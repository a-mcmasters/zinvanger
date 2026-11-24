import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import { alpha, useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import type { LivingSubtitleResult } from '@project/common/living-subtitle/living-subtitle-controller';

export type LivingSubtitleAction = 'mine' | 'close-word' | 'escape' | 'retry-definition';

interface Props {
    readonly word: string;
    readonly definition: LivingSubtitleResult;
    readonly mining: LivingSubtitleResult;
    readonly onAction: (action: LivingSubtitleAction) => void;
}

const glass = (mode: 'light' | 'dark') => (mode === 'dark' ? 'rgba(28, 24, 38, 0.94)' : 'rgba(252, 249, 255, 0.96)');

/** The word card: a clicked word's dictionary meaning and Mine, with the word as the card's target. Text only. */
export default function LivingSubtitleCard({ word, definition, mining, onAction }: Props) {
    const { t } = useTranslation();
    const theme = useTheme();
    return (
        <Box
            role="dialog"
            aria-label={word}
            sx={{
                bgcolor: glass(theme.palette.mode),
                color: 'text.primary',
                border: 1,
                borderColor: alpha(theme.palette.text.primary, 0.16),
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)', // must fit inside the frame's padding: its edge clips it
                borderRadius: 3,
                px: 2.25,
                pt: 1.75,
                pb: 1.5,
                width: 300,
                maxWidth: '100%',
                maxHeight: 280,
                overflowY: 'auto',
                textAlign: 'left',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        component="strong"
                        sx={{ display: 'block', fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.2 }}
                    >
                        {word}
                        {definition.status === 'success' && definition.lemma && (
                            <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                                {' → '}
                                {definition.lemma}
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
                    onClick={() => onAction('close-word')}
                    sx={{ mt: -0.5, mr: -1, color: 'text.secondary' }}
                >
                    ×
                </IconButton>
            </Box>
            <Box sx={{ mt: 1.25, mb: 1.5, pl: 1.25, minHeight: 24, borderLeft: 2, borderColor: 'primary.main' }}>
                {definition.status === 'pending' && (
                    <Typography variant="body2" color="text.secondary">
                        <CircularProgress size={12} sx={{ mr: 1 }} />
                        {t('livingSubtitle.loading')}
                    </Typography>
                )}
                {definition.status === 'success' && (
                    <Typography sx={{ fontSize: '0.95rem', lineHeight: 1.45 }}>
                        {definition.text || t('livingSubtitle.noResult')}
                    </Typography>
                )}
                {definition.status === 'error' && (
                    <Typography variant="body2" color="error">
                        {t(`livingSubtitle.error.${definition.message}`, { defaultValue: definition.message })}{' '}
                        <Button size="small" onClick={() => onAction('retry-definition')}>
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
                    // wait for the meaning, so the card is not mined without its definition
                    disabled={mining.status === 'pending' || definition.status === 'pending'}
                    onClick={() => onAction('mine')}
                >
                    {t(
                        mining.status === 'pending'
                            ? 'livingSubtitle.mining'
                            : mining.status === 'success'
                              ? 'livingSubtitle.mined'
                              : 'livingSubtitle.mine'
                    )}
                </Button>
            </Box>
            <Box role="status" aria-live="polite">
                {mining.status === 'error' && (
                    <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                        {t('livingSubtitle.error.mining', { message: mining.message })}
                    </Typography>
                )}
            </Box>
        </Box>
    );
}
