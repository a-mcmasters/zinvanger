import type { Token } from '@project/common';
import { isTokenStatusKnown, TokenState, TokenStatus } from '@project/common/settings';
import { HAS_LETTER_REGEX, normalizeToken } from '@project/common/util';

export const ASB_I_PLUS_ONE_ATTRIBUTE = 'data-asb-i-plus-one';

/**
 * The index of the line's one new word: the first occurrence of its only distinct Uncollected word, when the line has
 * at least two distinct known words, no Unknown word and every word resolved. Words without letters and ignored words
 * do not count.
 */
export function iPlusOneCandidate(text: string, tokens: readonly Token[]): number | undefined {
    let candidate: { word: string; index: number } | undefined;
    const known = new Set<string>();
    for (const [index, token] of tokens.entries()) {
        const surface = text.substring(token.pos[0], token.pos[1]).trim();
        if (!HAS_LETTER_REGEX.test(surface) || token.states.includes(TokenState.IGNORED)) continue;
        if (token.status == null || token.status === TokenStatus.UNKNOWN) return undefined;
        const word = normalizeToken(surface);
        if (isTokenStatusKnown(token.status)) known.add(word);
        else if (!candidate) candidate = { word, index };
        else if (candidate.word !== word) return undefined;
    }
    return candidate && known.size >= 2 ? candidate.index : undefined;
}
