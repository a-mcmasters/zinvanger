# S13 U3: Living subtitle controls

Status: Implemented, pending manual acceptance on NPO Start and YouTube
Parent: [S13 UI redesign](S13-ui-redesign.md)
Suggested branch: `slice/13c-living-subtitle`

## Problem

While watching Dutch video, replaying a sentence, understanding a word, revealing English and saving a card should happen where the viewer is already looking. Today these actions are spread across controls and the Anki dialog. U3 puts sentence actions beside the subtitle and word lookup beside the selected word, using the glass surfaces and violet accents established in U1.

## Chosen layout

On 2026-11-21, the user selected **A: Floating glass** from the [interactive mockup](S13-u0-prototype/living-subtitle.html?variant=A). Keep the Dutch subtitle independent, with a compact glass action pill beneath it and a word card floating above the selected word. English appears below the action strip when requested. Use the existing violet theme, rounded surfaces and visible focus treatment. The mockup is a visual reference with simulated actions, not production code.

This selects the visual layout only; the proposed playback and keyboard defaults below remain proposals.

## Scope

- Chrome extension video overlays, initially verified on NPO Start and YouTube, in normal and fullscreen playback.
- One compact action strip: Replay, Look up word, Show English, Mine.
- An anchored word card with a contextual meaning and a target-word selection for mining.
- Pointer and keyboard access to the same actions.
- Reuse the existing local lookup service, playback commands and sentence-mining pipeline.

Command-bar work (U4), redesigning the Anki dialog (U5), new translation providers, dictionary management, persisted vocabulary, multiword selection, image-based subtitle OCR, mobile and web-app UI changes are outside this slice. Existing settings and stored card mappings remain compatible. This slice introduces no new settings screen controls.

## Interaction contract

### Watching and entering the controls

Dutch stays visible according to the existing subtitle visibility settings. English is hidden until requested. Hovering the Dutch line reveals the strip without moving the line or pausing playback. Moving between the line, strip and word card must not dismiss them. After the pointer leaves the entire region, an unfocused strip closes after 250 ms.

The subtitle interaction region is one tab stop, labelled with the current sentence. Focusing it reveals the strip. Tab visits the four actions in their visual order, then leaves the region normally. There is no focus trap and no new global shortcut in this slice; existing replay and mining shortcuts remain available.

Clicking a word, activating Look up word, or entering the region by keyboard pauses playback and captures the current sentence as the interaction target. Mere pointer hover does neither. Opening Show English also captures and pauses, so the requested sentence stays readable while the response arrives. Capture means a stable subtitle source/cue identity, text, track and effective start/end times, not a mutable array index.

Closing an interaction does not automatically resume playback. Escape closes the word card first, then dismisses the strip and returns focus to the subtitle region. Explicitly resuming playback clears the captured target and resumes following the timeline. A seek, track replacement, video/episode change, subtitle hiding or video teardown dismisses the interaction and invalidates outstanding responses. Replay is the deliberate exception: it uses the captured target before clearing it.

### Replay

Replay seeks to the captured Dutch sentence's effective start, including the active subtitle offset, and plays through its end, then pauses. It uses the existing playback command/plan path so recording and playback state have one owner. A second Replay restarts that same sentence. Manual seeking or another explicit playback command cancels the pending end pause. Non-seekable media shows a short explanation instead of attempting an invalid seek.

### Look up a word

Clicking a Dutch word selects and visibly highlights it and opens a card anchored to that word. Look up word places keyboard focus on the first word of the captured sentence; Left/Right moves between words and Enter opens the card. Escape leaves word navigation. Tokenization preserves Dutch diacritics and internal apostrophes/hyphens while excluding surrounding punctuation from the lookup and target-word value. The sentence text itself is unchanged.

(Superseded 2026-11-22: there is no “Use as target word” action; the clicked word is the target word. See the verification log.) The card shows the selected word, its English meaning in this sentence, and a “Use as target word” action. Clicking a different word replaces the selection. Only one word card exists per video. Loading, no result, connection/authentication failure and retry states appear within the card without covering the Dutch sentence. Selecting a target word requires no successful lookup. Once selected, it remains highlighted for this captured sentence; selecting another replaces it. It is cleared when the interaction target is invalidated.

