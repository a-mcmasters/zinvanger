import type { DictionaryLocalTokenInput, DictionaryProvider } from '@project/common/dictionary-db';
import { saveKnownWord } from '@project/common/living-subtitle/known-word';
import { ApplyStrategy, DictionaryTokenSource, getFullyKnownTokenStatus } from '@project/common/settings';

const provider = (confirm = true) => {
    const saveRecordLocalBulk = jest.fn(async (profile: string | undefined, inputs: DictionaryLocalTokenInput[]) => ({
        savedTokens: confirm
            ? inputs.map(({ token }) => [token, DictionaryTokenSource.LOCAL, -1, profile ?? 'Default'])
            : [],
        deletedTokens: [],
    }));
    return { saveRecordLocalBulk } as unknown as DictionaryProvider & {
        saveRecordLocalBulk: typeof saveRecordLocalBulk;
    };
};

describe('saveKnownWord', () => {
    it('saves the word as fully known with the lookup lemmas, then refreshes its forms', async () => {
        const dictionary = provider();
        const tokensWereModified = jest.fn();
        await saveKnownWord(dictionary, async () => 'Dutch', 'liep', ['lopen'], tokensWereModified);
        expect(dictionary.saveRecordLocalBulk).toHaveBeenCalledWith(
            'Dutch',
            [{ token: 'liep', status: getFullyKnownTokenStatus(), lemmas: ['lopen'], states: [] }],
            ApplyStrategy.ADD
        );
        expect(tokensWereModified).toHaveBeenCalledWith(['liep', 'lopen']);
    });

    it('rejects, and refreshes nothing, when storage does not confirm the word', async () => {
        const tokensWereModified = jest.fn();
        await expect(
            saveKnownWord(provider(false), async () => undefined, 'liep', [], tokensWereModified)
        ).rejects.toThrow('notSaved');
        expect(tokensWereModified).not.toHaveBeenCalled();
    });
});
