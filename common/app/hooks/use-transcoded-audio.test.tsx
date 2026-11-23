import { afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { FileWithId } from '@project/common/file-selector';
import { TestHost, webmHeader } from '@project/common/audio-transcode/test-host';
import { convertedAudioTrackModels, useTranscodedAudio } from '@project/common/app/hooks/use-transcoded-audio';
import Alert from '@project/common/app/components/Alert';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Harness = ({ file, host }: { file?: FileWithId; host: TestHost }) => {
    const conversion = useTranscodedAudio(file, host);
    return (
        <>
            <output
                data-state={conversion.state}
                data-bytes={conversion.blob?.size}
                data-complete={conversion.state === 'ready'}
                data-required={conversion.required}
                data-error={conversion.error === undefined ? undefined : String(conversion.error)}
                data-tracks={conversion.tracks?.length}
                data-selected={conversion.selectedTrackIndex}
                data-attempt={conversion.attempt}
            >
                {conversion.codecName}
            </output>
            <Alert
                open={conversion.state === 'failed'}
                useAppLogo={false}
                dismissible
                disableAutoHide
                onClose={() => {}}
            >
                Conversion failed
            </Alert>
            <button data-select-first onClick={() => conversion.selectTrack(0)}>
                First track
            </button>
            <button data-select-second onClick={() => conversion.selectTrack(1)}>
                Second track
            </button>
            <button
                data-select-second-twice
                onClick={() => {
                    // Two choices delivered before React re-renders.
                    conversion.selectTrack(1);
                    conversion.selectTrack(1);
                }}
            >
                Second track twice
            </button>
            <button
                data-switch-then-old-failure
                onClick={() => {
                    // The previous track's audio fails after the switch, before React re-renders.
                    const previousAttempt = conversion.attempt;
                    conversion.selectTrack(1);
                    conversion.fail(new Error('Old track playback failed'), previousAttempt);
                }}
            >
                Switch, then old failure
            </button>
            <button data-fail onClick={() => conversion.fail(new Error('Playback failed'))}>
                Fail
            </button>
        </>
    );
};

let container: HTMLDivElement;
let root: Root;
let nextUrl = 0;
// Only the track header is needed to exercise the real codec probe.
const box = (type: string, ...parts: Uint8Array[]) => {
    const bytes = new Uint8Array(8 + parts.reduce((size, part) => size + part.length, 0));
    new DataView(bytes.buffer).setUint32(0, bytes.length);
    bytes.set(
        [...type].map((character) => character.charCodeAt(0)),
        4
    );
    let offset = 8;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
};
const audioTrak = (format = 'ac-3') =>
    box(
        'trak',
        box(
            'mdia',
            box('hdlr', new Uint8Array(8), new Uint8Array([115, 111, 117, 110])), // soun
            box('minf', box('stbl', box('stsd', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), box(format))))
        )
    );
const fileWithTracks = (id: string, formats: string[]): FileWithId => ({
    id,
    file: new File([box('moov', ...formats.map(audioTrak))], `${id}.mp4`),
});
const file = (id: string, audioTracks = 1) => fileWithTracks(id, Array(audioTracks).fill('ac-3'));
const state = () => container.querySelector('output')!.getAttribute('data-state');
const render = async (file: FileWithId | undefined, host: TestHost) => {
    await act(async () => root.render(<Harness file={file} host={host} />));
};
const click = async (selector: string) => {
    await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click());
};
const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!condition() && Date.now() < deadline) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
    }
    expect(condition()).toBe(true);
};
const waitForState = async (expected: string) => {
    const deadline = Date.now() + 2000;
    while (state() !== expected && Date.now() < deadline) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
    }
    expect(state()).toBe(expected);
};

const waitForRequirement = async () => {
    const deadline = Date.now() + 2000;
    while (container.querySelector('output')!.getAttribute('data-required') !== 'true' && Date.now() < deadline) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
    }
    expect(container.querySelector('output')!.getAttribute('data-required')).toBe('true');
};

