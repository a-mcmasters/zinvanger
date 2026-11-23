import NotificationController from '@project/extension/src/controllers/notification-controller';

const mockFrame = {
    hidden: true,
    frame: { className: '' },
    bind: async () => true,
    client: async () => ({ onMessage() {}, updateState() {} }),
    show: () => (mockFrame.hidden = false),
    hide: () => (mockFrame.hidden = true),
    unbind() {},
    set language(_: string) {},
};
jest.mock('@project/extension/src/services/ui-frame', () => ({
    __esModule: true,
    uiFrameForHtml: () => mockFrame,
}));
jest.mock('@project/extension/src/services/localization-fetcher', () => ({ fetchLocalization: async () => ({}) }));
jest.mock('@/services/frame-color-scheme', () => ({ frameColorSchemeStyleBlock: () => '' }));

describe('NotificationController', () => {
    const contextFailingThemeRead = () =>
        ({
            pause: jest.fn(),
            settings: {
                getSingle: async (key: string) => {
                    if (key === 'themeType') throw new Error('storage unavailable');
                    return 'en';
                },
            },
        }) as any;

    beforeEach(() => (mockFrame.hidden = true));

    it('does not show its full-page frame when reading the theme fails', async () => {
        const controller = new NotificationController(contextFailingThemeRead());

        await expect(controller.show('title', 'message')).rejects.toThrow('storage unavailable');
        expect(mockFrame.hidden).toBe(true);
    });

    it('does not show its alert frame when reading the theme fails', async () => {
        const controller = new NotificationController(contextFailingThemeRead());

        await expect(controller.updateAlert('2.0.0')).rejects.toThrow('storage unavailable');
        expect(mockFrame.hidden).toBe(true);
    });
});
