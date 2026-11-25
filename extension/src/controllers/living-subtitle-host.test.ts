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

interface FakeClient {
    sent: any[];
    listener?: (message: any) => void;
}

const clients: FakeClient[] = [];

jest.mock('@/services/ui-frame', () => ({
    __esModule: true,
    default: class {
        frame?: HTMLIFrameElement;
        parent = () => document.body;
        language = 'en';
        private bound = false;
        private client_: any;
        constructor(private readonly init: (frame: HTMLIFrameElement, lang: string) => Promise<void>) {}
        get hidden() {
            return this.frame === undefined || this.frame.classList.contains('asbplayer-hide');
        }
        async bind() {
            if (this.bound) return false;
            this.bound = true;
            this.frame = document.createElement('iframe');
            this.frame.classList.add('asbplayer-ui-frame'); // as UiFrame does before the initializer runs
            await this.init(this.frame, this.language);
            const entry: FakeClient = { sent: [] };
            clients.push(entry);
            this.client_ = {
                updateState: (state: any) => entry.sent.push({ command: 'updateState', state }),
                onMessage: (listener: any) => (entry.listener = listener),
            };
            return true;
        }
        async client() {
            return this.client_;
        }
        hide() {
            this.frame?.classList.add('asbplayer-hide');
        }
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

const english: IndexedSubtitleModel = { ...cue, text: 'He makes coffee.', track: 1, index: 1 };

const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50)); // past requestAnimationFrame
};

const rect = (left: number, top: number, width: number, height: number) => () =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

const setup = (mainCue = cue) => {
    (globalThis as any).browser = { runtime: { getURL: (path: string) => `chrome-extension://asb${path}` } };
    document.body.innerHTML =
        `<div id="container"><span data-asb-subtitle-index="0">${mainCue.text}</span>` +
        `<span data-asb-subtitle-index="1">${english.text}</span></div>`;
    const container = document.getElementById('container')!;
    const [span, englishSpan] = [...container.querySelectorAll('span')];
    let displayed = [mainCue, english];
    const context = {
        video: document.createElement('video'),
        containers: () => [container],
        displayed: () => displayed,
        cueAt: (index: number) => [mainCue, english][index],
        targetFor: (c: IndexedSubtitleModel) => ({ video: 'v', cue: c, surrounding: [] }),
        resolve: (target: any) => target,
        pause: jest.fn(),
        mine: jest.fn(async (): Promise<'saved' | 'dialog'> => 'saved'),
        define: jest.fn(async (word: string) => ({ text: `meaning of ${word}`, lemma: 'zetten', lemmas: ['zetten'] })),
        markKnown: jest.fn(async () => {}),
    };
    const host = new LivingSubtitleHost(context);
    host.bind({ language: 'en', themeType: 'dark' });
    /** A trusted click at a text offset inside `node`. */
    const click = (element: Element, node: Node, offset: number) => {
        (document as any).caretPositionFromPoint = () => ({ offsetNode: node, offset });
        (host as any).click({
            isTrusted: true,
            button: 0,
            target: element,
            clientX: 0,
            clientY: 0,
            stopPropagation: () => {},
            preventDefault: () => {},
        });
    };
    const hide = () => {
        displayed = [];
        host.subtitlesChanged();
    };
    const card = () => clients[0];
    const lastModel = () => card()?.sent.at(-1)?.state;
    return { host, context, container, span, englishSpan, click, hide, card, lastModel };
};

afterEach(() => {
    clients.length = 0;
    document.body.innerHTML = '';
    delete (document as any).caretPositionFromPoint;
});

describe('LivingSubtitleHost', () => {
    it('clicking a word pauses and opens the card with its dictionary meaning', async () => {
        const { host, context, span, click, lastModel } = setup();
        click(span, span.firstChild!, 5); // inside "zet"
        await flush();
        expect(context.pause).toHaveBeenCalled();
        expect(context.define).toHaveBeenCalledWith('zet', false);
        expect(lastModel()).toMatchObject({
            word: 'zet',
            definition: { status: 'success', text: 'meaning of zet', lemma: 'zetten' },
            mining: { status: 'idle' },
        });
        host.unbind();
    });

    it('ignores clicks on the translation track', async () => {
        const { host, context, englishSpan, click, card } = setup();
        click(englishSpan, englishSpan.firstChild!, 4);
        await flush();
        expect(context.define).not.toHaveBeenCalled();
        expect(card()).toBeUndefined();
        host.unbind();
    });

    it('opens the whole i+1 phrase from either word and retries the same lookup', async () => {
        const { host, context, span, click, lastModel } = setup({ ...cue, text: 'En ik ga voor een...' });
        span.innerHTML = 'En ik <span data-asb-i-plus-one data-asb-token-start="6"><b>ga</b> voor</span> een...';
        const phrase = span.querySelector('span')!;
        const first = phrase.querySelector('b')!;
        click(first, first.firstChild!, 1);
        await flush();
        expect(lastModel()).toMatchObject({ word: 'ga voor' });

        context.define.mockRejectedValueOnce(new Error('dictionaryUnavailable'));
        click(phrase, phrase.lastChild!, 3);
        await flush();
        expect(lastModel()).toMatchObject({ word: 'ga voor', definition: { status: 'error' } });
        (host as any).action('retry-definition');
        await flush();
        expect(context.define.mock.calls).toEqual([
            ['ga voor', false],
            ['ga voor', false],
            ['ga voor', true],
        ]);
        expect(lastModel()).toMatchObject({ word: 'ga voor', definition: { status: 'success' } });
        host.unbind();
    });

    it('maps a click to the right word when a ruby gloss precedes it', () => {
        const { host, context, span, click } = setup();
        span.innerHTML = '<ruby>Hij<rt>he</rt></ruby> zet koffie.';
        click(span, span.childNodes[1], 4); // just after "zet" in " zet koffie."
        expect(context.define).toHaveBeenCalledWith('zet', false);
        host.unbind();
    });

    it('maps a click in the hover-annotated copy of the sentence', () => {
        const { host, context, span, click } = setup();
        span.innerHTML =
            '<span class="asbplayer-subtitle-text">Hij zet koffie.</span>' +
            '<span class="asbplayer-subtitle-rich">Hij zet<rt>puts</rt> koffie.</span>';
        const rich = span.children[1];
        click(rich, rich.childNodes[2], 3); // inside "koffie"
        expect(context.define).toHaveBeenCalledWith('koffie', false);
        host.unbind();
    });

    it('creates the card frame hidden, so a loading frame never covers the page', async () => {
        const { host, span, click } = setup();
        click(span, span.firstChild!, 5);
        await flush();
        const frame = (host as any).frame.frame as HTMLIFrameElement;
        expect(frame.classList.contains('asbplayer-ui-frame')).toBe(false);
        expect(frame.classList.contains('asbplayer-living-subtitle-frame')).toBe(true);
        host.unbind();
    });

    it('places the card clear of every subtitle line', async () => {
        const { host, context, span, englishSpan, click, card } = setup();
        context.video.getBoundingClientRect = rect(0, 0, 800, 450);
        span.getBoundingClientRect = rect(100, 300, 400, 30); // the clicked Dutch line
        englishSpan.getBoundingClientRect = rect(150, 250, 300, 26); // a second track right above it
        click(span, span.firstChild!, 5);
        await flush();
        card().listener!({ command: 'size', width: 300, height: 120 });
        await flush();
        const frame = (host as any).frame.frame as HTMLIFrameElement;
        expect(parseFloat(frame.style.top) + 120).toBeLessThanOrEqual(250); // above the English line, not over it
        expect(frame.classList.contains('asbplayer-hide')).toBe(false);
        host.unbind();
    });

    it('closes the card on its close action and when subtitles are hidden', async () => {
        const { host, span, click, card, hide } = setup();
        click(span, span.firstChild!, 5);
        await flush();
        card().listener!({ command: 'action', action: 'close-word' });
        expect((host as any).state.word).toBeUndefined();

        click(span, span.firstChild!, 5);
        hide();
        expect((host as any).state.target).toBeUndefined();
        host.unbind();
    });

    it('Known on the card saves the clicked word and shows the confirmation', async () => {
        const { host, context, span, click, card, lastModel } = setup();
        click(span, span.firstChild!, 5);
        await flush();
        card().listener!({ command: 'action', action: 'known' });
        await flush();
        expect(context.markKnown).toHaveBeenCalledWith('zet', ['zetten']);
        expect(lastModel()).toMatchObject({ word: 'zet', known: { status: 'success' } });
        host.unbind();
    });

    it('a second Mine click does not end the first mine', async () => {
        const { host, context, span, click, card } = setup();
        context.mine = jest.fn(() => new Promise<'saved'>(() => {})); // the export is still running
        click(span, span.firstChild!, 5);
        await flush();
        card().listener!({ command: 'action', action: 'mine' });
        card().listener!({ command: 'action', action: 'mine' }); // before the card shows Mine disabled
        await flush();
        expect(context.mine).toHaveBeenCalledTimes(1);
        expect((host as any).mining).toBe(true); // so the recording's own play/seek does not dismiss it
        host.unbind();
    });
});
