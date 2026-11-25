import type { DictionaryProvider } from '@project/common/dictionary-db';
import { ApplyStrategy, DictionaryTokenSource, getFullyKnownTokenStatus } from '@project/common/settings';
import { ensureStoragePersisted, HAS_LETTER_REGEX } from '@project/common/util';

const localTokenTrack = -1; // LOCAL_TOKEN_TRACK, without importing the database into content scripts

const usable = (lemmas: readonly string[]) => lemmas.filter((lemma) => HAS_LETTER_REGEX.test(lemma));

/** Saves the word card's word as fully known for `profile`; rejects unless storage confirms that exact token. */
export async function saveKnownWord(
    dictionary: DictionaryProvider,
    profile: string | undefined,
    word: string,
    lookupLemmas: readonly string[]
) {
    void ensureStoragePersisted();
    let lemmas = usable(lookupLemmas);
    if (!lemmas.length) {
        // A save during a lookup outage must not replace an existing record's lemmas with the surface form.
        const { tokenRecords } = await dictionary.getRecords(profile, localTokenTrack);
        const existing = tokenRecords.find((r) => r.source === DictionaryTokenSource.LOCAL && r.token === word);
        lemmas = usable(existing?.lemmas ?? []);
    }
    const { savedTokens } = await dictionary.saveRecordLocalBulk(
        profile,
        [{ token: word, status: getFullyKnownTokenStatus(), lemmas: lemmas.length ? lemmas : [word], states: [] }],
        ApplyStrategy.ADD
    );
    if (!savedTokens.some(([token]) => token === word)) throw new Error('notSaved');
}
