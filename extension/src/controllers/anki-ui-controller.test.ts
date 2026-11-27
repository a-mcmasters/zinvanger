import AnkiUiController from '@project/extension/src/controllers/anki-ui-controller';

const mockClient = { onMessage: jest.fn(), updateState: jest.fn(), sendMessage: jest.fn() };
const mockFrame = {
    bind: jest.fn(async () => true),
    client: jest.fn(async () => mockClient),
    clientIfLoaded: mockClient as unknown,
    hidden: true,
    show: jest.fn(() => {
        mockFrame.hidden = false;
    }),
    hide: jest.fn(() => {
        mockFrame.hidden = true;
    }),
    unbind: jest.fn(),
    set fetchOptions(_: unknown) {},
    set language(_: string) {},
};
jest.mock('@project/extension/src/services/ui-frame', () => ({
    __esModule: true,
    default: class UiFrame {},
    uiFrameForHtml: () => mockFrame,
}));
jest.mock('@/services/build-flags', () => ({ isFirefoxBuild: false }));
jest.mock('@/services/tutorial', () => ({ isOnTutorialPage: () => false }));
jest.mock('@/services/translation-api-key', () => ({ getTranslationApiKey: async () => '' }));
jest.mock('@project/extension/src/services/localization-fetcher', () => ({ fetchLocalization: async () => ({}) }));
jest.mock('@project/extension/src/services/extension-global-state-provider', () => ({
    ExtensionGlobalStateProvider: class {
        getAll = async () => ({});
    },
}));

const fakeBinding = (overrides: Record<string, unknown> = {}) =>
    ({
        subscribed: true,
        video: { paused: false },
        pause: jest.fn(),
        play: jest.fn(),
        keyBindings: { unbind: jest.fn(), bind: jest.fn() },
        subtitleController: {},
        mobileVideoOverlayController: {},
        registeredVideoSrc: 'video',
        url: () => 'https://example.com',
        subtitleFileName: () => 'subs.srt',
        currentTimeMs: 0,
        settings: {
            getSingle: async () => 'en',
            profiles: async () => [],
            activeProfile: async () => undefined,
        },
        ...overrides,
    }) as any;

const showMessage = { subtitle: { start: 0, end: 1000, text: 'hi' }, surroundingSubtitles: [] } as any;

