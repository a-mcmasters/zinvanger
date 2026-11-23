import UiFrame from '@project/extension/src/services/ui-frame';

jest.mock('@project/extension/src/services/build-flags', () => ({ isFirefoxBuild: false }));
const mockBridgeBinds: { resolve: () => void; reject: (error: Error) => void }[] = [];
jest.mock('@project/extension/src/services/frame-bridge-client', () =>
    jest.fn().mockImplementation(() => ({
        bind: () => new Promise<void>((resolve, reject) => mockBridgeBinds.push({ resolve, reject })),
        unbind: jest.fn(),
    }))
);
// Settles every pending bridge bind on the next microtask, so tests can await frame setup.
const settleBridges = (error?: Error) =>
    Promise.resolve().then(() => mockBridgeBinds.splice(0).forEach((b) => (error ? b.reject(error) : b.resolve())));

describe('UiFrame', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        mockBridgeBinds.length = 0;
    });

    it('creates its full-page frame hidden so it cannot swallow page clicks before show()', async () => {
        const frame = new UiFrame(async () => {});
        const client = frame.client();
        await settleBridges();
        await client;

        expect(frame.frame!.isConnected).toBe(true);
        expect(frame.hidden).toBe(true);
        frame.show();
        expect(frame.hidden).toBe(false);
    });

    it('is no longer bound after unbind, so settings pushes do not recreate the frame', async () => {
        const frame = new UiFrame(async () => {});
        const bound = frame.bind();
        await settleBridges();
        await bound;
        frame.unbind();

        expect(frame.bound).toBe(false);
        expect(document.querySelector('iframe')).toBeNull();
    });

    it('makes a bind() that overlaps a settings-push client() wait for the frame and report it as new', async () => {
        const frame = new UiFrame(async () => {});
        let settingsClientReady = false;
        const settingsClient = frame.client().then(() => (settingsClientReady = true));
        const dialogBind = frame.bind();
        await Promise.resolve();
        expect(settingsClientReady).toBe(false);

        await settleBridges();
        await settingsClient;
        expect(await dialogBind).toBe(true);
        expect(document.querySelectorAll('iframe')).toHaveLength(1);
    });

    it('leaves a frame that fails to load hidden and retries with a fresh one', async () => {
        const frame = new UiFrame(async () => {});
        const failed = frame.bind();
        await settleBridges(new Error('Timed out waiting for frame to be ready'));
        await expect(failed).rejects.toThrow('Timed out');
        expect(frame.hidden).toBe(true);

        const retried = frame.bind();
        await settleBridges();
        expect(await retried).toBe(true);
        expect(document.querySelectorAll('iframe')).toHaveLength(1);
    });
});
