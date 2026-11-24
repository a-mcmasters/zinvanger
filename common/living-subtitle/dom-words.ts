import {
    livingSubtitleCueWords,
    livingSubtitleWords,
} from '@project/common/living-subtitle/living-subtitle-controller';

export interface DomWord {
    readonly range: Range;
    readonly start: number;
    readonly end: number;
    /** Index into livingSubtitleCueWords(cue.text), when the rendered word matches one. */
    readonly modelIndex?: number;
}

/**
 * Maps the rendered subtitle text back to the cue's words without changing the subtitle DOM. With hover-only
 * annotations the cue holds two copies of the sentence (plain and annotated, CSS shows one); each copy is matched on
 * its own, so both get the full set of word indexes.
 */
export const domWords = (element: HTMLElement, cueText: string): DomWord[] => {
    const copies = element.querySelectorAll<HTMLElement>(
        ':scope > .asbplayer-subtitle-text, :scope > .asbplayer-subtitle-rich'
    );
    return (copies.length > 0 ? [...copies] : [element]).flatMap((copy) => copyWords(copy, cueText));
};

const copyWords = (element: HTMLElement, cueText: string): DomWord[] => {
    const nodes: { node: Text; start: number }[] = [];
    let text = '';
    const appendText = (parent: Node) => {
        for (const child of parent.childNodes) {
            if (child instanceof Text && child.length) {
                nodes.push({ node: child, start: text.length });
                text += child.data;
            } else if (child instanceof Element) {
                if (child.matches('br')) text += '\n';
                else if (!child.matches('rt, rp')) appendText(child);
            }
        }
    };
    appendText(element);
    const position = (offset: number, end: boolean) => {
        const entry = nodes.findLast((n) => (end ? n.start < offset : n.start <= offset)) ?? nodes[0];
        return [entry.node, offset - entry.start] as const;
    };
    const model = livingSubtitleCueWords(cueText);
    let next = 0;
    return livingSubtitleWords(text).map((word) => {
        const range = document.createRange();
        range.setStart(...position(word.start, false));
        range.setEnd(...position(word.end, true));
        const match = model.findIndex((candidate, index) => index >= next && candidate.text === word.text);
        if (match >= 0) next = match + 1;
        return { range, start: word.start, end: word.end, modelIndex: match >= 0 ? match : undefined };
    });
};

const caretPoint = (element: HTMLElement, x: number, y: number): { node: Node; offset: number } | undefined => {
    const caret = document.caretPositionFromPoint?.(x, y);
    const node = caret?.offsetNode ?? document.caretRangeFromPoint?.(x, y)?.startContainer;
    const offset = caret?.offset ?? document.caretRangeFromPoint?.(x, y)?.startOffset;
    return node && offset !== undefined && element.contains(node) ? { node, offset } : undefined;
};

/** The index in livingSubtitleCueWords(cueText) of the word rendered under a point of the cue's element. */
export const wordIndexAt = (element: HTMLElement, cueText: string, x: number, y: number) => {
    // Compare DOM positions, not text offsets: domWords skips ruby glosses (rt, rp) that a text offset would count.
    const caret = caretPoint(element, x, y);
    return caret
        ? domWords(element, cueText).find((w) => w.range.comparePoint(caret.node, caret.offset) === 0)?.modelIndex
        : undefined;
};
