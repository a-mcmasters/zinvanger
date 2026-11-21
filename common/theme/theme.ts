import type { PaletteMode, PaletteOptions } from '@mui/material/styles';
import { alpha, createTheme as createMuiTheme } from '@mui/material/styles';

export const brandGradient = 'linear-gradient(145deg, #6231b9, #281354)';

const palettes: Record<PaletteMode, PaletteOptions> = {
    light: {
        primary: { main: '#6332a6', light: '#8350cb', dark: '#4b2288', contrastText: '#ffffff' },
        background: { paper: '#fcf9ff' },
        text: { primary: '#241931', secondary: '#62556e' },
        divider: '#dfd5e9',
        error: { main: '#b12c4e' },
        warning: { main: '#86510c' },
        success: { main: '#23663e' },
        info: { main: '#285f94' },
    },
    dark: {
        primary: { main: '#c4a1ff', light: '#e2ceff', dark: '#b68fee', contrastText: '#241239' },
        background: { paper: '#211a2e' },
        text: { primary: '#faf6ff', secondary: '#c5b9d4' },
        divider: '#453953',
        error: { main: '#ff91a9' },
        warning: { main: '#ffc981' },
        success: { main: '#86dbaa' },
        info: { main: '#a5d5ff' },
    },
};

export const createTheme = (mode: PaletteMode) => {
    const palette = palettes[mode];
    const controlBorder = mode === 'dark' ? '#89789c' : '#8b7b9b';

    return createMuiTheme({
        palette: {
            ...palette,
            mode,
            background: {
                ...palette.background,
                // The extension mounts dialogs in transparent iframes over video.
                default: 'transparent',
            },
        },
        typography: {
            fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
            h5: { fontWeight: 650, letterSpacing: '-0.025em' },
            h6: { fontWeight: 650, letterSpacing: '-0.015em' },
            button: { fontWeight: 600, textTransform: 'none' },
        },
        shape: { borderRadius: 10 },
        spacing: 8,
        components: {
            MuiPaper: {
                styleOverrides: {
                    root: { backgroundImage: 'none' },
                },
            },
            MuiDialog: {
                styleOverrides: {
                    paper: ({ theme }) => ({
                        borderRadius: 22,
                        border: `1px solid ${theme.palette.divider}`,
                        backgroundColor: alpha(theme.palette.background.paper, 0.96),
                        backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.07)}, transparent 45%)`,
                        backdropFilter: 'blur(20px) saturate(1.2)',
                    }),
                    paperFullScreen: { border: 0, borderRadius: 0 },
                },
            },
            MuiPopover: {
                styleOverrides: {
                    paper: ({ theme }) => ({
                        borderRadius: 14,
                        border: `1px solid ${theme.palette.divider}`,
                    }),
                },
            },
            MuiButtonBase: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        '&.Mui-focusVisible': {
                            outline: `2px solid ${theme.palette.primary.main}`,
                            outlineOffset: 2,
                        },
                    }),
                },
            },
            MuiButton: {
                styleOverrides: {
                    root: { borderRadius: 999 },
                },
            },
            MuiOutlinedInput: {
                styleOverrides: {
                    notchedOutline: { borderColor: controlBorder },
                },
            },
        },
    });
};
