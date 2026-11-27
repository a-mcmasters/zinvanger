---
sidebar_position: 1
---

import project from '@site/src/project';

# Loading subtitles {#loading-subtitles}

The first step to using asbplayer is to load subtitles onto a video source.

## Streaming video {#streaming-video}

### Chrome (or other Chromium-based browsers) {#chromium}

1. Follow the <a href={`${project.urls.repo}#install-the-chrome-extension`}>Zinvanger installation instructions</a> to load the extension in Chrome.
2. Click 🧩 icon in browser toolbar → asbplayer → **Open Side Panel**
3. Click **Load Subtitles** to load subtitles onto any video on the current page.

### Firefox {#firefox}

:::warning
asbplayer is missing some features on Firefox. See the [Compatibility](../compatibility.md#extension) section.  
:::

1. Install the the Firefox addon from the Mozilla <a href={project.extension.firefox.storeUrl}>addon store</a> or from the <a href={`${project.urls.upstreamReleases}/latest`}>upstream asbplayer release</a>.
2. Click 🧩 icon in browser toolbar → asbplayer → **Open Side Panel**
3. Click **Load Subtitles** to load subtitles onto any video on the current page.

### Android {#android}

See the [Android guide](../guides/android.md).

## Video files {#video-files}

1. Open the <a href={project.urls.app}>website</a>.
2. Drag-and-drop video and subtitle files into the website.

The website remembers the subtitle files you loaded for each video. Next time you open the same video file on its own, they load again. It matches videos by file name and size, and keeps the 50 most recent videos. Subtitles larger than 20 MB in total for one video aren't remembered.
