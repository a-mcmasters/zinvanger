import type { DictionaryProvider } from '@project/common/dictionary-db';
import { ApplyStrategy, getFullyKnownTokenStatus } from '@project/common/settings';
import { ensureStoragePersisted } from '@project/common/util';

/**
 * Saves the word card's word as fully known for `profile`, then hands its forms to `tokensWereModified` so the
 * annotations refresh. Rejects unless storage confirms that exact token. Storage resolves empty `lemmas`: an existing
 * record keeps its own, a new record uses the word.
 */
export async function saveKnownWord(
    dictionary: DictionaryProvider,
    profile: string | undefined,
    word: string,
    lemmas: readonly string[],
    tokensWereModified: (tokens: string[]) => void
) {
    void ensureStoragePersisted();
    const { savedTokens } = await dictionary.saveRecordLocalBulk(
        profile,
        [{ token: word, status: getFullyKnownTokenStatus(), lemmas: [...lemmas], states: [] }],
        ApplyStrategy.ADD
    );
    if (!savedTokens.some(([token]) => token === word)) throw new Error('notSaved');
    tokensWereModified([word, ...lemmas]);
}
