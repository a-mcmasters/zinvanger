import { useCallback, useEffect, useState } from 'react';
import type { FileModel, TranscodedAudioModel } from '@project/common';
import type { AudioClip } from '@project/common/audio-clip';
import { asbInfo } from '@project/common/util/log';

/** Bound dialog timestamps to the native file or the captured converted-audio snapshot. */
export const useClampTimestampInterval = ({
    open,
    audioClip,
    source,
}: {
    open: boolean;
    audioClip: Pick<AudioClip, 'sourceDurationMs'> | undefined;
    source: FileModel | TranscodedAudioModel | undefined;
}) => {
    const [duration, setDuration] = useState<{ source: NonNullable<typeof source>; durationMs: number | undefined }>();
    useEffect(() => {
        if (!open || !audioClip || !source) return;
        const controller = new AbortController();
        void audioClip
            .sourceDurationMs(controller.signal)
            .then((durationMs) => {
                if (!controller.signal.aborted) {
                    setDuration({ source, durationMs: durationMs !== undefined ? Math.floor(durationMs) : undefined });
                }
            })
            .catch((error) => {
                if (!controller.signal.aborted) asbInfo('anki/ui', error);
            });
        return () => controller.abort();
    }, [open, audioClip, source]);
    const end = duration?.source === source ? duration?.durationMs : undefined;
    return useCallback(
        (interval: number[]) =>
            end === undefined ? interval : interval.map((timestamp) => Math.max(0, Math.min(end, timestamp))),
        [end]
    );
};
