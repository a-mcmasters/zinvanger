import type { IndexedSubtitleModel, SubtitleModel } from '@project/common';
import { subtitleKey } from '@project/common/subtitle-reader/subtitle-stream';

export interface LivingSubtitleTarget {
    readonly video: string;
    readonly cue: IndexedSubtitleModel;
    readonly surrounding: readonly SubtitleModel[];
}

export interface LivingSubtitleWord {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

export const livingSubtitleWords = (text: string): LivingSubtitleWord[] =>
    [...text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0].normalize('NFC'),
    }));

export type LivingSubtitleResult =
    | { status: 'idle' | 'pending' }
    | { status: 'success'; text: string }
    | { status: 'error'; message: string };

export interface LivingSubtitleState {
    target?: LivingSubtitleTarget;
    captured: boolean;
    /** The clicked word: the card's word and the mined card's target word. */
    word?: LivingSubtitleWord;
    definition: LivingSubtitleResult;
    mining: LivingSubtitleResult;
}

/** `dialog`: the Anki dialog took over the card, so nothing is mined yet. */
export type LivingSubtitleMineOutcome = 'saved' | 'dialog';

interface Actions {
    pause(): void;
    /** The word's meaning; rejects with a `livingSubtitle.error` key. */
    define(word: string): Promise<string>;
    /** Resolves when a card is saved or a dialog takes it over, never on message acknowledgement. */
    mine(state: Readonly<LivingSubtitleState>): Promise<LivingSubtitleMineOutcome>;
    render(state: Readonly<LivingSubtitleState>): void;
}

const initialState = (): LivingSubtitleState => ({
    captured: false,
    definition: { status: 'idle' },
    mining: { status: 'idle' },
});

const sameTarget = (a: LivingSubtitleTarget, b: LivingSubtitleTarget) =>
    a.video === b.video &&
    subtitleKey(a.cue) === subtitleKey(b.cue) &&
    a.cue.text === b.cue.text &&
    a.cue.start === b.cue.start &&
    a.cue.end === b.cue.end;

/** Video-local interaction state. Timing, rendering and transport belong to adapters. */
export default class LivingSubtitleController {
    private state = initialState();
    private generation = 0;
    private definitionRequest = 0;
    private disposed = false;

    constructor(private readonly actions: Actions) {}

    private emit() {
        if (!this.disposed) this.actions.render({ ...this.state });
    }

    hover(target: LivingSubtitleTarget) {
        if (this.disposed || this.state.captured) return;
        if (!this.state.target || !sameTarget(this.state.target, target)) {
            this.clear();
            this.state.target = target;
        }
        this.emit();
    }

    /** After any subtitle update: `resolve` returns the current cue with the same source key, if any. */
    reconcile(resolve: (target: LivingSubtitleTarget) => LivingSubtitleTarget | undefined) {
        if (!this.state.target) return;
        const match = resolve(this.state.target);
        if (!match || !sameTarget(this.state.target, match)) {
            this.clear();
            return;
        }
        // Same cue, possibly re-indexed by a progressive update: keep the interaction.
        this.state.target = match;
        this.emit();
    }

    get captured() {
        return this.state.captured;
    }

    get hasTarget() {
        return this.state.target !== undefined;
    }

    capture() {
        if (this.disposed || !this.state.target) return;
        this.state.captured = true;
        this.actions.pause();
        this.emit();
    }

    /** Escape: closes the word card, then the whole interaction. */
    escape() {
        if (this.state.word) this.closeWord();
        else this.clear();
    }

    closeWord() {
        ++this.definitionRequest;
        this.state.word = undefined;
        this.state.definition = { status: 'idle' };
        this.emit();
    }

    retryDefinition() {
        const words = this.state.target ? livingSubtitleWords(this.state.target.cue.text) : [];
        const index = words.findIndex((w) => w.start === this.state.word?.start);
        if (index >= 0) void this.selectWord(index);
    }

    async selectWord(index: number) {
        const target = this.state.target;
        const word = target && livingSubtitleWords(target.cue.text)[index];
        if (this.disposed || !target || !word) return;
        this.capture();
        this.state.word = word;
        const request = ++this.definitionRequest;
        const generation = this.generation;
        this.state.definition = { status: 'pending' };
        this.emit();
        const result = await this.define(word.text);
        if (generation !== this.generation || request !== this.definitionRequest) return;
        this.state.definition = result;
        this.emit();
    }

    private async define(word: string): Promise<LivingSubtitleResult> {
        try {
            return { status: 'success', text: await this.actions.define(word) };
        } catch (error) {
            return { status: 'error', message: error instanceof Error ? error.message : String(error) };
        }
    }

    async mine() {
        if (this.disposed || !this.state.word || this.state.mining.status === 'pending') return;
        this.capture(); // hold the sentence, so the next cue cannot replace it while the card exports
        const generation = this.generation;
        const snapshot = { ...this.state };
        this.state.mining = { status: 'pending' };
        this.emit();
        try {
            const outcome = await this.actions.mine(snapshot);
            if (generation !== this.generation) return;
            this.state.mining = outcome === 'dialog' ? { status: 'idle' } : { status: 'success', text: '' };
        } catch (error) {
            if (generation !== this.generation) return;
            this.state.mining = { status: 'error', message: error instanceof Error ? error.message : String(error) };
        }
        this.emit();
    }

    /** Resume, external seek, hidden subtitles and source/video replacement invalidate requests. */
    clear() {
        ++this.generation;
        this.state = initialState();
        this.emit();
    }

    dispose() {
        this.clear();
        this.disposed = true;
    }
}
