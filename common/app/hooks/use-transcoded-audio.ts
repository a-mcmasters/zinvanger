import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioTranscodeHost, AudioConversion } from '@project/common/audio-transcode';
import type { FileWithId } from '@project/common/file-selector';
import { audioCodecDisplayName, probeAudioTrackChoices } from '@project/common/media-probe';
import type { ProbedAudioTrack } from '@project/common/media-probe';
import type { AudioTrackModel } from '@project/common';
import { asbError, asbTrace, asbWarn } from '@project/common/util/log';

export const convertedAudioTrackPrefix = 'converted-';
/** Audio-track menu id for a converted track, distinct from the video element's own track ids. */
export const convertedAudioTrackId = (index: number) => `${convertedAudioTrackPrefix}${index}`;

/** Menu entries for choosing which track to convert, labelled so no two look the same. */
export const convertedAudioTrackModels = (tracks: ProbedAudioTrack[]): AudioTrackModel[] => {
    const named = tracks.map(({ index, language, name }) => ({
        id: convertedAudioTrackId(index),
        language: language ?? '',
        // Blank or zero-padded names fall back to the track number; whitespace collapses as the menu renders it.
        label: name?.replace(/\s+/g, ' ').trim() || `#${index + 1}`,
        number: index + 1,
    }));
    // If any would look identical, e.g. two "eng Stereo", every label gets its track number, which keeps them
    // unique even when a name already ends in something like "#1".
    const ambiguous = named.some((track, i) =>
        named.some((other, j) => i !== j && other.language === track.language && other.label === track.label)
    );
    return named.map(({ number, ...track }) => (ambiguous ? { ...track, label: `${track.label} #${number}` } : track));
};

type TranscodedAudio = AudioConversion & {
    /** The original audio cannot be recorded, even if conversion is unavailable or fails. */
    readonly required: boolean;
    /** Display name of the codec the browser cannot decode, e.g. "E-AC-3". */
    readonly codecName?: string;
    /** Every audio track in the file when conversion is required, for choosing which one to convert. */
    readonly tracks?: ProbedAudioTrack[];
    readonly selectedTrackIndex?: number;
    /** Changes with every conversion started, so playback can tell a superseded conversion's events apart. */
    readonly attempt: number;
    /** @returns whether conversion (re)started; false for a repeat of the current track or an unusable choice */
    readonly selectTrack: (index: number) => boolean;
    /**
     * Fails the current conversion. With an `attempt`, only if that is still the current conversion,
     * since audio from one a track switch replaced may report errors after the switch.
     */
    readonly fail: (error: unknown, attempt?: number) => void;
};

/**
 * Detects audio tracks the browser cannot decode - Dolby formats like E-AC-3, most commonly - and
 * automatically transcodes the first one into a playable format in the background. Another track
 * can be chosen with `selectTrack`, which restarts the conversion for that track.
 *
 * When the browser plays one track itself, nothing is converted until another track is chosen;
 * choosing the native track again stops conversion and returns to the browser's own audio.
 */
