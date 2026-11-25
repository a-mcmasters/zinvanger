import type { DictionaryLocalTokenInput, DictionaryProvider } from '@project/common/dictionary-db';
import { saveKnownWord } from '@project/common/living-subtitle/known-word';
import { ApplyStrategy, DictionaryTokenSource, getFullyKnownTokenStatus } from '@project/common/settings';

const provider = (existing: { token: string; lemmas: string[] }[] = [], confirm = true) => {
    const saveRecordLocalBulk = jest.fn(async (profile: string | undefined, inputs: DictionaryLocalTokenInput[]) => ({
        savedTokens: confirm
            ? inputs.map(({ token }) => [token, DictionaryTokenSource.LOCAL, -1, profile ?? 'Default'])
            : [],
        deletedTokens: [],
    }));
    const getRecords = jest.fn(async () => ({
        tokenRecords: existing.map((record) => ({ ...record, source: DictionaryTokenSource.LOCAL })),
        ankiCardRecords: {},
    }));
    return { saveRecordLocalBulk, getRecords } as unknown as DictionaryProvider & {
        saveRecordLocalBulk: typeof saveRecordLocalBulk;
    };
};

const savedInput = (dictionary: ReturnType<typeof provider>) => dictionary.saveRecordLocalBulk.mock.calls[0];

describe('saveKnownWord', () => {
    it('saves the word as fully known with the lookup lemmas for the given profile', async () => {
        const dictionary = provider();
        await saveKnownWord(dictionary, 'Dutch', 'liep', ['lopen']);
        expect(savedInput(dictionary)).toEqual([
            'Dutch',
            [{ token: 'liep', status: getFullyKnownTokenStatus(), lemmas: ['lopen'], states: [] }],
            ApplyStrategy.ADD,
        ]);
    });

    it('keeps an existing record’s lemmas when the lookup gave none', async () => {
        const dictionary = provider([{ token: 'liep', lemmas: ['lopen'] }]);
        await saveKnownWord(dictionary, undefined, 'liep', []);
        expect(savedInput(dictionary)[1][0].lemmas).toEqual(['lopen']);
    });

    it('falls back to the surface form for a new word with no lookup', async () => {
        const dictionary = provider();
        await saveKnownWord(dictionary, undefined, 'liep', ['']);
        expect(savedInput(dictionary)[1][0].lemmas).toEqual(['liep']);
    });

    it('rejects when storage does not confirm the word', async () => {
        await expect(saveKnownWord(provider([], false), undefined, 'liep', ['lopen'])).rejects.toThrow('notSaved');
    });
});
