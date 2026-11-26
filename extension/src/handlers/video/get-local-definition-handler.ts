import type { Command, GetLocalDefinitionMessage, Message } from '@project/common';
import { translateSentence } from '@/services/translate-sentence';

// Only the extension-owned Anki dialog can spend DeepL quota.
export default class GetLocalDefinitionHandler {
    get sender() {
        return 'asbplayer-video-tab';
    }

    get command() {
        return 'get-local-definition';
    }

    handle(command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) {
        if (
            sender.id !== browser.runtime.id ||
            sender.url?.split('?')[0] !== browser.runtime.getURL('/anki-lookup.html')
        ) {
            return false;
        }

        const { sentence } = command.message as GetLocalDefinitionMessage;

        translateSentence(sentence)
            .then((translation) => sendResponse(translation === undefined ? undefined : { translation }))
            .catch(() => sendResponse(undefined));

        return true;
    }
}
