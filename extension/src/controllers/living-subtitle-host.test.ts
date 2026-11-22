import type { IndexedSubtitleModel } from '@project/common';
import LivingSubtitleHost from '@/controllers/living-subtitle-host';

// jsdom has no layout: word ranges measure as empty, so the card anchors to the line.
(Range.prototype as any).getBoundingClientRect ??= () => ({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
});

const clients: { part: string; sent: any[]; listener?: (message: any) => void }[] = [];

jest.mock('@/services/ui-frame', () => ({
    __esModule: true,
    default: class {
        frame?: HTMLIFrameElement;
        parent = () => document.body;
        language = 'en';
        private bound = false;
        private client_: any;
        constructor(private readonly init: (frame: HTMLIFrameElement, lang: string) => Promise<void>) {}
        async bind() {
            if (this.bound) return false;
            this.bound = true;
            this.frame = document.createElement('iframe');
            this.frame.classList.add('asbplayer-ui-frame'); // as UiFrame does before the initializer runs
            await this.init(this.frame, this.language);
            const part = new URL(this.frame.src).searchParams.get('part')!;
            const entry: (typeof clients)[number] = { part, sent: [] };
            clients.push(entry);
            this.client_ = {
                updateState: (state: any) => entry.sent.push({ command: 'updateState', state }),
                sendMessage: (message: any) => entry.sent.push(message),
                onMessage: (listener: any) => (entry.listener = listener),
            };
            return true;
        }
        async client() {
            return this.client_;
        }
        show() {}
        hide() {}
        unbind() {
            this.bound = false;
        }
    },
}));

const cue: IndexedSubtitleModel = {
    text: 'Hij zet koffie.',
    start: 1000,
    end: 2000,
    originalStart: 1000,
    originalEnd: 2000,
    track: 0,
    index: 0,
};

const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50)); // past requestAnimationFrame
};

const setup = () => {
    const sendMessage = jest.fn(async (...args: any[]): Promise<any> => args.length && { error: 'busy' });
    (globalThis as any).browser = {
        runtime: { getURL: (path: string) => `chrome-extension://asb${path}`, sendMessage },
    };
    document.body.innerHTML = `<div id="container"><span data-asb-subtitle-index="0">${cue.text}</span></div><div id="top"></div>`;
    const container = document.getElementById('container')!;
    const top = document.getElementById('top')!;
    let displayed = [cue];
    const video = document.createElement('video');
    const context = {
        video,
        containers: () => [container, top],
        displayed: () => displayed,
        cueAt: (index: number) => (index === 0 ? cue : undefined),
        targetFor: (c: IndexedSubtitleModel) => ({ video: 'v', cue: c, surrounding: [] }),
        resolve: (target: any) => target,
        recording: () => false,
        pause: jest.fn(),
        replay: jest.fn(),
        mine: jest.fn(async () => 'saved' as const),
        define: jest.fn(async (word: string) => `meaning of ${word}`),
        seekToAdjacentSubtitle: jest.fn(),
    };
    const host = new LivingSubtitleHost(context);
    host.bind({ language: 'en', themeType: 'dark' });
    const span = container.querySelector('span')!;
    const hide = () => {
        displayed = [];
        host.subtitlesChanged();
    };
    const show = (cues: IndexedSubtitleModel[]) => {
        displayed = cues;
        host.subtitlesChanged();
    };
    return { host, context, container, top, span, sendMessage, hide, show };
};

afterEach(() => {
    clients.length = 0;
    document.body.innerHTML = '';
});

