import 'core-js/stable/structured-clone'; // fake-indexeddb requires structured clone polyfill
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import Dexie from 'dexie';
import { MediaSources } from '@project/common/app/services/media-sources';
import { VideoSubtitleMemory, videoSubtitleMemoryAction } from '@project/common/app/services/video-subtitle-memory';

beforeEach(() => {
    Dexie.dependencies.indexedDB = new IDBFactory();
});

const video = (name: string, size = 10) => ({ id: name, file: new File(['x'.repeat(size)], name) });
const subtitle = (name: string, track: number, size = 3) => ({
    id: name,
    file: new File(['y'.repeat(size)], name),
    track,
});

it('restores the files for the same video only', async () => {
    const memory = new VideoSubtitleMemory();
    await memory.remember(video('a.mp4'), [{ fileParts: [subtitle('a.ja.srt', 0)] }]);

    const tracks = await memory.recall(video('a.mp4'));
    expect(tracks?.map(({ fileParts }) => fileParts.map(({ file, track }) => [file.name, track]))).toEqual([
        [['a.ja.srt', 0]],
    ]);
    expect(await memory.recall(video('a.mp4', 11))).toBeUndefined(); // different size, different video
    expect(await memory.recall(video('b.mp4'))).toBeUndefined();
});

it('replaces the files remembered for a video', async () => {
    const memory = new VideoSubtitleMemory();
    await memory.remember(video('a.mp4'), [{ fileParts: [subtitle('old.srt', 0)] }]);
    await memory.remember(video('a.mp4'), [{ fileParts: [subtitle('new.srt', 0)] }]);

    expect((await memory.recall(video('a.mp4')))?.[0].fileParts[0].file.name).toBe('new.srt');
});

it('forgets a video whose new subtitles are over the size cap', async () => {
    const memory = new VideoSubtitleMemory();
    await memory.remember(video('a.mp4'), [{ fileParts: [subtitle('old.srt', 0)] }]);
    await memory.remember(video('a.mp4'), [{ fileParts: [subtitle('big.sup', 0, 21 * 1024 * 1024)] }]);

    expect(await memory.recall(video('a.mp4'))).toBeUndefined();
});

it('forgets the oldest video past the limit', async () => {
    const memory = new VideoSubtitleMemory();
    const now = jest.spyOn(Date, 'now');
    for (let i = 0; i <= 50; ++i) {
        now.mockReturnValue(1000 + i);
        await memory.remember(video(`${i}.mp4`), [{ fileParts: [subtitle(`${i}.srt`, 0)] }]);
    }
    now.mockRestore();

    expect(await memory.recall(video('0.mp4'))).toBeUndefined();
    expect(await memory.recall(video('1.mp4'))).toBeDefined();
    expect(await memory.recall(video('50.mp4'))).toBeDefined();
});

it('keeps file IDs, and empty track slots as the placeholder the app uses', async () => {
    const memory = new VideoSubtitleMemory();
    const placeholder = { id: '-', file: new File([], '.srt'), track: 0 };
    await memory.remember(video('a.mp4'), [{ fileParts: [placeholder] }, { fileParts: [subtitle('a.srt', 1)] }]);

    const [empty, loaded] = (await memory.recall(video('a.mp4')))!;
    expect(empty.fileParts).toEqual([{ id: '-', file: expect.any(File), track: 0 }]);
    expect(loaded.fileParts[0].file.name).toBe('a.srt');
    expect(loaded.fileParts[0].id).toBe('a.srt'); // the file session finds its saved handle by this ID
});

it('prefers a file just read from disk over the remembered copy with the same ID', async () => {
    const memory = new VideoSubtitleMemory();
    await memory.remember(video('a.mp4'), [
        { fileParts: [subtitle('a.srt', 0, 3)] },
        { fileParts: [subtitle('b.srt', 1, 3)] },
    ]);

    const edited = subtitle('a.srt', 0, 7);
    const placeholder = { id: '-', file: new File([], '.srt'), track: 1 };
    const [a, b] = (await memory.recall(video('a.mp4'), [edited, placeholder]))!;
    expect(a.fileParts[0].file).toBe(edited.file);
    expect(b.fileParts[0].file.size).toBe(3); // lost from the session, filled from memory
});

describe('videoSubtitleMemoryAction', () => {
    const ep1 = video('ep1.mp4');
    const ep2 = video('ep2.mp4');
    const ep1Subtitles = { kind: 'files' as const, tracks: [{ fileParts: [subtitle('ep1.srt', 0)] }] };
    const placeholderOnly = { kind: 'files' as const, tracks: [{ fileParts: [{ ...subtitle('.srt', 0), id: '-' }] }] };
    const watchingEp1 = new MediaSources(ep1Subtitles, ep1);
    const pairedWithEp1 = { videoFile: ep1, subtitleTracks: watchingEp1.subtitleTracks };

    it('remembers subtitles loaded with, after or before a video', () => {
        expect(videoSubtitleMemoryAction({}, watchingEp1)).toBe('remember');
        expect(videoSubtitleMemoryAction({ videoFile: ep1, subtitleTracks: [] }, watchingEp1)).toBe('remember');
        // Subtitles dropped first are already loaded when the video arrives.
        const subtitlesFirst = new MediaSources(ep1Subtitles);
        expect(videoSubtitleMemoryAction({}, new MediaSources(subtitlesFirst.subtitleSource, ep1))).toBe('remember');
    });

    it("recalls for a new video, instead of taking the previous video's kept subtitles", () => {
        expect(videoSubtitleMemoryAction({}, new MediaSources(undefined, ep1))).toBe('recall');
        // handleSources keeps the subtitle source when only a video is selected.
        expect(videoSubtitleMemoryAction(pairedWithEp1, new MediaSources(watchingEp1.subtitleSource, ep2))).toBe(
            'recall'
        );
        // Also after the previous video was unloaded, which keeps its subtitles.
        const unloaded = new MediaSources(watchingEp1.subtitleSource);
        expect(videoSubtitleMemoryAction(pairedWithEp1, new MediaSources(unloaded.subtitleSource, ep2))).toBe('recall');
    });

    it('recalls the complete layout when a restored session lost some files', () => {
        // Restore last session opens a new video object and fills each lost subtitle file with a placeholder.
        expect(videoSubtitleMemoryAction(pairedWithEp1, new MediaSources(placeholderOnly, video('ep1.mp4')))).toBe(
            'recall'
        );
        const partial = {
            kind: 'files' as const,
            tracks: [...placeholderOnly.tracks, { fileParts: [subtitle('ep1.en.srt', 1)] }],
        };
        expect(videoSubtitleMemoryAction({}, new MediaSources(partial, ep1))).toBe('recall');
    });

    it('remembers clearing every track of the same video', () => {
        expect(videoSubtitleMemoryAction(pairedWithEp1, new MediaSources(placeholderOnly, ep1))).toBe('remember');
    });

    it('does nothing without a local video or when nothing changed', () => {
        expect(videoSubtitleMemoryAction({}, new MediaSources(ep1Subtitles))).toBeUndefined();
        expect(videoSubtitleMemoryAction(pairedWithEp1, watchingEp1)).toBeUndefined();
    });
});
