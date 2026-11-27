---
sidebar_position: 12
---

# Word lookup and sentence translation

## Word lookup on the video

On desktop, click a word in the first subtitle track. Playback pauses, the word is highlighted, and a card opens above the line with its dictionary meaning from [Yomitan](annotation.md) (no model tokens).

This also works for local video in the web app's own player, with or without the extension. There, the web app asks Yomitan for the meaning itself and mines the card the same way as its other mining shortcuts.

**Mine** mines exactly this sentence, without joining neighboring lines, using your usual audio padding and click-to-mine action. The clicked word goes to the Anki card's word field, and its meaning, once shown, to the definition field.

The dictionary links an inflected form to its base form, so the card shows the base form's meaning: _hadden_ shows the meaning of _hebben_ (to have).

Close the card with **×** or Escape. Resuming or seeking closes it too.

Word meanings need a [Yomitan URL](annotation.md) on subtitle track 1 and a Dutch dictionary in Yomitan, such as a Dutch Wiktionary dictionary from [wiktionary-to-yomitan](https://yomidevs.github.io/wiktionary-to-yomitan/download/). Yomitan has no Dutch deinflection, so an inflected form is found only when the dictionary lists it. Without Yomitan, the card shows an error with **Retry**, and **Mine** keeps working.

## Translate sentences in the Anki dialog {#sentence-translation}

In Chrome, the Anki dialog uses [DeepL](https://www.deepl.com/pro-api) to fill **Sentence Translation** once when you open it. Sentences are translated into American English, and DeepL detects the source language. Editing **Sentence** does not send another request while the dialog is open. Re-recording or retaking the screenshot keeps the translation already in the field, even if you edited **Sentence**. If the first lookup had not finished, the reopened dialog tries again.

1. Sign up for a DeepL API plan (Free or Pro) and copy the authentication key from your DeepL account. Free keys end in `:fx`; either kind works.
2. In the extension's **Anki** settings, paste the key into **DeepL API key** and click **Save**. The key is stored only in this browser's extension storage and is sent only to DeepL.
3. Add a custom asbplayer field named exactly `Sentence Translation` and map it to the corresponding field in your Anki note type. The translation box appears once the mapping is set.
4. Mine a subtitle and open the Anki dialog. Review the translation and edit it before exporting.

On the hosted web app, you can enter a mapped translation manually. Personal builds made with `ZINVANGER_PERSONAL_HOSTED_TRANSLATION=1` also show **Allow the Zinvanger web app to translate sentences with this API key** below the key. With it on, the hosted web app's Anki dialog fills **Sentence Translation** through the extension too.

On streaming sites, the translating dialog runs in the extension's own frame, where page-injected dictionary popups are unavailable. Clear the API key in **Anki** settings to use the dialog with those popups again.
