import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';
import { isPersonalHostedTranslationBuild } from '@/services/build-flags';
import {
    getLocalLookupToken,
    localLookupTokenKey,
    localLookupTokenSettingsId,
    minimumLocalLookupTokenLength,
    webSentenceTranslationKey,
} from '@/services/local-lookup-token';

export default function LocalLookupSettings() {
    const { t } = useTranslation();
    const [savedToken, setSavedToken] = useState<string>();
    const [token, setToken] = useState('');
    const [webTranslation, setWebTranslation] = useState(false);
    const [savedWebTranslation, setSavedWebTranslation] = useState(false);
    const [error, setError] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        void Promise.all([
            getLocalLookupToken(),
            isPersonalHostedTranslationBuild
                ? browser.storage.local.get({ [webSentenceTranslationKey]: false })
                : { [webSentenceTranslationKey]: false },
        ])
            .then(([value, settings]) => {
                const enabled = settings[webSentenceTranslationKey] === true;
                setSavedToken(value);
                setToken(value);
                setSavedWebTranslation(enabled);
                setWebTranslation(enabled);
            })
            .catch(() => setError(true));
        // Another open settings view may save; follow it so a later save here can't write back stale values.
        const listener = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
            if (area !== 'local') return;
            if (isPersonalHostedTranslationBuild && webSentenceTranslationKey in changes) {
                const enabled = changes[webSentenceTranslationKey].newValue === true;
                setSavedWebTranslation(enabled);
                setWebTranslation(enabled);
            }
            if (localLookupTokenKey in changes) {
                const value = (changes[localLookupTokenKey].newValue as string | undefined) ?? '';
                setSavedToken(value);
                setToken(value);
            }
        };
        browser.storage.onChanged.addListener(listener);
        return () => browser.storage.onChanged.removeListener(listener);
    }, []);

    const save = async () => {
        const value = token.trim();
        const enabled = value.length >= minimumLocalLookupTokenLength && webTranslation;
        setSaving(true);
        setError(false);
        try {
            // Write only what this view changed (consent also turns off when the token can no longer support it).
            const update: Record<string, string | boolean> = {};
            if (value !== savedToken) update[localLookupTokenKey] = value;
            // A token too short to use always revokes consent, even if another view just granted it.
            if (
                (isPersonalHostedTranslationBuild && enabled !== savedWebTranslation) ||
                value.length < minimumLocalLookupTokenLength
            ) {
                update[webSentenceTranslationKey] = enabled;
            }
            await browser.storage.local.set(update);
            setSavedToken(value);
            setToken(value);
            setSavedWebTranslation(enabled);
            setWebTranslation(enabled);
        } catch {
            setError(true);
        } finally {
            setSaving(false);
        }
    };

    const tokenLength = token.trim().length;
    const tooShort = tokenLength > 0 && tokenLength < minimumLocalLookupTokenLength;
    return (
        <Stack id={localLookupTokenSettingsId} spacing={1} sx={{ mt: 2 }}>
            <Stack direction="row" spacing={2} alignItems="flex-start">
                <TextField
                    fullWidth
                    type="password"
                    autoComplete="off"
                    label={t('settings.localLookupToken')}
                    helperText={t(error ? 'settings.localLookupTokenStorageError' : 'settings.localLookupTokenHint')}
                    value={token}
                    disabled={savedToken === undefined || saving}
                    error={error || tooShort}
                    onChange={(event) => setToken(event.target.value)}
                />
                <Button
                    disabled={
                        savedToken === undefined ||
                        saving ||
                        tooShort ||
                        (token.trim() === savedToken && webTranslation === savedWebTranslation)
                    }
                    onClick={() => void save()}
                >
                    {t('settings.localLookupTokenSave')}
                </Button>
            </Stack>
            {isPersonalHostedTranslationBuild && (
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={webTranslation}
                            onChange={(event) => setWebTranslation(event.target.checked)}
                        />
                    }
                    disabled={savedToken === undefined || saving || tokenLength < minimumLocalLookupTokenLength}
                    label={t('settings.webSentenceTranslation')}
                />
            )}
        </Stack>
    );
}
