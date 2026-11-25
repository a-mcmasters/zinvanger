import { isFirefox } from '@project/common/browser-detection';

const preparationTimeoutMs = 5000;

interface TrackAudioElement extends HTMLAudioElement {
    audioTracks?: Iterable<{ id: string; enabled: boolean }>;
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
}

export class ClippingCancelledError extends Error {
    constructor() {
        super('Clipping cancelled');
    }
}

export class AudioUnavailableError extends Error {}

interface RecordingMonitor {
    audible: boolean;
    silence?: () => void;
}

async function untilAborted<T>(signal: AbortSignal, result: Promise<T>): Promise<T> {
    let abort: () => void;
    try {
        return await Promise.race([
            result,
            new Promise<never>((_, reject) => {
                abort = () => reject(signal.reason);
                if (signal.aborted) abort();
                else signal.addEventListener('abort', abort, { once: true });
            }),
        ]);
    } finally {
        signal.removeEventListener('abort', abort!);
    }
}

async function waitForMedia(signal: AbortSignal, ready: () => boolean) {
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
        await untilAborted(
            signal,
            new Promise<void>((resolve) => {
                timer = setInterval(() => {
                    if (ready()) resolve();
                }, 100);
            })
        );
    } finally {
        clearInterval(timer);
    }
}

async function withAudio<T>(
    source: string | Blob,
    controller: AbortController,
    preload: 'auto' | 'metadata',
    run: (audio: TrackAudioElement, ready: () => void) => Promise<T>
) {
    controller.signal.throwIfAborted();
    const audio = new Audio() as TrackAudioElement;
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const timer = setTimeout(() => controller.abort(new Error('Timed out preparing audio')), preparationTimeoutMs);
    const ready = () => clearTimeout(timer);
    try {
        audio.preload = preload;
        audio.onerror = () => controller.abort(new Error(audio.error?.message || 'Could not load audio'));
        audio.src = url;
        return await run(audio, ready);
    } finally {
        ready();
        audio.onerror = audio.onended = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (typeof source !== 'string') URL.revokeObjectURL(url);
    }
}

export async function fileAudioDurationMs(source: string | Blob, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
        return await withAudio(source, controller, 'metadata', async (audio) => {
            await waitForMedia(controller.signal, () => audio.readyState >= 1);
            return Number.isFinite(audio.duration) ? audio.duration * 1000 : undefined;
        });
    } finally {
        signal?.removeEventListener('abort', abort);
    }
}

export default class FileAudioClipper {
    private _recording?: { controller: AbortController; monitor: RecordingMonitor; promise: Promise<Blob> };
    private _preview?: AbortController;
    private _blob?: Blob;

    constructor(
        private readonly _source: string | Blob,
        private readonly _start: number,
        private readonly _end: number,
        private readonly _playbackRate: number,
        private readonly _recorderMimeType: string,
        private readonly _onPlaybackChanged: () => void,
        private readonly _trackId?: string
    ) {}

    get recording() {
        return this._recording !== undefined && !this._recording.controller.signal.aborted;
    }

    get recordingAudibly() {
        return this.recording && this._recording?.monitor.audible === true;
    }

    get previewing() {
        return this._preview !== undefined && !this._preview.signal.aborted;
    }

    get recorded() {
        return this._blob !== undefined;
    }

    stopPreview() {
        this._preview?.abort(new ClippingCancelledError());
    }

    stopRecording() {
        this._recording?.controller.abort(new ClippingCancelledError());
    }

    silenceRecording() {
        const monitor = this._recording?.monitor;
        if (monitor?.audible) {
            monitor.audible = false;
            monitor.silence?.();
        }
    }

