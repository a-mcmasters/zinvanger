import type { IndexedSubtitleModel, SubtitleModel } from '@project/common';
import { subtitleKey } from '@project/common/subtitle-reader/subtitle-stream';
import { HAS_LETTER_REGEX, removeSubtitleHtml } from '@project/common/util';
import type { Yomitan } from '@project/common/yomitan';

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

export const livingSubtitleCueWords = (text: string) => livingSubtitleWords(removeSubtitleHtml(text));

/** The dictionary form to show beside a word, or undefined when it is the word itself ("Hij" → "hij" is not). */
export const distinctLemma = (word: string, lemma?: string) =>
    lemma && lemma.toLowerCase() !== word.toLowerCase() ? lemma : undefined;

/** Only the main subtitle track (the language being learned) is clickable; a translation track shown alongside is not. */
export const livingSubtitleActionable = (cue: IndexedSubtitleModel) =>
    cue.track === 0 && !cue.textImage && cue.text.trim() !== '';

export type LivingSubtitleResult =
    | { status: 'idle' | 'pending' }
    /** `lemma`: the dictionary form the meaning belongs to, when it differs from the word. */
    | { status: 'success'; text: string; lemma?: string }
    | { status: 'error'; message: string };

export interface LivingSubtitleDefinition {
    readonly text: string;
    readonly lemma?: string;
    /** Every dictionary form of the word, as the status resolver looks it up. */
    readonly lemmas?: readonly string[];
}

export type LivingSubtitleDefinitionResult =
    | Exclude<LivingSubtitleResult, { status: 'success' }>
    | ({ status: 'success' } & LivingSubtitleDefinition);

export interface LivingSubtitleState {
    target?: LivingSubtitleTarget;
    captured: boolean;
    /** The clicked word: the card's word and the mined card's target word. */
    word?: LivingSubtitleWord;
    definition: LivingSubtitleDefinitionResult;
    mining: LivingSubtitleResult;
    /** Absent when the word has no letters, so it cannot be marked known. */
    known?: LivingSubtitleResult;
}

const actionTimeoutMs = 10_000;

/** A word's meaning from Yomitan, with no model tokens; rejects with a `livingSubtitle.error` key. */
export const defineWithYomitan = async (yomitan: Yomitan, word: string): Promise<LivingSubtitleDefinition> => {
    try {
        const text = (await yomitan.gloss(word)) ?? '';
        // Read from the same Yomitan response as the gloss, so normally no second request.
        const lemmas = (await yomitan.lemmatize(word)) ?? [];
        return { text, lemma: distinctLemma(word, lemmas[0]), lemmas };
    } catch {
        throw new Error('dictionaryUnavailable');
    }
};

/** The web app reports the result of a submitted card through its own dialog or alerts. */
export type LivingSubtitleMineOutcome = 'saved' | 'dialog' | 'submitted';

interface Actions {
    pause(): void;
    /** The word's meaning; rejects with a `livingSubtitle.error` key. */
    define(word: string, retry: boolean): Promise<LivingSubtitleDefinition>;
    /** Resolves when a card is saved or handed off to the UI responsible for reporting the result. */
    mine(state: Readonly<LivingSubtitleState>): Promise<LivingSubtitleMineOutcome>;
    /** Saves the word as known for the profile active at the call; rejects unless the save is confirmed. */
    markKnown(word: string, lemmas: readonly string[]): Promise<void | 'stale'>;
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
    private knownRequest = 0;
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
        ++this.knownRequest;
        this.state.word = undefined;
        this.state.definition = { status: 'idle' };
        this.state.known = undefined;
        this.emit();
    }

    retryDefinition() {
        if (this.state.word) void this.selectWord(this.state.word, true);
    }

    async selectWord(selection: number | LivingSubtitleWord, retry = false) {
        const target = this.state.target;
        const word =
            typeof selection === 'number' ? target && livingSubtitleCueWords(target.cue.text)[selection] : selection;
        if (this.disposed || !target || !word) return;
        this.capture();
        if (this.state.word?.start !== word.start || this.state.word.end !== word.end) {
            ++this.knownRequest;
            this.state.known = HAS_LETTER_REGEX.test(word.text) ? { status: 'idle' } : undefined;
        }
        this.state.word = word;
        // "Mined" or a mining error belongs to the previous word.
        if (this.state.mining.status !== 'pending') this.state.mining = { status: 'idle' };
        const request = ++this.definitionRequest;
        const generation = this.generation;
        this.state.definition = { status: 'pending' };
        this.emit();
        const result = await this.define(word.text, retry);
        if (generation !== this.generation || request !== this.definitionRequest) return;
        this.state.definition = result;
        this.emit();
    }

    private async define(word: string, retry: boolean): Promise<LivingSubtitleDefinitionResult> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const definition = await Promise.race([
                this.actions.define(word, retry),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('dictionaryUnavailable')), actionTimeoutMs);
                }),
            ]);
            return { status: 'success', ...definition };
        } catch (error) {
            return { status: 'error', message: error instanceof Error ? error.message : String(error) };
        } finally {
            clearTimeout(timeout);
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
            if (outcome === 'submitted') {
                this.clear();
                return;
            }
            this.state.mining = outcome === 'dialog' ? { status: 'idle' } : { status: 'success', text: '' };
        } catch (error) {
            if (generation !== this.generation) return;
            this.state.mining = { status: 'error', message: error instanceof Error ? error.message : String(error) };
        }
        this.emit();
    }

    async markKnown() {
        const { word, definition, known } = this.state;
        // Wait for the lookup: its lemmas are the forms the status resolver queries.
        if (this.disposed || !word || !known || known.status === 'pending' || definition.status === 'pending') return;
        const request = ++this.knownRequest;
        const generation = this.generation;
        this.state.known = { status: 'pending' };
        this.emit();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let result: LivingSubtitleResult;
        try {
            const outcome = await Promise.race([
                this.actions.markKnown(word.text, definition.status === 'success' ? (definition.lemmas ?? []) : []),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('timeout')), actionTimeoutMs);
                }),
            ]);
            if (generation !== this.generation || request !== this.knownRequest) return;
            if (outcome === 'stale') {
                this.clear();
                return;
            }
            result = { status: 'success', text: '' };
        } catch (error) {
            result = { status: 'error', message: error instanceof Error ? error.message : String(error) };
        } finally {
            clearTimeout(timeout);
        }
        if (generation !== this.generation || request !== this.knownRequest) return;
        this.state.known = result;
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
