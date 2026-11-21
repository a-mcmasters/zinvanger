import {
    localSubtitleOffsetStorage,
    subtitleOffsetPageIdentity,
    subtitleOffsetTitleIdentity,
} from '@project/common/playback/subtitle-offset-storage';

describe('subtitleOffsetPageIdentity', () => {
    it('drops per-session query params', () => {
        expect(subtitleOffsetPageIdentity('https://www.disneyplus.com/play/abc?contextId=one')).toBe(
            subtitleOffsetPageIdentity('https://www.disneyplus.com/play/abc?contextId=two')
        );
    });

    it('keeps video-identifying params and the hash', () => {
        expect(subtitleOffsetPageIdentity('https://www.youtube.com/watch?pp=x&v=abc&t=10s')).toBe(
            'https://www.youtube.com/watch?v=abc'
        );
        expect(subtitleOffsetPageIdentity('https://plex.local/web/index.html#!/details?key=1')).toBe(
            'https://plex.local/web/index.html#!/details?key=1'
        );
    });
});

describe('subtitleOffsetPageIdentity path cleanup', () => {
    it('drops Amazon ref path segments', () => {
        expect(
            subtitleOffsetPageIdentity('https://www.amazon.com/gp/video/detail/B0X/ref=atv_hm_hom_c_1?autoplay=1')
        ).toBe('https://www.amazon.com/gp/video/detail/B0X');
    });
});

describe('subtitleOffsetTitleIdentity', () => {
    it('drops unread counts and play-state prefixes', () => {
        expect(subtitleOffsetTitleIdentity('(3) My Video')).toBe('My Video');
        expect(subtitleOffsetTitleIdentity('▶ My Video')).toBe('My Video');
        expect(subtitleOffsetTitleIdentity('▶️ My Video')).toBe('My Video');
        expect(subtitleOffsetTitleIdentity('My Video (2019)')).toBe('My Video (2019)');
    });
});

describe('localSubtitleOffsetStorage', () => {
    it('removes the entry when the offset returns to zero', () => {
        void localSubtitleOffsetStorage.set('k', -21000);
        expect(localSubtitleOffsetStorage.get('k')).toBe(-21000);
        void localSubtitleOffsetStorage.set('k', 0);
        expect(localStorage.getItem('k')).toBeNull();
    });
});
