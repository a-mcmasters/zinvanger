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

In the Chromium extension, the Anki dialog automatically translates the current **Sentence** field using Google Cloud Translation Basic. It fills **Sentence Translation** after a short pause when you edit the sentence, preserving manually entered translations. Successful translations are cached while the server runs.

Enable Cloud Translation API and billing in your Google Cloud project. Before starting the server, set `ASB_GOOGLE_TRANSLATE_API_KEY` to your API key in its environment (PowerShell: `$env:ASB_GOOGLE_TRANSLATE_API_KEY = "<key>"`). Restart the server after changing it. The key stays on the local server. `ASB_TRANSLATE_LANGUAGE` sets the target language code, default `en`; Google detects the source language. Sentence lookups do not fall back to the LLM.

Whole-transcript translation and contextual word meanings still use the configured subscription CLI. An NVIDIA GPU is only needed for Whisper transcription.

1. Generate a token with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. Before starting the server, set `ASB_LOOKUP_TOKEN` to that token in the same terminal. In PowerShell, use `$env:ASB_LOOKUP_TOKEN = "<token>"`. In Bash, use `export ASB_LOOKUP_TOKEN='<token>'`.
3. In the extension's **Anki** settings, paste the same token into **Local lookup token** and click **Save**.
4. Add a custom asbplayer field named exactly `Sentence Translation` and map it to the corresponding field in your Anki note type. The translation box appears once the mapping is set.
5. Mine a subtitle and open the Anki dialog. Review the translation and edit it before exporting. Fill in the word definition yourself.

The lookup-enabled dialog runs in the extension's own frame, where page-injected dictionary popups are unavailable. Clear the token in **Anki** settings to use the dialog with those popups again.

## Word lookup on the video

On desktop, click a word in the first subtitle track. Playback pauses, the word is highlighted, and a card opens above the line with its dictionary meaning from [Yomitan](annotation.md) (no model tokens).

**Mine** mines exactly this sentence, without joining neighboring lines, using your usual audio padding and click-to-mine action. The clicked word goes to the Anki card's word field, and its meaning, once shown, to the definition field.

The dictionary links an inflected form to its base form, so the card shows the base form's meaning: _hadden_ shows the meaning of _hebben_ (to have).

Close the card with **×** or Escape. Resuming or seeking closes it too.

Word meanings need a [Yomitan URL](annotation.md) on subtitle track 1 and a Dutch dictionary in Yomitan, such as a Dutch Wiktionary dictionary from [wiktionary-to-yomitan](https://yomidevs.github.io/wiktionary-to-yomitan/download/). Yomitan has no Dutch deinflection, so an inflected form is found only when the dictionary lists it. Without Yomitan, the card shows an error with **Retry**, and **Mine** keeps working.
