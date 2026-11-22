# U3 implementation plan: Floating glass

Status: Implemented except manual acceptance; see the spec's verification log
Spec: [Living subtitle controls](S13-u3-living-subtitle.md)
Visual reference: [variant A](S13-u0-prototype/living-subtitle.html?variant=A)

## Build order

Implement in the order below on `slice/13c-living-subtitle`. Each step should leave existing playback and mining working. Keep the new surface unmounted until its actions are wired; do not ship placeholder buttons. No persisted feature flag or new settings section is needed.

### 1. Define the interaction target and lifecycle

Add `extension/src/controllers/living-subtitle-controller.ts` and focused tests. Its public boundary takes subtitle/playback updates and user actions, emits a render model, and calls injected pause/replay/mine/lookup functions. It owns no HTML, service credentials or playback clock.

The target contains video identity, source load/cue identity, source revision, exact text, track, effective start/end times and surrounding subtitle context. Keep the highlighted word as a text range plus normalized lookup text. Store separate pending/result/error state for translation, definition and mining, plus an interaction generation. All async results must match the generation and request inputs before applying.

Use `subtitleKey` and source data from `common/subtitle-reader/subtitle-stream.ts`; do not retain array indexes across updates. Add a narrow snapshot/event boundary on `SubtitleController` rather than exposing its mutable internal arrays. Invalidate when target text/timing changes even if the source key stays the same. Unrelated progressive updates should not dismiss an unchanged target.

Separate transient hover from a captured interaction. Hover follows the timeline; capture pauses and freezes the target. Resume, external seek, hidden subtitles, changed source/video and teardown clear it. Keep the strip open across pointer travel and keyboard focus. Suppress existing pause-on-hover behavior for this interaction region, releasing that suppression on close/unbind.

Tests: hover versus capture, overlapping cue selection, same-key cue replacement, source replacement, unrelated updates, offset changes, stale responses and teardown.

### 2. Add the extension-owned surface and translation transport

Add an extension iframe entry point under `extension/src/entrypoints/living-subtitle-ui/`, a view under `extension/src/ui/components/LivingSubtitleUi.tsx`, and a small host adapter under `extension/src/controllers/`. Follow existing UI frame/bridge conventions and register the entry point/resources through the existing WXT setup where required.

The Dutch text remains in the existing subtitle overlay. Add delegated word click/focus handling there, and anchor the iframe's strip/card to the actual subtitle/word rectangles. Use separate bounded frame regions if necessary; a transparent full-video iframe must not intercept the player. Coordinate focus and the 250 ms leave timer across the subtitle and frame boundaries. Use the fullscreen-aware positioning/lifecycle already established by `element-overlay.ts`, without caching React roots as subtitle HTML.

Render variant A with the shared MUI theme: independent Dutch line, glass pill below, word card above, translation below the pill. Clamp/flip to video bounds. Support both themes, zoom, resize and fullscreen reparenting. Keep stable focus when rendering async states; restoring focus to the subtitle must not immediately reopen a dismissed strip.

Add typed model/action messages to the existing bridge pattern. Each host instance and action must be tied to its video and current target. Validate event origin/source and payloads using existing bridge conventions. Read secrets and perform network calls only in background code.

`GetLocalDefinitionHandler` currently accepts only `/anki-lookup.html` and actually calls `/translate`. Extract a shared background local-lookup client, preserve the old message/response contract, and add a dedicated typed U3 request with an explicit operation. Authorize the exact new extension UI URL as well as the existing caller where appropriate; do not authorize arbitrary content scripts or weaken this to an extension-id-only check. Return distinguishable unavailable, unauthorized, busy, timeout and malformed-response errors for the new UI.

The frame requests translation only after an explicit user action. Use a known source/cue pairing if available; otherwise translate the captured sentence. Never infer pairing from overlap alone. Hiding a pending translation suppresses presentation even if a response later arrives. Keep caches bounded and scoped by operation, language and input text.

Tests: allowed/denied callers, backwards-compatible Anki translation, typed errors, hidden pending results, frame events and focus transitions. First manual layout check: normal/fullscreen on NPO Start and YouTube before adding more behavior.

### 3. Implement contextual word lookup

The current backend has sentence translation only. Extend `transcriber/server.py` with an authenticated contextual-definition operation taking `word` and `sentence`, returning a concise English `definition`. Reuse the existing configured CLI provider, no-tools execution, authentication, timeout, concurrency limits and input-size validation. Treat supplied text as data in the prompt. Cache by word, sentence and output language. Keep `/translate` and the old Anki flow unchanged.

Extend `transcriber/test_server.py` with mocked provider calls for valid input, auth failure, invalid/oversized input, busy/timeout behavior and cache separation. Tests must not invoke a paid/live provider. Update `transcriber/README.md` with the new contract.

