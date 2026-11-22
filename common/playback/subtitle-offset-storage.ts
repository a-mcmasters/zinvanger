import type { SubtitleSourceState } from '@project/common/subtitle-reader/subtitle-stream';

export interface SubtitleOffsetStorage {
    readonly get: (key: string) => number | undefined | Promise<number | undefined>;
    readonly set: (key: string, offset: number) => void | Promise<void>;
}

export const subtitleOffsetKey = (video: string | undefined, mainTrack: string | undefined): string | undefined =>
    video && mainTrack ? `subtitle-offset:${JSON.stringify([video, mainTrack])}` : undefined;

// Query strings carry per-session junk (e.g. Disney+ contextId), so only params that name the video survive.
const videoIdentifyingParams = ['v', 'p', 'ep', 'episode', 'id', 'key'];

// shortcut: allowlist of video-id params, extend it when a site keys videos by another query param.
export const subtitleOffsetPageIdentity = (href: string): string => {
    const url = new URL(href);
    const params = new URLSearchParams();
    for (const name of videoIdentifyingParams) {
        const value = url.searchParams.get(name);
        if (value !== null) params.set(name, value);
    }
    const query = params.toString();
    // Amazon puts click tracking in the path, e.g. /detail/B0XXXX/ref=atv_hm_...
    const path = url.pathname
        .split('/')
        .filter((segment) => !segment.startsWith('ref='))
        .join('/');
    return `${url.origin}${path}${query ? `?${query}` : ''}${url.hash}`;
};

// Tabs prefix titles with unread counts or play state, e.g. "(3) Title" or "▶ Title".
export const subtitleOffsetTitleIdentity = (title: string): string =>
    title.replace(/^(?:\(\d+\+?\)\s*|(?:[▶►⏸❚]\uFE0F?)+\s*)+/u, '').trim();

export const subtitleOffsetVideoIdentity = ({ name, size, lastModified }: File): string =>
    JSON.stringify([name, size, lastModified]);

export const subtitleOffsetTrackIdentity = (files: readonly File[]): string | undefined =>
    files.length ? JSON.stringify(files.map(({ name, size }) => [name, size])) : undefined;

export const mainSubtitleOffsetIdentity = (sources: readonly SubtitleSourceState[]): string | undefined => {
    const mainTrack = sources.find(({ track }) => track === 0);
    return mainTrack?.offsetIdentity ?? mainTrack?.name;
};

export const localSubtitleOffsetStorage: SubtitleOffsetStorage = {
    get(key) {
        const value = localStorage.getItem(key);
        return value === null ? undefined : Number(value);
    },
    set(key, offset) {
        // A zero offset is the default, so drop it instead of letting entries pile up.
        if (offset === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, String(offset));
    },
};
