import type {
    IndexedSubtitleModel,
    LivingSubtitleLookupMessage,
    LocalLookupResponse,
    VideoToExtensionCommand,
} from '@project/common';
import { ASB_SUBTITLE_INDEX_ATTRIBUTE } from '@project/common/annotations/dom-annotations';
import LivingSubtitleController, { livingSubtitleWords } from '@/controllers/living-subtitle-controller';
import type {
    LivingSubtitleMineOutcome,
    LivingSubtitleState,
    LivingSubtitleTarget,
} from '@/controllers/living-subtitle-controller';
import { frameColorScheme, frameColorSchemeClass } from '@/services/frame-color-scheme';
import UiFrame from '@/services/ui-frame';
import type FrameBridgeClient from '@/services/frame-bridge-client';
import type {
    LivingSubtitleAction,
    LivingSubtitlePart,
    LivingSubtitleViewModel,
} from '@/ui/components/LivingSubtitleUi';
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
    recording(): boolean;
    pause(): void;
    replay(target: LivingSubtitleTarget): void;
    mine(state: Readonly<LivingSubtitleState>): Promise<LivingSubtitleMineOutcome>;
    /** The word's dictionary meaning ('' when the dictionary has none); rejects with a `livingSubtitle.error` key. */
    define(word: string): Promise<string>;
    /** Left/Right in the strip: the same seek as the previous/next subtitle key bindings. */
    seekToAdjacentSubtitle(forward: boolean): void;
}

const leaveDelayMs = 250;
const gap = 4;

interface DomWord {
    readonly range: Range;
    readonly start: number;
    readonly end: number;
    /** Index into livingSubtitleWords(cue.text), when the rendered word matches one. */
    readonly modelIndex?: number;
}

/**
 * Maps the rendered subtitle text back to the cue's words without changing the subtitle DOM. With hover-only
 * annotations the cue holds two copies of the sentence (plain and annotated, CSS shows one); each copy is matched on
 * its own, so both get the full set of word indexes.
 */
const domWords = (element: HTMLElement, cueText: string): DomWord[] => {
    const copies = element.querySelectorAll<HTMLElement>(
        ':scope > .asbplayer-subtitle-text, :scope > .asbplayer-subtitle-rich'
    );
    return (copies.length > 0 ? [...copies] : [element]).flatMap((copy) => copyWords(copy, cueText));
};

const copyWords = (element: HTMLElement, cueText: string): DomWord[] => {
    const nodes: { node: Text; start: number }[] = [];
    let text = '';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (node.parentElement?.closest('rt, rp')) continue;
        nodes.push({ node, start: text.length });
        text += node.data;
    }
    const position = (offset: number, end: boolean) => {
        const entry = nodes.findLast((n) => (end ? n.start < offset : n.start <= offset)) ?? nodes[0];
        return [entry.node, offset - entry.start] as const;
    };
    const model = livingSubtitleWords(cueText);
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

/** Only the main subtitle track (the language being learned) gets actions; a translation track shown alongside never does. */
const mainTrack = 0;

const actionable = (cue: IndexedSubtitleModel) => cue.track === mainTrack && !cue.textImage && cue.text.trim() !== '';

