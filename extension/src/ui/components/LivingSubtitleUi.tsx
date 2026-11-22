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
import type Bridge from '@/ui/bridge';
import type { LivingSubtitleResult } from '@/controllers/living-subtitle-controller';

/** What the host sends to the word card. Text only: the frame never receives HTML. */
export interface LivingSubtitleViewModel {
    readonly themeType: 'light' | 'dark';
    readonly words: readonly string[];
    readonly wordIndex: number;
    readonly definition: LivingSubtitleResult;
    readonly mining: LivingSubtitleResult;
    /** Widest the card may be (visible video width). */
    readonly maxWidth: number;
    /** Tallest the card may be (visible video height); content beyond it scrolls. */
    readonly maxHeight: number;
}

export type LivingSubtitleAction = 'mine' | 'close-word' | 'escape' | 'retry-definition';

interface Props {
    readonly bridge: Bridge;
}

const glass = (mode: 'light' | 'dark') => (mode === 'dark' ? 'rgba(28, 24, 38, 0.94)' : 'rgba(252, 249, 255, 0.96)');

/** The word card: a clicked word's dictionary meaning and Mine, with the word as the card's target. */
export default function LivingSubtitleUi({ bridge }: Props) {
    const { t } = useTranslation();
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

    const word = model.words[model.wordIndex];
    const surface = {
        bgcolor: glass(model.themeType),
        color: 'text.primary',
        border: 1,
        borderColor: alpha(theme.palette.text.primary, 0.16),
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)', // must fit inside the root padding: the frame edge clips it
    };

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
                <Box
                    role="dialog"
                    aria-label={word}
                    sx={{
                        ...surface,
                        borderRadius: 3,
                        px: 2.25,
                        pt: 1.75,
                        pb: 1.5,
                        width: 300,
                        maxWidth: '100%',
                        maxHeight: 280,
                        overflowY: 'auto',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                                component="strong"
                                sx={{ display: 'block', fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.2 }}
                            >
                                {word}
                                {model.definition.status === 'success' && model.definition.lemma && (
                                    <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                                        {' → '}
                                        {model.definition.lemma}
                                    </Box>
                                )}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {t('livingSubtitle.meaningInContext')}
                            </Typography>
                        </Box>
                        <IconButton
                            size="small"
                            aria-label={t('livingSubtitle.closeWord')}
                            onClick={() => send('close-word')}
                            sx={{ mt: -0.5, mr: -1, color: 'text.secondary' }}
                        >
                            ×
                        </IconButton>
                    </Box>
                    <Box
                        sx={{ mt: 1.25, mb: 1.5, pl: 1.25, minHeight: 24, borderLeft: 2, borderColor: 'primary.main' }}
                    >
                        {model.definition.status === 'pending' && (
                            <Typography variant="body2" color="text.secondary">
                                <CircularProgress size={12} sx={{ mr: 1 }} />
                                {t('livingSubtitle.loading')}
                            </Typography>
                        )}
                        {model.definition.status === 'success' && (
                            <Typography sx={{ fontSize: '0.95rem', lineHeight: 1.45 }}>
                                {model.definition.text || t('livingSubtitle.noResult')}
                            </Typography>
                        )}
                        {model.definition.status === 'error' && (
                            <Typography variant="body2" color="error">
                                {t(`livingSubtitle.error.${model.definition.message}`, {
                                    defaultValue: model.definition.message,
                                })}{' '}
                                <Button size="small" onClick={() => send('retry-definition')}>
                                    {t('livingSubtitle.retry')}
                                </Button>
                            </Typography>
                        )}
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Button
                            variant="contained"
                            size="small"
                            sx={{ borderRadius: 99, px: 2 }}
                            disabled={model.mining.status === 'pending'}
                            onClick={() => send('mine')}
                        >
                            {t(
                                model.mining.status === 'pending'
                                    ? 'livingSubtitle.mining'
                                    : model.mining.status === 'success'
                                      ? 'livingSubtitle.mined'
                                      : 'livingSubtitle.mine'
                            )}
                        </Button>
                    </Box>
                    <Box role="status" aria-live="polite">
                        {model.mining.status === 'error' && (
                            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                                {t('livingSubtitle.error.mining', { message: model.mining.message })}
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Box>
        </ThemeProvider>
    );
}
