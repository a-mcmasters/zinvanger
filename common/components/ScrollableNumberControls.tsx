import { makeStyles } from '@mui/styles';
import PlaybackRateInput from '@project/common/components/PlaybackRateInput';
import SubtitleOffsetInput from '@project/common/components/SubtitleOffsetInput';
import TimeDisplay from '@project/common/components/TimeDisplay';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ControlType } from '..';

const containerHeight = 40;

const useStyles = makeStyles(() => {
    return {
        container: {
            height: containerHeight,
            overflowY: 'scroll',
            scrollSnapType: 'y mandatory',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': {
                display: 'none',
            },
            textAlign: 'center',
        },
        child: {
            scrollbarWidth: 'none',
            scrollSnapAlign: 'center',
            '&::-webkit-scrollbar': {
                display: 'none',
            },
            scrollSnapStop: 'always',
        },
    };
});

interface Props {
    offset: number;
    currentMilliseconds: number;
    totalMilliseconds?: number;
    playbackRate: number;
    offsetInputRef: MutableRefObject<HTMLInputElement | undefined>;
    onOffset: (offset: number) => void;
    playbackRateInputRef: MutableRefObject<HTMLInputElement | undefined>;
    onPlaybackRate: (playbackRate: number) => void;
    initialControlType?: ControlType;
    onScrollTo: (controlType: ControlType) => void;
}

enum InitialScrollState {
    notStarted = 0,
    started = 1,
    ended = 2,
}

const ScrollableNumberControls = ({
    currentMilliseconds,
    totalMilliseconds,
    offset,
    offsetInputRef,
    onOffset,
    playbackRate,
    playbackRateInputRef,
    onPlaybackRate,
    initialControlType,
    onScrollTo,
}: Props) => {
    const classes = useStyles();
    const [controlType, setControlType] = useState<ControlType>(ControlType.timeDisplay);
    const lastScrollTop = useRef<number>(0);
    const [initialScroll, setInitialScroll] = useState<InitialScrollState>(InitialScrollState.notStarted);
    const initialScrollRef = useRef<InitialScrollState>(undefined);
    initialScrollRef.current = initialScroll;
    const containerRef = useRef<HTMLDivElement>(undefined);
    const onScrollToRef = useRef<(controlType: ControlType) => void>(undefined);
    onScrollToRef.current = onScrollTo;

    const handleScroll = useCallback(
        (e: React.UIEvent<HTMLDivElement>) => {
            const currentScrollTop = e.currentTarget.scrollTop;
            const goingDown = currentScrollTop > lastScrollTop.current;
            const newControlType = goingDown
                ? Math.ceil(Math.floor(currentScrollTop) / containerHeight)
                : Math.floor(currentScrollTop / containerHeight);

            if (initialScroll === InitialScrollState.ended && newControlType !== controlType) {
                onScrollTo(newControlType);
                setControlType(newControlType);
            }

            lastScrollTop.current = currentScrollTop;
        },
        [onScrollTo, initialScroll, controlType]
    );

    useEffect(() => {
        const container = containerRef.current;
        if (container === undefined) return;

        let wheelScrollTimeout: ReturnType<typeof setTimeout> | undefined;
        const finishWheelScroll = () => {
            clearTimeout(wheelScrollTimeout);
            wheelScrollTimeout = undefined;
        };

        const handleWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.deltaX !== 0) return;

            if (wheelScrollTimeout !== undefined) {
                event.preventDefault();
                return;
            }

            const { deltaMode, deltaY } = event;
            // Let fine pixel scrolling accumulate and snap natively.
            if (deltaY === 0 || (deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(deltaY) < containerHeight)) {
                return;
            }

            event.preventDefault();
            const currentControl = Math.round(container.scrollTop / containerHeight);
            const nextControl = currentControl + Math.sign(deltaY);
            if (nextControl < ControlType.timeDisplay || nextControl > ControlType.playbackRate) return;

            // Release the lock even in browsers that do not emit scrollend.
            wheelScrollTimeout = setTimeout(finishWheelScroll, 500);
            container.scrollTo({ top: nextControl * containerHeight, behavior: 'smooth' });
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        container.addEventListener('scrollend', finishWheelScroll);
        return () => {
            container.removeEventListener('wheel', handleWheel);
            container.removeEventListener('scrollend', finishWheelScroll);
            finishWheelScroll();
        };
    }, []);

    const handleDivRef = useCallback(
        (div: HTMLDivElement) => {
            if (initialScroll > InitialScrollState.notStarted) {
                return;
            }

            if (div) {
                if (initialControlType === undefined) {
                    setInitialScroll(InitialScrollState.ended);
                } else {
                    setTimeout(() => {
                        div.scrollTop = containerHeight * 2;
                        const transitionThroughScroll = (top: number, destinationControlType: ControlType) => {
                            div.scroll({ top, behavior: 'smooth' });
                            div.addEventListener('scrollend', (e: Event) => {
                                if ((e.currentTarget as HTMLDivElement)?.scrollTop >= containerHeight * 2) {
                                    // This is a result of the initial scrollTop = containerHeight * 2
                                    // to begin  the initial scroll - do not transition yet
                                    return;
                                }

                                // We can transition now that we are actually coming out of the initial scroll
                                if (initialScrollRef.current === InitialScrollState.started) {
                                    onScrollToRef.current?.(destinationControlType);
                                    setControlType(destinationControlType);
                                    setInitialScroll(InitialScrollState.ended);
                                }
                            });
                            setInitialScroll(InitialScrollState.started);
                        };

                        if (initialControlType === 1) {
                            transitionThroughScroll(containerHeight + 1, initialControlType);
                        } else if (initialControlType === 0) {
                            transitionThroughScroll(0, initialControlType);
                        } else {
                            setInitialScroll(InitialScrollState.ended);
                        }
                    }, 0);
                }

                containerRef.current = div;
            }
        },
        [initialScroll, initialControlType]
    );

    return (
        <div ref={handleDivRef} onScroll={handleScroll} className={classes.container}>
            <TimeDisplay
                currentMilliseconds={currentMilliseconds}
                totalMilliseconds={totalMilliseconds}
                className={classes.child}
            />
            <SubtitleOffsetInput
                inputRef={offsetInputRef}
                offset={offset}
                onOffset={onOffset}
                className={classes.child}
            />
            <PlaybackRateInput
                inputRef={playbackRateInputRef}
                playbackRate={playbackRate}
                onPlaybackRate={onPlaybackRate}
                className={classes.child}
            />
        </div>
    );
};

export default ScrollableNumberControls;