Reuse the local provider and authenticated background transport used by `AnkiUi`. The existing endpoint only translates sentences, so add a contextual word-definition operation to that service. Do not introduce a second provider or expose its authentication token to page scripts. Lookup is explicitly requested, never triggered by ordinary word hover. Retrieved text is rendered as text, with no executable HTML.

### Show English

Activating Show English reveals one English sentence beneath the captured Dutch sentence and changes the action to Hide English. Prefer a translation paired with the same source cue. If no such pairing exists, request a translation for the exact captured sentence through the existing local translation flow. Do not present an arbitrary overlapping subtitle as a guaranteed sentence translation.

Show a compact loading state, then the result or an inline error with Retry. Hide English works while a request is pending. A response arriving after hiding may be cached but cannot reopen the translation. Resuming playback or changing the target hides English again. Translation is independent of word lookup: a failure in one does not disable the other or prevent mining.

### Mine

Mine invokes the existing sentence-mining pipeline once with the captured sentence (or the current Dutch sentence if the viewer has only hovered), its effective timing, and the selected target word if any. Use the existing audio padding and configured post-mine behavior. U3 does not change direct export versus dialog behavior. A card can be mined without selecting a word or waiting for a lookup.

Translation and definition may accompany the request only when they belong to the exact captured sentence and selected word and the existing pipeline supports those fields. Late results must never edit a card already submitted. Disable repeat activation while the same mining request is in flight. Reuse existing success/failure feedback; acknowledge export only after the existing export flow reports success. Failure preserves the selection for retry.

## Rendering and edge cases

- Place the strip below the Dutch line, and the translation below the strip. Flip or clamp the word card within the video bounds when necessary. Long sentences and definitions wrap; card content may scroll without pushing the subtitle offscreen.
- Use U1 theme tokens in light and dark modes. Give translucent surfaces a sufficiently opaque backing for contrast over bright or busy video. Respect reduced motion, visible focus and 200% zoom; aim for at least 32 px action targets and meet WCAG AA text/control contrast.
- The region consumes pointer/key events only for its own interactions. The rest of the video remains usable and native player controls are not globally suppressed.
- With no active Dutch cue, hide pointer actions and expose no stale mining target. A focused region can announce “No subtitle at this time”; actions are unavailable until a cue exists. Image-only subtitles retain existing playback/mining paths but do not offer word lookup.
- For overlapping cues, word interaction targets the clicked cue; keyboard entry targets the first visible Dutch cue in display order. Replay, translation and mining all use that same cue. Never combine distinct speakers' cues implicitly.
- Keep state per bound video, including request generations. Ignore late results for old cue/source identities, including progressive transcript replacements. Unbind removes listeners, timers, pending end-pause work and overlay DOM.
- Replace only duplicate sentence actions in existing extension overlays. Keep unrelated actions reachable through their existing entry points until U4 ships. `ControlsController` manages native-player control visibility; it is not the new action strip.

## Acceptance criteria

- [ ] On NPO Start and YouTube, hovering reveals the strip without shifting subtitles or pausing; pointer travel into the strip/card does not close it.
- [ ] Replay plays the chosen sentence at its offset-adjusted time and pauses at its end; a user seek cancels that pause.
- [ ] Clicking a Dutch word opens a contextual English lookup, and selecting it makes that exact word available to Mine.
- [ ] Using Tab, Left/Right, Enter and Escape alone, a viewer can look up/select a word, reveal English, replay and mine; focus never becomes trapped or lost on a detached element.
- [ ] English is initially hidden, appears only on request, and resets on resume/target change. Missing paired translations use the existing sentence translation service.
- [ ] A slow lookup for sentence A cannot appear on sentence B; hiding a pending translation cannot cause it to reopen on completion.
- [ ] With the local service stopped or unauthorized, lookup/translation show recoverable errors while replay and mining still work.
- [ ] Mining preserves the chosen sentence, target word, configured audio padding and post-mine behavior, with no duplicate submission from repeated clicks.
- [ ] Seeking, subtitle offset/source changes, progressive cue replacement, episode navigation and video teardown do not leave stale cards, focus, timers or playback actions.
- [ ] Normal/fullscreen, both themes, 200% zoom, long subtitles and bright video preserve readable controls and visible focus.
- [ ] Required automated checks and manual smoke evidence are recorded below before marking this slice done.

