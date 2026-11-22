import LivingSubtitleLookupHandler from '@/handlers/video/living-subtitle-lookup-handler';
import GetLocalDefinitionHandler from '@/handlers/video/get-local-definition-handler';

const token = 't'.repeat(32);
const extensionUrl = (path: string) => `chrome-extension://asb${path}`;

const respond = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const contentScript = { id: 'asb', tab: { id: 1 }, url: 'https://www.npostart.nl/' };

const run = (handler: { handle: (...args: any[]) => unknown }, message: object, sender: object = contentScript) =>
    new Promise<any>((resolve) => {
        handler.handle({ sender: 'asbplayer-video', message }, sender, resolve);
    });

describe('LivingSubtitleLookupHandler', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = jest.fn();
        (globalThis as any).fetch = fetchMock;
        (globalThis as any).browser = {
            runtime: { id: 'asb', getURL: extensionUrl },
            storage: { local: { get: async () => ({ localLookupToken: token }) } },
        };
    });

    it('defines a word for the video content script only', async () => {
        fetchMock.mockReturnValue(respond(200, { definition: 'to put' }));
        const message = { command: 'living-subtitle-lookup', operation: 'define', sentence: 'Hij zet.', word: 'zet' };
        await expect(run(new LivingSubtitleLookupHandler(), message)).resolves.toEqual({ text: 'to put' });
        expect(fetchMock.mock.calls[0][0]).toContain('/define?sentence=Hij+zet.&word=zet');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`);

        for (const sender of [
            { ...contentScript, id: 'other-extension' },
            { id: 'asb', url: extensionUrl('/popup.html') }, // no tab: an extension page
            { ...contentScript, url: extensionUrl('/living-subtitle.html') }, // a frame, whose replies the page reads
        ]) {
            await expect(run(new LivingSubtitleLookupHandler(), message, sender)).resolves.toEqual({
                error: 'unauthorized',
            });
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed requests without calling the service', async () => {
        for (const message of [
            { operation: 'define', sentence: 'Hij zet.' },
            { operation: 'translate', sentence: '' },
            { operation: 'translate', sentence: 'x'.repeat(501) },
            { operation: 'delete', sentence: 'Hij zet.' },
        ]) {
            await expect(
                run(new LivingSubtitleLookupHandler(), { command: 'living-subtitle-lookup', ...message })
            ).resolves.toEqual({ error: 'invalid' });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns distinguishable errors', async () => {
        const message = { command: 'living-subtitle-lookup', operation: 'translate', sentence: 'Hoi.' };
        const cases: [() => Promise<Response>, string][] = [
            [() => respond(401, {}), 'unauthorized'],
            [() => respond(429, {}), 'busy'],
            [() => respond(504, {}), 'timeout'],
            [() => respond(200, { definition: 'wrong field' }), 'malformed'],
            [() => respond(200, { translation: 'x'.repeat(2001) }), 'malformed'],
            [() => Promise.reject(new TypeError('Failed to fetch')), 'unavailable'],
        ];
        for (const [response, error] of cases) {
            fetchMock.mockImplementationOnce(response);
            await expect(run(new LivingSubtitleLookupHandler(), message)).resolves.toEqual({ error });
        }
    });

    it('keeps the Anki dialog translation contract', async () => {
        fetchMock.mockReturnValue(respond(200, { translation: 'Hi.' }));
        const message = { command: 'get-local-definition', sentence: 'Hoi.' };
        const ankiFrame = { id: 'asb', url: extensionUrl('/anki-lookup.html') };
        await expect(run(new GetLocalDefinitionHandler(), message, ankiFrame)).resolves.toEqual({ translation: 'Hi.' });
        // The living-subtitle length cap must not truncate the dialog's translations.
        fetchMock.mockReturnValue(respond(200, { translation: 'x'.repeat(2001) }));
        await expect(run(new GetLocalDefinitionHandler(), message, ankiFrame)).resolves.toEqual({
            translation: 'x'.repeat(2001),
        });
        fetchMock.mockReturnValue(respond(502, {}));
        await expect(run(new GetLocalDefinitionHandler(), message, ankiFrame)).resolves.toBe(undefined);
        expect(
            new GetLocalDefinitionHandler().handle(
                { message } as any,
                { id: 'asb', url: extensionUrl('/x.html') },
                () => {}
            )
        ).toBe(false);
    });
});
