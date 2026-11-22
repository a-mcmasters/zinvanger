export function videolandSubtitleUrlKey(url: string): string {
    // The router and edge hosts can serve the same subtitle segments at the same paths.
    return url.replace(
        /^https:\/\/(?:sr|edge-[a-z0-9-]+)\.vod\.videoland\.bedrock\.tech\//i,
        'https://vod.videoland.bedrock.tech/'
    );
}
