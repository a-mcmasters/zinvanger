import project from '@project/common/project';
import TranslateAppSentenceHandler from '@/handlers/asbplayerv2/translate-app-sentence-handler';
import { localLookup } from '@/services/local-lookup-client';

let mockFirefoxBuild = false;
jest.mock('@/services/build-flags', () => ({
    get isFirefoxBuild() {
        return mockFirefoxBuild;
    },
}));
jest.mock('@/services/local-lookup-client', () => ({ localLookup: jest.fn() }));

const lookup = jest.mocked(localLookup);
const appUrl = project.urls.app;
const appSender = {
    id: 'test-extension',
    origin: new URL(appUrl).origin,
    url: `${appUrl}?video=example`,
    tab: { url: appUrl } as Browser.tabs.Tab,
};
const request = {
    sender: 'asbplayerv2',
    message: { command: 'translate-app-sentence', messageId: 'test', sentence: 'Dit is een test.' },
} as const;

describe('TranslateAppSentenceHandler', () => {
    const handler = new TranslateAppSentenceHandler();
    let optedIn: boolean;

    beforeEach(() => {
        optedIn = false;
        mockFirefoxBuild = false;
        lookup.mockReset().mockResolvedValue({ text: 'This is a test.' });
        Object.defineProperty(globalThis, 'browser', {
            configurable: true,
            value: {
                runtime: { id: 'test-extension' },
                storage: { local: { get: async () => ({ webSentenceTranslation: optedIn }) } },
            },
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, 'browser');
    });

    it('returns the translation to the app video frame after opt-in', async () => {
        optedIn = true;
        await expect(new Promise((resolve) => handler.handle(request, appSender, resolve))).resolves.toBe(
            'This is a test.'
        );
        expect(lookup).toHaveBeenCalledWith(request.message.sentence);
    });

    it('skips the local service without opt-in', async () => {
        await expect(new Promise((resolve) => handler.handle(request, appSender, resolve))).resolves.toBeUndefined();
        expect(lookup).not.toHaveBeenCalled();
    });

    it.each([
        { id: 'other-extension' },
        { origin: 'null' },
        { url: new URL('/another-repository/', appUrl).href },
        { tab: { url: new URL('/another-repository/', appUrl).href } as Browser.tabs.Tab },
    ])('rejects an untrusted sender with %o', (override) => {
        optedIn = true;
        expect(handler.handle(request, { ...appSender, ...override }, jest.fn())).toBe(false);
        expect(lookup).not.toHaveBeenCalled();
    });
    it.each(['', '   ', 'x'.repeat(4001), 42])('rejects invalid sentence #%#', (sentence) => {
        optedIn = true;
        const message = { ...request.message, sentence } as unknown as typeof request.message;
        expect(handler.handle({ ...request, message }, appSender, jest.fn())).toBe(false);
        expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects every request in a Firefox build', () => {
        optedIn = true;
        mockFirefoxBuild = true;
        expect(handler.handle(request, appSender, jest.fn())).toBe(false);
        expect(lookup).not.toHaveBeenCalled();
    });

    it('answers undefined when the lookup fails', async () => {
        optedIn = true;
        lookup.mockRejectedValue(new Error('offline'));
        await expect(new Promise((resolve) => handler.handle(request, appSender, resolve))).resolves.toBeUndefined();
    });
});
