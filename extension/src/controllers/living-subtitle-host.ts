import type { IndexedSubtitleModel } from '@project/common';
import { ASB_SUBTITLE_INDEX_ATTRIBUTE } from '@project/common/annotations/dom-annotations';
import LivingSubtitleController, {
    livingSubtitleActionable,
} from '@project/common/living-subtitle/living-subtitle-controller';
import { subtitleWordAt, subtitleWordRanges } from '@project/common/living-subtitle/dom-words';
import type {
    LivingSubtitleDefinition,
    LivingSubtitleMineOutcome,
    LivingSubtitleState,
    LivingSubtitleTarget,
} from '@project/common/living-subtitle/living-subtitle-controller';
import { frameColorScheme, frameColorSchemeClass } from '@/services/frame-color-scheme';
import UiFrame from '@/services/ui-frame';
import type FrameBridgeClient from '@/services/frame-bridge-client';
import type { LivingSubtitleAction } from '@project/common/components/LivingSubtitleCard';
import type { LivingSubtitleViewModel } from '@/ui/components/LivingSubtitleUi';
import i18n from 'i18next';

export interface LivingSubtitleHostContext {
    readonly video: HTMLMediaElement;
    containers(): HTMLElement[];
    /** Text cues on screen, in display order. */
    displayed(): readonly IndexedSubtitleModel[];
    cueAt(index: number): IndexedSubtitleModel | undefined;
    targetFor(cue: IndexedSubtitleModel): LivingSubtitleTarget;
    /** The current cue with the target's source key, if it still exists for the same video. */
    resolve(target: LivingSubtitleTarget): LivingSubtitleTarget | undefined;
    pause(): void;
    mine(state: Readonly<LivingSubtitleState>): Promise<LivingSubtitleMineOutcome>;
    /** The word's dictionary meaning ('' when the dictionary has none); rejects with a `livingSubtitle.error` key. */
    define(word: string, retry: boolean): Promise<LivingSubtitleDefinition>;
    markKnown(word: string, lemmas: readonly string[]): Promise<void | 'stale'>;
}

const gap = 4;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Page-side adapter of the living subtitle: clicking a main-track word pauses, highlights it and opens the word card (an
 * extension frame) with its dictionary meaning, the target-word choice and Mine.
 */
export default class LivingSubtitleHost {
    readonly controller: LivingSubtitleController;
    private readonly context: LivingSubtitleHostContext;
    private state?: LivingSubtitleState;
    private frame?: UiFrame;
    /** One bind for the frame: concurrent renders share it. */
    private client?: Promise<FrameBridgeClient>;
    private size?: { width: number; height: number };
    private mining = false;
    private updateScheduled = false;
    /** Bumped per render, so a render that awaited a loading frame cannot show an outdated model. */
    private renderGeneration = 0;
    private ownHighlights = new Map<string, readonly Range[]>();
    private language = 'en';
    private themeType: 'light' | 'dark' = 'dark';
    private bound = false;
    private readonly listeners: [EventTarget, string, EventListener][] = [];

    constructor(context: LivingSubtitleHostContext) {
        this.context = context;
        this.controller = new LivingSubtitleController({
            pause: () => context.pause(),
            define: (word, retry) => context.define(word, retry),
            mine: (state) => context.mine(state),
            markKnown: (word, lemmas) => context.markKnown(word, lemmas),
            render: (state) => {
                this.state = state;
                this.scheduleUpdate();
            },
        });
    }

