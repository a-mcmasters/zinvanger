import AnkiUiController from '@project/extension/src/controllers/anki-ui-controller';

const mockFrame = {
    bind: jest.fn(async () => true),
    client: jest.fn(async () => ({ onMessage: jest.fn(), updateState: jest.fn(), sendMessage: jest.fn() })),
    show: jest.fn(),
    unbind: jest.fn(),
    hidden: true,
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
jest.mock('@/services/local-lookup-token', () => ({ getLocalLookupToken: async () => '' }));
jest.mock('@project/extension/src/services/localization-fetcher', () => ({ fetchLocalization: async () => ({}) }));
jest.mock('@project/extension/src/services/extension-global-state-provider', () => ({
    ExtensionGlobalStateProvider: class {
        getAll = async () => ({});
    },
}));

const fakeBinding = (overrides: Record<string, unknown> = {}) =>
    ({
        subscribed: true,
        pause: jest.fn(),
        keyBindings: { unbind: jest.fn() },
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
    beforeEach(() => jest.clearAllMocks());

    const controller = () => {
        const c = new AnkiUiController();
        c.updateSettings({ ankiConnectUrl: 'http://127.0.0.1:8765' } as any, {} as any);
        return c;
    };

    it('shows its full-page frame only after the dialog state is sent', async () => {
        await controller().show(fakeBinding(), showMessage);

        const client = await mockFrame.client.mock.results[0].value;
        expect(client.updateState).toHaveBeenCalled();
        expect(mockFrame.show).toHaveBeenCalledTimes(1);
        expect(client.updateState.mock.invocationCallOrder[0]).toBeLessThan(mockFrame.show.mock.invocationCallOrder[0]);
    });

    it('leaves the frame hidden when building the dialog state fails, so it cannot block page clicks', async () => {
        const binding = fakeBinding();
        binding.settings.profiles = () => Promise.reject(new Error('storage unavailable'));

        await expect(controller().show(binding, showMessage)).rejects.toThrow('storage unavailable');
        expect(mockFrame.show).not.toHaveBeenCalled();
    });

    it('does not build a frame for a video that was unbound while the dialog was opening', async () => {
        await expect(controller().show(fakeBinding({ subscribed: false }), showMessage)).rejects.toThrow('unbound');
        expect(mockFrame.bind).not.toHaveBeenCalled();
        expect(mockFrame.show).not.toHaveBeenCalled();
    });
});
