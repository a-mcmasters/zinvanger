import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@project/extension/src/services/ui-frame', () => ({
    __esModule: true,
    default: class UiFrame {},
    uiFrameForSrc: jest.fn(),
}));

import { StatisticsOverlayController } from '@project/extension/src/controllers/statistics-overlay-controller';
import { uiFrameForSrc } from '@project/extension/src/services/ui-frame';

describe('StatisticsOverlayController mobile overlay positioning', () => {
    const runtimeListeners = new Set<(message: any, sender: any, sendResponse: (response?: any) => void) => void>();

    beforeEach(() => {
        runtimeListeners.clear();
        (globalThis as any).browser = {
            runtime: {
                getURL: (path: string) => `extension://${path}`,
                onMessage: {
                    addListener: (listener: (message: any, sender: any, sendResponse: () => void) => void) =>
                        runtimeListeners.add(listener),
                    removeListener: (listener: (message: any, sender: any, sendResponse: () => void) => void) =>
                        runtimeListeners.delete(listener),
                },
            },
        };
    });

    afterEach(() => {
        document.body.replaceChildren();
        document.documentElement.style.removeProperty('color-scheme');
        delete (globalThis as any).browser;
    });

    const openStatistics = () => {
        for (const listener of runtimeListeners) {
            listener(
                {
                    sender: 'asbplayer-extension-to-video',
                    message: {
                        command: 'open-statistics-overlay',
                        mediaId: 'media-id',
                        force: false,
                    },
                },
                {},
                () => {}
            );
        }
    };

    const flushMutations = async () => {
        await Promise.resolve();
        await Promise.resolve();
    };

    const addTopMobileOverlay = () => {
        const mobileOverlay = document.createElement('div');
        mobileOverlay.className = 'asbplayer-mobile-video-overlay-container-top';
        mobileOverlay.getBoundingClientRect = () => ({
            left: 0,
            top: 8,
            width: 410,
            height: 108,
            right: 410,
            bottom: 116,
            x: 0,
            y: 8,
            toJSON() {},
        });
        document.body.appendChild(mobileOverlay);
        return mobileOverlay;
    };

    it('moves below a visible top mobile overlay and returns when it is removed', async () => {
        const controller = new StatisticsOverlayController([]);
        controller.bind();
        openStatistics();

        const mobileOverlay = addTopMobileOverlay();
        await flushMutations();

        expect(document.querySelector<HTMLElement>('.asbplayer-statistics-overlay-container')?.style.top).toBe(
            '85.33333333333333px'
        );

        mobileOverlay.remove();
        await flushMutations();

        expect(document.querySelector<HTMLElement>('.asbplayer-statistics-overlay-container')?.style.top).toBe('8px');
        controller.unbind();
    });

    it('keeps a deliberate stats movement after the mobile overlay is removed', async () => {
        const controller = new StatisticsOverlayController([]);
        controller.bind();
        openStatistics();

        const mobileOverlay = addTopMobileOverlay();
        await flushMutations();

        for (const listener of runtimeListeners) {
            listener(
                {
                    sender: 'asbplayer-statistics-overlay-to-tab',
                    message: { command: 'move-statistics-overlay', deltaX: 0, deltaY: 10 },
                },
                {},
                () => {}
            );
        }
        expect(document.querySelector<HTMLElement>('.asbplayer-statistics-overlay-container')?.style.top).toBe(
            '95.33333333333333px'
        );

        mobileOverlay.remove();
        await flushMutations();

        expect(document.querySelector<HTMLElement>('.asbplayer-statistics-overlay-container')?.style.top).toBe(
            '95.33333333333333px'
        );
        controller.unbind();
    });

    it('uses a transparent dark color scheme for the overlay iframe', () => {
        document.documentElement.style.colorScheme = 'dark';
        const controller = new StatisticsOverlayController([]);
        controller.bind();
        openStatistics();

        const iframe = document.querySelector<HTMLIFrameElement>('iframe');
        expect(iframe?.getAttribute('allowtransparency')).toBe('true');
        expect(iframe?.classList.contains('asbplayer-color-scheme-dark')).toBe(true);
        expect(iframe?.style.colorScheme).toBe('dark');
        expect(iframe?.src).toContain('colorScheme=dark');
        controller.unbind();
    });

    it('hides a details dialog on close even when its first load failed', async () => {
        const fakeFrame = (bind: () => Promise<boolean>) => {
            let onMessage: ((message: any) => void) | undefined;
            const client = {
                onMessage: (listener: (message: any) => void) => (onMessage = listener),
                updateState() {},
            };
            const frame = {
                hidden: true,
                bind,
                client: async () => client,
                unbind: jest.fn(),
                show: () => (frame.hidden = false),
                hide: () => (frame.hidden = true),
                close: () => onMessage?.({ command: 'close' }),
            };
            return frame;
        };
        const failed = fakeFrame(() => Promise.reject(new Error('Timed out waiting for frame to be ready')));
        const retried = fakeFrame(async () => true);
        jest.mocked(uiFrameForSrc)
            .mockReturnValueOnce(failed as any)
            .mockReturnValueOnce(retried as any);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const controller = new StatisticsOverlayController([]);
        controller.bind();
        const openDetails = async () => {
            for (const listener of runtimeListeners) {
                listener(
                    {
                        sender: 'asbplayer-statistics-overlay-to-tab',
                        message: {
                            command: 'open-statistics-overlay-one-uncollected-dialog',
                            entries: [],
                            totalSentences: 0,
                            mediaId: 'media-id',
                        },
                    },
                    {},
                    () => {}
                );
            }
            for (let i = 0; i < 10; ++i) await Promise.resolve();
        };

        await openDetails();
        expect(failed.hidden).toBe(true);
        await openDetails();
        expect(retried.hidden).toBe(false);

        retried.close();
        expect(retried.hidden).toBe(true);
        controller.unbind();
    });
});
