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

    it('reports itself unbound and removes its frame after unbind()', async () => {
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
        let dialogBindSettled = false;
        const settingsClient = frame.client().then(() => (settingsClientReady = true));
        const dialogBind = frame.bind().finally(() => (dialogBindSettled = true));
        await Promise.resolve();
        await Promise.resolve();
        expect(settingsClientReady).toBe(false);
        expect(dialogBindSettled).toBe(false);

        await settleBridges();
        await settingsClient;
        expect(await dialogBind).toBe(true);
        expect(await frame.bind()).toBe(false); // handlers are wired once per client
        expect(document.querySelectorAll('iframe')).toHaveLength(1);
    });

    it('builds a fresh frame after being unbound while its first load was still pending', async () => {
        const frame = new UiFrame(async () => {});
        const pending = frame.bind();
        frame.unbind();
        await settleBridges(); // even if the torn-down load still completes, it must not be reused
        await pending;
        expect(document.querySelector('iframe')).toBeNull();

        const rebound = frame.bind();
        await settleBridges();
        expect(await rebound).toBe(true);
        expect(document.querySelectorAll('iframe')).toHaveLength(1);
        expect(frame.hidden).toBe(true);
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
