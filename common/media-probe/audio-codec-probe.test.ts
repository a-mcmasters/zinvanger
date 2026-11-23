import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { audioCodecDisplayName, probeAudioTrackChoices } from '@project/common/media-probe/audio-codec-probe';
import ByteReader from '@project/common/media-probe/byte-reader';
import { matroskaAudioTracks } from '@project/common/media-probe/matroska';
import { isoBmffAudioSampleFormats } from '@project/common/media-probe/iso-bmff';
import { TextDecoder, TextEncoder } from 'util';

// jsdom's Blob does not implement arrayBuffer(), and jsdom lacks the encoding APIs.
beforeAll(() => {
    globalThis.TextDecoder ??= TextDecoder as typeof globalThis.TextDecoder;
    globalThis.TextEncoder ??= TextEncoder as typeof globalThis.TextEncoder;
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

const concat = (...parts: (Uint8Array | number[])[]) => {
    const arrays = parts.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)));
    const result = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
    let offset = 0;

    for (const array of arrays) {
        result.set(array, offset);
        offset += array.length;
    }

    return result;
};

const ascii = (text: string) => new Uint8Array([...text].map((character) => character.charCodeAt(0)));

const blobOf = (bytes: Uint8Array) => new Blob([bytes]);

// Matroska

const ebmlSize = (size: number) => {
    if (size < 0x7f) {
        return new Uint8Array([0x80 | size]);
    }

    if (size < 0x3fff) {
        return new Uint8Array([0x40 | (size >> 8), size & 0xff]);
    }

    return new Uint8Array([0x10 | ((size >> 24) & 0x0f), (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff]);
};

const ebmlElement = (id: number[], data: Uint8Array) => concat(id, ebmlSize(data.length), data);

const trackEntry = (trackType: number, codecId: string, extra: Uint8Array = new Uint8Array()) =>
    ebmlElement(
        [0xae],
        concat(ebmlElement([0x83], new Uint8Array([trackType])), ebmlElement([0x86], ascii(codecId)), extra)
    );

const matroskaFile = ({
    audioCodecIds,
    withVideoTrack = true,
    paddingElements = 1,
}: {
    audioCodecIds: string[];
    withVideoTrack?: boolean;
    paddingElements?: number;
}) =>
    concat(
        ebmlElement([0x1a, 0x45, 0xdf, 0xa3], ascii('ebml')),
        ebmlElement(
            [0x18, 0x53, 0x80, 0x67],
            concat(
                // Void elements, so the walk has to skip padding to reach Tracks.
                ...Array.from({ length: paddingElements }, () => ebmlElement([0xec], new Uint8Array(32))),
                ebmlElement(
                    [0x16, 0x54, 0xae, 0x6b],
                    concat(
                        ...(withVideoTrack ? [trackEntry(1, 'V_MPEG4/ISO/AVC')] : []),
                        ...audioCodecIds.map((codecId) => trackEntry(2, codecId))
                    )
                )
            )
        )
    );

// ISO base media file format

const box = (type: string, data: Uint8Array) => {
    const size = 8 + data.length;
    return concat([(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff], ascii(type), data);
};

const trak = (handler: string, sampleEntry: Uint8Array) =>
    box(
        'trak',
        box(
            'mdia',
            concat(
                box('hdlr', concat(new Uint8Array(8), ascii(handler))),
                box(
                    'minf',
                    box(
                        'stbl',
                        box(
                            'stsd',
                            concat(
                                new Uint8Array(4), // version and flags
                                new Uint8Array([0, 0, 0, 1]), // entry count
                                sampleEntry
                            )
                        )
                    )
                )
            )
        )
    );

const isoBmffFile = ({
    audioSampleFormats,
    moovAtEnd = false,
    paddingBoxes = 0,
}: {
    audioSampleFormats: string[];
    moovAtEnd?: boolean;
    paddingBoxes?: number;
}) => {
    const moov = box(
        'moov',
        concat(
            trak('vide', box('avc1', new Uint8Array(20))),
            ...audioSampleFormats.map((format) => trak('soun', box(format, new Uint8Array(28))))
        )
    );
    const ftyp = box('ftyp', ascii('isom'));
    const mdat = box('mdat', new Uint8Array(64));
    const padding = concat(...Array.from({ length: paddingBoxes }, () => box('free', new Uint8Array())));
    return moovAtEnd ? concat(ftyp, mdat, padding, moov) : concat(ftyp, padding, moov, mdat);
};

// FFmpeg writes padded MPEG-4 descriptor lengths, including for DTS in mp4a.
const descriptor = (tag: number, data: Uint8Array, padded = true) => {
    const length = [data.length & 0x7f];
    for (let remaining = data.length >>> 7; remaining > 0; remaining >>>= 7) {
        length.unshift(0x80 | (remaining & 0x7f));
    }
    while (padded && length.length < 4) length.unshift(0x80);
    return concat([tag, ...length], data);
};
const mp4aFile = (
    objectType: number,
    esFlags: number,
    {
        paddedDescriptors = true,
        soundVersion = 0,
        wave = false,
        url = 'url',
    }: { paddedDescriptors?: boolean; soundVersion?: number; wave?: boolean; url?: string } = {}
) => {
    const decoder = descriptor(4, concat([objectType, 0x15], new Uint8Array(11)), paddedDescriptors);
    const es = descriptor(
        3,
        concat(
            [0, 1, esFlags],
            ...(esFlags & 0x80 ? [new Uint8Array([0, 1])] : []),
            ...(esFlags & 0x40 ? [concat([url.length], ascii(url))] : []),
            ...(esFlags & 0x20 ? [new Uint8Array([0, 1])] : []),
            decoder,
            descriptor(6, new Uint8Array([2]), paddedDescriptors)
        ),
        paddedDescriptors
    );
    const header = new Uint8Array(soundVersion === 1 ? 44 : soundVersion === 2 ? 64 : 28);
    header.set([0, soundVersion], 8);
    const esds = box('esds', concat(new Uint8Array(4), es));
    const entry = box('mp4a', concat(header, wave ? box('wave', esds) : esds));
    return concat(box('ftyp', ascii('isom')), box('moov', trak('soun', entry)));
};

describe('audio container parsing', () => {
    it('reads Matroska audio track languages and names, preferring the BCP 47 language', async () => {
        const utf8 = (text: string) => new TextEncoder().encode(text);
        const file = concat(
            ebmlElement([0x1a, 0x45, 0xdf, 0xa3], ascii('ebml')),
            ebmlElement(
                [0x18, 0x53, 0x80, 0x67],
                ebmlElement(
                    [0x16, 0x54, 0xae, 0x6b],
                    concat(
                        trackEntry(2, 'A_EAC3', ebmlElement([0x22, 0xb5, 0x9c], ascii('eng'))),
                        trackEntry(
                            2,
                            'A_EAC3',
                            concat(
                                ebmlElement([0x22, 0xb5, 0x9c], ascii('dut')),
                                ebmlElement([0x22, 0xb5, 0x9d], ascii('nl')),
                                ebmlElement([0x53, 0x6e], utf8('Nederlands™'))
                            )
                        )
                    )
                )
            )
        );
        expect(await matroskaAudioTracks(new ByteReader(blobOf(file)))).toEqual([
            { codecId: 'A_EAC3', language: 'eng', name: undefined },
            { codecId: 'A_EAC3', language: 'nl', name: 'Nederlands™' },
        ]);
    });

    it('reads Matroska audio tracks in order, ignoring the video track', async () => {
        for (const audioCodecIds of [[], ['A_EAC3'], ['A_AAC', 'A_EAC3', 'A_DTS']]) {
            const reader = new ByteReader(blobOf(matroskaFile({ audioCodecIds })));
            expect((await matroskaAudioTracks(reader))?.map(({ codecId }) => codecId)).toEqual(audioCodecIds);
        }
    });

    it('reads MP4 audio sample formats with either a leading or trailing moov', async () => {
        for (const audioSampleFormats of [[], ['ec-3'], ['mp4a', 'ac-3', 'dtsc']]) {
            for (const moovAtEnd of [false, true]) {
                const reader = new ByteReader(blobOf(isoBmffFile({ audioSampleFormats, moovAtEnd })));
                expect(await isoBmffAudioSampleFormats(reader)).toEqual(audioSampleFormats);
            }
        }
    });

    it.each([
        { lengthBytes: 1, esFlags: 0, url: 'url' },
        { lengthBytes: 2, esFlags: 0xe0, url: 'u'.repeat(128) },
    ])('reads mp4a descriptors with compact $lengthBytes-byte lengths', async ({ esFlags, url }) => {
        const reader = new ByteReader(blobOf(mp4aFile(0xa9, esFlags, { paddedDescriptors: false, url })));
        expect(await isoBmffAudioSampleFormats(reader)).toEqual(['dtsc']);
    });

    it.each([
        { soundVersion: 0, wave: true },
        { soundVersion: 1, wave: false },
        { soundVersion: 1, wave: true },
        { soundVersion: 2, wave: false },
        { soundVersion: 2, wave: true },
    ])('reads QuickTime sound version $soundVersion with wave=$wave', async ({ soundVersion, wave }) => {
        const reader = new ByteReader(blobOf(mp4aFile(0xa9, 0, { soundVersion, wave })));
        expect(await isoBmffAudioSampleFormats(reader)).toEqual(['dtsc']);
    });

    it('leaves an unsupported QuickTime sound version unresolved', async () => {
        const reader = new ByteReader(blobOf(mp4aFile(0xa9, 0, { soundVersion: 3 })));
        expect(await isoBmffAudioSampleFormats(reader)).toEqual(['mp4a']);
    });
});

describe('probeAudioTrackChoices', () => {
    // Like Chrome: opens the containers, decodes nothing patent-encumbered.
    const playsContainersButNoDolby = (playableContainers = ['video/x-matroska', 'video/mp4']) =>
        jest
            .spyOn(HTMLMediaElement.prototype, 'canPlayType')
            .mockImplementation((type) => (playableContainers.includes(type) ? 'maybe' : ''));

    it.each(['A_AAC', 'A_OPUS'])(
        'leaves %s audio alone without requiring advertised codec support',
        async (codecId) => {
            playsContainersButNoDolby();
            expect(await probeAudioTrackChoices(blobOf(matroskaFile({ audioCodecIds: [codecId] })))).toBeUndefined();
        }
    );

    it.each(['maybe', 'probably'] as const)(
        'leaves Dolby audio alone when the browser reports %s support',
        async (support) => {
            jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) =>
                type === 'video/mp4' ? 'maybe' : type === 'audio/mp4; codecs="ec-3"' ? support : ''
            );
            expect(await probeAudioTrackChoices(blobOf(isoBmffFile({ audioSampleFormats: ['ec-3'] })))).toBeUndefined();
        }
    );

    it('detects Matroska audio after more than 4096 padding elements', async () => {
        playsContainersButNoDolby();
        const file = matroskaFile({ audioCodecIds: ['A_EAC3'], paddingElements: 4097 });
        expect(await probeAudioTrackChoices(blobOf(file))).toEqual([{ index: 0, codec: 'eac3', language: 'eng' }]);
    });

    it('detects MP4 audio after more than 4096 padding boxes', async () => {
        playsContainersButNoDolby();
        const file = isoBmffFile({ audioSampleFormats: ['ec-3'], moovAtEnd: true, paddingBoxes: 4097 });
        expect(await probeAudioTrackChoices(blobOf(file))).toEqual([{ index: 0, codec: 'eac3' }]);
    });

    it.each([
        ['A_AC3/BSID9', 'ac3'],
        ['A_DTS/EXPRESS', 'dts'],
        ['A_TRUEHD', 'truehd'],
    ])('normalizes Matroska %s for eligibility', async (codecId, codec) => {
        playsContainersButNoDolby();
        expect(await probeAudioTrackChoices(blobOf(matroskaFile({ audioCodecIds: [codecId] })))).toEqual([
            { index: 0, codec, language: 'eng' },
        ]);
    });

    it.each([
        ['ec-3', 'eac3'],
        ['ac-3', 'ac3'],
        ['dtsc', 'dts'],
    ])('normalizes MP4 %s for eligibility', async (format, codec) => {
        playsContainersButNoDolby();
        expect(await probeAudioTrackChoices(blobOf(isoBmffFile({ audioSampleFormats: [format] })))).toEqual([
            { index: 0, codec },
        ]);
    });

    it.each([
        [0xa5, 'ac3'],
        [0xa6, 'eac3'],
        [0xa9, 'dts'],
    ])('identifies object type %i inside an MP4 mp4a entry', async (objectType, codec) => {
        playsContainersButNoDolby();
        expect(await probeAudioTrackChoices(blobOf(mp4aFile(objectType, 0)))).toEqual([{ index: 0, codec }]);
    });

    it('reads a decoder descriptor after the optional ES fields', async () => {
        playsContainersButNoDolby();
        expect(await probeAudioTrackChoices(blobOf(mp4aFile(0xa9, 0xe0)))).toEqual([{ index: 0, codec: 'dts' }]);
    });

    it('leaves ordinary AAC mp4a entries alone', async () => {
        playsContainersButNoDolby();
        expect(await probeAudioTrackChoices(blobOf(mp4aFile(0x40, 0)))).toBeUndefined();
    });

    it('does not identify a codec from a decoder descriptor outside its declared bounds', async () => {
        playsContainersButNoDolby();
        for (const length of [1, 0x7f, 0x80]) {
            const file = mp4aFile(0xa9, 0);
            const decoder = file.findIndex(
                (byte, index) => byte === 4 && file[index + 1] === 0x80 && file[index + 5] === 0xa9
            );
            expect(decoder).toBeGreaterThan(0);
            file[decoder + 4] = length;
            expect(await probeAudioTrackChoices(blobOf(file))).toBeUndefined();
        }
    });

    it('lists every track when the browser can decode none of them', async () => {
        playsContainersButNoDolby();
        const tracks = await probeAudioTrackChoices(blobOf(matroskaFile({ audioCodecIds: ['A_EAC3', 'A_DTS'] })));
        expect(tracks).toEqual([
            { index: 0, codec: 'eac3', language: 'eng' },
            { index: 1, codec: 'dts', language: 'eng' },
        ]);
    });

    // Browsers play the first track they can decode, but the others are only reachable by converting them.
    it('marks the track the browser plays natively when it can decode one of several', async () => {
        playsContainersButNoDolby();
        const tracks = await probeAudioTrackChoices(
            blobOf(matroskaFile({ audioCodecIds: ['A_EAC3', 'A_AAC', 'A_AC3'] }))
        );
        expect(tracks?.map(({ codec, native }) => ({ codec, native }))).toEqual([
            { codec: 'eac3', native: undefined },
            { codec: 'aac', native: true },
            { codec: 'ac3', native: undefined },
        ]);
    });

    it('offers only the native track and the ones FFmpeg can convert', async () => {
        playsContainersButNoDolby();
        const tracks = await probeAudioTrackChoices(
            blobOf(matroskaFile({ audioCodecIds: ['A_AAC', 'A_AC3', 'A_OPUS'] }))
        );
        expect(tracks?.map(({ index, codec }) => ({ index, codec }))).toEqual([
            { index: 0, codec: 'aac' },
            { index: 1, codec: 'ac3' },
        ]);
    });

    it('leaves a file alone when no track needs converting', async () => {
        playsContainersButNoDolby();
        expect(
            await probeAudioTrackChoices(blobOf(matroskaFile({ audioCodecIds: ['A_AAC', 'A_AAC'] })))
        ).toBeUndefined();
    });

    it('leaves a file alone when its only track plays natively', async () => {
        playsContainersButNoDolby();
        expect(await probeAudioTrackChoices(blobOf(matroskaFile({ audioCodecIds: ['A_AAC'] })))).toBeUndefined();
    });

    // Converting would leave the user with sound and no picture - Firefox with mkv.
    it('leaves files alone when the browser cannot open the container', async () => {
        playsContainersButNoDolby(['video/mp4']);
        const track = await probeAudioTrackChoices(blobOf(matroskaFile({ audioCodecIds: ['A_EAC3'] })));
        expect(track).toBeUndefined();
    });

    it('leaves files without audio alone', async () => {
        playsContainersButNoDolby();
        expect(await probeAudioTrackChoices(blobOf(matroskaFile({ audioCodecIds: [] })))).toBeUndefined();
    });

    it('leaves containers it cannot parse alone', async () => {
        playsContainersButNoDolby();
        expect(await probeAudioTrackChoices(blobOf(ascii('not a media file')))).toBeUndefined();
    });
});

describe('audioCodecDisplayName', () => {
    it('names the codecs users are likely to see', () => {
        expect(audioCodecDisplayName('eac3')).toBe('E-AC-3');
        expect(audioCodecDisplayName('ac3')).toBe('AC-3');
        expect(audioCodecDisplayName('truehd')).toBe('Dolby TrueHD');
    });

    it('falls back to the codec name', () => {
        expect(audioCodecDisplayName('vorbis')).toBe('VORBIS');
    });
});
