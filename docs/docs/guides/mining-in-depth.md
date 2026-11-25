---
sidebar_position: 3
---

import NoteAddIcon from '@site/src/components/NoteAddIcon';
import ImageIcon from '@site/src/components/ImageIcon';

# Mining in-depth {#mining-in-depth}

Sentence mining can be accomplished in a variety of ways, according to your needs and preferences, using asbplayer.

## Opening the Anki Export Dialog {#opening-the-anki-export-dialog}

There are multiple ways to open the **Anki Export Dialog**:

1. **Mine Subtitle** <NoteAddIcon /> button that can be found in the **Subtitle List** of the **Side Panel** or on the website.
2. **Mine Subtitle** <NoteAddIcon /> button in the **Overlay UI** on streaming videos or on the mobile website.
3. The **mine current subtitle and open Anki dialog** [Mining keyboard shortcut](../reference/settings.md#mining-keyboard-shortcuts) - `Ctrl + Shift + X` by default.
4. Right-click → asbplayer → **Mine Subtitle** on streaming video.

:::info
Methods #1 and #2 will open the dialog only if the [mining button default action](../reference/settings#mining-button-default-action) is set to "Show Anki dialog."  
:::

:::info
When an _empty_ subtitle track is loaded, and audio recording is enabled, all of the above actions will start recording audio the first time they are triggered, and open the Anki dialog the second time they are triggered.
:::

## Adjusting cards {#adjusting-cards}

Prior to being exported, cards can be adjusted from the dialog.

### Selected time range {#selected-time-range}

A **slider** at the bottom of the dialog can be used to change the selected time range.

- The **Sentence Field** will be automatically updated to match the selected time range, if it has not been manually edited already.
- For local files, the audio clip will also be automatically updated. Use **Zoom Out** beside the slider if the range you need extends past its current bounds.
- For streaming video, the audio clip can be re-recorded with the selected time range.

### Audio field {#audio-field}

The **Audio Field** displays the recorded audio clip and provides three action buttons:

- **Play/Pause** — preview the audio clip directly in the dialog.
- **Re-record** — capture a fresh clip from the selected time range for a local file or a supported streaming video. If the clip cuts off part of the sentence, extend the range with the slider before re-recording.
- **Download** — download the audio clip as a file to your device.

### Text fields {#text-fields}

Any of the text fields - sentence, definition, word, custom fields, source, URL, tags - can be edited. Typically, a separate dictionary app is used to fill out the definition field.

The Chromium extension can also [fill in sentence translations](./local-whisper.md#set-up-automatic-anki-lookups). When a sentence spans several subtitle lines, mining from the extension can use the neighboring lines to include the whole sentence and its audio.

### Image field {#image-field}

For local files, clicking the **Preview Button** <ImageIcon /> on the **Image Field** can be used to change the video timestamp from which the screenshot is extracted.

Pause a local video on the frame you want before mining. To save the picture shown in the preview, map **Image Field** to a field in your Anki note type under **Settings → Anki**.

## Exporting cards {#exporting-cards}

Use the buttons at the bottom of the dialog to finally export the card. There are three types of export:

1. **Export**: simply export a card with the dialog content.
2. **Update last card**: update the last card in your Anki deck with the dialog content.
3. **Open in Anki**: opens Anki's card creator prefilled with the dialog content.

## Dialog-less mining flows {#dialog-less-mining-flows}

Dialog-less mining flows that both include a word definition and skip the Anki dialog entirely can be achieved when asbplayer is used in combination with a dictionary app that also integrates with Anki. Currently, the most popular dictionary app that does this is [Yomitan](https://yomitan.wiki/).

### Update last card {#update-last-card}

A dialog-less mining flow with Yomitan looks like this:

1. Using Yomitan, highlight the word inside the subtitles that you would like to mine.
2. Use Yomitan's card-creation button to create a card.
3. Immediately use asbplayer's **update last card** [Mining keyboard shortcut](../reference/settings.md#mining-keyboard-shortcuts) - `Ctrl + Shift + U` - to update the card with asbplayer-supplied content.

The disadvantage of this flow is that skipping the dialog means skipping the opportunity to modify the card. However, there are ways to work around this:

- Instead of directly updating the last card at the final step, you can always use `Ctrl + Shift + X` instead to open the dialog, adjust the card, and finally **update last card** using the dialog GUI. With this method you still go through the dialog, but retain the benefit of Yomitan's automatically-supplied word definition.
- The **Anki Export Dialog** can always be opened _after_ card creation with the **manually take screenshot** [Mining keyboard shortcut](../reference/settings.md#mining-keyboard-shortcuts) - `Ctrl + Shift + V` by default.

### One click {#one-click}

See the [one-click mining](./one-click-mining.md) guide.

## Known words and i+1 lines {#known-words-and-i-plus-one-lines}

Click a word in the main subtitle to pause and open its word card. **Known** saves the word as known for the active profile, without Anki or annotations. The card shows **Marked known** once the save is confirmed, and **Retry** if it fails. **Mine** stays available.

To spot lines worth mining, open the Anki settings and choose:

- **Known-word decks**: the decks, including their subdecks, that hold your vocabulary notes.
- **Word fields**: the fields that hold just the word, such as `Word`. Keep sentences, translations and audio out of them.

With both set, a main-track line with exactly one new word, at least two known words and no unstudied Anki words gets a dotted amber underline on its new word. Playback continues. Words you marked **Known** and Anki cards you are learning or have learned count as known. Click the underlined word to open its word card, then choose **Known** or **Mine**. The underline goes away once the word's status updates. Clear either setting to turn the underline off. The underline needs Yomitan. It appears once Zinvanger has read the chosen decks and fields from Anki, and after that it uses the last read while Anki is closed. Changing either setting hides it until the next read finishes.
