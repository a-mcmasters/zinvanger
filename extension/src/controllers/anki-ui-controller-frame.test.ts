import { PostMinePlayback } from '@project/common';
import AnkiUiController from '@/controllers/anki-ui-controller';
import FrameBridgeClient from '@/services/frame-bridge-client';

// Opens the dialog through the real UiFrame and FrameBridgeClient; only the frame's ready handshake is faked.

const mockToken = jest.fn<Promise<string>, []>();
jest.mock('@/services/local-lookup-token', () => ({
    getLocalLookupToken: () => mockToken(),
    minimumLocalLookupTokenLength: 32,
}));
jest.mock('@/services/build-flags', () => ({ isFirefoxBuild: false }));
jest.mock('@/services/tutorial', () => ({ isOnTutorialPage: () => false }));
jest.mock('@/services/localization-fetcher', () => ({ fetchLocalization: async () => ({}) }));
jest.mock('@/services/extension-global-state-provider', () => ({
    ExtensionGlobalStateProvider: class {
        getAll = async () => ({});
    },
}));

const gate = () => {
    let open!: () => void;
    const wait = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { open, wait };
};

const showMessage = (text: string) =>
    ({ subtitle: { start: 9000, end: 10000, text }, surroundingSubtitles: [] }) as any;

function mockBinding() {
    let playing = true;
    let currentTimeMs = 10000;
    return {
        subscribed: true,
        get currentTimeMs() {
            return currentTimeMs;
        },
        get playing() {
            return playing;
        },
        get video() {
            return { paused: !playing };
        },
        advance(milliseconds: number) {
            if (playing) currentTimeMs += milliseconds;
        },
        pause: jest.fn(() => {
            playing = false;
        }),
        play: jest.fn(() => {
            playing = true;
        }),
        seek: jest.fn(async (timestamp: number) => {
            currentTimeMs = timestamp;
        }),
        keyBindings: { bind: jest.fn(), unbind: jest.fn() },
        subtitleController: {} as { forceHideSubtitles?: boolean },
        mobileVideoOverlayController: {} as { forceHide?: boolean },
        registeredVideoSrc: 'video',
        url: () => 'https://example.com',
        subtitleFileName: () => 'subs.srt',
        settings: {
            getSingle: async () => 'en',
            profiles: jest.fn(async () => []),
            activeProfile: async () => undefined,
        },
    };
}

function controller() {
    const c = new AnkiUiController();
    c.updateSettings({ ankiConnectUrl: 'http://127.0.0.1:8765' } as any, {} as any);
    return c;
}