const waitForWorker = async (host: TestHost, index = 0) => {
    const deadline = Date.now() + 2000;
    while (host.workers.length <= index && Date.now() < deadline) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
    }
    expect(host.workers.length).toBeGreaterThan(index);
    await host.workers[index].started;
};

const waitForComplete = async () => {
    const deadline = Date.now() + 2000;
    while (container.querySelector('output')?.getAttribute('data-complete') !== 'true' && Date.now() < deadline) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
    }
    expect(container.querySelector('output')!.getAttribute('data-complete')).toBe('true');
};

beforeAll(() => {
    // jsdom predates this standard AbortSignal method.
    if (AbortSignal.prototype.throwIfAborted === undefined) {
        AbortSignal.prototype.throwIfAborted = function () {
            if (this.aborted) throw this.reason;
        };
    }
    if (Blob.prototype.arrayBuffer === undefined) {
        Blob.prototype.arrayBuffer = function () {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(this);
            });
        };
    }
});
beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    // Browser codec support and Blob URLs are the external boundaries.
    jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((mime) =>
        mime === 'video/mp4' ? 'probably' : ''
    );
    URL.createObjectURL = jest.fn(() => `blob:converted-${++nextUrl}`);
    URL.revokeObjectURL = jest.fn();
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    jest.restoreAllMocks();
});

it('starts converting an undecodable track automatically and reports its codec', async () => {
    const host = new TestHost();
    host.autoComplete = false;
    await render(file('a'), host);
    await waitForState('transcoding');
    expect(container.querySelector('output')!.textContent).toBe('AC-3');
    expect(container.querySelector('output')!.getAttribute('data-required')).toBe('true');
    await waitForWorker(host);
    expect(host.workers).toHaveLength(1);
    await act(async () => host.workers[0].complete());
    await waitForComplete();
});

it('converts another audio track when the user chooses it', async () => {
    const host = new TestHost();
    host.autoComplete = false;
    const trackIndexes: number[] = [];
    const transcodeAudio = host.transcodeAudio;
    host.transcodeAudio = (options) => {
        trackIndexes.push(options.trackIndex);
        return transcodeAudio(options);
    };
    await render(file('a', 2), host);
    await waitForState('transcoding');
    const output = container.querySelector('output')!;
    expect(output.getAttribute('data-tracks')).toBe('2');
    expect(output.getAttribute('data-selected')).toBe('0');
    expect(output.getAttribute('data-attempt')).toBe('1');

    await click('[data-select-second]');
    await waitForWorker(host, 1);
    expect(trackIndexes).toEqual([0, 1]);
    expect(output.getAttribute('data-selected')).toBe('1');
    expect(output.getAttribute('data-attempt')).toBe('2');
    expect(state()).toBe('transcoding');

    // Choosing the track that is already converting must not throw that work away.
    await click('[data-select-second]');
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(trackIndexes).toEqual([0, 1]);
    expect(host.workers).toHaveLength(2);
});

const recordTrackIndexes = (host: TestHost) => {
    const trackIndexes: number[] = [];
    const transcodeAudio = host.transcodeAudio;
    host.transcodeAudio = (options) => {
        trackIndexes.push(options.trackIndex);
        return transcodeAudio(options);
    };
    return trackIndexes;
};

it('restarts conversion only once when the same track is chosen twice before a re-render', async () => {
    const host = new TestHost();
    host.autoComplete = false;
    const trackIndexes = recordTrackIndexes(host);
    await render(file('a', 2), host);
    await waitForWorker(host);
    await click('[data-select-second-twice]');
    await waitForWorker(host, 1);
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(trackIndexes).toEqual([0, 1]);
});