describe('LivingSubtitleHost', () => {
    it('reveals on hover without pausing and closes 250 ms after the pointer leaves', async () => {
        const { host, context, span } = setup();
        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        await flush();
        expect(context.pause).not.toHaveBeenCalled();
        const strip = clients.find((client) => client.part === 'strip')!;
        expect(strip.sent.at(-1).state).toMatchObject({ sentence: cue.text, captured: false });

        span.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        strip.listener!({ command: 'action', action: 'pointer-enter' }); // pointer travels into the strip
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect((host as any).state.target).toBeDefined();

        strip.listener!({ command: 'action', action: 'pointer-leave' });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect((host as any).state?.target).toBeUndefined();
        host.unbind();
    });

    it('captures on Tab entry but not on programmatic focus', async () => {
        const { host, context, container, top } = setup();
        await flush(); // the region becomes a tab stop on the next frame
        container.focus();
        expect(context.pause).not.toHaveBeenCalled();
        container.blur();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
        container.focus();
        expect(context.pause).toHaveBeenCalled();
        expect((host as any).state.captured).toBe(true);
        expect(container.tabIndex).toBe(0);
        expect(container.getAttribute('role')).toBe('group');
        expect(top.hasAttribute('tabindex')).toBe(false); // one tab stop for all tracks
        host.unbind();
        expect(container.hasAttribute('tabindex')).toBe(false);
    });

    it('looks up from the content script, never through a frame, and maps typed errors', async () => {
        const { host, span, sendMessage } = setup();
        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        await flush();
        void host.controller.toggleEnglish();
        await flush();
        expect(sendMessage.mock.calls[0][0]).toMatchObject({
            sender: 'asbplayer-video',
            message: { command: 'living-subtitle-lookup', sentence: cue.text },
        });
        expect(clients.flatMap((client) => client.sent).some((message) => message.command === 'lookup')).toBe(false);
        expect((host as any).state.translation).toEqual({ status: 'error', message: 'busy' });
        host.unbind();
    });

    it('looks words up in the dictionary, never through the background', async () => {
        const { host, context, span, sendMessage } = setup();
        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        await flush();
        void host.controller.selectWord(1);
        await flush();
        expect(context.define).toHaveBeenCalledWith('zet');
        expect((host as any).state.definition).toEqual({ status: 'success', text: 'meaning of zet' });
        expect(sendMessage).not.toHaveBeenCalled();
        host.unbind();
    });

    it('Left and Right in the strip go to the previous and next subtitle', async () => {
        const { host, context, span } = setup();
        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        await flush();
        const strip = clients.find((client) => client.part === 'strip')!;
        strip.listener!({ command: 'action', action: 'subtitle-previous' });
        strip.listener!({ command: 'action', action: 'subtitle-next' });
        expect(context.seekToAdjacentSubtitle.mock.calls).toEqual([[false], [true]]);
        host.unbind();
    });

    it('creates frames hidden, so a loading frame never covers the page', async () => {
        const { host, span } = setup();
        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        await flush();
        const frame = (host as any).frames.get('strip').frame as HTMLIFrameElement;
        expect(frame.classList.contains('asbplayer-ui-frame')).toBe(false);
        expect(frame.classList.contains('asbplayer-living-subtitle-frame')).toBe(true);
        host.unbind();
    });

    it('gives the translation track no actions', async () => {
        const { host, context, container, span, show } = setup();
        const other = { ...cue, text: 'He makes coffee.', track: 1, index: 1 };
        context.cueAt = (index: number) => [cue, other][index];
        const english = document.createElement('span');
        english.setAttribute('data-asb-subtitle-index', '1');
        english.textContent = other.text;
        container.appendChild(english);

        english.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        expect((host as any).state?.target).toBeUndefined(); // hovering English does nothing

        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        show([other, cue]); // another track changes: keep the hovered Dutch line
        expect((host as any).state.target.cue.index).toBe(0);
        show([other]); // the Dutch line left and only English remains: close rather than follow it
        expect((host as any).state.target).toBeUndefined();
        host.unbind();
    });

    it('maps a click to the right word when a ruby gloss precedes it', () => {
        const { host, span } = setup();
        span.innerHTML = '<ruby>Hij<rt>he</rt></ruby> zet koffie.';
        const text = span.childNodes[1]; // " zet koffie."
        (document as any).caretPositionFromPoint = () => ({ offsetNode: text, offset: 4 }); // just after "zet"
        const selectWord = jest.spyOn(host.controller, 'selectWord');
        const event = { isTrusted: true, button: 0, target: span, clientX: 0, clientY: 0 };
        (host as any).click({ ...event, stopPropagation: () => {}, preventDefault: () => {} });
        expect(selectWord).toHaveBeenCalledWith(1); // "zet", not "koffie"
        delete (document as any).caretPositionFromPoint;
        host.unbind();
    });

    it('maps a click in the hover-annotated copy of the sentence', () => {
        const { host, span } = setup();
        span.innerHTML =
            '<span class="asbplayer-subtitle-text">Hij zet koffie.</span>' +
            '<span class="asbplayer-subtitle-rich">Hij zet<rt>puts</rt> koffie.</span>';
        const rich = span.children[1];
        const text = rich.childNodes[2]; // " koffie."
        (document as any).caretPositionFromPoint = () => ({ offsetNode: text, offset: 3 }); // inside "koffie"
        const selectWord = jest.spyOn(host.controller, 'selectWord');
        const event = { isTrusted: true, button: 0, target: rich, clientX: 0, clientY: 0 };
        (host as any).click({ ...event, stopPropagation: () => {}, preventDefault: () => {} });
        expect(selectWord).toHaveBeenCalledWith(2); // "koffie", although the plain copy came first
        delete (document as any).caretPositionFromPoint;
        host.unbind();
    });

    it('places the strip clear of every subtitle line, not just the hovered one', async () => {
        const { host, context, container, span } = setup();
        const rect = (left: number, top: number, width: number, height: number) => () =>
            ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
        const english = document.createElement('span');
        english.setAttribute('data-asb-subtitle-index', '1');
        english.textContent = 'He makes coffee.';
        container.appendChild(english);
        span.getBoundingClientRect = rect(100, 300, 400, 30); // the hovered Dutch line
        english.getBoundingClientRect = rect(150, 334, 300, 26); // a second track right below it
        context.video.getBoundingClientRect = rect(0, 0, 800, 450);
        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        await flush();
        clients.find((client) => client.part === 'strip')!.listener!({ command: 'size', width: 300, height: 40 });
        await flush();
        const frame = (host as any).frames.get('strip').frame as HTMLIFrameElement;
        expect(parseFloat(frame.style.top)).toBeGreaterThanOrEqual(360); // below the English line, not over it
        host.unbind();
    });

    it('keyboard entry picks the main track, not a translation shown first', async () => {
        const { host, container, show } = setup();
        const english = { ...cue, text: 'He makes coffee.', track: 1, index: 1 };
        show([english, cue]);
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
        container.focus();
        expect((host as any).state.target.cue.track).toBe(0);
        host.unbind();
    });

    it('a keyboard user who tabs in between cues gets the next cue', async () => {
        const { host, context, container, hide, show } = setup();
        hide();
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
        container.focus();
        expect((host as any).state?.target).toBeUndefined();
        show([cue]);
        expect((host as any).state).toMatchObject({ captured: true, target: { cue: { index: 0 } } });
        expect(context.pause).toHaveBeenCalled();
        host.unbind();
    });

    it('a second Mine click does not end the first mine', async () => {
        const { host, context, span } = setup();
        context.mine = jest.fn(() => new Promise<'saved'>(() => {})); // the export is still running
        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        await flush();
        const strip = clients.find((client) => client.part === 'strip')!;
        strip.listener!({ command: 'action', action: 'mine' });
        strip.listener!({ command: 'action', action: 'mine' }); // before the frame shows Mine disabled
        await flush();
        expect(context.mine).toHaveBeenCalledTimes(1);
        expect((host as any).mining).toBe(true); // so the recording's own play/seek does not dismiss it
        host.unbind();
    });

    it('dismisses a captured sentence when subtitles are hidden', async () => {
        const { host, span, hide } = setup();
        span.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
        host.controller.capture();
        hide();
        expect((host as any).state?.target).toBeUndefined();
        host.unbind();
    });
});
