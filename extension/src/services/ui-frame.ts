import project from '@project/common/project';
import { isFirefoxBuild } from '@project/extension/src/services/build-flags';
import type { FetchOptions } from '@project/extension/src/services/frame-bridge-client';
import FrameBridgeClient from '@project/extension/src/services/frame-bridge-client';
import { frameColorScheme, frameColorSchemeClass } from '@project/extension/src/services/frame-color-scheme';

export const uiFrameForHtml = (html: (lang: string) => Promise<string>) => {
    return new UiFrame(async (frame: HTMLIFrameElement, lang: string) => {
        if (isFirefoxBuild) {
            // Firefox does not allow document.write() into the about:blank iframe.
            frame.srcdoc = await html(lang);
        } else {
            // On Chromium, use document.write() since it allows the loading of extension scripts
            // into the iframe without additional work.
            const doc = frame.contentDocument!;
            doc.open();
            doc.write(await html(lang));
            doc.close();
        }
    });
};

export const uiFrameForSrc = (src: string) => {
    return new UiFrame(async (frame: HTMLIFrameElement) => {
        const colorScheme = frameColorScheme();
        frame.src = `${src}?colorScheme=${encodeURIComponent(colorScheme)}`;
    });
};

type FrameInitializer = (frame: HTMLIFrameElement, lang: string) => Promise<void>;

export default class UiFrame {
    private readonly _frameInitializer: FrameInitializer;
    private readonly _expectedOrigin?: string;
    private readonly _useRuntimeMessages: boolean;
    private _fetchOptions: FetchOptions | undefined;
    private _client: FrameBridgeClient | undefined;
    private _frame: HTMLIFrameElement | undefined;
    // The frame's window once loaded. Removing or moving the iframe replaces it, losing the dialog document.
    private _window: Window | null | undefined;
    private _language: string = project.defaultLanguage;
    private _dirty = true;
    private _bound = false;
    private _ready: Promise<void> = Promise.resolve();
    // A new client whose message handlers no caller has attached yet; the next bind() returns true for it.
    private _unclaimedClient = false;
    /** Where the frame is inserted; moving an iframe reloads it, so change it only with `unbind()`. */
    parent: () => HTMLElement = () => document.body;

    constructor(frameInitializer: FrameInitializer, expectedOrigin?: string, useRuntimeMessages = false) {
        this._frameInitializer = frameInitializer;
        this._expectedOrigin = expectedOrigin;
        this._useRuntimeMessages = useRuntimeMessages;
    }

    set fetchOptions(fetchOptions: FetchOptions) {
        this._dirty =
            this._dirty ||
            this._fetchOptions?.allowedFetchUrl !== fetchOptions.allowedFetchUrl ||
            this._fetchOptions?.videoSrc !== fetchOptions.videoSrc;
        this._fetchOptions = fetchOptions;
    }

    set language(language: string) {
        this._dirty = this._dirty || this._language !== language;
        this._language = language;
    }

    get hidden() {
        return this._frame === undefined || this._frame.classList.contains('asbplayer-hide');
    }

    get bound() {
        return this._bound;
    }

    get frame() {
        return this._frame;
    }

    /** True once the page removed the frame after it loaded, or moved one whose document was written in place. */
    get lost() {
        if (this._window === undefined) return false;
        const frame = this._frame!;
        if (!frame.isConnected) return true;
        // A frame loaded from src or srcdoc reloads itself when moved and handshakes again; a written one stays blank.
        return !frame.src && !frame.srcdoc && frame.contentWindow !== this._window;
    }

    get clientIfLoaded() {
        return this._client;
    }

    async bind(): Promise<boolean> {
        await this._init();
        const isNewClient = this._unclaimedClient;
        this._unclaimedClient = false;
        return isNewClient;
    }

    async client() {
        await this._init();
        return this._client!;
    }

    private async _init() {
        if (this._dirty) {
            this._create();
        }

        // Concurrent callers all wait for the same in-flight frame, so none gets a client that is not ready yet.
        await this._ready;
    }

    private _create() {
        this._dirty = false;
        this._bound = true;
        this._client?.unbind();
        this._frame?.remove();
        this._window = undefined;

        this._frame = document.createElement('iframe');
        this._frame.classList.add('asbplayer-ui-frame');
        // Starts hidden: a visible but empty full-page frame swallows every click on the page until show().
        this._frame.classList.add('asbplayer-hide');
        this._frame.classList.add(frameColorSchemeClass());
        this._frame.setAttribute('allowtransparency', 'true');

        this._client = new FrameBridgeClient(
            this._frame,
            this._fetchOptions,
            this._expectedOrigin,
            this._useRuntimeMessages
        );
        this.parent().appendChild(this._frame);
        this._unclaimedClient = true;

        const client = this._client;
        const frame = this._frame;
        this._ready = Promise.all([client.bind(), this._frameInitializer(frame, this._language)]).then(
            () => {
                if (this._client === client) this._window = frame.contentWindow;
            },
            (error) => {
                if (this._client === client) this._dirty = true; // Retry with a fresh frame next time.
                throw error;
            }
        );
    }

    show() {
        this._frame?.classList.remove('asbplayer-hide');
    }

    hide() {
        this._frame?.classList.add('asbplayer-hide');
        this._frame?.blur();
    }

    unbind() {
        this._dirty = true;
        this._bound = false;
        this._client?.unbind();
        this._frame?.remove();
    }
}
