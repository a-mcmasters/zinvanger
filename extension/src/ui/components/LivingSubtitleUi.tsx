import { createTheme } from '@project/common/theme';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import IconButton from '@mui/material/IconButton';
import { alpha, ThemeProvider } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localLookupTokenSettingsId } from '@/services/local-lookup-token';
import type Bridge from '@/ui/bridge';
import type { LivingSubtitleResult } from '@/controllers/living-subtitle-controller';

export type LivingSubtitlePart = 'strip' | 'card';

/** What the host sends to both frames. Text only: frames never receive HTML. */
export interface LivingSubtitleViewModel {
    readonly themeType: 'light' | 'dark';
    readonly sentence: string;
    readonly captured: boolean;
    readonly wordNavigation: boolean;
    readonly words: readonly string[];
    readonly wordIndex?: number;
    readonly targetWordIndex?: number;
    readonly cardOpen: boolean;
    readonly englishVisible: boolean;
    readonly translation: LivingSubtitleResult;
    readonly definition: LivingSubtitleResult;
    readonly mining: LivingSubtitleResult;
    readonly replayDisabled: boolean;
    readonly lookupAvailable: boolean;
    /** Incremented by the host when focus should move into this frame. */
    readonly focusRequest: number;
    /** Widest the frame may be (visible video width), so the strip wraps instead of overflowing at high zoom. */
    readonly maxWidth: number;
    /** Tallest the frame may be (visible video height); content beyond it scrolls. */
    readonly maxHeight: number;
}

export type LivingSubtitleAction =
    | 'replay'
    | 'look-up'
    | 'english'
    | 'mine'
    | 'use-target'
    | 'close-word'
    | 'escape'
    | 'word-previous'
    | 'word-next'
    | 'word-open'
    | 'retry-definition'
    | 'retry-translation'
    | 'pointer-enter'
    | 'pointer-leave'
    | 'focus-in'
    | 'focus-out';

interface Props {
    readonly bridge: Bridge;
    readonly part: LivingSubtitlePart;
}

const glass = (mode: 'light' | 'dark') => (mode === 'dark' ? 'rgba(28, 24, 38, 0.94)' : 'rgba(252, 249, 255, 0.96)');