/** The first main-track text cue on screen: what keyboard entry and timeline-following use. */
const followCue = (cues: readonly IndexedSubtitleModel[]) => cues.find(actionable);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/** Page-side adapter: subtitle DOM events, word highlights and the two extension frames of the living subtitle. */
export default class LivingSubtitleHost {
    readonly controller: LivingSubtitleController;
    private readonly context: LivingSubtitleHostContext;
    private state?: LivingSubtitleState;
    private frames = new Map<LivingSubtitlePart, UiFrame>();
    /** One bind per frame: concurrent renders and lookups share it. */
    private clients = new Map<LivingSubtitlePart, Promise<FrameBridgeClient>>();
    private sizes = new Map<LivingSubtitlePart, { width: number; height: number }>();
    private focused = new Set<LivingSubtitlePart>();
    private pointerInFrame = new Set<LivingSubtitlePart>();
    private pointerOverSubtitle = false;
    private suppressFocusReveal = false;
    /** The region a keyboard user tabbed into during a gap between cues. */
    private keyboardWaiting?: HTMLElement;
    /** Only Tab focus is keyboard entry; token selection and Escape also focus the subtitle programmatically. */
    private tabbing = false;
    private leaveTimeout?: ReturnType<typeof setTimeout>;
    private focusRequests = new Map<LivingSubtitlePart, number>();
    private mining = false;
    private updateScheduled = false;
    /** Bumped per render, so a render that awaited a loading frame cannot show an outdated model. */
    private renderGeneration = 0;
    private pendingFocus = new Set<LivingSubtitlePart>();
    private ownHighlights = new Map<string, readonly Range[]>();
    private language = 'en';
    private themeType: 'light' | 'dark' = 'dark';
    private bound = false;
    private readonly listeners: [EventTarget, string, EventListener][] = [];

    constructor(context: LivingSubtitleHostContext) {
        this.context = context;
        this.controller = new LivingSubtitleController({
            pause: () => context.pause(),
            lookup: (operation, sentence, word) => this.lookup(operation, sentence, word),
            replay: (target) => context.replay(target),
            mine: (state) => context.mine(state),
            render: (state) => {
                this.state = state;
                this.scheduleUpdate();
            },
        });
    }

    bind({ language, themeType }: { language: string; themeType: 'light' | 'dark' }) {
        if (language !== this.language) this.unbindFrames(); // frames load their strings once
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
        listen(document, 'pointerover', (event: PointerEvent) => this.pointerOver(event));
        listen(document, 'pointerout', (event: PointerEvent) => this.pointerOut(event));
        listen(document, 'click', (event: MouseEvent) => this.click(event));
        listen(document, 'focusin', (event: FocusEvent) => this.focusIn(event));
        listen(document, 'keydown', (event: KeyboardEvent) => this.keyDown(event));
        listen(document, 'fullscreenchange', () => {
            // Frames must live inside the fullscreen element to stay visible; moving them reloads them.
            this.unbindFrames();
            this.scheduleUpdate();
        });
        listen(window, 'resize', () => this.scheduleUpdate());
        // Frames use viewport coordinates; any scrolling container can move the subtitle under them.
        listen(document, 'scroll', () => this.scheduleUpdate());
        this.scheduleUpdate();
    }

    /** Call after subtitles change or re-render. */
    subtitlesChanged() {
        this.controller.reconcile((target) => this.context.resolve(target));
        const target = this.state?.target;
        // Hidden subtitles dismiss a captured sentence (hover follows the timeline below); recording for a mine plays
        // past the cue on purpose.
        if (
            target &&
            this.state?.captured &&
            !this.mining &&
            !this.context.displayed().some((cue) => cue.index === target.cue.index)
        ) {
            this.controller.clear();
        }
        const waiting = this.keyboardWaiting;
        if (waiting) {
            if (document.activeElement === waiting && !this.state?.target) this.captureForKeyboard(waiting);
            else this.keyboardWaiting = undefined; // focus moved on
        }
        const hovered = this.state?.target;
        const displayed = this.context.displayed();
        // Hover follows the timeline, but keeps the hovered line while it is on screen (another track may change).
        if (hovered && !this.state?.captured && this.pointerInside) {
            if (!displayed.some((cue) => cue.index === hovered.cue.index)) {
                const next = followCue(displayed);
                if (next) this.controller.hover(this.context.targetFor(next));
                else this.controller.clear();
            }
        }
        this.scheduleUpdate();
    }

