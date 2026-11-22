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
    /** Keyboard word navigation position; the card opens only for `word`. */
    cursor?: number;
    word?: LivingSubtitleWord;
    targetWord?: LivingSubtitleWord;
    /** The target word's meaning, kept after its card closes. */
    targetDefinition?: string;
    englishVisible: boolean;
    translation: LivingSubtitleResult;
    definition: LivingSubtitleResult;
    mining: LivingSubtitleResult;
}

/** `dialog`: the Anki dialog took over the card, so nothing is mined yet. */
export type LivingSubtitleMineOutcome = 'saved' | 'dialog';

interface Actions {
    pause(): void;
    lookup(operation: 'translate' | 'define', sentence: string, word?: string): Promise<string>;
    replay(target: LivingSubtitleTarget): void;
    /** Resolves when a card is saved or a dialog takes it over, never on message acknowledgement. */
    mine(state: Readonly<LivingSubtitleState>): Promise<LivingSubtitleMineOutcome>;
    render(state: Readonly<LivingSubtitleState>): void;
}

const initialState = (): LivingSubtitleState => ({
    captured: false,
    englishVisible: false,
    translation: { status: 'idle' },
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

    startWordNavigation() {
        const target = this.state.target;
        if (this.disposed || !target || livingSubtitleWords(target.cue.text).length === 0) return;
        this.state.cursor = this.state.word
            ? livingSubtitleWords(target.cue.text).findIndex((w) => w.start === this.state.word!.start)
            : 0;
        this.capture();
    }

    moveCursor(delta: number) {
        const words = this.state.target ? livingSubtitleWords(this.state.target.cue.text) : [];
        if (this.state.cursor === undefined || words.length === 0) return;
        this.state.cursor = Math.min(words.length - 1, Math.max(0, this.state.cursor + delta));
        this.emit();
    }

    openCursor() {
        if (this.state.cursor !== undefined) void this.selectWord(this.state.cursor);
    }

    /** Escape: closes the word card, then word navigation, then the whole interaction. */
    escape() {
        if (this.state.word) {
            this.closeWord();
        } else if (this.state.cursor !== undefined) {
            this.state.cursor = undefined;
            this.emit();
        } else {
            this.clear();
        }
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
        if (this.state.cursor !== undefined) this.state.cursor = index;
        this.state.word = word;
        const request = ++this.definitionRequest;
        const generation = this.generation;
        this.state.definition = { status: 'pending' };
        this.emit();
        const result = await this.lookup('define', target.cue.text, word.text);
        if (generation !== this.generation) return;
        // Chosen as target while its meaning was loading: keep it even if the card has closed since.
        const forTarget = result.status === 'success' && this.state.targetWord?.start === word.start;
        if (forTarget) this.state.targetDefinition = result.text;
        if (request === this.definitionRequest) this.state.definition = result;
        if (forTarget || request === this.definitionRequest) this.emit();
    }

    useTargetWord() {
        if (this.disposed || !this.state.word) return;
        this.state.targetWord = this.state.word;
        this.state.targetDefinition =
            this.state.definition.status === 'success' ? this.state.definition.text : undefined;
        this.emit();
    }

    async toggleEnglish() {
        if (this.disposed || !this.state.target) return;
        this.capture();
        this.state.englishVisible = !this.state.englishVisible;
        this.emit();
        await this.fetchTranslation();
    }

    async retryTranslation() {
        if (this.disposed || !this.state.target || this.state.translation.status !== 'error') return;
        await this.fetchTranslation();
    }

    private async fetchTranslation() {
        if (
            !this.state.target ||
            !this.state.englishVisible ||
            this.state.translation.status === 'pending' ||
            this.state.translation.status === 'success'
        ) {
            return;
        }
        const generation = this.generation;
        this.state.translation = { status: 'pending' };
        this.emit();
        const result = await this.lookup('translate', this.state.target.cue.text);
        if (generation !== this.generation) return;
        this.state.translation = result;
        this.emit();
    }

    private async lookup(
        operation: 'translate' | 'define',
        sentence: string,
        word?: string
    ): Promise<LivingSubtitleResult> {
        try {
            return { status: 'success', text: await this.actions.lookup(operation, sentence, word) };
        } catch (error) {
            return { status: 'error', message: error instanceof Error ? error.message : String(error) };
        }
    }

    replay() {
        if (this.disposed || !this.state.target) return;
        this.actions.replay(this.state.target);
        this.clear();
    }

    async mine() {
        if (this.disposed || !this.state.target || this.state.mining.status === 'pending') return;
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
