import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';
import { isPersonalHostedTranslationBuild } from '@/services/build-flags';
import {
    getTranslationApiKey,
    translationApiKeyKey,
    minimumTranslationApiKeyLength,
    webSentenceTranslationKey,
} from '@/services/translation-api-key';

export default function TranslationApiKeySettings() {
    const { t } = useTranslation();
    const [savedToken, setSavedToken] = useState<string>();
    const [token, setToken] = useState('');
    const [webTranslation, setWebTranslation] = useState(false);
    const [savedWebTranslation, setSavedWebTranslation] = useState(false);
    const [error, setError] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        void Promise.all([
            getTranslationApiKey(),
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
            if (translationApiKeyKey in changes) {
                const value = (changes[translationApiKeyKey].newValue as string | undefined) ?? '';
                setSavedToken(value);
                setToken(value);
            }
        };
        browser.storage.onChanged.addListener(listener);
        return () => browser.storage.onChanged.removeListener(listener);
    }, []);

    const save = async () => {
        const value = token.trim();
        const enabled = value.length >= minimumTranslationApiKeyLength && webTranslation;
        setSaving(true);
        setError(false);
        try {
            // Write only what this view changed (consent also turns off when the token can no longer support it).
            const update: Record<string, string | boolean> = {};
            if (value !== savedToken) update[translationApiKeyKey] = value;
            // A token too short to use always revokes consent, even if another view just granted it.
            if (
                (isPersonalHostedTranslationBuild && enabled !== savedWebTranslation) ||
                value.length < minimumTranslationApiKeyLength
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
    const tooShort = tokenLength > 0 && tokenLength < minimumTranslationApiKeyLength;
    return (
        <Stack spacing={1} sx={{ mt: 2 }}>
            <Stack direction="row" spacing={2} alignItems="flex-start">
                <TextField
                    fullWidth
                    type="password"
                    autoComplete="off"
                    label={t('settings.translationApiKey')}
                    helperText={t(error ? 'settings.translationApiKeyStorageError' : 'settings.translationApiKeyHint')}
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
                    {t('settings.translationApiKeySave')}
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
                    disabled={savedToken === undefined || saving || tokenLength < minimumTranslationApiKeyLength}
                    label={t('settings.webAppSentenceTranslation')}
                />
            )}
        </Stack>
    );
}
