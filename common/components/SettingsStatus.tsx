import React from 'react';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

export type SettingsStatusState = 'ok' | 'error' | 'pending';

interface Props {
    state: SettingsStatusState;
    children: React.ReactNode;
    action?: React.ReactNode;
}

// A one-line "● Connected" row, used where the settings screen shows a connection instead of its config.
export default function SettingsStatus({ state, children, action }: Props) {
    const theme = useTheme();
    const color = {
        ok: theme.palette.success.main,
        error: theme.palette.error.main,
        pending: theme.palette.text.disabled,
    }[state];

    return (
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minHeight: 40 }} role="status">
            <span
                aria-hidden
                style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }}
            />
            <Typography sx={{ flexGrow: 1 }}>{children}</Typography>
            {action}
        </Stack>
    );
}
