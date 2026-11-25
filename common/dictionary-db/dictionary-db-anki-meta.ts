import type { _DictionaryDatabase, DictionaryMetaKey } from '@project/common/dictionary-db';
import { _buildIdHealthCheck } from '@project/common/dictionary-db';

export async function completeAnkiCacheBuild(
    db: _DictionaryDatabase,
    profile: string,
    buildId: string,
    activeTracks: DictionaryMetaKey[],
    builtTracks: Iterable<number>
): Promise<void> {
    await db.transaction('rw', db.meta, async () => {
        await _buildIdHealthCheck(db, buildId, 'anki', activeTracks);
        for (const track of builtTracks) {
            const key: DictionaryMetaKey = [profile, track];
            const { ankiMeta } = (await db.meta.get(key))!;
            await db.meta.update(key, { ankiMeta: { ...ankiMeta, builtSource: ankiMeta.settings } });
        }
    });
}
