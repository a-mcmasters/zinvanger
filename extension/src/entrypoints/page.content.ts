import project from '@project/common/project';
import { asbError } from '@project/common/util/log';
import { currentPageDelegate } from '@/services/pages';
import { configureExtensionLogProvider } from '@/services/extension-log-provider';

const appUrl = new URL(project.urls.app);
// A match pattern, not a glob: WXT's dev content-script registration drops excludeGlobs.
const excludeMatches = [`*://${appUrl.hostname}${appUrl.pathname.replace(/\/+$/, '')}/*`];
// shortcut: Chrome dev builds still run on the localhost:3000 web app (globs dropped); see #75.
const excludeGlobs: string[] = [];

if (import.meta.env.DEV) {
    excludeGlobs.push(`*://${project.development.host}:${project.development.port}/*`);
}

export default defineContentScript({
    // Set manifest options
    matches: ['<all_urls>'],
    excludeMatches,
    excludeGlobs,
    allFrames: true,
    runAt: 'document_start',

    main() {
        configureExtensionLogProvider();
        void currentPageDelegate()
            .then((pageDelegate) => pageDelegate.loadScripts())
            .catch((error) => asbError('content', 'Failed to load page integration:', error));
    },
});