export const useTranscodedAudio = (
    videoFile: FileWithId | undefined,
    host: AudioTranscodeHost | undefined
): TranscodedAudio => {
    const [conversion, setConversion] = useState<AudioConversion>({ state: 'idle' });
    const [tracks, setTracks] = useState<ProbedAudioTrack[]>();
    const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>();
    // Converted audio can play, so choosing a track does something.
    const [selectable, setSelectable] = useState(false);
    // Read synchronously so two choices delivered before a re-render don't both restart conversion.
    const selectionRef = useRef<{ index?: number; failed: boolean }>({ failed: false });
    const abortControllerRef = useRef<AbortController>(undefined);
    const [attempt, setAttempt] = useState(0);
    // Advanced synchronously, so a failure report handled before the next render is checked correctly.
    const attemptRef = useRef(0);

    /** Never rejects: failures become the 'failed' state unless the conversion was superseded. */
    const convert = useCallback(async (videoFile: FileWithId, trackIndex: number, host: AudioTranscodeHost) => {
        const abortController = new AbortController();
        abortControllerRef.current?.abort();
        abortControllerRef.current = abortController;
        const { signal } = abortController;
        setAttempt(++attemptRef.current);
        setConversion({ state: 'transcoding' });

        try {
            const blob = await host.transcodeAudio({
                file: videoFile.file,
                fileId: videoFile.id,
                trackIndex,
                onAudio: (audio) => {
                    if (signal.aborted) return;
                    setConversion({ state: 'transcoding', blob: audio });
                },
                signal,
            });
            if (signal.aborted) return;

            setConversion({ state: 'ready', blob });
            asbTrace('audio/transcode', 'Converted audio is ready for playback', {
                fileId: videoFile.id,
                outputBytes: blob.size,
            });
        } catch (error) {
            if (signal.aborted) return;
            asbError('audio/transcode', 'Failed to transcode audio', {
                fileId: videoFile.id,
                trackIndex,
                errorCode: error instanceof Error && 'code' in error ? error.code : undefined,
                error,
            });
            selectionRef.current.failed = true;
            setConversion({ state: 'failed', error });
        }
    }, []);

    useEffect(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = undefined;
        setConversion({ state: 'idle' });
        setTracks(undefined);
        setSelectedTrackIndex(undefined);
        setSelectable(false);
        selectionRef.current = { failed: false };
        if (videoFile === undefined || host === undefined) return;

        let cancelled = false;
        const detectAndConvert = async () => {
            let track: ProbedAudioTrack | undefined;
            try {
                const tracks = await probeAudioTrackChoices(videoFile.file);
                track = tracks?.find(({ native }) => native) ?? tracks?.[0];
                if (cancelled || tracks === undefined || track === undefined) return;
                // Mining must avoid the original track even when conversion cannot start.
                setTracks(tracks);
                setSelectedTrackIndex(track.index);
                selectionRef.current.index = track.index;
                if (!host.supportsAudioPlayback()) {
                    asbWarn('audio/transcode', 'Skipping audio conversion: converted audio playback is unsupported', {
                        fileId: videoFile.id,
                        codec: track.codec,
                    });
                    return;
                }
            } catch (error) {
                if (!cancelled) {
                    asbWarn('audio/transcode', 'Could not determine whether audio needs conversion', {
                        fileId: videoFile.id,
                        error,
                    });
                }
                return;
            }
            setSelectable(true);
            if (track.native) return;
            asbTrace('audio/transcode', 'Starting audio conversion', {
                fileId: videoFile.id,
                trackIndex: track.index,
                codec: track.codec,
            });
            await convert(videoFile, track.index, host);
        };
        void detectAndConvert();

        return () => {
            cancelled = true;
            abortControllerRef.current?.abort();
        };
    }, [videoFile, host, convert]);

    const selectTrack = useCallback(
        (index: number) => {
            if (
                videoFile === undefined ||
                host === undefined ||
                !selectable ||
                !tracks?.some((track) => track.index === index) ||
                (index === selectionRef.current.index && !selectionRef.current.failed)
            ) {
                return false;
            }
            selectionRef.current = { index, failed: false };
            setSelectedTrackIndex(index);
            if (tracks?.find((track) => track.index === index)?.native) {
                // Back to the browser's own audio; the new attempt disowns the stopped conversion's failures.
                abortControllerRef.current?.abort();
                abortControllerRef.current = undefined;
                setAttempt(++attemptRef.current);
                setConversion({ state: 'idle' });
                return true;
            }
            asbTrace('audio/transcode', 'Converting the chosen audio track', {
                fileId: videoFile.id,
                trackIndex: index,
            });
            void convert(videoFile, index, host);
            return true;
        },
        [videoFile, host, tracks, selectable, convert]
    );

    const fail = useCallback((error: unknown, attempt?: number) => {
        if (attempt !== undefined && attempt !== attemptRef.current) return;
        abortControllerRef.current?.abort();
        abortControllerRef.current = undefined;
        selectionRef.current.failed = true;
        setConversion({ state: 'failed', error });
    }, []);

    const track = tracks?.find(({ index }) => index === selectedTrackIndex);
    return useMemo(
        () => ({
            ...conversion,
            required: track !== undefined && !track.native,
            codecName: track === undefined ? undefined : audioCodecDisplayName(track.codec),
            tracks: selectable ? tracks : undefined,
            selectedTrackIndex,
            attempt,
            selectTrack,
            fail,
        }),
        [conversion, track, tracks, selectable, selectedTrackIndex, attempt, selectTrack, fail]
    );
};
