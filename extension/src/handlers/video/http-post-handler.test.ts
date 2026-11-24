import HttpPostHandler from '@/handlers/video/http-post-handler';

const run = (body: object) =>
    new Promise<any>((resolve) => {
        new HttpPostHandler().handle(
            { sender: 'asbplayer-popup', message: { command: 'http-post', url: 'http://anki', body } } as any,
            {},
            resolve
        );
    });

describe('HttpPostHandler', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = jest.fn().mockResolvedValue({ json: async () => ({ result: 1, error: null }) });
        (globalThis as any).fetch = fetchMock;
    });

    it.each(['createDeck', 'createModel'])('forwards %s from the popup', async (action) => {
        await expect(run({ version: 6, action, params: {} })).resolves.toEqual({ result: 1, error: null });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe(action);
    });

    it('rejects an action that is not allow-listed', async () => {
        await expect(run({ version: 6, action: 'deleteDecks', params: {} })).resolves.toEqual({
            error: 'Invalid request',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
