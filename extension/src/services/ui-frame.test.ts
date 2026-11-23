import UiFrame from '@project/extension/src/services/ui-frame';

jest.mock('@project/extension/src/services/build-flags', () => ({ isFirefoxBuild: false }));
jest.mock('@project/extension/src/services/frame-bridge-client', () =>
    jest.fn().mockImplementation(() => ({ bind: jest.fn().mockResolvedValue(undefined), unbind: jest.fn() }))
);

describe('UiFrame', () => {
    afterEach(() => (document.body.innerHTML = ''));

    it('creates its full-page frame hidden so it cannot swallow page clicks before show()', async () => {
        const frame = new UiFrame(async () => {});
        await frame.client();

        expect(frame.frame!.isConnected).toBe(true);
        expect(frame.hidden).toBe(true);
        frame.show();
        expect(frame.hidden).toBe(false);
    });

    it('is no longer bound after unbind, so settings pushes do not recreate the frame', async () => {
        const frame = new UiFrame(async () => {});
        await frame.bind();
        frame.unbind();

        expect(frame.bound).toBe(false);
        expect(document.querySelector('iframe')).toBeNull();
    });
});
