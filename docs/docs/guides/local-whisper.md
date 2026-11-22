---
sidebar_position: 12
---

# Local Whisper subtitles and Anki lookups

The local Whisper server generates Dutch subtitles from the audio you hear. This helps when subtitles for a dubbed show follow the original script.

## Generate subtitles from an audio file

Clone the asbplayer fork and run these commands from its root. You need Python and an NVIDIA GPU to transcribe audio. The default model downloads about 3 GB on the first run and needs about 4 GB of GPU memory.

```powershell
python -m venv transcriber/.venv
transcriber/.venv/Scripts/python -m pip install -r transcriber/requirements.txt
transcriber/.venv/Scripts/python transcriber/server.py transcribe episode.m4a --key "<video name>"
transcriber/.venv/Scripts/python transcriber/server.py
```

On Linux or macOS, the virtual environment's Python is at `transcriber/.venv/bin/python`.

Use the video name shown in the **Load Subtitles** picker as the key. The server listens on `127.0.0.1:8767` and writes SRT files to `~/asbplayer-transcripts` by default. Set `ASB_TRANSCRIPTS_DIR` to use another folder.

Open the video in the extension with the server running. Select **Nederlands (Whisper)** in **Load Subtitles**. With [Auto-load detected subtitles](../reference/settings.md#auto-load-detected-subtitles) enabled, asbplayer selects the Whisper track when the site has no saved choice or its first saved language is Dutch. Saved choices for other languages and explicit empty tracks still apply.

In Chrome, **Load Subtitles → Transcribe this episode** records the episode tab. When the site autoplays the next episode, a new recording starts on its own from 0:00. Choose **Finish and transcribe** or **Cancel** to stop. The recording is saved to `asbplayer-transcripts/audio/` every 30 seconds while it plays, so a browser or extension crash loses at most the last 30 seconds. To transcribe a recording that never finished, run `python transcriber/server.py transcribe "<file>.webm" --key "<video name>"`.

## Set up automatic Anki lookups

In the Chromium extension, the Anki dialog fills in the English translation of the mined sentence. After each transcription, the server translates the whole episode once and saves it as `<key>.en.ai.srt`, so opening a card costs nothing. If you save an English subtitle file as `<key>.en.srt` in the transcripts folder, it is used instead, matched to the Dutch lines by time. Only a sentence found in neither file is translated on demand. Translation uses your logged-in Claude Code by default, with its tools turned off. Set `ASB_DEFINE_PROVIDER=codex` before starting the server to use the Codex CLI instead. Codex can still read files on your computer, so a hostile subtitle could make it copy one into a translation. The provider uses your subscription quota. An NVIDIA GPU is only needed for Whisper transcription.

1. Generate a token with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. Before starting the server, set `ASB_LOOKUP_TOKEN` to that token in the same terminal. In PowerShell, use `$env:ASB_LOOKUP_TOKEN = "<token>"`. In Bash, use `export ASB_LOOKUP_TOKEN='<token>'`.
3. In the extension's **Anki** settings, paste the same token into **Local lookup token** and click **Save**.
4. Add a custom asbplayer field named exactly `Sentence Translation` and map it to the corresponding field in your Anki note type. The translation box appears once the mapping is set.
5. Mine a subtitle and open the Anki dialog. Review the translation and edit it before exporting. Fill in the word definition yourself.

The lookup-enabled dialog runs in the extension's own frame, where page-injected dictionary popups are unavailable. Clear the token in **Anki** settings to use the dialog with those popups again.

## Subtitle actions on the video

On desktop, hovering a line in the first subtitle track shows a small action strip below it with **Replay**, **Look up word**, **English** and **Mine**. Playback keeps going unless you have pause-on-hover enabled. Clicking a word, choosing **Look up word** or **English**, or tabbing into the subtitle pauses and keeps that sentence until you resume, seek or press Escape.

- **Replay** plays the sentence once from its start (including your subtitle offset) and pauses at its end. Seeking cancels the pause. It is unavailable while recording.
- **Click a word** to open a card with its meaning in this sentence. **Use as target word** sends the word, and its meaning when shown, to the card's word and definition fields. You can pick a target word without waiting for the meaning.
- **English** shows a translation of the sentence. It is sent to the `Sentence Translation` field when that field is mapped.
- **Mine** mines exactly this sentence, without joining neighboring lines, using your usual audio padding and click-to-mine action.

Keyboard: Tab onto the subtitle, then Tab through the four actions. In **Look up word**, use Left and Right to move between words, Enter to open the card and Escape to stop. Escape closes the card, then the strip.

Word meanings and English need this server running with a lookup token (see above). Without it, the card shows an error with **Retry**, and Replay and Mine keep working.
