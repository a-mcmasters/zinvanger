import Dexie from 'dexie';
import type { LoadableSubtitleTrack } from '@project/common';
import type { FileWithId } from '@project/common/file-selector';
import type { MediaSources, SubtitleSourceFile } from '@project/common/app/services/media-sources';

interface VideoSubtitlesRecord {
    videoKey: string;
    /** Files per track slot, with their IDs so the file session keeps their handles; an empty slot stays empty. */
    tracks: FileWithId[][];
    timestamp: number;
}

class VideoSubtitlesDatabase extends Dexie {
    videos!: Dexie.Table<VideoSubtitlesRecord, string>;

    constructor() {
        super('VideoSubtitlesDatabase');
        this.version(1).stores({ videos: 'videoKey,timestamp' });
    }
}

// shortcut: the newest 50 videos, up to 20 MB of subtitles each; raise if users keep larger libraries.
const maxVideos = 50;
const maxBytesPerVideo = 20 * 1024 * 1024;

// The app fills an empty track slot with this placeholder (see restoreSessionFiles and the track selector).
const isEmptySlot = ({ id }: FileWithId) => id === '-';
const emptySlot = (track: number): SubtitleSourceFile => ({ id: '-', file: new File([], '.srt'), track });

// A local video file has no stable path in the browser, so name + size stands in for its identity.
export const videoKey = ({ file }: FileWithId) => `${file.name}:${file.size}`;

/** The local video and the subtitle tracks last shown with it. */
export interface PairedSources {
    videoFile?: FileWithId;
    subtitleTracks?: LoadableSubtitleTrack<SubtitleSourceFile>[];
}

/** What a change of media sources means for the remembered subtitles of the local video. */
export const videoSubtitleMemoryAction = (
    paired: PairedSources,
    sources: MediaSources
): 'remember' | 'recall' | undefined => {
    const { videoFile, subtitleSource, subtitleTracks, subtitleSourceFiles } = sources;
    if (!videoFile || subtitleSource.kind !== 'files') return undefined;
    const tracksChanged = subtitleTracks !== paired.subtitleTracks;
    // Same video: any new choice counts, including clearing every track.
    if (videoFile === paired.videoFile) return tracksChanged ? 'remember' : undefined;
    // New video: remember the subtitles that came with it. Tracks already shown with a video belong to that
    // video (they are kept when the next one opens alone), and a restored session fills lost files with empty
    // slots; both recall the complete layout instead.
    const complete = subtitleSourceFiles.length > 0 && !subtitleSourceFiles.some(isEmptySlot);
    return tracksChanged && complete ? 'remember' : 'recall';
};

/** Remembers which subtitle files were last loaded for each local video. */
export class VideoSubtitleMemory {
    private readonly _db = new VideoSubtitlesDatabase();

    async remember(video: FileWithId, tracks: LoadableSubtitleTrack<SubtitleSourceFile>[]) {
        const files = tracks.map(({ fileParts }) =>
            fileParts.filter((f) => !isEmptySlot(f)).map(({ id, file }) => ({ id, file }))
        );
        const key = videoKey(video);
        await this._db.transaction('rw', this._db.videos, async () => {
            if (files.flat().reduce((size, { file }) => size + file.size, 0) > maxBytesPerVideo) {
                // Too big to keep, but the files it replaced are no longer the user's choice.
                await this._db.videos.delete(key);
                return;
            }
            await this._db.videos.put({ videoKey: key, tracks: files, timestamp: Date.now() });
            const stale = await this._db.videos.orderBy('timestamp').reverse().offset(maxVideos).primaryKeys();
            await this._db.videos.bulkDelete(stale);
        });
    }

    /** Files in `loaded` with a remembered ID win: a restored session just read them from disk. */
    async recall(
        video: FileWithId,
        loaded: FileWithId[] = []
    ): Promise<LoadableSubtitleTrack<SubtitleSourceFile>[] | undefined> {
        const record = await this._db.videos.get(videoKey(video));
        const loadedById = new Map(loaded.filter((f) => !isEmptySlot(f)).map(({ id, file }) => [id, file]));
        return record?.tracks.map((files, track) => ({
            fileParts: files.length
                ? files.map(({ id, file }) => ({ id, file: loadedById.get(id) ?? file, track }))
                : [emptySlot(track)],
        }));
    }
}