## Implementation plan

The [detailed build plan](S13-u3-implementation-plan.md) defines the implementation order, file boundaries, transport authorization, backend addition, playback/mining integration and validation. It supersedes the preliminary outline below where more specific.

1. Add a video-local living-subtitle controller with explicit target, selection, translation, lookup and mining state. Keep asynchronous request generations and lifecycle handling here, separate from rendering and provider calls.
2. Integrate at `extension/src/controllers/subtitle-controller.ts` and `extension/src/services/binding.ts`: obtain stable source identities and effective timings, route existing playback/mining commands, and coordinate pause-on-hover so crossing this region cannot unexpectedly resume a captured interaction.
3. Add a focused overlay view using `extension/src/services/element-overlay.ts` or an extension-owned frame where needed. Confirm fullscreen containment and page CSS isolation before choosing the rendering host. Reuse `common/theme/theme.ts` tokens.
4. Share background lookup transport with the existing Anki translation flow; reuse `extension/src/services/local-lookup-token.ts` and the service configured by `project.json`. Add a contextual word-definition endpoint and typed U3 messages, keeping credentials in the background and authorizing the exact extension-owned UI caller. The provider remains unchanged.
5. Connect target-word data to the existing sentence mining path. Keep the U5 dialog work separate. Add English locale strings and run locale synchronization; add concise user documentation for the new controls.
6. Add behavior tests for interaction transitions, request races, duplicate mining prevention, cue replacement, offset-aware replay and cleanup. Extend subtitle/controller and binding integration coverage rather than testing copied implementation details.

Validation: focused Jest suites, common typecheck, extension compile (and client compile if shared UI changes), lint/formatting and `pnpm run verify` through Git Bash on Windows. Record any existing generated-file line-ending failure separately from new failures; do not mark full verification green if it fails. Manually test NPO Start and YouTube, plus a local subtitle fixture for overlap, missing translation, long text and stale-response cases. Check an actual Anki card's sentence, word and audio after mining.

## Decisions to confirm when reviewing this spec

These are proposed defaults, not previously agreed product decisions: Replay pauses at sentence end; active lookup/translation pauses and stays paused when dismissed; lookup reuses the existing local service; keyboard entry uses Tab rather than a new global binding. The existing service means U3 can deliver lookup without waiting for the later agent hand-off slice. Reconcile the older product-spec statement that the extension does not look anything up when this behavior is accepted.

## Verification log