describe('AnkiUiController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFrame.clientIfLoaded = mockClient;
        mockFrame.hidden = true;
    });

    const controller = () => {
        const c = new AnkiUiController();
        c.updateSettings({ ankiConnectUrl: 'http://127.0.0.1:8765' } as any, {} as any);
        return c;
    };

    it('shows its full-page frame only after the dialog state is sent', async () => {
        await controller().show(fakeBinding(), showMessage);

        expect(mockClient.updateState).toHaveBeenCalled();
        expect(mockFrame.show).toHaveBeenCalledTimes(1);
        expect(mockClient.updateState.mock.invocationCallOrder[0]).toBeLessThan(
            mockFrame.show.mock.invocationCallOrder[0]
        );
    });

    it('does not show a frame that another open replaced while this one built its state', async () => {
        const binding = fakeBinding();
        binding.settings.profiles = async () => {
            mockFrame.clientIfLoaded = { replacement: true }; // e.g. a second open switched to the lookup frame
            return [];
        };

        await controller().show(binding, showMessage);
        expect(mockFrame.show).not.toHaveBeenCalled();
    });

    it('does not show its frame when building the dialog state fails', async () => {
        const binding = fakeBinding();
        binding.settings.profiles = () => Promise.reject(new Error('storage unavailable'));

        await expect(controller().show(binding, showMessage)).rejects.toThrow('storage unavailable');
        expect(mockFrame.show).not.toHaveBeenCalled();
    });

    const shows: [string, (c: AnkiUiController, binding: any) => Promise<void>][] = [
        ['show', (c, binding) => c.show(binding, showMessage)],
        ['showCardSelect', (c, binding) => c.showCardSelect(binding, showMessage)],
        ['showAfterRerecord', (c, binding) => c.showAfterRerecord(binding, showMessage)],
        ['showAfterRetakingScreenshot', (c, binding) => c.showAfterRetakingScreenshot(binding, showMessage)],
    ];

    const expectPlayerRestored = (binding: any) => {
        expect(binding.keyBindings.bind).toHaveBeenCalledWith(binding);
        expect(binding.subtitleController.forceHideSubtitles).toBe(false);
        expect(binding.mobileVideoOverlayController.forceHide).toBe(false);
        expect(binding.play).toHaveBeenCalled();
    };

    it.each(shows)('%s prepares the player as soon as the dialog is requested', async (_, open) => {
        const binding = fakeBinding();
        let preparedBeforeState = false;
        binding.settings.profiles = async () => {
            preparedBeforeState =
                binding.pause.mock.calls.length > 0 &&
                binding.keyBindings.unbind.mock.calls.length > 0 &&
                binding.subtitleController.forceHideSubtitles === true &&
                binding.mobileVideoOverlayController.forceHide === true;
            return [];
        };

        await open(controller(), binding);
        expect(preparedBeforeState).toBe(true);
        expect(binding.keyBindings.bind).not.toHaveBeenCalled();
        expect(binding.subtitleController.forceHideSubtitles).toBe(true);
        expect(binding.mobileVideoOverlayController.forceHide).toBe(true);
    });

    it.each(shows)('%s restores the player when building the dialog state fails', async (_, open) => {
        const binding = fakeBinding();
        binding.settings.profiles = () => Promise.reject(new Error('storage unavailable'));

        await expect(open(controller(), binding)).rejects.toThrow('storage unavailable');
        expectPlayerRestored(binding);
    });

    it.each(shows)('%s restores the player when the frame bridge times out', async (_, open) => {
        const binding = fakeBinding();
        mockFrame.client.mockRejectedValueOnce(new Error('timed out'));

        await expect(open(controller(), binding)).rejects.toThrow('timed out');
        expectPlayerRestored(binding);
    });

    it('does not resume a video the user had paused when the open fails', async () => {
        const binding = fakeBinding({ video: { paused: true } });
        mockFrame.client.mockRejectedValueOnce(new Error('timed out'));

        await expect(controller().show(binding, showMessage)).rejects.toThrow('timed out');
        expect(binding.keyBindings.bind).toHaveBeenCalled();
        expect(binding.play).not.toHaveBeenCalled();
    });

    it('keeps shortcuts off when an open fails under a dialog that is still visible', async () => {
        const binding = fakeBinding();
        mockFrame.hidden = false;
        mockFrame.client.mockRejectedValueOnce(new Error('timed out'));

        await expect(controller().show(binding, showMessage)).rejects.toThrow('timed out');
        expect(binding.keyBindings.bind).not.toHaveBeenCalled();
        expect(binding.subtitleController.forceHideSubtitles).toBe(true);
        expect(binding.play).not.toHaveBeenCalled();
    });

    it('leaves the player to an open still in flight when another one fails', async () => {
        const binding = fakeBinding();
        let finishSlowOpen!: () => void;
        binding.settings.profiles = () =>
            new Promise((resolve) => {
                finishSlowOpen = () => resolve([]);
            });
        const c = controller();
        const slow = c.show(binding, showMessage);
        await new Promise((r) => setTimeout(r, 0));
        mockFrame.client.mockRejectedValueOnce(new Error('timed out'));

        await expect(c.show(binding, showMessage)).rejects.toThrow('timed out');
        expect(binding.keyBindings.bind).not.toHaveBeenCalled();

        finishSlowOpen();
        await slow;
        // The slower open still shows its card, so the player stays as that dialog needs it.
        expect(mockClient.updateState).toHaveBeenCalledTimes(1);
        expect(mockFrame.show).toHaveBeenCalledTimes(1);
        expect(binding.keyBindings.bind).not.toHaveBeenCalled();
    });

    it('does not build a frame for a video that was unbound while the dialog was opening', async () => {
        const binding = fakeBinding();
        binding.settings.getSingle = async () => {
            binding.subscribed = false; // e.g. YouTube swapped the video while the language was read
            return 'en';
        };

        await expect(controller().show(binding, showMessage)).rejects.toThrow('unbound');
        expect(mockFrame.bind).not.toHaveBeenCalled();
        expect(mockFrame.show).not.toHaveBeenCalled();
    });

    it('racing opens restore focus to the element focused before the dialog', async () => {
        const iframe = document.createElement('iframe');
        const input = document.createElement('input');
        document.body.append(iframe, input);
        input.focus();
        // The dialog takes focus when it is shown (MUI Dialog autofocus): the parent's activeElement becomes the iframe.
        mockFrame.show.mockImplementationOnce(() => {
            mockFrame.hidden = false;
            iframe.focus();
        });
        const binding = fakeBinding({ postMinePlayback: 2 });
        // Two opens race (e.g. the mine shortcut pressed twice); the second one's state takes a little longer.
        let slow = false;
        binding.settings.profiles = async () => {
            if (slow) await new Promise((r) => setTimeout(r, 10));
            slow = true;
            return [];
        };
        const c = controller();

        await Promise.all([c.show(binding, showMessage), c.show(binding, showMessage)]);
        expect(document.activeElement).toBe(iframe);

        // The user closes the dialog.
        const onMessage = mockClient.onMessage.mock.calls[0][0];
        onMessage({ command: 'resume', uiState: { dialogRequestedTimestamp: 0 }, cardExported: false });
        await new Promise((r) => setTimeout(r, 0));
        expect(document.activeElement).toBe(input);
        document.body.replaceChildren();
    });
});
