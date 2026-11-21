import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ControlType } from '@project/common';
import ScrollableNumberControls from '@project/common/components/ScrollableNumberControls';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ScrollableNumberControls', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        jest.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        jest.useRealTimers();
    });

    const renderControls = (initialControlType?: ControlType) => {
        act(() => {
            root.render(
                <ScrollableNumberControls
                    currentMilliseconds={2000}
                    offset={500}
                    playbackRate={1}
                    offsetInputRef={{ current: undefined }}
                    playbackRateInputRef={{ current: undefined }}
                    onOffset={() => {}}
                    onPlaybackRate={() => {}}
                    initialControlType={initialControlType}
                    onScrollTo={() => {}}
                />
            );
        });
        act(() => jest.runOnlyPendingTimers());
        const controls = container.querySelector('div')!;
        const scrollTo = jest.fn();
        controls.scrollTo = scrollTo;
        return { controls, scrollTo };
    };

    const wheel = (controls: HTMLElement, init: WheelEventInit) => {
        const event = new WheelEvent('wheel', { cancelable: true, ...init });
        act(() => {
            controls.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };

    it.each([
        { start: undefined, deltaY: 120 },
        { start: ControlType.playbackRate, deltaY: -120 },
    ])('moves wheel delta $deltaY exactly one control to the offset', ({ start, deltaY }) => {
        const { controls, scrollTo } = renderControls(start);
        expect(controls.scrollTop).toBe(deltaY > 0 ? 0 : 80);

        expect(wheel(controls, { deltaY })).toBe(true);
        expect(scrollTo).toHaveBeenCalledWith({ top: 40, behavior: 'smooth' });
    });

    it('waits for the adjacent control to settle before accepting another notch', () => {
        const { controls, scrollTo } = renderControls(ControlType.playbackRate);

        expect(wheel(controls, { deltaY: -120 })).toBe(true);
        expect(wheel(controls, { deltaY: -120 })).toBe(true);
        expect(scrollTo).toHaveBeenCalledTimes(1);

        controls.scrollTop = 40;
        controls.dispatchEvent(new Event('scrollend'));
        expect(wheel(controls, { deltaY: -120 })).toBe(true);
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('lets zoom and horizontal wheel gestures through', () => {
        const { controls, scrollTo } = renderControls();

        expect(wheel(controls, { deltaY: 120.5, ctrlKey: true })).toBe(false);
        expect(wheel(controls, { deltaX: 120 })).toBe(false);
        expect(scrollTo).not.toHaveBeenCalled();
    });
});