- 2026-11-21 implementation: `LivingSubtitleController` (state, stale-response generations), `LivingSubtitleHost` (subtitle DOM events, CSS Custom Highlight word marks, two content-sized extension frames at `living-subtitle.html?part=strip|card`), `LivingSubtitleLookupHandler` (authorizes only the living-subtitle page; typed errors), `/define` on the transcriber, `PlaybackEngine.replay` (one-shot end pause), and `Binding.mineLivingSubtitle` (exact captured cue; settles on `card-*`, `show-anki-ui` or `notify-error`, not on send).
- Automated: controller (12), host (3), lookup handler (4), engine replay (2) and transcriber (27) tests pass; existing binding suite passes. Extension compile and common typecheck pass.
- `pnpm run verify` on Windows (Git Bash) is **not green**, but none of the failures come from this change: `check:project` and `check:external-api` report drift in generated files this change does not touch (line endings); `pretty:check` cannot run because cmd.exe parses the `|` in its glob; `test:scripts` has 3 release/packaging failures that also occur with this change stashed. Every other step passes: loc keys, page references, common typecheck, client/extension compile, common (2496), client (26) and extension (496) tests, eslint, and Prettier on all touched files.
- Deviations to review: a captured interaction stays open when the pointer leaves (only hover closes after 250 ms); replay on non-seekable media and source/cue translation pairing are not implemented (translation always uses the service, which already prefers stored English SRTs); duplicate sentence actions elsewhere were not removed.
- 2026-11-22 review fixes (subagent review): lookups now go from the video content script to the background, not through the strip frame, because frame replies reach the parent window by `postMessage` where the page can read them; the handler accepts only a content-script sender. This replaces "authorizing the exact extension-owned UI caller". The transcriber's default provider is now Claude Code with `--tools ""` and `--strict-mcp-config`, because Codex cannot turn off code execution and MCP tools and its read-only sandbox reads any file, so a prompt-injected subtitle could copy local files into a result. This replaces "the provider remains unchanged"; Codex stays available with `ASB_DEFINE_PROVIDER=codex`. Results over 2000 characters are rejected. Pause-on-hover works again, and auto-resume skips a captured sentence. Also fixed: frames are created hidden (a loading frame covered the page), Enter in word navigation only opens a word from Look up, English Retry retries, hidden subtitles dismiss a captured sentence, focus returns to the subtitle or strip when a focused frame hides or reloads, fullscreen no longer fails pending lookups, mining with no post-mine action settles without waiting for `card-saved`, the Anki dialog opening no longer shows "Mined", hidden frames forget pointer and focus, updates stop after unbind, and only the first subtitle container is a `role="group"` tab stop. Extension tests: 499 pass.
- 2026-11-22 review round 2 (Codex): hidden frames stay laid out (`visibility: hidden`, `inert`) so a loading frame can report its size; mining sends exactly the captured cue's text instead of joining overlapping cues across tracks; superseded renders and replaced frame clients are discarded; mining awaits the actual send and ignores card events for a different subtitle; a replay cancelled during its seek no longer plays; a recreated frame does not replay an old focus request, focus waits for the frame to be shown, and opening a word from the keyboard focuses the card. Extension tests: 504 pass.
- 2026-11-22 review round 3 (Codex): send results and timeouts settle only their own mine; Mine captures the sentence first; a frame that fails to load is removed before a retry; focus deferred until a frame is shown is re-requested inside it. Known limit: `notify-error`, `recording-finished` and two exports of the same subtitle carry no request id (marked `shortcut:` in `binding.ts`). Extension tests: 506 pass.
- 2026-11-22 review round 4 (Codex): hover keeps the hovered line while it stays on screen; frames re-place on any scroll; frames stay inside the visible part of the video and the strip wraps to that width at high zoom. Extension tests: 509 pass.
- 2026-11-22 review round 5 (Codex): the target word keeps its meaning after its card closes and is mined with it; strip and card placement is bounded vertically by the on-screen part of the video. Extension tests: 510 pass.
- 2026-11-22 review round 6 (Codex): a target meaning that arrives after its card closed is kept; frames are capped to the visible video height and scroll inside. Extension tests: 512 pass.
- 2026-11-22 review round 7 (Codex): a settings refresh that finishes after unbind no longer rebinds the host; each video's host adds and removes only its own ranges in the shared CSS highlights. Extension tests: 512 pass.
- 2026-11-22 review round 8 (Codex): a word click resolves by DOM position against the word ranges, so ruby glosses (`rt`, `rp`) no longer shift it onto the next word. Extension tests: 513 pass.
- 2026-11-22 review round 9 (Codex): replay plays only after its seek completes, not after the seek watchdog gives up. Engine tests: 220 pass.
- 2026-11-22 review round 10 (Codex) and user feedback: Replay pauses before seeking, so a seek that never lands cannot leave the video playing; playback modes (auto-pause, condensed, ...) are off while a replay runs (the reviewer's early-auto-pause case could not be reproduced in the engine harness, so this has no regression test); the strip and card avoid every subtitle line on screen, not just the hovered one (user report: the overlay covered subtitles); frame bodies are forced transparent over CssBaseline, and the surface shadow fits inside the frame padding instead of being clipped into a visible rectangle (seen in rendered screenshots). Extension tests: 514 pass; engine tests: 220 pass.
- 2026-11-22 review round 11 (Codex): the replay engine now pauses a playing video itself before seeking and ignores that pause's own event, so Replay clicked during playback no longer cancels itself (the controller no longer captures before replay). Engine tests: 221 pass.
- 2026-11-22 review round 12 (Codex): replay waits up to 2 s for the player to confirm its own pause before seeking (and gives up otherwise), so a pause during the seek is always the viewer's, including on sites that pause asynchronously; a failed `play()` clears the armed end pause and is logged. Engine tests: 223 pass.
- 2026-11-22 review round 13 (Codex): each replay owns its pause wait; cancelling a replay, starting another or unbinding settles it, and a stale wait can no longer clear a newer replay's. Engine tests: 224 pass.
- 2026-11-22 review round 14 (Codex): keyboard entry, the region label and hover-follow pick the main (lowest-numbered) subtitle track, or the hovered line's own track, never a translation track just because it is listed first. (Superseded by the user's decision below.) Extension tests: 515 pass.
- 2026-11-22 review round 15 (Codex): a keyboard user who tabs into the subtitle region between cues gets the next cue captured when it appears, if focus is still on the region. Extension tests: 516 pass.
- 2026-11-22 user decision: only the main subtitle track (track 0) gets actions. Hovering, clicking or tabbing never targets a translation track, and when the hovered Dutch line ends with only English on screen, the strip closes. Accepted limit (review round 16): Dutch loaded as a track other than 0 gets no actions; there is no setting that marks the learning-language track. Extension tests: 516 pass.
- 2026-11-22 review round 17 (Codex): with hover-only dictionary annotations the cue holds a plain and an annotated copy of the sentence; words are matched per copy, so clicks work in either, and highlights cover both copies. Extension tests: 517 pass.
- 2026-11-22 review round 18 (Codex): capturing a sentence clears the pause-on-hover auto-resume, so closing the strip and moving the pointer away no longer resumes playback (no binding test: `binding.test.ts` has concurrent edits from another session). Extension tests: 517 pass.
- 2026-11-22 review round 19 (Codex): resolving a captured cue after a progressive transcript update also refreshes its surrounding subtitles, so the card gets the current context; a second Mine click while the first is running no longer clears the host's mining flag. Extension tests: 518 pass.
- 2026-11-22 isolated branch: `pnpm run verify` passed in Linux with Node 24.22.3 and pnpm 11.27.0 (2,502 common, 26 client, 509 extension, 51 script, and 216 FFmpeg tests). All 27 transcriber tests passed. On Windows, `verify:app` passed with LF checkout files, Git Bash and a binary-mode jq wrapper. The release milestone test's mock launcher and the Anki packaging test's missing `zip` stopped the Windows run at `test:scripts`. Both tests passed in Linux.
- 2026-11-22 user decision: no model tokens per word or sentence. The word card's meaning comes from Yomitan (`Yomitan.gloss` with the Yomitan URL of subtitle track 1, fetched through the existing `http-post` background relay); the transcriber's `/define` endpoint is removed. The English line uses `/translate?stored=1`, which returns only a stored translation (supplied `.en.srt` or the episode `.en.ai.srt`) and never runs the CLI; a missing one shows "No English subtitle for this line". The Anki dialog's sentence translation still falls back to the CLI. Limits: Yomitan has no Dutch deinflection, and a dictionary meaning is not the meaning in this sentence.
- 2026-11-22 user decision: words are looked up only by clicking them. The Look up word action and keyboard word navigation are removed; Left/Right in the strip go to the previous/next subtitle (the same seek as the key bindings, which frames cannot reach). Keyboard users can no longer open a word card; this replaces the keyboard word-lookup requirement.
- 2026-11-22 user decision: the action strip is removed completely, so nothing appears on hover. Clicking a main-track word pauses and opens the word card, which now holds Use as target word and Mine. Replay (including `PlaybackEngine.replay`), English (the background lookup handler and the transcriber's `stored=1` mode), keyboard entry, the subtitle tab stop and its focus ring are removed. The Anki dialog's sentence translation is unchanged.
- 2026-11-22 user decision: “Use as target word” is removed; the clicked word is always the target word and is mined with its shown meaning. Wiktionary part-of-speech labels (“vt”) are left out of glosses.
- Manual acceptance: not run. Needs NPO Start and YouTube, fullscreen, both themes, 200% zoom and a live Anki export.

## Retro

To fill after shipping.