In the view, selecting a word opens the card and requests its definition; moving the pointer alone never calls the service. Word navigation uses a roving focus position so every word is not a separate page tab stop. Preserve internal apostrophes/hyphens and diacritics; keep punctuation out of the target-word field. (Superseded 2026-11-22: the clicked word is the target word; there is no separate action.) “Use as target word” works during loading or failure and is independent of whether a definition exists.

Tests: Dutch punctuation/diacritics, changing words while a request runs, explicit-only requests, unavailable service, retry and selecting a target without a result.

### 4. Connect replay and mining through Binding

Expose narrow actions on `extension/src/services/binding.ts` for the captured target, rather than letting UI code call private methods or mutate the video directly.

Replay belongs in `common/playback/playback-engine.ts` and its plan/executor machinery. Add a bounded one-shot replay operation if existing operations do not express it. Do not use a UI timer for the end pause. Account for effective subtitle offset once, cancel on external seek/new playback command/source change/unbind, and avoid changing saved playback modes. Recording must retain ownership of playback while recording is active; disable replay with an explanation then. Verify behavior with repeat/auto-pause modes and restore ordinary mode behavior after the one-shot operation ends.

Mining has an important existing behavior: `_copySentence` calls `expandToSentence`, which may change the clicked cue's text and bounds. For U3, use the captured target consistently across lookup, replay and export. Route its exact text/bounds and surrounding context to `_copySubtitle` through a named public adapter, preserving recording, padding and `postMineAction`. Leave existing keyboard/dialog sentence-expansion behavior intact. Do not silently expand U3's sentence after the user has selected a word. A future sentence-grouping improvement can change the capture model explicitly.

Pass the chosen word and matching definition; attach translation only through the configured translation-field mapping supported by the existing export flow. Snapshot fields at submission. Late results never mutate a submitted card. Track the actual recording/export/dialog lifecycle to release the busy state: return from a message-send call is not proof of a successful Anki export. Preserve the target on failure; clear it on unrelated navigation. Decide the exact completion signal from the existing flow during this adapter work and add a typed signal if it is missing.

Tests: offset-aware replay at varied playback rates, cancellation, recording conflicts, exact target export when adjacent cues would expand, word/field mapping, repeated activation, retry, dialog cancellation and real completion versus message acknowledgement.

### 5. Finish integration and document behavior

Wire creation, settings refresh, subtitle/playback events and disposal into `Binding`. Remove only duplicate extension sentence actions after their replacement works; leave native player controls and U4's unrelated entry points reachable. Do not change `ControlsController` into a sentence-action owner.

Ensure no-cue, image-only and overlapping-cue states are intentional. Verify subtitle drag/text selection and existing annotations do not also handle a living-subtitle word action. Add English locale keys and run `scripts/loc/merge-loc-from-en.js`. Document keyboard navigation, pause behavior and the local-service prerequisite in the existing user documentation. Update the parent checklist and product spec to reflect the implemented lookup behavior, without treating the prototype as tested production code.

## Validation and completion

Run focused controller, view, handler, binding and playback tests after their respective steps, plus the transcriber unit suite for the new endpoint. Then run common typecheck, client and extension compile, touched-code lint/formatting and full `pnpm run verify` through Git Bash. Record existing Windows line-ending failures explicitly; do not call verification green when it stops there.

Manual acceptance on both NPO Start and YouTube:

1. Reveal the pill by pointer and keyboard, cross into the card, select a word and reveal English. Verify playback/focus behavior and normal player controls.
2. Replay, seek during replay, change offset, replace subtitles and navigate to another video. Check that old responses and end-pause actions cannot affect the new target.
3. Stop the local service, use an invalid token and simulate a slow request. Check inline failures, retry, and independent mining/replay.
4. Mine with and without a target word; inspect the actual Anki sentence, word, translation and audio bounds. Double-click Mine and confirm only one request/card.
5. Repeat layout checks in fullscreen, light/dark mode and 200% zoom, including long text, overlapping cues and image-only subtitles using a fixture where the sites do not provide these cases.

Record results in the U3 spec. Ship only when its acceptance checklist is satisfied, then update the slice board. No runtime checks have been run for this planning-only change.

## Working assumptions

Use the spec's proposed behavior while implementing: replay pauses at the end; active lookup/translation pauses and remains paused on dismissal; keyboard entry uses Tab. Variant A is the confirmed visual choice. The new word endpoint is required to fulfill contextual lookup with the current provider; this corrects the earlier assumption that no backend work was needed.

The first two integration risks to resolve are fullscreen/focus behavior across the subtitle and iframe, and stable cue identity with progressive subtitle updates. Complete those before polishing the word card. The next risk is mining completion acknowledgement; do not equate queuing media recording with card creation.