export default function LivingSubtitleUi({ bridge, part }: Props) {
    const { t } = useTranslation();
    const [model, setModel] = useState<LivingSubtitleViewModel>();
    const rootRef = useRef<HTMLDivElement>(null);
    const firstActionRef = useRef<HTMLButtonElement>(null);
    const lookUpRef = useRef<HTMLButtonElement>(null);
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
    // The host sizes each frame to its content so the rest of the video stays clickable.
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

    const focusRequest = model?.focusRequest ?? 0;
    useEffect(() => {
        if (focusRequest === 0) return;
        if (part === 'strip') firstActionRef.current?.focus();
        else rootRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, [focusRequest, part]);

    const theme = useMemo(() => createTheme(model?.themeType ?? 'dark'), [model?.themeType]);
    if (!model) return null;

    const mode = model.themeType;
    const word = model.wordIndex === undefined ? undefined : model.words[model.wordIndex];
    const errorText = (result: LivingSubtitleResult) =>
        result.status === 'error' ? t(`livingSubtitle.error.${result.message}`, { defaultValue: result.message }) : '';
    const lookupSettingsLink = (result: LivingSubtitleResult) =>
        result.status === 'error' && result.message === 'unauthorized' ? (
            <Button
                size="small"
                href={`${browser.runtime.getURL('/options.html')}#${localLookupTokenSettingsId}`}
                target="_blank"
                rel="noopener noreferrer"
            >
                {t('livingSubtitle.openLookupSettings')}
            </Button>
        ) : null;
    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') send('escape');
        else if (model.wordNavigation && event.key === 'ArrowLeft') send('word-previous');
        else if (model.wordNavigation && event.key === 'ArrowRight') send('word-next');
        // Enter on any other button presses that button.
        else if (model.wordNavigation && event.key === 'Enter' && event.target === lookUpRef.current) send('word-open');
        else return;
        event.preventDefault();
    };
    const surface = {
        bgcolor: glass(mode),
        color: 'text.primary',
        border: 1,
        borderColor: alpha(theme.palette.text.primary, 0.16),
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)', // must fit inside the root padding: the frame edge clips it
        '@media (prefers-reduced-motion: no-preference)': { transition: 'opacity 120ms' },
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {/* CssBaseline paints the body; these frames float over video, so only their surfaces may be opaque. */}
            <GlobalStyles styles={{ 'html, body': { backgroundColor: 'transparent' } }} />
            <Box
                ref={rootRef}
                onPointerEnter={() => send('pointer-enter')}
                onPointerLeave={() => send('pointer-leave')}
                onFocus={() => send('focus-in')}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) send('focus-out');
                }}
                onKeyDown={handleKeyDown}
                sx={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                    p: 1.5,
                    width: 'max-content', // measured size must not depend on the frame's current viewport
                    maxWidth: model.maxWidth,
                    maxHeight: model.maxHeight,
                    overflowY: 'auto',
                    boxSizing: 'border-box',
                }}
            >
                {part === 'strip' ? (
                    <>
                        <Box
                            role="toolbar"
                            aria-label={t('livingSubtitle.actions')}
                            sx={{
                                ...surface,
                                display: 'flex',
                                flexWrap: 'wrap',
                                justifyContent: 'center',
                                gap: 0.25,
                                p: 0.5,
                                borderRadius: 3,
                            }}
                        >
                            <Button
                                ref={firstActionRef}
                                size="small"
                                color="inherit"
                                disabled={model.replayDisabled}
                                title={model.replayDisabled ? t('livingSubtitle.replayUnavailable') : undefined}
                                onClick={() => send('replay')}
                                sx={{ borderRadius: 99, minHeight: 32, px: 1.5 }}
                            >
                                ↺ {t('livingSubtitle.replay')}
                            </Button>
                            <Button
                                ref={lookUpRef}
                                size="small"
                                color="inherit"
                                disabled={!model.lookupAvailable}
                                aria-pressed={model.wordNavigation}
                                onClick={() => send('look-up')}
                                sx={{ borderRadius: 99, minHeight: 32, px: 1.5 }}
                            >
                                ⌕ {t('livingSubtitle.lookUp')}
                            </Button>
                            <Button
                                size="small"
                                color="inherit"
                                aria-pressed={model.englishVisible}
                                onClick={() => send('english')}
                                sx={{ borderRadius: 99, minHeight: 32, px: 1.5 }}
                            >
                                文 {t(model.englishVisible ? 'livingSubtitle.hideEnglish' : 'livingSubtitle.english')}
                            </Button>
                            <Button
                                size="small"
                                variant="contained"
                                disabled={model.mining.status === 'pending'}
                                onClick={() => send('mine')}
                                sx={{ borderRadius: 99, minHeight: 32, px: 1.5 }}
                            >
                                ＋{' '}
                                {t(
                                    model.mining.status === 'pending'
                                        ? 'livingSubtitle.mining'
                                        : model.mining.status === 'success'
                                          ? 'livingSubtitle.mined'
                                          : 'livingSubtitle.mine'
                                )}
                            </Button>
                        </Box>
                        <Box role="status" aria-live="polite" sx={{ maxWidth: 560, textAlign: 'center' }}>
                            {model.wordNavigation && word !== undefined && (
                                <Typography variant="caption" sx={{ ...surface, px: 1, py: 0.25, borderRadius: 1 }}>
                                    {t('livingSubtitle.wordNavigation', {
                                        index: model.wordIndex! + 1,
                                        count: model.words.length,
                                        word,
                                    })}
                                </Typography>
                            )}
                            {model.mining.status === 'error' && (
                                <Typography variant="body2" color="error" sx={{ ...surface, px: 1, borderRadius: 1 }}>
                                    {t('livingSubtitle.error.mining', { message: model.mining.message })}
                                </Typography>
                            )}
                        </Box>
                        {model.englishVisible && (
                            <Box sx={{ ...surface, px: 1.5, py: 0.75, borderRadius: 2, maxWidth: 560 }}>
                                {model.translation.status === 'pending' && <CircularProgress size={16} />}
                                {model.translation.status === 'success' && (
                                    <Typography sx={{ textAlign: 'center' }}>{model.translation.text}</Typography>
                                )}
                                {model.translation.status === 'error' && (
                                    <Typography variant="body2" color="error">
                                        {errorText(model.translation)}{' '}
                                        <Button size="small" onClick={() => send('retry-translation')}>
                                            {t('livingSubtitle.retry')}
                                        </Button>
                                        {lookupSettingsLink(model.translation)}
                                    </Typography>
                                )}
                            </Box>
                        )}
                    </>
                ) : (
                    model.cardOpen &&
                    word !== undefined && (
                        <Box
                            role="dialog"
                            aria-label={word}
                            sx={{
                                ...surface,
                                borderRadius: 2,
                                p: 2,
                                width: 280,
                                maxWidth: '100%',
                                maxHeight: 240,
                                overflowY: 'auto',
                            }}
                        >
                            <Typography variant="overline" color="primary" sx={{ lineHeight: 1 }}>
                                {t('livingSubtitle.meaningInContext')}
                            </Typography>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Typography variant="h6" component="strong" sx={{ fontWeight: 650 }}>
                                    {word}
                                </Typography>
                                <IconButton
                                    size="small"
                                    aria-label={t('livingSubtitle.closeWord')}
                                    onClick={() => send('close-word')}
                                >
                                    ×
                                </IconButton>
                            </Box>
                            <Box sx={{ my: 1, minHeight: 24 }}>
                                {model.definition.status === 'pending' && (
                                    <Typography variant="body2" color="text.secondary">
                                        <CircularProgress size={12} sx={{ mr: 1 }} />
                                        {t('livingSubtitle.loading')}
                                    </Typography>
                                )}
                                {model.definition.status === 'success' && (
                                    <Typography variant="body2">
                                        {model.definition.text || t('livingSubtitle.noResult')}
                                    </Typography>
                                )}
                                {model.definition.status === 'error' && (
                                    <Typography variant="body2" color="error">
                                        {errorText(model.definition)}{' '}
                                        <Button size="small" onClick={() => send('retry-definition')}>
                                            {t('livingSubtitle.retry')}
                                        </Button>
                                        {lookupSettingsLink(model.definition)}
                                    </Typography>
                                )}
                            </Box>
                            <Button
                                fullWidth
                                variant="outlined"
                                size="small"
                                aria-pressed={model.targetWordIndex === model.wordIndex}
                                onClick={() => send('use-target')}
                            >
                                {model.targetWordIndex === model.wordIndex
                                    ? `✓ ${t('livingSubtitle.targetWord')}`
                                    : `＋ ${t('livingSubtitle.useAsTarget')}`}
                            </Button>
                        </Box>
                    )
                )}
            </Box>
        </ThemeProvider>
    );
}
