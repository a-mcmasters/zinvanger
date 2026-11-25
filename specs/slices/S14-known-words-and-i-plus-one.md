# S14: Known words and i+1 subtitles

Status: Specced and ready for implementation

Issue [#91](https://github.com/a-mcmasters/zinvanger/issues/91) tracks the Known action. This slice is the handoff for that action and the i+1 cue. See the [approved interactive mockup](S14-i-plus-one-mockup.html) and the [current word-card behavior](S13-u3-living-subtitle.md#verification-log).

## Problem

While watching Dutch video, the learner wants to spot a sentence worth mining and tell Zinvanger when a word is already familiar. The clicked-word card already pauses and shows the meaning and Mine. The old hover shortcut for marking a word known depends on annotations being enabled, and the settings redesign removed the panel that exposed those controls.

## User flow

1. In the existing Anki settings, choose **Known-word decks** and **Word fields**. For the owner's collection, select **Dutch** (includes its subdecks) and **Word**. These are separate from the export destination and its field mappings.
2. Watch as usual. A qualifying main-track subtitle shows a dotted amber underline on its one new word. Playback continues.
3. Click the word. Playback pauses and opens the existing word card. Clicking a regular subtitle word still opens the same card.
4. Choose **Known** to save the word locally for the active profile. While saving, disable that action. On confirmation, show **Marked known**, leave the card open and remove the underline once the line's statuses update. On failure, leave the card open and offer Retry. Mine stays available.
5. Choose **Mine** to use the existing export flow for the selected word and captured subtitle. Direct export reports success after Anki confirms the save. If configured to open the Anki dialog, keep that behavior. The line ceases to qualify once the new Anki card's status is available.
6. Dismiss the word card and resume playback manually.

## Scope and decisions

- Ship the Known action first on both the extension desktop overlay and the web app's word card. It works with annotations off, Anki closed, and Yomitan unavailable. Reopening a card can offer Known again. Repeated writes are safe.
- Ship the Anki source and i+1 cue second. Cue analysis is active on the main track when both Known-word decks and Word fields are configured. A fresh profile leaves those inputs empty. The default Yomitan URL alone does not activate the feature. Clearing either input turns the cue off. Preserve any pre-existing annotation or status settings.
- Reuse the current tokenizer and status resolver. A qualifying line has exactly one distinct **Uncollected** word, at least two distinct known words, and zero **Unknown** words. Use the existing `isTokenStatusKnown` threshold (Learning or higher). **Unknown** includes an Anki card that has been created but has yet to be studied. A local Known record uses the fully known status and takes precedence through the existing resolver.
- Count repeated occurrences of the same case-normalized surface form once and underline its first occurrence. Use the status resolver's supported form and lemma matching. Exclude punctuation, numbers without letters, and explicitly ignored tokens from the count. Leave proper names in the count for v1.
- Show a cue only when tokenization and status collection for the whole line are ready. Treat a missing or failed response as unresolved, even if the available results suggest a candidate. A resolved Uncollected status is a valid result. If Yomitan fails or the configured Anki source has never completed a cache load for this profile, render a plain subtitle for this feature. A successfully loaded cache can be used while Anki is offline.
- The cue is for the main video subtitle. Keep the current selected-word styling and its click target. Automatic pauses, playback recipes, statistics changes, a bulk Known action, an undo button and persistent status display on reopened cards are outside this slice.

## Plan

### 1. Save Known from the word card

- In `common/living-subtitle/living-subtitle-controller.ts` and `common/components/LivingSubtitleCard.tsx`, add the Known action and its idle, pending, confirmed and retry states. Use a request guard independent of lookup and mining. Invalidate the UI result on close, word change, profile change or teardown. A definition retry preserves Known state.
- Route the action through `LivingSubtitleUi.tsx`, `living-subtitle-host.ts` and `Binding._createLivingSubtitleHost` in the extension. In the web app, pass the `DictionaryProvider` from `App.tsx` to the word card actions in `VideoPlayer.tsx`. Use the existing dictionary storage implementations and bulk-save RPC. Preserve compatibility with older extensions.
- Capture the profile at click time, request storage persistence and write through `DictionaryProvider.saveRecordLocalBulk` using `getFullyKnownTokenStatus()` and `ApplyStrategy.ADD`. Use the cached lookup's usable lemmas, including alternatives when available. With no usable lookup result, preserve existing usable lemmas if present and fall back to the clicked surface form for a new record. Do not offer Known for tokens with no letters.
- Show success only if the returned `savedTokens` contains the clicked token. Bound the wait (about 10 seconds) and allow Retry. Keep the existing hover shortcut path intact. Refresh current annotations when enabled, and avoid queueing refresh work when every track is disabled.

### 2. Wire the Anki vocabulary source and draw the cue

- Put the two controls in `common/components/AnkiSettingsTab.tsx`. Reuse the main track's `dictionaryAnkiDecks` and `dictionaryAnkiWordFields`, and update the nested track settings without overwriting unrelated fields. Use the usual settings persistence and profile routing. Reuse the current Anki cache in `common/dictionary-db/dictionary-db-anki.ts`, including its subdeck matching. Changing the source must invalidate or rebuild the relevant cache before the new results can drive cues. Keep existing sentence-field settings available to the legacy annotation paths. The i+1 vocabulary source uses the selected word fields.
- Use one shared activation predicate for i+1 in `common/settings/settings-dictionary.ts`. Wire it into annotation building and status collection on the main track. Carry the activation and status-readiness information to rendering. Reuse the existing build, cache invalidation and refresh paths for saves and Anki changes. Do not enable unrelated visual annotations or surface an annotation failure decoration solely because the cue could not be computed.
- Evaluate the line in `common/annotations/render-annotations.ts` using the resolved tokens available to `computeRichText`. Apply the cue to the existing actionable word span, without changing the text or its offsets. Bound work to the existing subtitle analysis window and handle progressive subtitle updates.
- Add strings to `common/locales/en.json` and run the locale merge. Document setup and the click flow in the mining guide. The shared app changes need client and extension compilation.

### Collection preparation

Use a plain `Word` field containing the Dutch targets the card teaches. Keep sample sentences, prompts, translations and audio tags out. Include explicit inflected forms where useful, such as `zijn was waren geweest`.

The owner's desktop Anki sync succeeded with no changes. The phone's latest reviews still need verification before editing the collection schema. Prepare a separate dry run of the collection changes, particularly extracting only the highlighted target from B1 sentence cards and stripping sound tags from vocabulary fronts. Keep any existing populated `Word` values. Collection writes and any one-way full sync are separate from implementing this slice.

## Acceptance criteria

- [ ] With default annotation settings and Anki closed, clicking a Dutch word and choosing Known saves it to the active profile. A lookup outage still permits a surface-form save. Mine remains available.
- [ ] A rejected or timed-out write offers Retry. Double-clicks and stale results after close, word change or profile change do not apply a confirmation to the wrong card. A successful retry shows one confirmation. Saving with annotations off does not start a refresh loop.
- [ ] The feature reads existing notes from the selected decks and subdecks using the selected word fields. Changing the vocabulary source updates the cue and leaves the mining destination intact.
- [ ] A line with two distinct known words and one distinct Uncollected word underlines its first occurrence. Test repeated words, zero or two new words, an Unknown word, a partial result, and unavailable Yomitan. No cue appears on secondary tracks.
- [ ] Clicking the cue opens the existing word card. Known clears the cue after the write is confirmed and the status refreshed. Mine still uses the captured word, subtitle and original audio through the configured export flow.
- [ ] Cover the shared controller and candidate rule in tests, plus the extension and web app save paths. Run `pnpm run verify` and manually check the Chrome overlay on YouTube and Netflix, plus the web app's local-file player.

## Verification log

- One-episode check: use a Dutch subtitle file from an episode the learner would watch and the configured Anki vocabulary source. Record the qualifying share and inspect a sample for false cues from names, repeated words and Dutch forms. Use the result to inform tuning before S8 removes statistics. This is an evaluation, not a preset coverage target.
- `pnpm run verify`: pending implementation.
- Manual acceptance: pending implementation.
