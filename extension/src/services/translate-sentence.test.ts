import { translateSentence } from '@/services/translate-sentence';

const respond = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
const translated = (text: string) => respond(200, { translations: [{ detected_source_language: 'NL', text }] });

describe('translateSentence', () => {
    let fetchMock: jest.Mock;
    let apiKey: string;

    beforeEach(() => {
        apiKey = '00000000-0000-0000-0000-000000000000:fx';
        fetchMock = jest.fn();
        (globalThis as any).fetch = fetchMock;
        (globalThis as any).browser = {
            storage: { local: { get: async () => ({ deeplApiKey: apiKey }) } },
        };
    });

    it('needs an API key and a sentence before asking DeepL', async () => {
        apiKey = '';
        await expect(translateSentence('Zonder sleutel.')).resolves.toBeUndefined();
        await expect(translateSentence('  ')).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends the sentence with the key and shares one request', async () => {
        fetchMock.mockReturnValue(translated("It's good."));

        const [first, second] = await Promise.all([
            translateSentence(' Het is goed. '),
            translateSentence('Het is goed.'),
        ]);
        await expect(translateSentence('Het is goed.')).resolves.toBe("It's good.");

        expect([first, second]).toEqual(["It's good.", "It's good."]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api-free.deepl.com/v2/translate');
        expect(init.headers.Authorization).toBe(`DeepL-Auth-Key ${apiKey}`);
        expect(JSON.parse(init.body)).toEqual({ text: ['Het is goed.'], target_lang: 'EN-US' });
    });

    it('uses the Pro host for a Pro key', async () => {
        apiKey = '11111111-1111-1111-1111-111111111111';
        fetchMock.mockReturnValue(translated('Pro.'));
        await expect(translateSentence('Betaald.')).resolves.toBe('Pro.');
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepl.com/v2/translate');
    });

    it('asks again after a failed or unexpected answer', async () => {
        fetchMock.mockReturnValueOnce(respond(456, {})).mockReturnValueOnce(respond(200, { translations: [] }));
        fetchMock.mockReturnValue(translated('Again.'));

        await expect(translateSentence('Opnieuw.')).resolves.toBeUndefined();
        await expect(translateSentence('Opnieuw.')).resolves.toBeUndefined();
        await expect(translateSentence('Opnieuw.')).resolves.toBe('Again.');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('runs at most four requests at once', async () => {
        const answers: ((response: Response) => void)[] = [];
        fetchMock.mockImplementation(() => new Promise<Response>((resolve) => answers.push(resolve)));

        const running = [1, 2, 3, 4].map((n) => translateSentence(`Zin ${n}.`));
        await expect(translateSentence('Zin 5.')).resolves.toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve));
        expect(fetchMock).toHaveBeenCalledTimes(4);

        answers.forEach((answer) =>
            answer({ ok: true, status: 200, json: async () => ({ translations: [{ text: 'Done.' }] }) } as Response)
        );
        await expect(Promise.all(running)).resolves.toEqual(['Done.', 'Done.', 'Done.', 'Done.']);
        fetchMock.mockReturnValue(translated('Five.'));
        await expect(translateSentence('Zin 5.')).resolves.toBe('Five.');
    });
});
