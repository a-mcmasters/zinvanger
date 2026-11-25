import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, jest } from '@jest/globals';
import { ThemeProvider } from '@mui/material/styles';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { CardModel } from '@project/common';
import { Anki } from '@project/common/anki';
import type { ExportParams } from '@project/common/anki';
import { AudioClip } from '@project/common/audio-clip';
import { addBlobUrl } from '@project/common/blob-url';
import AnkiDialog from '@project/common/components/AnkiDialog';
import en from '@project/common/locales/en.json';
import { defaultSettings } from '@project/common/settings';
import { createTheme } from '@project/common/theme';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('warns that a previewed picture needs an Anki field before it can be exported', async () => {
    const card: CardModel = {
        subtitle: { text: 'Ik zie een foto.', start: 0, end: 1000, originalStart: 0, originalEnd: 1000, track: 0 },
        subtitleFileName: 'episode.srt',
        surroundingSubtitles: [],
        image: {
            base64: 'UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoBAAEAAUAmJaACdLoAA5gA/u3O3+HKn07O7/5Bjt57ed2AAAA=',
            extension: 'webp',
        },
        mediaTimestamp: 0,
    };
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const anki = new Anki(defaultSettings, {
        fetch: async (_url, { action }) => ({ result: action === 'version' ? 6 : [], error: null }),
    });
    const render = (imageField: string) =>
        act(async () =>
            root.render(
                <I18nextProvider i18n={i18n}>
                    <ThemeProvider theme={createTheme('dark')}>
                        <AnkiDialog
                            open
                            disabled={false}
                            card={card}
                            onProceed={async () => {}}
                            onCancel={() => {}}
                            onCopyToClipboard={() => {}}
                            mp3Encoder={async (blob) => blob}
                            settings={{ ...defaultSettings, imageField }}
                            anki={anki}
                        />
                    </ThemeProvider>
                </I18nextProvider>
            )
        );

    try {
        await render('');
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            'Choose an Image Field in Anki settings to save this picture.'
        );
        await render('Picture');
        expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
            'Choose an Image Field in Anki settings to save this picture.'
        );
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

it.each([
    { name: 'expands to a neighboring cue', hasNeighbor: true, cueEnd: 2000, selectedEnd: 3000 },
    { name: 'expands an isolated cue', hasNeighbor: false, cueEnd: 2000, selectedEnd: 3000 },
    {
        name: 'retains a recording when resetting an isolated cue clamped to EOF',
        hasNeighbor: false,
        cueEnd: 3500,
        selectedEnd: 3200,
    },
])('$name', async ({ hasNeighbor, cueEnd, selectedEnd }) => {
    const subtitle = { text: 'Dit is', start: 1000, end: cueEnd, originalStart: 1000, originalEnd: cueEnd, track: 0 };
    const card: CardModel = {
        subtitle,
        subtitleFileName: 'episode.srt',
        surroundingSubtitles: hasNeighbor
            ? [subtitle, { text: 'een zin.', start: 2100, end: 3000, originalStart: 2100, originalEnd: 3000, track: 0 }]
            : [subtitle],
        file: { name: 'episode.mp4', blobUrl: 'blob:anki-dialog-local-audio' },
        image: { base64: 'AA==', extension: 'webp' },
        mediaTimestamp: 1000,
    };
    addBlobUrl('blob:anki-dialog-local-audio');
    const originalMediaRecorder = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
    Object.defineProperty(globalThis, 'MediaRecorder', {
        configurable: true,
        value: { isTypeSupported: () => true },
    });
    const record = jest.spyOn(AudioClip.prototype, 'blob').mockResolvedValue(new Blob(['audio']));
    jest.spyOn(AudioClip.prototype, 'sourceDurationMs').mockResolvedValue(3200);
    const slice = jest.spyOn(AudioClip.prototype, 'slice');
    const onProceed = jest.fn<(params: ExportParams) => Promise<void>>().mockResolvedValue(undefined);
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const anki = new Anki(defaultSettings, {
        fetch: async (_url, { action }) => ({ result: action === 'version' ? 6 : [], error: null }),
    });

    try {
        await act(async () => {
            root.render(
                <I18nextProvider i18n={i18n}>
                    <ThemeProvider theme={createTheme('dark')}>
                        <AnkiDialog
                            open
                            disabled={false}
                            card={card}
                            onProceed={onProceed}
                            onCancel={() => {}}
                            onCopyToClipboard={() => {}}
                            mp3Encoder={async (blob) => blob}
                            settings={{ ...defaultSettings, preferMp3: false, audioPaddingStart: 100 }}
                            anki={anki}
                        />
                    </ThemeProvider>
                </I18nextProvider>
            );
        });
        const end = document.querySelectorAll<HTMLInputElement>('input[type="range"]')[1];
        expect(end.max).toBe(hasNeighbor ? '3000' : '3200');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(end, String(selectedEnd));
            end.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(end.value).toBe(String(selectedEnd));
        expect(record).not.toHaveBeenCalled();

        const rerecord = document.querySelector<HTMLButtonElement>('button[aria-label="Rerecord"]');
        expect(rerecord).not.toBeNull();
        await act(async () => rerecord!.click());
        expect(record).toHaveBeenCalledTimes(1);
        expect(slice).toHaveBeenLastCalledWith(900, selectedEnd + 500);
        expect(rerecord!.getAttribute('aria-label')).toBe('Rerecord');
        const firstTake = record.mock.contexts[0];
        await act(async () => rerecord!.click());
        expect(record).toHaveBeenCalledTimes(2);
        expect(record.mock.contexts[1]).not.toBe(firstTake);

        record.mockRejectedValueOnce(new Error('Cannot capture audio'));
        await act(async () => rerecord!.click());
        expect(record).toHaveBeenCalledTimes(3);
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Audio capture failed');

        if (cueEnd > selectedEnd) {
            const reset = document.querySelector<HTMLButtonElement>('[aria-label="Reset"] button');
            expect(reset).not.toBeNull();
            await act(async () => reset!.click());
            expect(end.value).toBe(String(selectedEnd));
        }

        const exportButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Export');
        await act(async () => exportButton!.click());
        expect(onProceed.mock.calls[0][0].text).toBe(hasNeighbor ? 'Dit is\neen zin.' : 'Dit is');
        expect(onProceed.mock.calls[0][0].audioClip).toBe(record.mock.contexts[1]);
    } finally {
        await act(async () => root.unmount());
        container.remove();
        jest.restoreAllMocks();
        if (originalMediaRecorder) Object.defineProperty(globalThis, 'MediaRecorder', originalMediaRecorder);
        else Reflect.deleteProperty(globalThis, 'MediaRecorder');
    }
});
