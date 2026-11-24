import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ThemeProvider } from '@mui/material/styles';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { PostMineAction } from '@project/common';
import type { IndexedSubtitleModel } from '@project/common';
import { defaultSettings, SettingsProvider } from '@project/common/settings';
import { MockSettingsStorage } from '@project/common/settings/mock-settings-storage';
import { createTheme } from '@project/common/theme';
import { Yomitan } from '@project/common/yomitan';
import en from '@project/common/locales/en.json';
import VideoPlayer from '@project/common/app/components/VideoPlayer';
import { MiningContext } from '@project/common/app/services/mining-context';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@project/common/app/components/subtitles.css', () => ({}));

/** The channel to the app window: records what the player sends and lets the test push subtitles. */
const channels: any[] = [];

jest.mock('@project/common/app/services/player-channel', () => ({
    __esModule: true,
    default: class {
        callbacks: { [name: string]: (...args: any[]) => void } = {};
        copy = jest.fn();
        constructor() {
            channels.push(this);
            return new Proxy(this, {
                get: (target: any, name: string) => {
                    if (name in target) return target[name];
                    if (name.startsWith('on')) {
                        return (callback: any) => {
                            target.callbacks[name] = callback;
                            return () => {};
                        };
                    }
                    return () => {};
                },
            });
        }
    },
}));

const cue: IndexedSubtitleModel = {
    text: 'Hij zet koffie.',
    start: 0,
    end: 5000,
    originalStart: 0,
    originalEnd: 5000,
    track: 0,
    index: 0,
};

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

beforeAll(async () => {
    Object.defineProperty(screen, 'orientation', { value: { addEventListener() {}, removeEventListener() {} } });
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
});

describe('VideoPlayer', () => {
    let root: Root;
    let container: HTMLDivElement;

    beforeEach(() => {
        channels.length = 0;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        jest.spyOn(Yomitan.prototype, 'gloss').mockImplementation(async (word) => `meaning of ${word}`);
        jest.spyOn(Yomitan.prototype, 'lemmatize').mockResolvedValue(['zetten']);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        delete (document as any).caretPositionFromPoint;
    });

    const renderPlayer = async (cues = [cue], settings = defaultSettings) => {
        await act(async () =>
            root.render(
                <ThemeProvider theme={createTheme('dark')}>
                    <VideoPlayer
                        settings={settings}
                        settingsProvider={new SettingsProvider(new MockSettingsStorage())}
                        extension={{ supportsAppIntegration: false } as any}
                        supportsDictionaryPlayback={false}
                        videoFile="blob:video"
                        channel="channel"
                        popOut={false}
                        miningContext={new MiningContext()}
                        ankiDialogOpen={false}
                        onAnkiDialogRequest={() => {}}
                        onSettingsChanged={() => {}}
                        onAnkiDialogRewind={() => {}}
                        onError={() => {}}
                    />
                </ThemeProvider>
            )
        );
        const channel = channels[0];
        await act(async () => channel.callbacks.onReady(10, 'video.mp4'));
        await act(async () => channel.callbacks.onSubtitles(cues, ['subs.srt', 'translation.srt']));
        await flush();
        const subtitle = container.querySelector<HTMLElement>('[data-asb-subtitle-index="0"]')!;
        expect(subtitle).not.toBeNull();
        return { channel, subtitle };
    };

    /** A click on the on-video subtitle at a text offset (jsdom has no layout to hit-test). */
    const clickAt = async (target: HTMLElement, node: Node, offset: number) => {
        (document as any).caretPositionFromPoint = () => ({ offsetNode: node, offset });
        await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
        await flush();
    };

    it('clicking a word in the on-video subtitle opens its word card, and Mine mines it with that word', async () => {
        const translation = { ...cue, text: 'He makes coffee.', track: 1, index: 1 };
        const { channel, subtitle } = await renderPlayer([cue, translation]);

        await clickAt(subtitle, subtitle.firstChild!, 5); // inside "zet"

        const card = container.querySelector<HTMLElement>('[role="dialog"][aria-label="zet"]');
        expect(card).not.toBeNull();
        expect(card!.textContent).toContain('meaning of zet');
        const mine = [...card!.querySelectorAll('button')].find((button) => button.textContent === 'Mine')!;
        expect(mine).toBeDefined();

        await act(async () => mine.click());
        await flush();

        expect(channel.copy).toHaveBeenCalledTimes(1);
        const [minedSubtitle, surroundingSubtitles, cardTextFieldValues] = channel.copy.mock.calls[0];
        expect(minedSubtitle).toMatchObject({ text: cue.text, start: cue.start, end: cue.end });
        expect(surroundingSubtitles).toEqual([cue]);
        expect(cardTextFieldValues).toMatchObject({ word: 'zet', definition: 'meaning of zet' });
    });

    it('lets the app report the outcome of a direct export', async () => {
        const { channel, subtitle } = await renderPlayer([cue], {
            ...defaultSettings,
            clickToMineDefaultAction: PostMineAction.exportCard,
        });
        await clickAt(subtitle, subtitle.firstChild!, 5);
        const card = container.querySelector<HTMLElement>('[role="dialog"][aria-label="zet"]')!;
        const mine = [...card.querySelectorAll('button')].find((button) => button.textContent === 'Mine')!;

        await act(async () => mine.click());

        expect(channel.copy).toHaveBeenCalledTimes(1);
        expect(container.contains(card)).toBe(false);
    });

    it('opens the decoded word after a subtitle line break', async () => {
        const { subtitle } = await renderPlayer([{ ...cue, text: 'Drie<br>auto&#39;s' }]);

        await clickAt(subtitle, subtitle.lastChild!, 2);

        expect(container.querySelector(`[role="dialog"][aria-label="auto's"]`)).not.toBeNull();
    });

    it('dismisses the word card when seeking within the same cue', async () => {
        const { subtitle } = await renderPlayer();

        await clickAt(subtitle, subtitle.firstChild!, 5);
        expect(container.querySelector('[role="dialog"][aria-label="zet"]')).not.toBeNull();

        await act(async () => container.querySelector('video')!.dispatchEvent(new Event('seeking')));

        expect(container.querySelector('[role="dialog"][aria-label="zet"]')).toBeNull();
    });
});