    async preview() {
        const controller = new AbortController();
        this._preview = controller;
        const blob = this._blob;
        try {
            this._onPlaybackChanged();
            await withAudio(blob ?? this._source, controller, 'auto', async (audio, ready) => {
                const duration = await this._prepare(audio, controller.signal, blob);
                await untilAborted(controller.signal, audio.play());
                ready();
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await untilAborted(
                        controller.signal,
                        new Promise<void>((resolve) => {
                            audio.onended = () => resolve();
                            timer = setTimeout(resolve, duration + 100);
                        })
                    );
                } finally {
                    clearTimeout(timer);
                }
            });
        } finally {
            if (this._preview === controller) this._preview = undefined;
            this._onPlaybackChanged();
        }
    }

    record(audible: boolean) {
        if (this._blob) return Promise.resolve(this._blob);
        const recording = this._recording;
        if (recording && !recording.controller.signal.aborted) return recording.promise;
        const controller = new AbortController();
        const monitor: RecordingMonitor = { audible };
        const promise = withAudio(this._source, controller, 'auto', async (audio, ready) => {
            const duration = await this._prepare(audio, controller.signal);
            const audioContext = !audible || isFirefox ? new AudioContext() : undefined;
            try {
                if (audioContext) {
                    const source = audioContext.createMediaElementSource(audio);
                    if (audible) {
                        const gain = audioContext.createGain();
                        source.connect(gain);
                        gain.connect(audioContext.destination);
                        monitor.silence = () => {
                            gain.gain.value = 0;
                        };
                    } else {
                        source.connect(audioContext.createMediaStreamDestination());
                    }
                } else {
                    // Element muting changes speaker output while captureStream still receives the audio.
                    monitor.silence = () => {
                        audio.muted = true;
                    };
                }
                if (!monitor.audible) monitor.silence?.();
                controller.signal.throwIfAborted();
                await untilAborted(controller.signal, audio.play());
                controller.signal.throwIfAborted();
                ready();
                const blob = await this._record(audio, controller, duration);
                controller.signal.throwIfAborted();
                this._blob = blob;
                return blob;
            } finally {
                void audioContext?.close();
            }
        }).finally(() => {
            if (this._recording?.controller === controller) this._recording = undefined;
            if (audible) this._onPlaybackChanged();
        });
        this._recording = { controller, monitor, promise };
        if (audible) this._onPlaybackChanged();
        return promise;
    }

    private async _prepare(audio: TrackAudioElement, signal: AbortSignal, recorded?: Blob) {
        await waitForMedia(signal, () => audio.readyState >= 1);
        // Recorded blobs start at zero and already encode the selected playback rate.
        const start = recorded ? 0 : this._start / 1000;
        const end = recorded ? audio.duration : Math.min(this._end / 1000, audio.duration);
        if (end <= start) throw new AudioUnavailableError('Requested audio is outside the file');
        if (!recorded && this._trackId && audio.audioTracks) {
            for (const track of audio.audioTracks) track.enabled = this._trackId === track.id;
        }
        audio.currentTime = start;
        audio.playbackRate = recorded ? 1 : this._playbackRate;
        const canPlay = () => !audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
        if (!canPlay()) await waitForMedia(signal, canPlay);
        signal.throwIfAborted();
        if (audio.ended || audio.currentTime >= audio.duration) {
            throw new AudioUnavailableError('Requested audio is outside the file');
        }
        const requestedDuration = (this._end - this._start) / this._playbackRate;
        return Number.isFinite(end)
            ? Math.min(requestedDuration, ((end - start) * 1000) / audio.playbackRate)
            : requestedDuration;
    }

    private async _record(audio: TrackAudioElement, controller: AbortController, duration: number) {
        const stream = audio.mozCaptureStream?.() ?? audio.captureStream?.();
        if (!stream) throw new Error('Unable to capture stream from audio');
        const input = new MediaStream();
        for (const track of stream.getVideoTracks()) track.stop();
        const tracks = stream.getAudioTracks();
        let recorder: MediaRecorder | undefined;
        let stopTimer: ReturnType<typeof setTimeout> | undefined;
        let finishTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            for (const track of tracks) {
                if (track.enabled) input.addTrack(track);
            }
            const capture = new MediaRecorder(input, { mimeType: this._recorderMimeType });
            recorder = capture;
            return await untilAborted(
                controller.signal,
                new Promise<Blob>((resolve) => {
                    const chunks: BlobPart[] = [];
                    capture.ondataavailable = (event) => chunks.push(event.data);
                    capture.onstop = () => resolve(new Blob(chunks, { type: this._recorderMimeType }));
                    capture.onerror = () => controller.abort(new Error('Could not record audio'));
                    const stop = () => {
                        if (capture.state !== 'inactive') capture.stop();
                    };
                    audio.onended = stop;
                    capture.start();
                    stopTimer = setTimeout(stop, duration + 100);
                    finishTimer = setTimeout(
                        () => controller.abort(new Error('Timed out finishing audio recording')),
                        duration + 100 + preparationTimeoutMs
                    );
                })
            );
        } finally {
            clearTimeout(stopTimer);
            clearTimeout(finishTimer);
            audio.onended = null;
            if (recorder) {
                recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
                if (recorder.state !== 'inactive') recorder.stop();
            }
            for (const track of tracks) track.stop();
        }
    }
}
