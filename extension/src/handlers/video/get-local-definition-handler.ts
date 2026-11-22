import type { Command, GetLocalDefinitionMessage, Message } from '@project/common';
import { localLookup } from '@/services/local-lookup-client';

// Only the extension-owned Anki dialog can spend local lookup quota.
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

        localLookup('translate', { sentence })
            .then((response) => sendResponse('text' in response ? { translation: response.text } : undefined))
            .catch(() => sendResponse(undefined));

        return true;
    }
}