it('ignores a playback failure from the conversion a track switch replaced', async () => {
    const host = new TestHost();
    host.autoComplete = false;
    await render(file('a', 2), host);
    await waitForWorker(host);
    await click('[data-switch-then-old-failure]');
    await waitForWorker(host, 1);
    expect(state()).toBe('transcoding');
    expect(host.workers[1].active).toBe(true);
    expect(container.querySelector('output')!.getAttribute('data-selected')).toBe('1');
});

it('plays the native track until another is chosen, and stops converting when it is chosen again', async () => {
    const host = new TestHost();
    host.autoComplete = false;
    const output = () => container.querySelector('output')!;
    // The browser decodes Opus itself, so the second track plays natively.
    await render(fileWithTracks('a', ['ac-3', 'Opus']), host);
    await waitFor(() => output().getAttribute('data-tracks') === '2');
    expect(output().getAttribute('data-selected')).toBe('1');
    expect(output().getAttribute('data-required')).toBe('false');
    expect(state()).toBe('idle');
    expect(host.workers).toHaveLength(0);

    await click('[data-select-first]');
    await waitForWorker(host);
    expect(state()).toBe('transcoding');
    expect(output().getAttribute('data-required')).toBe('true');

    await click('[data-select-second]');
    expect(state()).toBe('idle');
    expect(output().getAttribute('data-required')).toBe('false');
    expect(host.workers[0].active).toBe(false);
});

it('converts another track after the first conversion finished', async () => {
    const host = new TestHost();
    const trackIndexes = recordTrackIndexes(host);
    await render(file('a', 2), host);
    await waitForComplete();
    await click('[data-select-second]');
    await waitForWorker(host, 1);
    await waitForComplete();
    expect(trackIndexes).toEqual([0, 1]);
    expect(container.querySelector('output')!.getAttribute('data-selected')).toBe('1');
});

it('retries the chosen track after its conversion failed', async () => {
    const host = new TestHost();
    host.autoComplete = false;
    const trackIndexes = recordTrackIndexes(host);
    await render(file('a', 2), host);
    await waitForWorker(host);
    await click('[data-fail]');
    expect(state()).toBe('failed');
    await click('[data-select-first]');
    await waitForWorker(host, 1);
    expect(trackIndexes).toEqual([0, 0]);
    expect(state()).toBe('transcoding');
});

it('offers no track choice when converted audio cannot play', async () => {
    const host = new TestHost();
    host.supportsAudioPlayback = () => false;
    await render(file('a', 2), host);
    await waitForRequirement();
    expect(container.querySelector('output')!.getAttribute('data-tracks')).toBeNull();
    await click('[data-select-second]');
    expect(host.workers).toHaveLength(0);
});

it('retains complete audio for mining and clears it when the file changes', async () => {
    const host = new TestHost();
    await render(file('a'), host);
    await waitForState('ready');
    expect(container.querySelector('output')!.getAttribute('data-bytes')).toBe(String(webmHeader.length + 3));
    await waitForComplete();
    expect(host.workers[0].active).toBe(false);
    await render(undefined, host);
    expect(state()).toBe('idle');
    expect(container.querySelector('output')!.getAttribute('data-required')).toBe('false');
    expect(container.querySelector('output')!.textContent).toBe('');
    expect(container.querySelector('output')!.getAttribute('data-bytes')).toBeNull();
});

it('makes the prefix available while conversion remains incomplete', async () => {
    const host = new TestHost();
    host.autoComplete = false;
    await render(file('a'), host);
    await waitForWorker(host);
    await act(async () => host.workers[0].chunk(new Uint8Array([4, 5]).buffer));
    expect(state()).toBe('transcoding');
    expect(container.querySelector('output')!.getAttribute('data-complete')).toBe('false');
    expect(container.querySelector('output')!.getAttribute('data-bytes')).toBe(String(webmHeader.length + 2));
    expect(host.workers[0].active).toBe(true);
    await act(async () => host.workers[0].complete());
    await waitForComplete();
});

