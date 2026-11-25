import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CardModel } from '@project/common';
import { AudioClip } from '@project/common/audio-clip';
import type { AnkiSettings } from '@project/common/settings';
import { asbInfo } from '@project/common/util/log';
import { useClampTimestampInterval } from '@project/common/hooks/use-clamp-timestamp-interval';

interface Recording {
    clip: AudioClip;
    interval: number[];
}

interface AudioSelection {
    interval?: number[];
    recordedClip?: AudioClip;
    pending?: Recording;
    failed?: boolean;
}

export function useAnkiDialogAudio(
    card: CardModel,
    open: boolean,
    settings: AnkiSettings,
    mp3Encoder: (blob: Blob, extension: string) => Promise<Blob>
) {
    const { audioPaddingStart, audioPaddingEnd, preferMp3, recordWithAudioPlayback } = settings;
    const initialClip = useMemo(
        () => AudioClip.fromCard(card, audioPaddingStart, audioPaddingEnd, recordWithAudioPlayback),
        [card, audioPaddingStart, audioPaddingEnd, recordWithAudioPlayback]
    );
    const clampTimestampInterval = useClampTimestampInterval({
        open,
        audioClip: initialClip,
        source: card.audio ? undefined : card.file,
    });
    const makeClip = useCallback(
        (interval?: number[]) => {
            let clip = initialClip;
            if (clip && interval) {
                clip = clip.slice(
                    Math.max(0, Math.round(interval[0]) - audioPaddingStart),
                    Math.round(interval[1]) + audioPaddingEnd
                );
            }
            return preferMp3 ? clip?.toEncoded(mp3Encoder, 'mp3') : clip;
        },
        [initialClip, mp3Encoder, preferMp3, audioPaddingStart, audioPaddingEnd]
    );

    const [selection, setSelection] = useState<AudioSelection>({});
    const { interval, recordedClip, failed } = selection;
    const audioClip = useMemo(() => recordedClip ?? makeClip(interval), [recordedClip, makeClip, interval]);
    const pending = open ? selection.pending : undefined;
    const applyAudioInterval = useCallback((interval: number[]) => {
        setSelection((previous) =>
            previous.interval?.[0] === interval[0] && previous.interval?.[1] === interval[1] ? previous : { interval }
        );
    }, []);

    useEffect(() => {
        setSelection((previous) =>
            previous.pending || previous.recordedClip || previous.failed ? { interval: previous.interval } : previous
        );
    }, [open, makeClip]);

    useEffect(() => {
        // A download or export holds its own reference to the previous clip.
        return () => audioClip?.stop({ preserveCapture: true });
    }, [open, audioClip]);

    useEffect(() => {
        if (!pending) return;
        let cancelled = false;
        void pending.clip.blob().then(
            () => {
                if (cancelled) return;
                setSelection((previous) =>
                    previous.pending === pending ? { interval: pending.interval, recordedClip: pending.clip } : previous
                );
            },
            (error) => {
                if (cancelled) return;
                asbInfo('anki/ui', error);
                setSelection((previous) =>
                    previous.pending === pending ? { ...previous, pending: undefined, failed: true } : previous
                );
            }
        );
        return () => {
            cancelled = true;
            pending.clip.stop();
        };
    }, [pending]);

    const rerecord = useCallback(
        (range: number[]) => {
            const interval = clampTimestampInterval(range);
            if (interval[0] >= interval[1]) return;
            const clip = makeClip(interval);
            if (!clip) return;

            audioClip?.stop({ preserveCapture: true });
            setSelection((previous) => ({ ...previous, pending: { clip, interval }, failed: false }));
        },
        [clampTimestampInterval, makeClip, audioClip]
    );

    return {
        audioClip,
        audioInterval: interval,
        applyAudioInterval,
        rerecord,
        recording: !!pending,
        failed,
        clampTimestampInterval,
    };
}
