import ChromeExtension from '@project/common/app/services/chrome-extension';
import { AppExtensionDictionaryStorage } from '@project/common/app/services/app-extension-dictionary-storage';

describe('i+1 extension compatibility', () => {
    it.each([
        ['1.25.9', false],
        ['1.26.0', true],
    ])('requests the cache source behind extension %s only when supported', async (version, supported) => {
        const extension = new ChromeExtension(version);
        try {
            const request = jest.spyOn(extension, 'dictionaryGetAnkiCacheSource').mockResolvedValue('source');
            const storage = new AppExtensionDictionaryStorage(extension);

            expect(extension.supportsIPlusOne).toBe(supported);
            await expect(storage.getAnkiCacheSource('Dutch', 0)).resolves.toBe(supported ? 'source' : undefined);
            expect(request).toHaveBeenCalledTimes(supported ? 1 : 0);
        } finally {
            extension.unbind();
        }
    });
});

describe('ChromeExtension.supportsSidePanel', () => {
    let displayMode: string;
    const created: ChromeExtension[] = [];

    beforeEach(() => {
        displayMode = 'browser';
        window.matchMedia = jest.fn((query: string) => ({
            matches: query === `(display-mode: ${displayMode})`,
        })) as unknown as typeof window.matchMedia;
    });

    afterEach(() => {
        created.splice(0).forEach((ext) => ext.unbind());
        delete (window as { matchMedia?: unknown }).matchMedia; // jsdom has no matchMedia of its own
    });

    // Feature flag stays true, as when installing the app moves the tab into an app window without a reload (#42)
    const extension = () => {
        const ext = new ChromeExtension('1.20.0', {}, undefined, { sidePanel: true });
        created.push(ext);
        return ext;
    };

    it('allows the side panel in a normal browser tab', () => {
        expect(extension().supportsSidePanel).toBe(true);
    });

    it('refuses it once the same page is in an installed-app window, including fullscreen', () => {
        const ext = extension();
        displayMode = 'standalone';
        expect(ext.supportsSidePanel).toBe(false);
        displayMode = 'fullscreen';
        expect(ext.supportsSidePanel).toBe(false);
    });

    it('refuses it when the display mode cannot be read', () => {
        delete (window as { matchMedia?: unknown }).matchMedia;
        expect(extension().supportsSidePanel).toBe(false);
    });
});
