import { readEbmlElement } from '@project/common/media-probe/ebml';
import type { EbmlElement } from '@project/common/media-probe/ebml';
import type ByteReader from '@project/common/media-probe/byte-reader';

// EBML element IDs, with their marker bits left intact as they appear on disk.
const idSegment = 0x18538067;
const idTracks = 0x1654ae6b;
const idTrackEntry = 0xae;
const idTrackType = 0x83;
const idCodecId = 0x86;
const idName = 0x536e;
const idLanguage = 0x22b59c;
const idLanguageBcp47 = 0x22b59d;

const trackTypeAudio = 2;
// Matroska's default when a track has no Language element.
const matroskaDefaultLanguage = 'eng';

export interface MatroskaAudioTrack {
    readonly codecId: string;
    readonly language?: string;
    readonly name?: string;
}

const readString = async (reader: ByteReader, element: EbmlElement) => {
    const bytes = await reader.bytes(element.dataOffset, element.dataSize);
    return bytes && new TextDecoder().decode(bytes).replace(/\0+$/, ''); // Some muxers zero-pad strings.
};

const readTrackEntry = async (reader: ByteReader, entry: EbmlElement) => {
    let offset = entry.dataOffset;
    let trackType: number | undefined;
    let codecId: string | undefined;
    let language: string | undefined;
    let languageBcp47: string | undefined;
    let name: string | undefined;
    while (offset < entry.end) {
        const child = await readEbmlElement(reader, offset, entry.end);
        if (child === undefined) break;
        if (child.id === idTrackType) {
            trackType = await reader.unsignedInt(child.dataOffset, child.dataSize);
        } else if (child.id === idCodecId) {
            codecId = await readString(reader, child);
        } else if (child.id === idLanguage) {
            language = await readString(reader, child);
        } else if (child.id === idLanguageBcp47) {
            languageBcp47 = await readString(reader, child);
        } else if (child.id === idName) {
            name = await readString(reader, child);
        }
        offset = child.end;
    }
    if (trackType !== trackTypeAudio || codecId === undefined) return undefined;
    const track: MatroskaAudioTrack = { codecId, language: languageBcp47 ?? language ?? matroskaDefaultLanguage, name };
    return track;
};

const readTracks = async (reader: ByteReader, tracks: EbmlElement) => {
    const audioTracks: MatroskaAudioTrack[] = [];
    let offset = tracks.dataOffset;
    while (offset < tracks.end) {
        const child = await readEbmlElement(reader, offset, tracks.end);
        if (child === undefined) break;
        if (child.id === idTrackEntry) {
            const track = await readTrackEntry(reader, child);
            if (track !== undefined) audioTracks.push(track);
        }
        offset = child.end;
    }
    return audioTracks;
};

/**
 * Walks Matroska/WebM Segment → Tracks → TrackEntry metadata, selecting audio entries by
 * TrackType and reading their CodecID, language and name.
 *
 * @returns the audio tracks in a Matroska/WebM file, in track order.
 */
export const matroskaAudioTracks = async (reader: ByteReader): Promise<MatroskaAudioTrack[] | undefined> => {
    let offset = 0;
    let limit = reader.size;
    while (offset < limit) {
        const element = await readEbmlElement(reader, offset, limit);
        if (element === undefined) return;
        if (element.id === idTracks) return readTracks(reader, element);
        if (element.id === idSegment) {
            offset = element.dataOffset; // Descend rather than skip - Tracks lives inside Segment.
            limit = element.end;
            continue;
        }
        offset = element.end;
    }
};
