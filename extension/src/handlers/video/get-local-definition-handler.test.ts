import GetLocalDefinitionHandler from '@/handlers/video/get-local-definition-handler';

const apiKey = '00000000-0000-0000-0000-000000000000:fx';
const extensionUrl = (path: string) => `chrome-extension://asb${path}`;

const respond = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const run = (message: object, sender: object) =>
    new Promise<any>((resolve) => {
        new GetLocalDefinitionHandler().handle({ sender: 'asbplayer-video-tab', message } as any, sender, resolve);
    });

describe('GetLocalDefinitionHandler', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = jest.fn();
        (globalThis as any).fetch = fetchMock;
        (globalThis as any).browser = {
            runtime: { id: 'asb', getURL: extensionUrl },
            storage: { local: { get: async () => ({ deeplApiKey: apiKey }) } },
        };
    });

    it('translates for the Anki dialog only, with the API key', async () => {
        const message = { command: 'get-local-definition', sentence: 'Hoi.' };
        const ankiFrame = { id: 'asb', url: extensionUrl('/anki-lookup.html') };

        fetchMock.mockReturnValue(respond(200, { translations: [{ detected_source_language: 'NL', text: 'Hi.' }] }));
        await expect(run(message, ankiFrame)).resolves.toEqual({ translation: 'Hi.' });
        expect(fetchMock.mock.calls[0][0]).toBe('https://api-free.deepl.com/v2/translate');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`DeepL-Auth-Key ${apiKey}`);

        fetchMock.mockReturnValue(respond(502, {}));
        await expect(run({ ...message, sentence: 'Doei.' }, ankiFrame)).resolves.toBe(undefined);

        expect(
            new GetLocalDefinitionHandler().handle(
                { message } as any,
                { id: 'asb', url: extensionUrl('/x.html') },
                () => {}
            )
        ).toBe(false);
    });
});