    bind({ language, themeType }: { language: string; themeType: 'light' | 'dark' }) {
        if (language !== this.language) this.unbindFrame(); // the frame loads its strings once
        this.language = language;
        this.themeType = themeType;
        if (this.bound) {
            this.scheduleUpdate();
            return;
        }
        this.bound = true;
        const listen = (target: EventTarget, type: string, listener: (event: any) => void) => {
            target.addEventListener(type, listener, true);
            this.listeners.push([target, type, listener]);
        };
        listen(document, 'click', (event: MouseEvent) => this.click(event));
        listen(document, 'keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape' && this.state?.word) this.controller.closeWord();
        });
        listen(document, 'fullscreenchange', () => {
            // The frame must live inside the fullscreen element to stay visible; moving it reloads it.
            this.unbindFrame();
            this.scheduleUpdate();
        });
        listen(window, 'resize', () => this.scheduleUpdate());
        // The frame uses viewport coordinates; any scrolling container can move the subtitle under it.
        listen(document, 'scroll', () => this.scheduleUpdate());
    }

    /** Call after subtitles change or re-render. */
    subtitlesChanged() {
        this.controller.reconcile((target) => this.context.resolve(target));
        const target = this.state?.target;
        // Hidden subtitles dismiss the card; recording for a mine plays past the cue on purpose.
        if (target && !this.mining && !this.context.displayed().some((cue) => cue.index === target.cue.index)) {
            this.controller.clear();
        }
        this.scheduleUpdate();
    }

    /** Resume and external seeks close the card, unless mining is moving the playhead itself. */
    playbackResumedOrSeeked() {
        if (!this.mining) this.controller.clear();
    }

    get captured() {
        return this.state?.captured ?? false;
    }

    unbind() {
        this.controller.dispose();
        for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener, true);
        this.listeners.length = 0;
        this.bound = false;
        this.unbindFrame();
        this.clearHighlights();
    }

    private cueElement(cue: IndexedSubtitleModel) {
        for (const container of this.context.containers()) {
            const element = container.querySelector<HTMLElement>(`[${ASB_SUBTITLE_INDEX_ATTRIBUTE}="${cue.index}"]`);
            if (element) return element;
        }
        return undefined;
    }

    private eventCue(event: Event) {
        const target = event.target instanceof Element ? event.target : undefined;
        if (!target || !this.context.containers().some((container) => container.contains(target))) return undefined;
        const element = target.closest<HTMLElement>(`[${ASB_SUBTITLE_INDEX_ATTRIBUTE}]`);
        const cue = element
            ? this.context.cueAt(Number(element.getAttribute(ASB_SUBTITLE_INDEX_ATTRIBUTE)))
            : undefined;
        return cue && element && livingSubtitleActionable(cue) ? { cue, element, target } : undefined;
    }

    private click(event: MouseEvent) {
        if (!event.isTrusted || event.button !== 0) return; // pages cannot spend lookups with synthetic clicks
        if (!window.getSelection()?.isCollapsed) return; // keep subtitle text selection working
        const hit = this.eventCue(event);
        if (!hit) return;
        const word = subtitleWordAt(hit.element, hit.cue.text, hit.target, event.clientX, event.clientY);
        if (!word) return;
        event.stopPropagation(); // the word belongs to this interaction, not to the player or annotations
        event.preventDefault();
        if (this.state?.target && this.context.resolve(this.state.target)?.cue.index !== hit.cue.index) {
            this.controller.clear();
        }
        this.controller.hover(this.context.targetFor(hit.cue));
        void this.controller.selectWord(word);
    }

    private action(action: LivingSubtitleAction) {
        switch (action) {
            case 'mine':
                void this.mine();
                break;
            case 'known':
                void this.controller.markKnown();
                break;
            case 'close-word':
            case 'escape':
                this.controller.closeWord();
                break;
            case 'retry-definition':
                this.controller.retryDefinition();
                break;
        }
    }

    private async mine() {
        if (this.mining) return; // a second click before the card shows Mine disabled must not end the first mine
        this.mining = true;
        try {
            await this.controller.mine();
        } finally {
            this.mining = false;
        }
        // Recording plays the sentence; once it is mined, playback follows the timeline again.
        if (!this.context.video.paused && this.state?.mining.status === 'success') this.controller.clear();
    }

    private frameClient() {
        if (!this.client) {
            const created = this.createClient();
            this.client = created;
            // A frame that never loaded can be retried; keep a replacement that is already loading.
            created.catch(() => {
                if (this.client === created) this.client = undefined;
            });
        }
        return this.client;
    }

    private async createClient() {
        const frame = new UiFrame(
            async (element, lang) => {
                // Runs right after insertion, before paint: replaces the full-page frame class with a hidden one.
                element.className = `asbplayer-living-subtitle-frame asbplayer-hide ${frameColorSchemeClass()}`;
                element.inert = true;
                element.title = i18n.t('livingSubtitle.actions');
                const params = new URLSearchParams({ lang, colorScheme: frameColorScheme() });
                element.src = `${browser.runtime.getURL('/living-subtitle.html')}?${params}`;
            },
            browser.runtime.getURL('/').slice(0, -1),
            true
        );
        frame.parent = () => {
            const fullscreen = document.fullscreenElement;
            return fullscreen instanceof HTMLElement && !(fullscreen instanceof HTMLMediaElement)
                ? fullscreen
                : document.body;
        };
        frame.language = this.language;
        this.frame = frame;
        let client: FrameBridgeClient;
        try {
            await frame.bind();
            client = await frame.client();
        } catch (error) {
            frame.unbind(); // a retry creates a new frame; don't leave this one in the page
            if (this.frame === frame) this.frame = undefined;
            throw error;
        }
        client.onMessage((message: any) => {
            if (message.command === 'action') {
                this.action(message.action);
            } else if (message.command === 'size') {
                this.size = { width: Math.ceil(message.width), height: Math.ceil(message.height) };
                this.scheduleUpdate();
            }
        });
        return client;
    }

    private unbindFrame() {
        this.frame?.unbind();
        this.frame = undefined;
        this.client = undefined;
        this.size = undefined;
    }

    private hideFrame() {
        if (!this.frame || this.frame.hidden) return;
        this.frame.hide();
        if (this.frame.frame) this.frame.frame.inert = true;
    }

    private scheduleUpdate() {
        if (this.updateScheduled) return;
        this.updateScheduled = true;
        requestAnimationFrame(() => {
            this.updateScheduled = false;
            void this.update();
        });
    }

    private async update() {
        if (!this.bound) return;
        const generation = ++this.renderGeneration;
        const current = () => this.bound && generation === this.renderGeneration;
        const state = this.state;
        const element = state?.target ? this.cueElement(state.target.cue) : undefined;
        this.clearHighlights();
        if (!state?.target || !state.word || !element) {
            this.hideFrame();
            return;
        }

        const cue = state.target.cue;
        const ranges = subtitleWordRanges(element, cue.text, state.word);
        this.highlight('asbplayer-living-subtitle-word', ranges);

        const video = this.context.video.getBoundingClientRect();
        // The part of the video on screen: the card stays inside it, and at high zoom it shrinks to fit.
        const visibleLeft = Math.max(video.left, 0) + gap;
        const visibleRight = Math.min(video.right, window.innerWidth) - gap;
        const visibleTop = Math.max(video.top, 0) + gap;
        const visibleBottom = Math.min(video.bottom, window.innerHeight) - gap;
        const model: LivingSubtitleViewModel = {
            themeType: this.themeType,
            word: state.word.text,
            definition: state.definition,
            mining: state.mining,
            known: state.known,
            maxWidth: Math.max(0, visibleRight - visibleLeft),
            maxHeight: Math.max(0, visibleBottom - visibleTop),
        };
        try {
            const client = await this.frameClient();
            if (!current()) return; // unbound or superseded while the frame loaded
            client.updateState(model);
        } catch {
            return; // the frame failed to load; the next update retries
        }

        const frame = this.frame?.frame;
        const size = this.size;
        if (!frame || !size) return;
        const line = element.getBoundingClientRect();
        // Every subtitle line on screen (other tracks, other cues) is an obstacle: the card must never cover subtitles.
        const obstacles = this.context
            .containers()
            .flatMap((container) => [...container.querySelectorAll(`[${ASB_SUBTITLE_INDEX_ATTRIBUTE}]`)])
            .map((subtitle) => subtitle.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0);
        const anchor = ranges.map((range) => range.getBoundingClientRect()).find((rect) => rect.width > 0) ?? line; // the visible copy's word
        const left = clamp(anchor.left + anchor.width / 2 - size.width / 2, visibleLeft, visibleRight - size.width);
        /** Moves the card up or down from `top` until it overlaps no subtitle in its column. */
        const clearOf = (start: number, direction: 1 | -1) => {
            let top = start;
            for (let moved = true, steps = 0; moved && steps < obstacles.length; ++steps) {
                moved = false;
                for (const rect of obstacles) {
                    const overlaps =
                        rect.left < left + size.width &&
                        rect.right > left &&
                        rect.top < top + size.height &&
                        rect.bottom > top;
                    if (!overlaps) continue;
                    top = direction > 0 ? rect.bottom + gap : rect.top - gap - size.height;
                    moved = true;
                }
            }
            return top;
        };
        const fits = (top: number) => top >= visibleTop && top + size.height <= visibleBottom;
        const above = clearOf(line.top - gap - size.height, -1);
        const below = clearOf(line.bottom + gap, 1);
        // Above the line, else below it; if neither fits on screen, stay on screen (may overlap).
        const top = fits(above) ? above : fits(below) ? below : clamp(above, visibleTop, visibleBottom - size.height);
        Object.assign(frame.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${size.width}px`,
            height: `${size.height}px`,
        });
        frame.classList.remove('asbplayer-hide');
        frame.inert = false;
    }

    // Highlights are document-wide and every bound video has a host, so each host only adds and removes its own ranges.
    private highlight(name: string, ranges: readonly Range[]) {
        const highlights = globalThis.CSS?.highlights;
        if (ranges.length === 0 || !highlights || typeof Highlight === 'undefined') return;
        let shared = highlights.get(name);
        if (!shared) highlights.set(name, (shared = new Highlight()));
        for (const range of ranges) shared.add(range);
        this.ownHighlights.set(name, ranges);
    }

    private clearHighlights() {
        for (const [name, ranges] of this.ownHighlights) {
            for (const range of ranges) globalThis.CSS?.highlights?.get(name)?.delete(range);
        }
        this.ownHighlights.clear();
    }
}
