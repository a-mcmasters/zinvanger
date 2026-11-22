import type { LocalLookupError, LocalLookupResponse } from '@project/common';
import project from '@project/common/project';
import { getLocalLookupToken } from '@/services/local-lookup-token';

const { host, port } = project.services.transcriber;
const timeoutMs = 70_000; // the server's CLI timeout is 60 s

const statusErrors: { [status: number]: LocalLookupError } = {
    400: 'invalid',
    401: 'unauthorized',
    429: 'busy',
    504: 'timeout',
};

/**
 * Background-only: reads the lookup token and asks the local transcriber service for a sentence's English.
 * `storedOnly`: only an already stored translation (no model call); a missing one is `notStored`.
 */
export const localLookup = async (
    sentence: string,
    { storedOnly = false }: { readonly storedOnly?: boolean } = {}
): Promise<LocalLookupResponse> => {
    const token = await getLocalLookupToken();
    if (token.length < 32) return { error: 'unauthorized' };

    const query = new URLSearchParams({ sentence, ...(storedOnly ? { stored: '1' } : {}) });
    let response: Response;
    try {
        response = await fetch(`http://${host}:${port}/translate?${query}`, {
            headers: { Authorization: `Bearer ${token}` },
            redirect: 'error',
            signal: AbortSignal.timeout?.(timeoutMs),
        });
    } catch (error) {
        return { error: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'unavailable' };
    }

    if (storedOnly && response.status === 404) return { error: 'notStored' };
    if (!response.ok) return { error: statusErrors[response.status] ?? 'unavailable' };
    const json = await response.json().catch(() => undefined);
    const text = json?.translation;
    return typeof text === 'string' ? { text } : { error: 'malformed' };
};