    /** Resume and external seeks end a captured interaction, unless mining is moving the playhead itself. */
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
        if (this.leaveTimeout) clearTimeout(this.leaveTimeout);
        this.unbindFrames();
        this.clearHighlights();
        for (const container of this.context.containers()) this.releaseRegion(container);
    }

    private get pointerInside() {
        return this.pointerOverSubtitle || this.pointerInFrame.size > 0;
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
        return cue && element && actionable(cue) ? { cue, element } : undefined;
    }

    private inContainer(node: EventTarget | null) {
        return node instanceof Node && this.context.containers().some((container) => container.contains(node));
    }

    private pointerOver(event: PointerEvent) {
        this.tabbing = false;
        if (!this.inContainer(event.target)) return;
        this.pointerOverSubtitle = true;
        this.cancelLeave();
        const hit = this.eventCue(event);
        if (hit && !this.state?.captured) this.controller.hover(this.context.targetFor(hit.cue));
    }

    private pointerOut(event: PointerEvent) {
        if (!this.inContainer(event.target) || this.inContainer(event.relatedTarget)) return;
        this.pointerOverSubtitle = false;
        this.scheduleLeave();
    }

    private click(event: MouseEvent) {
        if (!event.isTrusted || event.button !== 0) return; // pages cannot spend lookups with synthetic clicks
        if (!window.getSelection()?.isCollapsed) return; // keep subtitle text selection working
        const hit = this.eventCue(event);
        if (!hit) return;
        // Compare DOM positions, not text offsets: domWords skips ruby glosses (rt, rp) that a text offset would count.
        const caret = caretPoint(hit.element, event.clientX, event.clientY);
        const word =
            caret &&
            domWords(hit.element, hit.cue.text).find((w) => w.range.comparePoint(caret.node, caret.offset) === 0);
        if (word?.modelIndex === undefined) return;
        event.stopPropagation(); // the word belongs to this interaction, not to the player or annotations
        event.preventDefault();
        const target = this.context.targetFor(hit.cue);
        if (
            this.state?.captured &&
            this.state.target &&
            this.context.resolve(this.state.target)?.cue.index !== hit.cue.index
        ) {
            this.controller.clear();
        }
        this.controller.hover(target);
        void this.controller.selectWord(word.modelIndex);
    }

    private focusIn(event: FocusEvent) {
        const container = this.context.containers().find((candidate) => candidate === event.target);
        if (!container || this.suppressFocusReveal || !this.tabbing) return;
        this.captureForKeyboard(container);
    }

    /** Captures the cue for a keyboard user on the region; in a gap between cues, waits for the next one. */
    private captureForKeyboard(container: HTMLElement) {
        const first = followCue(this.context.displayed());
        this.keyboardWaiting = first === undefined ? container : undefined;
        if (!first) return;
        if (!this.state?.captured) this.controller.hover(this.context.targetFor(first));
        this.controller.capture();
    }

    private keyDown(event: KeyboardEvent) {
        this.tabbing = event.key === 'Tab';
        if (!this.context.containers().some((container) => container === event.target) || !this.state?.target) return;
        if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            this.focusFrame('strip');
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.controller.escape();
        }
    }

    private focusFrame(part: LivingSubtitlePart) {
        this.focusRequests.set(part, (this.focusRequests.get(part) ?? 0) + 1);
        const frame = this.frames.get(part);
        if (frame && !frame.hidden) frame.frame?.focus();
        else this.pendingFocus.add(part); // an inert or loading frame cannot take focus; place() gives it
        this.scheduleUpdate();
    }

    private focusSubtitle() {
        const [container] = this.context.containers();
        if (!container) return;
        this.suppressFocusReveal = true;
        container.focus({ preventScroll: true });
        this.suppressFocusReveal = false;
    }

    private action(action: LivingSubtitleAction, part: LivingSubtitlePart) {
        const controller = this.controller;
        switch (action) {
            case 'replay':
                if (!this.context.recording()) controller.replay();
                break;
            case 'english':
                void controller.toggleEnglish();
                break;
            case 'mine':
                void this.mine();
                break;
            case 'use-target':
                controller.useTargetWord();
                break;
            case 'close-word':
                controller.closeWord();
                this.focusFrame('strip');
                break;
            case 'escape': {
                const closingCard = part === 'card' && this.state?.word !== undefined;
                controller.escape();
                if (closingCard) this.focusFrame('strip');
                else if (!this.state?.target) this.focusSubtitle();
                break;
            }
            case 'subtitle-previous':
                this.context.seekToAdjacentSubtitle(false);
                break;
            case 'subtitle-next':
                this.context.seekToAdjacentSubtitle(true);
                break;
            case 'retry-definition':
                controller.retryDefinition();
                break;
            case 'retry-translation':
                void controller.retryTranslation();
                break;
            case 'pointer-enter':
                this.pointerInFrame.add(part);
                this.cancelLeave();
                break;
            case 'pointer-leave':
                this.pointerInFrame.delete(part);
                this.scheduleLeave();
                break;
            case 'focus-in':
                this.focused.add(part);
                break;
            case 'focus-out':
                this.focused.delete(part);
                this.scheduleLeave();
                break;
        }
    }

    private async mine() {
        if (this.mining) return; // a second click before the frame shows Mine disabled must not end the first mine
        this.mining = true;
        try {
            await this.controller.mine();
        } finally {
            this.mining = false;
        }
        // Recording plays the sentence; once it is mined, playback follows the timeline again.
        if (!this.context.video.paused && this.state?.mining.status === 'success') this.controller.clear();
    }

    private cancelLeave() {
        if (this.leaveTimeout) clearTimeout(this.leaveTimeout);
        this.leaveTimeout = undefined;
    }

    private scheduleLeave() {
        this.cancelLeave();
        this.leaveTimeout = setTimeout(() => {
            this.leaveTimeout = undefined;
            // A captured interaction stays until Escape, resume or seek; only hover closes on leave.
            if (!this.pointerInside && this.focused.size === 0 && !this.state?.captured) this.controller.clear();
        }, leaveDelayMs);
    }

    // From the content script, not a frame: frame replies reach the parent window by postMessage, which the page reads.
    private async lookup(operation: 'translate' | 'define', sentence: string, word?: string): Promise<string> {
        if (operation === 'define') return this.context.define(word!);
        const command: VideoToExtensionCommand<LivingSubtitleLookupMessage> = {
            sender: 'asbplayer-video',
            message: { command: 'living-subtitle-lookup', sentence },
            src: '',
        };
        const response = ((await browser.runtime.sendMessage(command).catch(() => undefined)) as
            | LocalLookupResponse
            | undefined) ?? { error: 'unavailable' };
        if ('text' in response) return response.text;
        throw new Error(response.error);
    }

    private client(part: LivingSubtitlePart) {
        let client = this.clients.get(part);
        if (!client) {
            const created = this.createClient(part);
            client = created;
            // A frame that never loaded can be retried; keep a replacement that is already loading.
            created.catch(() => this.clients.get(part) === created && this.clients.delete(part));
            this.clients.set(part, client);
        }
        return client;
    }

    private async createClient(part: LivingSubtitlePart) {
        const frame = new UiFrame(
            async (element, lang) => {
                // Runs right after insertion, before paint: replaces the full-page frame class with a hidden one.
                element.className = `asbplayer-living-subtitle-frame asbplayer-hide ${frameColorSchemeClass()}`;
                element.inert = true;
                element.title = i18n.t('livingSubtitle.actions');
                const params = new URLSearchParams({ lang, part, colorScheme: frameColorScheme() });
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
        this.frames.set(part, frame);
        let client: FrameBridgeClient;
        try {
            await frame.bind();
            client = await frame.client();
        } catch (error) {
            frame.unbind(); // a retry creates a new frame; don't leave this one in the page
            if (this.frames.get(part) === frame) this.frames.delete(part);
            throw error;
        }
        client.onMessage((message: any) => {
            if (message.command === 'action') {
                this.action(message.action, part);
            } else if (message.command === 'size') {
                this.sizes.set(part, { width: Math.ceil(message.width), height: Math.ceil(message.height) });
                this.scheduleUpdate();
            }
        });
        return client;
    }

    private unbindFrames() {
        const hadFocus = this.focused.size > 0;
        for (const frame of this.frames.values()) frame.unbind();
        this.frames.clear();
        this.clients.clear();
        this.sizes.clear();
        this.focusRequests.clear(); // a new frame must not replay an old focus request
        this.pendingFocus.clear();
        this.forgetFrame('strip');
        this.forgetFrame('card');
        if (hadFocus && this.bound) this.focusSubtitle(); // keep keyboard users on the subtitle, not <body>
    }

    /** A hidden or removed frame never reports pointer-leave or focus-out. */
    private forgetFrame(part: LivingSubtitlePart) {
        this.focused.delete(part);
        this.pointerInFrame.delete(part);
    }

    private hideFrame(part: LivingSubtitlePart) {
        this.pendingFocus.delete(part);
        const frame = this.frames.get(part);
        if (!frame || frame.hidden) return;
        const hadFocus = this.focused.has(part);
        frame.hide();
        if (frame.frame) frame.frame.inert = true;
        this.forgetFrame(part);
        if (!hadFocus) return;
        if (part === 'card' && this.state?.target) this.focusFrame('strip');
        else this.focusSubtitle();
    }

    private scheduleUpdate() {
        if (this.updateScheduled) return;
        this.updateScheduled = true;
        requestAnimationFrame(() => {
            this.updateScheduled = false;
            void this.update();
        });
    }

    private releaseRegion(container: HTMLElement) {
        container.removeAttribute('tabindex');
        container.removeAttribute('role');
        container.removeAttribute('aria-label');
        container.classList.remove('asbplayer-living-subtitle-region');
    }

    private async update() {
        if (!this.bound) return;
        const generation = ++this.renderGeneration;
        const current = () => this.bound && generation === this.renderGeneration;
        const first = followCue(this.context.displayed());
        const containers = this.context.containers();
        for (const container of containers) {
            if (container !== containers[0]) {
                this.releaseRegion(container); // one tab stop for all subtitle tracks
                continue;
            }
            container.tabIndex = 0;
            container.setAttribute('role', 'group');
            container.classList.add('asbplayer-living-subtitle-region');
            container.setAttribute(
                'aria-label',
                first ? i18n.t('livingSubtitle.region', { sentence: first.text }) : i18n.t('livingSubtitle.noSubtitle')
            );
        }

        const state = this.state;
        const element = state?.target ? this.cueElement(state.target.cue) : undefined;
        this.clearHighlights();
        if (!state?.target || !element) {
            this.hideFrame('card');
            this.hideFrame('strip');
            return;
        }

        const cue = state.target.cue;
        const words = livingSubtitleWords(cue.text);
        const dom = domWords(element, cue.text);
        /** The word's ranges in every copy of the sentence: the highlight then shows in whichever copy is visible. */
        const rangesFor = (index?: number) =>
            index === undefined ? [] : dom.filter((w) => w.modelIndex === index).map((w) => w.range);
        const wordIndex = state.word ? words.findIndex((w) => w.start === state.word!.start) : undefined;
        const targetWordIndex = state.targetWord
            ? words.findIndex((w) => w.start === state.targetWord!.start)
            : undefined;
        this.highlight('asbplayer-living-subtitle-word', rangesFor(targetWordIndex ?? wordIndex));

        const video = this.context.video.getBoundingClientRect();
        // The part of the video on screen: frames stay inside it, and at high zoom the strip wraps to fit.
        const visibleLeft = Math.max(video.left, 0) + gap;
        const visibleRight = Math.min(video.right, window.innerWidth) - gap;
        // Vertically too, only the on-screen part of the video counts; when neither side fits, stay on screen.
        const visibleTop = Math.max(video.top, 0) + gap;
        const visibleBottom = Math.min(video.bottom, window.innerHeight) - gap;
        const model: LivingSubtitleViewModel = {
            themeType: this.themeType,
            sentence: cue.text,
            captured: state.captured,
            words: words.map((w) => w.text),
            wordIndex,
            targetWordIndex,
            cardOpen: state.word !== undefined,
            englishVisible: state.englishVisible,
            translation: state.translation,
            definition: state.definition,
            mining: state.mining,
            replayDisabled: this.context.recording(),
            focusRequest: this.focusRequests.get('strip') ?? 0,
            maxWidth: Math.max(0, visibleRight - visibleLeft),
            maxHeight: Math.max(0, visibleBottom - visibleTop),
        };
        try {
            const strip = await this.client('strip');
            if (!current()) return; // unbound or superseded while the frame loaded
            strip.updateState(model);
            if (model.cardOpen) {
                const card = await this.client('card');
                if (!current()) return;
                card.updateState({ ...model, wordIndex, focusRequest: this.focusRequests.get('card') ?? 0 });
            }
        } catch {
            return; // the frame failed to load; the next update retries
        }

        const line = element.getBoundingClientRect();
        const place = (part: LivingSubtitlePart, left: number, top: number) => {
            const frame = this.frames.get(part)?.frame;
            const size = this.sizes.get(part);
            if (!frame || !size) return;
            Object.assign(frame.style, {
                left: `${left}px`,
                top: `${top}px`,
                width: `${size.width}px`,
                height: `${size.height}px`,
            });
            frame.classList.remove('asbplayer-hide');
            frame.inert = false;
            if (this.pendingFocus.delete(part)) {
                frame.focus();
                // The frame's own focus attempt ran while it was hidden; ask again now that it can take focus.
                this.focusRequests.set(part, (this.focusRequests.get(part) ?? 0) + 1);
                this.scheduleUpdate();
            }
        };

        // Every subtitle line on screen (other tracks, other cues) is an obstacle: frames must never cover subtitles.
        const obstacles = this.context
            .containers()
            .flatMap((container) => [...container.querySelectorAll(`[${ASB_SUBTITLE_INDEX_ATTRIBUTE}]`)])
            .map((subtitle) => subtitle.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map(({ left, top, right, bottom, width, height }) => ({ left, top, right, bottom, width, height }));
        const fits = (top: number, height: number) => top >= visibleTop && top + height <= visibleBottom;
        /** Moves a frame up or down from `top` until it overlaps no subtitle in its column. */
        const clearOf = (top: number, left: number, size: { width: number; height: number }, direction: 1 | -1) => {
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
        /** Prefers `first`, then the other side; if neither fits on screen, stays on screen (may overlap). */
        const settle = (
            left: number,
            size: { width: number; height: number },
            first: [number, 1 | -1],
            second: [number, 1 | -1]
        ) => {
            for (const [top, direction] of [first, second]) {
                const clear = clearOf(top, left, size, direction);
                if (fits(clear, size.height)) return clear;
            }
            return clamp(first[0], visibleTop, visibleBottom - size.height);
        };

        const stripSize = this.sizes.get('strip') ?? { width: 0, height: 0 };
        const stripLeft = clamp(
            line.left + line.width / 2 - stripSize.width / 2,
            visibleLeft,
            visibleRight - stripSize.width
        );
        const stripTop = settle(stripLeft, stripSize, [line.bottom + gap, 1], [line.top - gap - stripSize.height, -1]);
        place('strip', stripLeft, stripTop);

        if (model.cardOpen) {
            const cardSize = this.sizes.get('card') ?? { width: 0, height: 0 };
            const anchor =
                rangesFor(wordIndex)
                    .map((range) => range.getBoundingClientRect())
                    .find((rect) => rect.width > 0) ?? line; // the visible copy's word
            const cardLeft = clamp(
                anchor.left + anchor.width / 2 - cardSize.width / 2,
                visibleLeft,
                visibleRight - cardSize.width
            );
            // The strip is an obstacle for the card too.
            obstacles.push({
                left: stripLeft,
                top: stripTop,
                right: stripLeft + stripSize.width,
                bottom: stripTop + stripSize.height,
                width: stripSize.width,
                height: stripSize.height,
            });
            const above = Math.min(line.top, stripTop) - gap - cardSize.height;
            const below = Math.max(line.bottom, stripTop + stripSize.height) + gap;
            place('card', cardLeft, settle(cardLeft, cardSize, [above, -1], [below, 1]));
        } else {
            this.hideFrame('card');
        }
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
