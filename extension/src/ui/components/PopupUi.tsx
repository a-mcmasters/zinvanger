import project from '@project/common/project';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import type {
    ExtensionToVideoCommand,
    GrantedActiveTabPermissionMessage,
    PopupToExtensionCommand,
    SettingsUpdatedMessage,
} from '@project/common';
import { createTheme } from '@project/common/theme';
import { asbError } from '@project/common/util/log';
import type { AsbplayerSettings } from '@project/common/settings';
import { SettingsProvider } from '@project/common/settings';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { ExtensionSettingsStorage } from '@project/extension/src/services/extension-settings-storage';
import Popup from '@project/extension/src/ui/components/Popup';
import { useRequestingActiveTabPermission } from '@project/extension/src/ui/hooks/use-requesting-active-tab-permission';
import { isMobile } from 'react-device-detect';
import { useSettingsProfileContext } from '@project/common/hooks/use-settings-profile-context';
import { alpha, StyledEngineProvider, ThemeProvider } from '@mui/material/styles';
import { DictionaryProvider } from '@project/common/dictionary-db';
import { ExtensionDictionaryStorage } from '@/services/extension-dictionary-storage';
import { isFirefoxBuild } from '@/services/build-flags';
import { openExtensionShortcuts } from '@/services/extension-shortcuts';
import { extensionLogProvider } from '@/services/extension-log-provider';

interface Props {
    initialSettings: AsbplayerSettings;
    commands: any;
}

const handleOpenExtensionShortcuts = () => openExtensionShortcuts({ closePopup: true });

const notifySettingsUpdated = () => {
    const settingsUpdatedCommand: PopupToExtensionCommand<SettingsUpdatedMessage> = {
        sender: 'asbplayer-popup',
        message: {
            command: 'settings-updated',
        },
    };
    void browser.runtime
        .sendMessage(settingsUpdatedCommand)
        .catch((error) => asbError('settings', 'Failed to notify the extension about updated settings:', error));
};

export function PopupUi({ initialSettings, commands }: Props) {
    const dictionaryProvider = useMemo(() => new DictionaryProvider(new ExtensionDictionaryStorage()), []);
    const settingsProvider = useMemo(() => new SettingsProvider(new ExtensionSettingsStorage()), []);
    const [settings, setSettings] = useState(initialSettings);
    const theme = useMemo(() => createTheme(settings.themeType), [settings.themeType]);

    const handleSettingsChanged = useCallback(
        async (changed: Partial<AsbplayerSettings>) => {
            setSettings((old) => ({ ...old, ...changed }));
            try {
                await settingsProvider.set(changed);
                notifySettingsUpdated();
            } catch (error) {
                asbError('settings', 'Failed to save extension settings:', error);
            }
        },
        [settingsProvider]
    );

    const handleOpenApp = useCallback(() => {
        if (settings.streamingAppUrl) {
            void browser.tabs.create({ active: true, url: settings.streamingAppUrl });
            window.close();
        }
    }, [settings]);

    const handleOpenSidePanel = useCallback(async () => {
        if (isFirefoxBuild) {
            // @ts-expect-error: browser.sidebarAction is not yet in the TypeScript lib.dom.d.ts
            browser.sidebarAction.open();
        } else {
            browser.windows.getLastFocused((window) => {
                void browser.sidePanel.open({ windowId: window.id! });
            });
        }
    }, []);

    const handleOpenUserGuide = useCallback(() => {
        void browser.tabs.create({ active: true, url: `${project.urls.repo}#getting-started` });
        window.close();
    }, []);

    const { requestingActiveTabPermission, tabRequestingActiveTabPermission } = useRequestingActiveTabPermission();

    useEffect(() => {
        if (!requestingActiveTabPermission || tabRequestingActiveTabPermission === undefined) {
            return;
        }

        const command: ExtensionToVideoCommand<GrantedActiveTabPermissionMessage> = {
            sender: 'asbplayer-extension-to-video',
            message: {
                command: 'granted-active-tab-permission',
            },
            src: tabRequestingActiveTabPermission.src,
        };
        void browser.tabs.sendMessage(tabRequestingActiveTabPermission.tabId, command);
        window.close();
    }, [requestingActiveTabPermission, tabRequestingActiveTabPermission]);

    const handleProfileChanged = useCallback(() => {
        void settingsProvider
            .getAll()
            .then(setSettings)
            .catch((error) => asbError('settings', 'Failed to load extension settings:', error));
        notifySettingsUpdated();
    }, [settingsProvider]);

    const profilesContext = useSettingsProfileContext({
        dictionaryProvider,
        settingsProvider,
        onProfileChanged: handleProfileChanged,
    });

    if (requestingActiveTabPermission === undefined) {
        return null;
    }

    return (
        <StyledEngineProvider injectFirst>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <GlobalStyles
                    styles={{
                        ':root': { backgroundColor: theme.palette.background.paper, colorScheme: theme.palette.mode },
                    }}
                />
                <Paper
                    square
                    sx={{
                        backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.09)}, transparent 55%)`,
                        width: isMobile ? '100%' : 'var(--popup-desktop-width)',
                        minHeight: isMobile ? undefined : 'var(--popup-desktop-min-height)',
                    }}
                >
                    <Box>
                        <Popup
                            commands={commands}
                            dictionaryProvider={dictionaryProvider}
                            logProvider={extensionLogProvider}
                            settings={settings}
                            onSettingsChanged={handleSettingsChanged}
                            onOpenApp={handleOpenApp}
                            onOpenSidePanel={handleOpenSidePanel}
                            onOpenExtensionShortcuts={handleOpenExtensionShortcuts}
                            onOpenUserGuide={handleOpenUserGuide}
                            {...profilesContext}
                        />
                    </Box>
                </Paper>
            </ThemeProvider>
        </StyledEngineProvider>
    );
}
