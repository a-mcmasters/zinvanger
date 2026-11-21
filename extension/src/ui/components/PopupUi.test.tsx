import React, { act } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { defaultSettings, SettingsProvider } from '@project/common/settings';
import type { AsbplayerSettings } from '@project/common/settings';
import { createTheme } from '@project/common/theme';
import { MockStorageArea } from '@project/extension/src/services/mock-storage-area';
import { PopupUi } from '@project/extension/src/ui/components/PopupUi';

const mockPopupProps: { settings: AsbplayerSettings }[] = [];
let mockRequestingActiveTabPermission: boolean | undefined = false;

jest.mock('@project/extension/src/ui/components/Popup', () => ({
    __esModule: true,
    default: (props: { settings: AsbplayerSettings }) => {
        mockPopupProps.push(props);
        return <div data-testid="popup" />;
    },
}));
jest.mock('@project/extension/src/ui/hooks/use-requesting-active-tab-permission', () => ({
    useRequestingActiveTabPermission: () => ({ requestingActiveTabPermission: mockRequestingActiveTabPermission }),
}));
jest.mock('@project/common/hooks/use-settings-profile-context', () => ({
    useSettingsProfileContext: () => ({}),
}));
jest.mock('@/services/extension-log-provider', () => ({ extensionLogProvider: {} }));
jest.mock('@/services/build-flags', () => ({ isFirefoxBuild: false }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const injectedRules = () =>
    Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText));

describe('PopupUi', () => {
    const originalBrowser = Object.getOwnPropertyDescriptor(globalThis, 'browser');
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        mockPopupProps.length = 0;
        mockRequestingActiveTabPermission = false;
        Object.defineProperty(globalThis, 'browser', {
            configurable: true,
            value: { storage: { local: new MockStorageArea() } },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        jest.restoreAllMocks();
        if (originalBrowser) Object.defineProperty(globalThis, 'browser', originalBrowser);
        else Reflect.deleteProperty(globalThis, 'browser');
    });

    // Regression for issue #2: a second async settings read delayed mount and flashed a white square.
    it('renders the initial settings on the first render without reading settings again', () => {
        const getAll = jest.spyOn(SettingsProvider.prototype, 'getAll');
        const initialSettings: AsbplayerSettings = { ...defaultSettings, themeType: 'dark' };

        act(() => root.render(<PopupUi initialSettings={initialSettings} commands={{}} />));

        expect(container.querySelector('[data-testid="popup"]')).not.toBeNull();
        expect(mockPopupProps[0].settings).toBe(initialSettings);
        expect(getAll).not.toHaveBeenCalled();
    });

    it.each(['dark', 'light'] as const)('paints the root with the %s theme paper color', (themeType) => {
        act(() => root.render(<PopupUi initialSettings={{ ...defaultSettings, themeType }} commands={{}} />));

        const rootRule = injectedRules()
            .filter((rule) => rule.startsWith(':root'))
            .at(-1);
        expect(rootRule).toContain(`background-color: ${createTheme(themeType).palette.background.paper};`);
        expect(rootRule).toContain(`color-scheme: ${themeType};`);
    });

    it('keeps the root empty while the active tab permission is loading', () => {
        mockRequestingActiveTabPermission = undefined;

        act(() => root.render(<PopupUi initialSettings={defaultSettings} commands={{}} />));

        expect(container.childNodes).toHaveLength(0);
    });
});

describe('popup-ui index.html', () => {
    const html = readFileSync(join(__dirname, '../../entrypoints/popup-ui/index.html'), 'utf8');

    it('paints the default dark theme paper color before React mounts', () => {
        expect(defaultSettings.themeType).toBe('dark');
        expect(html).toContain(`background-color: ${createTheme('dark').palette.background.paper};`);
        expect(html).toContain('<meta name="color-scheme" content="dark" />');
    });

    it('sizes the empty root like the mounted desktop popup', () => {
        expect(html).toMatch(/#root:empty\s*\{[^}]*width: var\(--popup-desktop-width\);/);
        expect(html).toMatch(/#root:empty\s*\{[^}]*min-height: var\(--popup-desktop-min-height\);/);
    });
});
