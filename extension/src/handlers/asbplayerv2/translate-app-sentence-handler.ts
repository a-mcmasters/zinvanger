import type { Command, Message, TranslateAppSentenceMessage } from '@project/common';
import project from '@project/common/project';
import { isFirefoxBuild } from '@/services/build-flags';
import { localLookup } from '@/services/local-lookup-client';
import { webSentenceTranslationKey } from '@/services/local-lookup-token';

const appUrl = new URL(project.urls.app);

const isAppPage = (url: string | undefined) => {
    if (url === undefined) return false;
    const page = new URL(url);
    return page.origin === appUrl.origin && page.pathname === appUrl.pathname;
};

export default class TranslateAppSentenceHandler {
    readonly sender = 'asbplayerv2';
    readonly command = 'translate-app-sentence';

    handle(
        command: Command<Message>,
        sender: Browser.runtime.MessageSender,
        sendResponse: (response?: string) => void
    ) {
        // The relay accepts window messages. Check browser-supplied sender metadata and the extension-only opt-in.
        if (
            isFirefoxBuild ||
            sender.id !== browser.runtime.id ||
            sender.origin !== appUrl.origin ||
            !isAppPage(sender.url) ||
            !isAppPage(sender.tab?.url)
        ) {
            return false;
        }

        const { sentence } = command.message as TranslateAppSentenceMessage;
        if (typeof sentence !== 'string' || !sentence.trim() || sentence.length > 4000) return false;

        browser.storage.local
            .get({ [webSentenceTranslationKey]: false })
            .then(async (settings) => {
                if (settings[webSentenceTranslationKey] !== true) return undefined;
                const result = await localLookup(sentence);
                return 'text' in result ? result.text : undefined;
            })
            .then(sendResponse, () => sendResponse(undefined));
        return true;
    }
}
