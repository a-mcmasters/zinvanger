import { getTranslationApiKey, minimumTranslationApiKeyLength } from '@/services/translation-api-key';

const targetLanguage = 'EN-US';
const timeoutMs = 20_000;
const maxConcurrentRequests = 4; // the old local server's limit; it also caps what a runaway caller can bill
const maxCachedTranslations = 5000;
// So a reopened card or a second tab never pays for the same sentence twice. Failures are not kept.
const pending = new Map<string, Promise<string | undefined>>();
const finished = new Map<string, string>();

// DeepL Free keys end in ":fx" and only work on the free host.
const endpointFor = (apiKey: string) =>
    apiKey.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';

const requestTranslation = async (text: string): Promise<string | undefined> => {
    try {
        const apiKey = await getTranslationApiKey();
        if (apiKey.length < minimumTranslationApiKeyLength) return undefined;
        const response = await fetch(endpointFor(apiKey), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${apiKey}` },
            body: JSON.stringify({ text: [text], target_lang: targetLanguage }),
            redirect: 'error',
            signal: AbortSignal.timeout?.(timeoutMs),
        });
        if (!response.ok) return undefined;
        const translated = (await response.json())?.translations?.[0]?.text;
        return typeof translated === 'string' && translated.trim() ? translated : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Background-only: translates a sentence into English with DeepL and the saved API key. Resolves to undefined when
 * there is no key, DeepL fails, or four other lookups are still running. Never rejects.
 */
export const translateSentence = (sentence: string): Promise<string | undefined> => {
    const text = sentence.trim();
    if (!text) return Promise.resolve(undefined);
    const done = finished.get(text);
    if (done !== undefined) return Promise.resolve(done);
    const running = pending.get(text);
    if (running) return running;
    if (pending.size >= maxConcurrentRequests) return Promise.resolve(undefined);

    const lookup = requestTranslation(text).then((result) => {
        pending.delete(text);
        if (result !== undefined) {
            if (finished.size >= maxCachedTranslations) finished.clear();
            finished.set(text, result);
        }
        return result;
    });
    pending.set(text, lookup);
    return lookup;
};
