import type { Command, LivingSubtitleLookupMessage, LocalLookupResponse, Message } from '@project/common';
import { localLookup } from '@/services/local-lookup-client';

const maxSentenceLength = 500;
const maxWordLength = 80;
const maxResultLength = 2000; // a definition or sentence for the overlay, not a document

const valid = ({ operation, sentence, word }: LivingSubtitleLookupMessage) =>
    typeof sentence === 'string' &&
    sentence.trim() !== '' &&
    sentence.length <= maxSentenceLength &&
    (operation === 'translate'
        ? word === undefined
        : operation === 'define' && typeof word === 'string' && word.trim() !== '' && word.length <= maxWordLength);

// Only the video content script can spend local lookup quota: page scripts cannot reach runtime messaging (no
// externally_connectable), and the content script's isolated world keeps results away from the page. The extension
// frames cannot be the caller, because their replies to the content script travel by window postMessage.
export default class LivingSubtitleLookupHandler {
    get sender() {
        return 'asbplayer-video';
    }

    get command() {
        return 'living-subtitle-lookup';
    }

    handle(command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) {
        if (
            sender.id !== browser.runtime.id ||
            sender.tab === undefined ||
            sender.url === undefined ||
            sender.url.startsWith(browser.runtime.getURL('/'))
        ) {
            sendResponse({ error: 'unauthorized' } satisfies LocalLookupResponse);
            return false;
        }

        const message = command.message as LivingSubtitleLookupMessage;
        if (!valid(message)) {
            sendResponse({ error: 'invalid' } satisfies LocalLookupResponse);
            return false;
        }

        localLookup(message.operation, { sentence: message.sentence, word: message.word })
            .then((response) =>
                sendResponse(
                    'text' in response && response.text.length > maxResultLength
                        ? ({ error: 'malformed' } satisfies LocalLookupResponse)
                        : response
                )
            )
            .catch(() => sendResponse({ error: 'unavailable' } satisfies LocalLookupResponse));
        return true;
    }
}
