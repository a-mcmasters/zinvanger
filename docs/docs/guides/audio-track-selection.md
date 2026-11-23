---
sidebar_position: 10
---

# Audio track selection {#audio-track-selection}

Some video files have multiple audio tracks, for example the original language plus dubs. On the website, the audio track button in the video controls lets you choose between them when at least one track is in a format your browser can't play and asbplayer converts (Dolby Digital / Digital Plus, DTS or Dolby TrueHD, see [compatibility](../compatibility.md)). A track the browser plays itself needs no conversion; choosing a converted track takes a moment to start, and switching restarts its conversion from the beginning.

For files whose tracks the browser can all play, the selector is only available when the **Experimental Web Platform features** flag is enabled from `chrome://flags` (or equivalent for the current browser).

:::warning
As of this writing **Experimental Web Platform features** completely breaks the browser extension for streaming video (on some websites, maybe all). Enable this flag at your own risk.
:::