describe('AnkiUiController with a real frame', () => {
    beforeEach(() => {
        mockToken.mockReset().mockResolvedValue('');
        Reflect.set(globalThis, 'browser', {
            runtime: {
                getURL: (path: string) => new URL(path, 'https://extension.invalid').href,
                sendMessage: jest.fn().mockResolvedValue(undefined),
            },
        });
        jest.spyOn(FrameBridgeClient.prototype, '_bindClient').mockImplementation(async function (
            this: FrameBridgeClient
        ) {
            Reflect.set(this, 'frameId', 'test-frame');
        });
        jest.spyOn(window, 'focus').mockImplementation(() => {});
    });

    afterEach(() => {
        document.body.replaceChildren();
        jest.restoreAllMocks();
    });

    it('returns to the playhead of the request after exporting, however slow the frame loads', async () => {
        const load = gate();
        const stateStarted = gate();
        const state = gate();
        jest.spyOn(FrameBridgeClient.prototype, '_bindClient').mockImplementationOnce(async function (
            this: FrameBridgeClient
        ) {
            await load.wait;
            Reflect.set(this, 'frameId', 'test-frame');
        });
        const update = jest.spyOn(FrameBridgeClient.prototype, 'updateState');
        const context = mockBinding();
        context.settings.profiles.mockImplementationOnce(async () => {
            stateStarted.open();
            await state.wait;
            return [];
        });
        const c = controller();
        const opening = c.show(context as any, showMessage('mine'));
        await Promise.resolve();
        await Promise.resolve();
        context.advance(3000);
        load.open();
        await stateStarted.wait;
        context.advance(1000);
        state.open();
        await opening;
        // The user exports the card, which closes the dialog.
        const closeDialog = Reflect.get(update.mock.instances[0] as unknown as object, 'serverMessageListener');
        await closeDialog({
            command: 'resume',
            cardExported: true,
            uiState: update.mock.calls[0][0],
        });
        expect(context.currentTimeMs).toBe(10000);
    });

    it('does not pause a video that was unbound while the dialog state was built', async () => {
        const stateStarted = gate();
        const state = gate();
        const context = mockBinding();
        context.settings.profiles.mockImplementationOnce(async () => {
            stateStarted.open();
            await state.wait;
            return [];
        });
        const c = controller();
        const opening = c.show(context as any, showMessage('mine'));
        await stateStarted.wait;
        c.unbind();
        context.subscribed = false;
        context.play();
        state.open();
        await opening.catch(() => {});

        expect({
            iframePresent: !!document.querySelector('iframe'),
            playerPlaying: context.playing,
        }).toEqual({ iframePresent: false, playerPlaying: true });
    });

    it('hides the lookup frame and restores the player when the dialog state cannot be delivered', async () => {
        mockToken.mockResolvedValue('a'.repeat(32));
        (browser.runtime.sendMessage as jest.Mock).mockRejectedValueOnce(new Error('Receiving end does not exist.'));
        const context = mockBinding();
        const c = controller();
        await c.show(context as any, showMessage('mine')).catch(() => {});

        const lastCall = (mock: jest.Mock) => Math.max(0, ...mock.mock.invocationCallOrder);
        expect({
            playerPlaying: context.playing,
            controllerShowing: c.showing,
            // Shortcuts are unbound at request time, so they must have been bound again since.
            shortcutsBound: lastCall(context.keyBindings.bind) > lastCall(context.keyBindings.unbind),
        }).toEqual({ playerPlaying: true, controllerShowing: false, shortcutsBound: true });
    });

    const closeDialog = (update: jest.SpyInstance, index: number, message: object) =>
        Reflect.get(
            update.mock.instances[index] as object,
            'serverMessageListener'
        )({
            command: 'resume',
            uiState: update.mock.calls[index][0],
            ...message,
        });
    const last = (mock: jest.Mock) => Math.max(0, ...mock.mock.invocationCallOrder);

    it('does not resume playback after an obsolete open settles following a close with pause selected', async () => {
        const started = gate();
        const release = gate();
        const context = Object.assign(mockBinding(), { postMinePlayback: PostMinePlayback.pause });
        context.settings.profiles.mockImplementationOnce(async () => {
            started.open();
            await release.wait;
            throw new Error('obsolete settings read failed');
        });
        const update = jest.spyOn(FrameBridgeClient.prototype, 'updateState');
        const c = controller();
        const older = c.show(context as any, showMessage('older')).catch(() => {});
        await started.wait;
        await c.show(context as any, showMessage('newer'));
        await closeDialog(update, 0, { cardExported: false });
        const restoredOnClose = context.keyBindings.bind.mock.calls.length;
        release.open();
        await older;
        expect({
            restoredOnClose,
            playCalls: context.play.mock.calls.length,
            playingAfterObsoleteRequest: context.playing,
        }).toEqual({ restoredOnClose: 1, playCalls: 0, playingAfterObsoleteRequest: false });
    });

    it('keeps the video paused when a re-open fails after the first dialog closed with pause selected', async () => {
        const update = jest.spyOn(FrameBridgeClient.prototype, 'updateState');
        const context = Object.assign(mockBinding(), { postMinePlayback: PostMinePlayback.pause });
        const c = controller();
        await c.show(context as any, showMessage('first'));
        const started = gate();
        const fail = gate();
        context.settings.profiles.mockImplementationOnce(async () => {
            started.open();
            await fail.wait;
            throw new Error('storage unavailable');
        });
        const second = c.show(context as any, showMessage('second'));
        await started.wait;
        await closeDialog(update, 0, { cardExported: true });
        const playingAfterClose = context.playing;
        fail.open();
        await second.catch(() => {});
        expect({
            playingAfterClose,
            playingAfterFailedOpen: context.playing,
            shortcutsBound: last(context.keyBindings.bind) > last(context.keyBindings.unbind),
            subtitlesHidden: context.subtitleController.forceHideSubtitles,
        }).toEqual({
            playingAfterClose: false,
            playingAfterFailedOpen: false,
            shortcutsBound: true,
            subtitlesHidden: false,
        });
    });

    it('preserves the visible card and leaves mine shortcuts off when a lookup replacement cannot be delivered', async () => {
        mockToken.mockResolvedValue('a'.repeat(32));
        const sent = browser.runtime.sendMessage as jest.Mock;
        const context = mockBinding();
        const c = controller();
        await c.show(context as any, showMessage('visible'));
        expect(c.showing).toBe(true);
        sent.mockRejectedValueOnce(new Error('replacement could not be serialized'));
        await c.show(context as any, showMessage('replacement')).catch(() => {});
        await Promise.resolve();
        expect({
            originalFrameVisible: c.showing,
            shortcutBindCalls: context.keyBindings.bind.mock.calls.length,
            playing: context.playing,
        }).toEqual({ originalFrameVisible: true, shortcutBindCalls: 0, playing: false });
    });

    it('restores the player when a pending lookup send is rejected after a newer open fails setup', async () => {
        mockToken.mockResolvedValue('a'.repeat(32));
        const sent = gate();
        let rejectSend!: (error: Error) => void;
        const pendingSend = new Promise((_resolve, reject) => {
            rejectSend = reject;
        });
        (browser.runtime.sendMessage as jest.Mock).mockImplementationOnce(() => {
            sent.open();
            return pendingSend;
        });
        const context = mockBinding();
        const c = controller();
        const older = c.show(context as any, showMessage('pending delivery')).catch(() => {});
        await sent.wait;
        context.settings.profiles.mockRejectedValueOnce(new Error('settings read failed'));
        await c.show(context as any, showMessage('newer')).catch(() => {});
        rejectSend(new Error('no lookup frame received the state'));
        await older;
        await Promise.resolve();
        expect({
            showing: c.showing,
            playing: context.playing,
            shortcutBindCalls: context.keyBindings.bind.mock.calls.length,
        }).toEqual({ showing: false, playing: true, shortcutBindCalls: 1 });
    });

    it('restores the player when a newer open fails after the shown card could not be delivered', async () => {
        mockToken.mockResolvedValue('a'.repeat(32));
        let rejectSend!: (error: Error) => void;
        (browser.runtime.sendMessage as jest.Mock).mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    rejectSend = reject;
                })
        );
        const context = mockBinding();
        const c = controller();
        await c.show(context as any, showMessage('undeliverable')); // shown while its card is still on its way
        const started = gate();
        const fail = gate();
        context.settings.profiles.mockImplementationOnce(async () => {
            started.open();
            await fail.wait;
            throw new Error('storage unavailable');
        });
        const reopen = c.show(context as any, showMessage('newer')).catch(() => {});
        await started.wait;
        rejectSend(new Error('Receiving end does not exist.'));
        await new Promise((r) => setTimeout(r, 0));
        fail.open();
        await reopen;
        await new Promise((r) => setTimeout(r, 0));
        expect({
            frameShowing: c.showing,
            shortcutsBound: last(context.keyBindings.bind) > last(context.keyBindings.unbind),
            playing: context.playing,
        }).toEqual({ frameShowing: false, shortcutsBound: true, playing: true });
    });

    it('restores the page when two lookup updates were sent and both fail to deliver', async () => {
        mockToken.mockResolvedValue('a'.repeat(32));
        const rejectUpdate: ((error: Error) => void)[] = [];
        const runtime = browser.runtime.sendMessage as jest.Mock;
        runtime.mockImplementation(() => new Promise((_resolve, reject) => rejectUpdate.push(reject)));
        const context = mockBinding();
        const c = controller();
        await c.show(context as any, showMessage('A')); // shown while its card is still on its way
        await c.show(context as any, showMessage('B')); // replaces it before the first failure is known
        expect(runtime.mock.calls.map(([request]) => request.message.state.subtitle.text)).toEqual(['A', 'B']);
        rejectUpdate[0](new Error('A could not be delivered'));
        rejectUpdate[1](new Error('B could not be delivered'));
        await new Promise((r) => setTimeout(r, 0));

        expect({
            showing: c.showing,
            playing: context.playing,
            shortcutBindCalls: context.keyBindings.bind.mock.calls.length,
            shortcutsBound: last(context.keyBindings.bind) > last(context.keyBindings.unbind),
            subtitlesHidden: context.subtitleController.forceHideSubtitles,
            overlayHidden: context.mobileVideoOverlayController.forceHide,
        }).toEqual({
            showing: false,
            playing: true,
            shortcutBindCalls: 1,
            shortcutsBound: true,
            subtitlesHidden: false,
            overlayHidden: false,
        });
    });

    it.each(['export', 'rewind', 'rerecord'])(
        'honors %s from A when B is loading and B is later cancelled',
        async (action) => {
            const update = jest.spyOn(FrameBridgeClient.prototype, 'updateState');
            const context = Object.assign(mockBinding(), {
                postMinePlayback: PostMinePlayback.pause,
                rerecord: jest.fn(),
            });
            const c = controller();
            await c.show(context as any, showMessage('A')); // requested at 10000
            const stateStarted = gate();
            const unblock = gate();
            context.settings.profiles.mockImplementationOnce(async () => {
                stateStarted.open();
                await unblock.wait;
                return [];
            });
            await context.seek(15000); // e.g. the next mine's recording moved the playhead
            context.seek.mockClear();
            const openB = c.show(context as any, showMessage('B'));
            await stateStarted.wait;
            if (action === 'export') {
                await closeDialog(update, 0, { cardExported: true });
            } else if (action === 'rewind') {
                await closeDialog(update, 0, { command: 'rewind' });
            } else {
                await closeDialog(update, 0, { command: 'rerecord', recordStart: 9000, recordEnd: 10000 });
            }
            unblock.open();
            await openB;
            await closeDialog(update, 1, { cardExported: false });

            const seeks = context.seek.mock.calls.map(([ms]) => ms);
            const rerecords = context.rerecord.mock.calls.map(([start, end, state]) => [
                start,
                end,
                state.subtitle.text,
            ]);
            expect({ seeks, rerecords }).toEqual({
                seeks: action === 'export' ? [10000] : action === 'rewind' ? [9000] : [],
                rerecords: action === 'rerecord' ? [[9000, 10000, 'A']] : [],
            });
        }
    );

    it('rerecords when the only dialog closes with rerecord', async () => {
        const update = jest.spyOn(FrameBridgeClient.prototype, 'updateState');
        const context = Object.assign(mockBinding(), { rerecord: jest.fn() });
        const c = controller();
        await c.show(context as any, showMessage('first'));
        await closeDialog(update, 0, { command: 'rerecord', recordStart: 9000, recordEnd: 10000 });
        expect(context.rerecord).toHaveBeenCalledTimes(1);
    });

    it('applies playback policy at the close even when B subsequently fails to open', async () => {
        const update = jest.spyOn(FrameBridgeClient.prototype, 'updateState');
        const context = Object.assign(mockBinding(), { postMinePlayback: PostMinePlayback.pause });
        const c = controller();
        await c.show(context as any, showMessage('A'));
        const stateStarted = gate();
        const failB = gate();
        context.settings.profiles.mockImplementationOnce(async () => {
            stateStarted.open();
            await failB.wait;
            throw new Error('storage unavailable');
        });
        const openB = c.show(context as any, showMessage('B')).catch(() => {});
        await stateStarted.wait;
        await closeDialog(update, 0, { cardExported: false });
        context.postMinePlayback = PostMinePlayback.play;
        failB.open();
        await openB;
        expect({ showing: c.showing, playing: context.playing, playCalls: context.play.mock.calls.length }).toEqual({
            showing: false,
            playing: false,
            playCalls: 0,
        });
    });

    it('restores the player if the page removes the dialog frame while the card loads', async () => {
        const stateStarted = gate();
        const state = gate();
        const context = mockBinding();
        context.settings.profiles.mockImplementationOnce(async () => {
            stateStarted.open();
            await state.wait;
            return [];
        });
        const c = controller();
        const opening = c.show(context as any, showMessage('mine'));
        await stateStarted.wait;
        document.querySelector('iframe')!.remove(); // e.g. the site re-rendered its player
        state.open();
        await expect(opening).rejects.toThrow('removed');

        expect({
            showing: c.showing,
            playing: context.playing,
            shortcutsBound: last(context.keyBindings.bind) > last(context.keyBindings.unbind),
            subtitlesHidden: context.subtitleController.forceHideSubtitles,
        }).toEqual({ showing: false, playing: true, shortcutsBound: true, subtitlesHidden: false });
    });

    it('restores the player when the page removed the shown dialog frame, and opens the next card in a new frame', async () => {
        const context = mockBinding();
        const c = controller();
        await c.show(context as any, showMessage('A'));
        const frameA = document.querySelector('iframe')!;
        frameA.remove(); // e.g. the site re-rendered <body>

        await expect(c.show(context as any, showMessage('B'))).rejects.toThrow('removed');
        expect({
            showing: c.showing,
            playing: context.playing,
            shortcutsBound: last(context.keyBindings.bind) > last(context.keyBindings.unbind),
            subtitlesHidden: context.subtitleController.forceHideSubtitles,
        }).toEqual({ showing: false, playing: true, shortcutsBound: true, subtitlesHidden: false });

        await c.show(context as any, showMessage('C'));
        const frameC = document.querySelector('iframe');
        expect({ showing: c.showing, newFrame: frameC !== null && frameC !== frameA }).toEqual({
            showing: true,
            newFrame: true,
        });
    });

    it('still shows the lookup dialog if the page moves its frame while the card loads', async () => {
        // A src frame reloads when moved and handshakes again (checked in Chromium), so it is not lost.
        mockToken.mockResolvedValue('a'.repeat(32));
        const stateStarted = gate();
        const state = gate();
        const context = mockBinding();
        context.settings.profiles.mockImplementationOnce(async () => {
            stateStarted.open();
            await state.wait;
            return [];
        });
        const c = controller();
        const opening = c.show(context as any, showMessage('mine'));
        await stateStarted.wait;
        document.body.appendChild(document.createElement('div')).appendChild(document.querySelector('iframe')!);
        state.open();
        await opening;

        expect(c.showing).toBe(true);
    });

    it('restores the player if the page moves the html frame while the card loads', async () => {
        mockToken.mockResolvedValue('');
        const stateStarted = gate();
        const state = gate();
        const context = mockBinding();
        context.settings.profiles.mockImplementationOnce(async () => {
            stateStarted.open();
            await state.wait;
            return [];
        });
        const c = controller();
        const opening = c.show(context as any, showMessage('mine'));
        await stateStarted.wait;
        // Moving an iframe reloads it: the dialog document is gone, though the frame is in the page again.
        document.body.appendChild(document.createElement('div')).appendChild(document.querySelector('iframe')!);
        state.open();
        await expect(opening).rejects.toThrow('removed');

        expect({
            showing: c.showing,
            playing: context.playing,
            shortcutsBound: last(context.keyBindings.bind) > last(context.keyBindings.unbind),
            subtitlesHidden: context.subtitleController.forceHideSubtitles,
        }).toEqual({ showing: false, playing: true, shortcutsBound: true, subtitlesHidden: false });
    });
});
