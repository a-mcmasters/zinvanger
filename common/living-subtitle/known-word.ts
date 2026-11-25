import type { DictionaryProvider } from '@project/common/dictionary-db';
import { ApplyStrategy, getFullyKnownTokenStatus } from '@project/common/settings';
import { ensureStoragePersisted } from '@project/common/util';

/**
 * Saves the word as fully known for the profile active at the click. Refreshes its forms after storage confirms
 * the exact token and the profile is still active.
 */
export async function saveKnownWord(
    dictionary: DictionaryProvider,
    getActiveProfile: () => Promise<string | undefined>,
    word: string,
    lemmas: readonly string[],
    tokensWereModified: (tokens: string[]) => void
) {
    const profile = await getActiveProfile();
    void ensureStoragePersisted();
    const { savedTokens } = await dictionary.saveRecordLocalBulk(
        profile,
        [{ token: word, status: getFullyKnownTokenStatus(), lemmas: [...lemmas], states: [] }],
        ApplyStrategy.ADD
    );
    if ((await getActiveProfile()) !== profile) return 'stale' as const;
    if (!savedTokens.some(([token]) => token === word)) throw new Error('notSaved');
    tokensWereModified([word, ...lemmas]);
}
