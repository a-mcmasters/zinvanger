import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createTheme, ThemeProvider, useTheme } from '@mui/material/styles';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { CardModel } from '@project/common';
import type { AsbplayerSettings, KeyBindName, PageConfig, PageSettings, Profile } from '@project/common/settings';
import { changeForTextSubtitleSetting, textSubtitleSettingsForTrack } from '@project/common/settings';
import { isMobile } from 'react-device-detect';
import type { Anki } from '@project/common/anki';
import { TutorialStep } from '@project/common/components/settings-model';
import AnkiSettingsTab from '@project/common/components/AnkiSettingsTab';
import { KeyBindField } from '@project/common/components/KeyboardShortcutsSettingsTab';
import NumericSettingInput from '@project/common/components/NumericSettingInput';
import SettingsSection from '@project/common/components/SettingsSection';
import SwitchLabelWithHoverEffect from '@project/common/components/SwitchLabelWithHoverEffect';
import type { DictionaryProvider } from '@project/common/dictionary-db';
import type { LogProvider } from '@project/common/util/log';

interface SettingsFormPageConfig extends PageConfig {
    faviconUrl: string;
}

export type PageConfigMap = { [K in keyof PageSettings]: SettingsFormPageConfig };

// S13/U2: props stay as they were so every host (popup, settings page, app dialog) keeps working unchanged.
// Most are unused now that the screen only shows what the watch → replay → look up → mine workflow needs.
interface Props {
    anki: Anki;
    ankiSettingsExtra?: React.ReactNode;
    extensionInstalled: boolean;
    extensionVersion?: string;
    extensionSupportsAppIntegration: boolean;
    extensionSupportsOverlay: boolean;
    extensionSupportsSidePanel: boolean;
    extensionSupportsOrderableAnkiFields: boolean;
    extensionSupportsTrackSpecificSettings: boolean;
    extensionSupportsSubtitlesWidthSetting: boolean;
    extensionSupportsSubtitlesWidthInPixels: boolean;
    extensionSupportsPauseOnHover: boolean;
    extensionSupportsPlaybackEngine: boolean;
    extensionSupportsAutoPauseResume: boolean;
    extensionSupportsExportCardBind: boolean;
    extensionSupportsPageSettings: boolean;
    extensionSupportsAnimatedImageCapture?: boolean;
    extensionSupportsDictionary: boolean;
    extensionSupportsDictionaryBrowser: boolean;
    extensionSupportsDictionaryWaniKani: boolean;
    extensionSupportsDictionaryMatchAcrossScripts: boolean;
    extensionSupportsSeekableTrackSetting: boolean;
    extensionSupportsAutoCopyableTrackSetting: boolean;
    extensionOwnsWebSocketClient?: boolean;
    extensionSupportsDictionaryTokenStatusDisplayAlpha: boolean;
    extensionSupportsDictionaryYomitanMecab: boolean;
    supportsDictionaryPlayback: boolean;
    extensionSupportsSubtitleTrackSelectorInWebApp: boolean;
    extensionSupportsSubtitleListCustomization: boolean;
    extensionSupportsUpdateLastWithSameSubtitleText: boolean;
    /** False when the web app's dictionary lives in an extension too old for the known-word source. */
    extensionSupportsIPlusOne?: boolean;
    insideApp?: boolean;
    appVersionRepoPath?: string;
    dictionaryProvider: DictionaryProvider;
    logProvider: LogProvider;
    settings: AsbplayerSettings;
    profiles: Profile[];
    activeProfile?: string;
    pageConfigs?: PageConfigMap;
    scrollToId?: string;
    chromeKeyBinds: { [key: string]: string | undefined };
    localFontsAvailable: boolean;
    localFontsPermission?: PermissionState;
    localFontFamilies: string[];
    supportedLanguages: string[];
    forceVerticalTabs?: boolean;
    inTutorial?: boolean;
    inAnnotationTutorial?: boolean;
    onAnnotationTutorialSeen?: () => void;
    heightConstrained?: boolean;
    testCard?: () => Promise<CardModel>;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    onOpenChromeExtensionShortcuts: () => void;
    onUnlockLocalFonts: () => void;
    onImportSettings?: () => void;
}

// Mining shortcuts are Chrome extension commands, so they're edited on Chrome's shortcuts page.
const shortcuts: { name: KeyBindName; label: string; boundViaBrowser: boolean }[] = [
    { name: 'copySubtitle', label: 'binds.copySubtitle', boundViaBrowser: true },
    { name: 'ankiExport', label: 'binds.ankiExport', boundViaBrowser: true },
    {
        name: 'seekToBeginningOfCurrentSubtitle',
        label: 'binds.seekToBeginningOfCurrentOrPreviousSubtitle',
        boundViaBrowser: false,
    },
    { name: 'seekToPreviousSubtitle', label: 'binds.seekToPreviousSubtitle', boundViaBrowser: false },
    { name: 'seekToNextSubtitle', label: 'binds.seekToNextSubtitle', boundViaBrowser: false },
    { name: 'toggleSubtitles', label: 'binds.toggleSubtitles', boundViaBrowser: false },
];

// Background opacity used when the "background" switch is turned on
const subtitleBackgroundOnOpacity = 0.6;

