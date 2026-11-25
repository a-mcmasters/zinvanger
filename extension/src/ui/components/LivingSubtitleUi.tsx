import { createTheme } from '@project/common/theme';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import { ThemeProvider } from '@mui/material/styles';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type Bridge from '@/ui/bridge';
import LivingSubtitleCard from '@project/common/components/LivingSubtitleCard';
import type { LivingSubtitleAction } from '@project/common/components/LivingSubtitleCard';
import type { LivingSubtitleResult } from '@project/common/living-subtitle/living-subtitle-controller';

/** What the host sends to the word card. Text only: the frame never receives HTML. */
export interface LivingSubtitleViewModel {
    readonly themeType: 'light' | 'dark';
    readonly words: readonly string[];
    readonly wordIndex: number;
    readonly definition: LivingSubtitleResult;
    readonly mining: LivingSubtitleResult;
    readonly known: LivingSubtitleResult;
    /** Widest the card may be (visible video width). */
    readonly maxWidth: number;
    /** Tallest the card may be (visible video height); content beyond it scrolls. */
    readonly maxHeight: number;
}

interface Props {
    readonly bridge: Bridge;
}

/** The word card's extension frame: relays the host's model and the card's actions, and reports its size. */
export default function LivingSubtitleUi({ bridge }: Props) {
    const [model, setModel] = useState<LivingSubtitleViewModel>();
    const rootRef = useRef<HTMLDivElement>(null);
    const send = useCallback(
        (action: LivingSubtitleAction) => bridge.sendMessageFromServer({ command: 'action', action } as any),
        [bridge]
    );

    useEffect(() => bridge.serverIsReady(), [bridge]);
    useEffect(
        () =>
            bridge.addClientMessageListener((message: any) => {
                if (message.command === 'updateState') setModel(message.state as LivingSubtitleViewModel);
            }),
        [bridge]
    );

    const loaded = model !== undefined;
    // The host sizes the frame to its content so the rest of the video stays clickable.
    useLayoutEffect(() => {
        const element = rootRef.current;
        if (!element) return;
        const reportSize = () => {
            const { width, height } = element.getBoundingClientRect();
            bridge.sendMessageFromServer({ command: 'size', width, height } as any);
        };
        // Chromium can defer ResizeObserver callbacks in hidden cross-origin frames. The host needs
        // this first measurement to reveal the frame, which lets the observer track later changes.
        reportSize();
        const observer = new ResizeObserver(reportSize);
        observer.observe(element);
        return () => observer.disconnect();
    }, [bridge, loaded]);

    const theme = useMemo(() => createTheme(model?.themeType ?? 'dark'), [model?.themeType]);
    if (!model) return null;

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {/* CssBaseline paints the body; the frame floats over video, so only the card may be opaque. */}
            <GlobalStyles styles={{ 'html, body': { backgroundColor: 'transparent' } }} />
            <Box
                ref={rootRef}
                onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    send('escape');
                    event.preventDefault();
                }}
                sx={{
                    display: 'inline-flex',
                    p: 1.5,
                    width: 'max-content', // measured size must not depend on the frame's current viewport
                    maxWidth: model.maxWidth,
                    maxHeight: model.maxHeight,
                    overflowY: 'auto',
                    boxSizing: 'border-box',
                }}
            >
                <LivingSubtitleCard
                    word={model.words[model.wordIndex]}
                    definition={model.definition}
                    mining={model.mining}
                    known={model.known}
                    onAction={send}
                />
            </Box>
        </ThemeProvider>
    );
}
