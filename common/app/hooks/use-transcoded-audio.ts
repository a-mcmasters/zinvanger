import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioTranscodeHost, AudioConversion } from '@project/common/audio-transcode';
import type { FileWithId } from '@project/common/file-selector';
import { audioCodecDisplayName, audioTracksRequiringTranscode } from '@project/common/media-probe';
import type { ProbedAudioTrack } from '@project/common/media-probe';
import { asbError, asbTrace, asbWarn } from '@project/common/util/log';

type TranscodedAudio = AudioConversion & {
    /** The original audio cannot be recorded, even if conversion is unavailable or fails. */
    readonly required: boolean;
    /** Display name of the codec the browser cannot decode, e.g. "E-AC-3". */
    readonly codecName?: string;
    /** Every audio track in the file when conversion is required, for choosing which one to convert. */
    readonly tracks?: ProbedAudioTrack[];
    readonly selectedTrackIndex?: number;
    readonly selectTrack: (index: number) => void;
    readonly fail: (error: unknown) => void;
};

/**
 * Detects audio tracks the browser cannot decode - Dolby formats like E-AC-3, most commonly - and
 * automatically transcodes the first one into a playable format in the background. Another track
 * can be chosen with `selectTrack`, which restarts the conversion for that track.
 */
export const useTranscodedAudio = (
    videoFile: FileWithId | undefined,
    host: AudioTranscodeHost | undefined
): TranscodedAudio => {
    const [conversion, setConversion] = useState<AudioConversion>({ state: 'idle' });
    const [tracks, setTracks] = useState<ProbedAudioTrack[]>();
    const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>();
    const abortControllerRef = useRef<AbortController>(undefined);

    /** Never rejects: failures become the 'failed' state unless the conversion was superseded. */
    const convert = useCallback(async (videoFile: FileWithId, trackIndex: number, host: AudioTranscodeHost) => {
        const abortController = new AbortController();
        abortControllerRef.current?.abort();
        abortControllerRef.current = abortController;
        const { signal } = abortController;
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
            setConversion({ state: 'failed', error });
        }
    }, []);

    useEffect(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = undefined;
        setConversion({ state: 'idle' });
        setTracks(undefined);
        setSelectedTrackIndex(undefined);
        if (videoFile === undefined || host === undefined) return;

        let cancelled = false;
        const detectAndConvert = async () => {
            let track: ProbedAudioTrack | undefined;
            try {
                const tracks = await audioTracksRequiringTranscode(videoFile.file);
                track = tracks?.[0];
                if (cancelled || tracks === undefined || track === undefined) return;
                // Mining must avoid the original track even when conversion cannot start.
                setTracks(tracks);
                setSelectedTrackIndex(track.index);
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
                !host.supportsAudioPlayback() ||
                !tracks?.some((track) => track.index === index) ||
                (index === selectedTrackIndex && conversion.state !== 'failed')
            ) {
                return;
            }
            setSelectedTrackIndex(index);
            asbTrace('audio/transcode', 'Converting the chosen audio track', {
                fileId: videoFile.id,
                trackIndex: index,
            });
            void convert(videoFile, index, host);
        },
        [videoFile, host, tracks, selectedTrackIndex, conversion.state, convert]
    );

    const fail = useCallback((error: unknown) => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = undefined;
        setConversion({ state: 'failed', error });
    }, []);

    const track = tracks?.find(({ index }) => index === selectedTrackIndex);
    return useMemo(
        () => ({
            ...conversion,
            required: track !== undefined,
            codecName: track === undefined ? undefined : audioCodecDisplayName(track.codec),
            tracks,
            selectedTrackIndex,
            selectTrack,
            fail,
        }),
        [conversion, track, tracks, selectedTrackIndex, selectTrack, fail]
    );
};