it.each(['file change', 'unmount'])('terminates a native conversion on %s', async (action) => {
    const host = new TestHost();
    host.autoComplete = false;
    await render(file('a'), host);
    await waitForWorker(host);
    if (action === 'file change') {
        await render(file('b'), host);
    } else {
        await act(async () => root.unmount());
        root = createRoot(container);
    }
    expect(host.workers[0].active).toBe(false);
    await act(async () => host.workers[0].complete());
    expect(container.querySelector('output')?.getAttribute('data-bytes')).toBeFalsy();
    if (action === 'file change') {
        // The new file's conversion starts on its own with a fresh session.
        await waitForWorker(host, 1);
        expect(state()).toBe('transcoding');
    }
});

it('retains the conversion requirement without starting a worker when WebM Opus is unsupported', async () => {
    const host = new TestHost();
    host.supportsAudioPlayback = () => false;
    await render(file('a'), host);
    await waitForRequirement();
    expect(state()).toBe('idle');
    expect(container.querySelector('output')!.textContent).toBe('AC-3');
    expect(host.workers).toHaveLength(0);
});

it('reports a runtime download failure instead of silently disabling conversion', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const host = new TestHost();
    host.prepareError = new TypeError('Failed to fetch');
    await render(file('a'), host);
    await waitForState('failed');
    expect(container.querySelector('output')!.getAttribute('data-required')).toBe('true');
    expect(container.querySelector('output')!.getAttribute('data-error')).toContain('Failed to fetch');
    expect(host.workers).toHaveLength(0);
});

it('terminates conversion when streamed playback fails and retains the failure', async () => {
    const host = new TestHost();
    host.autoComplete = false;
    await render(file('a'), host);
    await waitForWorker(host);
    await click('[data-fail]');
    expect(state()).toBe('failed');
    expect(host.workers[0].active).toBe(false);
    expect(container.querySelector('output')!.getAttribute('data-bytes')).toBeNull();
    expect(container.querySelector('output')!.getAttribute('data-error')).toContain('Playback failed');
});

it('dismisses the notice without clearing the failure and shows a new failure for the next file', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const host = new TestHost();
    host.error = 'Invalid media';
    await render(file('a'), host);
    await waitForState('failed');
    expect(container.querySelector('output')!.getAttribute('data-error')).toContain('Invalid media');
    await click('[aria-label="Close"]');
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(state()).toBe('failed');
    expect(container.querySelector('output')!.getAttribute('data-error')).toContain('Invalid media');
    expect(container.querySelector('output')!.getAttribute('data-required')).toBe('true');
    expect(host.workers).toHaveLength(1);
    await render(file('b'), host);
    await waitForWorker(host, 1);
    await waitForState('failed');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it('labels track choices so no two look the same', () => {
    expect(
        convertedAudioTrackModels([
            { index: 0, codec: 'eac3', language: 'eng', name: 'English' },
            { index: 1, codec: 'eac3', language: 'dut', name: '' },
        ])
    ).toEqual([
        { id: 'converted-0', language: 'eng', label: 'English' },
        { id: 'converted-1', language: 'dut', label: '#2' },
    ]);
    // A generated suffix must not collide with a name that already looks like one.
    const labels = convertedAudioTrackModels([
        { index: 0, codec: 'eac3', language: 'eng', name: 'Stereo' },
        { index: 1, codec: 'eac3', language: 'eng', name: 'Stereo' },
        { index: 2, codec: 'eac3', language: 'eng', name: 'Stereo #1' },
    ]).map(({ label }) => label);
    expect(labels).toEqual(['Stereo #1', 'Stereo #2', 'Stereo #1 #3']);
    // The menu collapses whitespace, so names differing only in spacing look the same.
    expect(
        convertedAudioTrackModels([
            { index: 0, codec: 'eac3', language: 'eng', name: 'Director  Commentary' },
            { index: 1, codec: 'eac3', language: 'eng', name: 'Director Commentary' },
        ]).map(({ label }) => label)
    ).toEqual(['Director Commentary #1', 'Director Commentary #2']);
});
