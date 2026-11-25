import { describe, expect, it } from '@jest/globals';
import type { Token } from '@project/common';
import { iPlusOneCandidate } from '@project/common/annotations/i-plus-one';
import { TokenState, TokenStatus } from '@project/common/settings';

const { UNCOLLECTED, UNKNOWN, LEARNING, MATURE } = TokenStatus;

/** Tokenizes `text` on spaces, giving each word the next status (`null` or `undefined`: unresolved). */
const line = (text: string, statuses: (TokenStatus | null | undefined)[], states: TokenState[][] = []) => {
    const tokens: Token[] = [];
    let start = 0;
    for (const [index, word] of text.split(' ').entries()) {
        tokens.push({
            pos: [start, start + word.length],
            readings: [],
            states: states[index] ?? [],
            status: statuses[index],
        });
        start += word.length + 1;
    }
    return iPlusOneCandidate(text, tokens);
};

describe('iPlusOneCandidate', () => {
    it('marks the one new word among at least two known words', () => {
        expect(line('Ik kom straks terug', [MATURE, LEARNING, UNCOLLECTED, MATURE])).toBe(2);
    });

    it('needs two distinct known words', () => {
        expect(line('ja ja straks', [MATURE, MATURE, UNCOLLECTED])).toBeUndefined();
        expect(line('Ja ja ik straks', [MATURE, MATURE, MATURE, UNCOLLECTED])).toBe(3);
    });

    it('marks the first occurrence of a repeated new word', () => {
        expect(line('Straks kom ik straks', [UNCOLLECTED, MATURE, MATURE, UNCOLLECTED])).toBe(0);
    });

    it('marks nothing when no word or two distinct words are new', () => {
        expect(line('Ik kom terug', [MATURE, MATURE, MATURE])).toBeUndefined();
        expect(line('Ik kom straks weer', [MATURE, MATURE, UNCOLLECTED, UNCOLLECTED])).toBeUndefined();
    });

    it('marks nothing beside an Unknown word', () => {
        expect(line('Ik kom straks terug', [MATURE, UNKNOWN, UNCOLLECTED, MATURE])).toBeUndefined();
    });

    it('marks nothing until every word is resolved', () => {
        expect(line('Ik kom straks terug', [MATURE, MATURE, UNCOLLECTED, undefined])).toBeUndefined();
        expect(line('Ik kom straks terug', [MATURE, MATURE, UNCOLLECTED, null])).toBeUndefined();
    });

    it('skips punctuation, numbers and ignored words', () => {
        expect(line('Om 12 uur , kom straks', [MATURE, undefined, MATURE, undefined, MATURE, UNCOLLECTED])).toBe(5);
        expect(line('Ik Jan kom straks', [MATURE, UNCOLLECTED, MATURE, UNCOLLECTED], [[], [TokenState.IGNORED]])).toBe(
            3
        );
    });
});