export default function SettingsForm({
    anki,
    ankiSettingsExtra,
    settings,
    extensionInstalled,
    extensionVersion,
    extensionSupportsIPlusOne,
    insideApp,
    scrollToId,
    chromeKeyBinds,
    inTutorial,
    inAnnotationTutorial,
    onAnnotationTutorialSeen,
    testCard,
    onSettingsChanged,
    onOpenChromeExtensionShortcuts,
}: Props) {
    const { t } = useTranslation();
    const theme = useTheme();
    const settingsTheme = useMemo(
        () =>
            createTheme(theme, {
                components: {
                    MuiFormHelperText: {
                        styleOverrides: { root: { marginLeft: 0 }, contained: { marginLeft: 0 } },
                    },
                },
            }),
        [theme]
    );
    const handleSettingChanged = useCallback(
        async <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => {
            onSettingsChanged({ [key]: value });
        },
        [onSettingsChanged]
    );

    const [tutorialStep, setTutorialStep] = useState<TutorialStep>(TutorialStep.ankiConnect);
    const { noteType, keyBindSet, subtitlePositionOffset } = settings;

    useEffect(() => {
        if (tutorialStep === TutorialStep.noteType && noteType) {
            setTutorialStep(TutorialStep.ankiFields);
        }
    }, [tutorialStep, noteType]);

    // The annotation (dictionary) settings are gone, so there's nothing left for that tutorial to point at
    useEffect(() => {
        if (inAnnotationTutorial) onAnnotationTutorialSeen?.();
    }, [inAnnotationTutorial, onAnnotationTutorialSeen]);

    // Old tab ids ('anki-settings', 'keyboard-shortcuts', ...) are kept as section ids so deep links still land
    useEffect(() => {
        if (scrollToId) document.getElementById(scrollToId)?.scrollIntoView({ behavior: 'smooth' });
    }, [scrollToId]);

    // Size and background apply to every subtitle track at once
    const { subtitleSize, subtitleBackgroundOpacity } = textSubtitleSettingsForTrack(settings);
    const handleSubtitleSettingChanged = useCallback(
        (change: { subtitleSize?: number; subtitleBackgroundOpacity?: number }) =>
            onSettingsChanged(changeForTextSubtitleSetting(change, settings)),
        [settings, onSettingsChanged]
    );

    return (
        <ThemeProvider theme={settingsTheme}>
            <Stack spacing={1} sx={{ height: '100%', overflowY: 'auto', px: 2, pb: 3 }}>
                <section id="anki-settings">
                    <SettingsSection>{t('settings.anki')}</SettingsSection>
                    <AnkiSettingsTab
                        settings={settings}
                        isMobile={isMobile}
                        insideApp={insideApp}
                        inTutorial={inTutorial}
                        onSettingChanged={handleSettingChanged}
                        tutorialStep={tutorialStep}
                        onTutorialStepChanged={setTutorialStep}
                        anki={anki}
                        testCard={testCard}
                        knownWordsSupported={extensionSupportsIPlusOne}
                    />
                    {ankiSettingsExtra}
                    {extensionInstalled && (
                        <SwitchLabelWithHoverEffect
                            control={
                                <Switch
                                    checked={settings.streamingTakeScreenshot}
                                    onChange={(event) =>
                                        void handleSettingChanged('streamingTakeScreenshot', event.target.checked)
                                    }
                                />
                            }
                            label={t('extension.settings.takeScreenshot')}
                            labelPlacement="start"
                        />
                    )}
                </section>
                <section id="subtitle-appearance">
                    <SettingsSection>{t('settings.subtitles')}</SettingsSection>
                    <Stack spacing={1}>
                        <NumericSettingInput
                            label={t('settings.subtitleSize')}
                            fullWidth
                            // tracks can differ (set by the old per-track UI); show track 1's, editing sets all
                            value={subtitleSize ?? textSubtitleSettingsForTrack(settings, 0).subtitleSize!}
                            color="primary"
                            onValueChange={(value) => handleSubtitleSettingChanged({ subtitleSize: value })}
                            slotProps={{ htmlInput: { min: 1, step: 1 } }}
                        />
                        <NumericSettingInput
                            label={t('settings.subtitlePositionOffset')}
                            fullWidth
                            value={subtitlePositionOffset}
                            color="primary"
                            onValueChange={(value) => void handleSettingChanged('subtitlePositionOffset', value)}
                            slotProps={{ htmlInput: { min: 0, step: 1 } }}
                        />
                        <SwitchLabelWithHoverEffect
                            control={
                                <Switch
                                    checked={(subtitleBackgroundOpacity ?? 0) > 0}
                                    onChange={(event) =>
                                        handleSubtitleSettingChanged({
                                            subtitleBackgroundOpacity: event.target.checked
                                                ? subtitleBackgroundOnOpacity
                                                : 0,
                                        })
                                    }
                                />
                            }
                            label={t('settings.subtitleBackground')}
                            labelPlacement="start"
                        />
                    </Stack>
                </section>
                <section id="keyboard-shortcuts">
                    <SettingsSection>{t('settings.keyboardShortcuts')}</SettingsSection>
                    {shortcuts.map(({ name, label, boundViaBrowser }) => {
                        const viaChrome = extensionInstalled && boundViaBrowser;
                        return (
                            <KeyBindField
                                key={name}
                                label={t(label)}
                                keys={viaChrome ? (chromeKeyBinds[name] ?? '') : keyBindSet[name].keys}
                                boundViaChrome={viaChrome}
                                onKeysChange={(keys) =>
                                    void handleSettingChanged('keyBindSet', { ...keyBindSet, [name]: { keys } })
                                }
                                onOpenExtensionShortcuts={onOpenChromeExtensionShortcuts}
                            />
                        );
                    })}
                </section>
                {extensionVersion && (
                    <Typography variant="caption" color="textSecondary" sx={{ pt: 2 }}>
                        Zinvanger {extensionVersion}
                    </Typography>
                )}
            </Stack>
        </ThemeProvider>
    );
}
