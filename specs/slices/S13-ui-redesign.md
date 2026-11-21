# S13: Redesign the UI around watch, replay, look up, mine

Status: In progress (U0 and U1 complete)
Branch: `slice/13-ui-redesign` (one branch per sub-slice: `slice/13a-…`, `slice/13b-…`)

## Problem

The extension still looks and behaves like upstream asbplayer. That means a stock MUI look with a single pink accent (`common/theme/theme.ts` is the whole theme), 9 settings tabs (about 7.6k lines in `common/components/*SettingsTab.tsx` + `SettingsForm.tsx`), and clunky menus (the toolbar popup, the subtitle picker `VideoDataSyncDialog`, the hover controls over the video). A Dutch beginner (A1–A2) does four things while watching: **replay a line, pause and look up a word, read the translation, mine the sentence**. Everything else on screen is noise, and the settings mostly configure features nobody here uses.

## Decisions taken (2026-11-21 interview)

- Primary sites: NPO Start plus other streaming sites, in Chrome. Not the web app or mobile.
- Style: a modern app, but not the first generic "rounded cards + accent color" look. Pick from real alternatives (see U0).
- Options: **remove** most of them, don't hide them behind an "Advanced" screen. A removed setting is hard-coded to the value that suits this workflow.
- Audience: you, maybe others later. So keep it clean and configurable where it matters (Anki deck, fields, shortcuts), but no power-user knobs.

## Design directions to compare in U0

Three deliberately different options. U0 builds each as a clickable throwaway mock so the choice comes from seeing them, not reading about them.

1. **Command bar.** One floating, keyboard-first bar (opened with a hotkey, like Raycast or Linear's ⌘K) replaces the popup, the subtitle picker and most menus. "Load subtitles", "Transcribe episode", "Shift offset +0.5 s" and "Open deck settings" are all commands you type or pick. The settings page shrinks to what the bar can't do.
2. **Living subtitle.** The subtitle line itself is the UI. Hovering it shows a slim pill under the line (↺ replay · 🔍 translate · ＋ mine). Clicking a word opens a small card anchored to that word (meaning, add as target word). There are no menus over the video at all. Settings become one sheet that slides in from the side.
3. **Study strip.** A quiet bar docked at the bottom edge holds the current line, its translation and the last 3 lines as a short scrollback you can click to replay or mine. Big, readable type with a typographic, editorial feel instead of an app chrome look.

Recommendation: **2 for the video, 1 for everything else.** The subtitle is where your eyes already are, and a command bar absorbs the long tail of rare actions without needing a menu for each. U0 confirms or overturns this.

## Settings: what stays

Everything not listed here loses its UI and is fixed to a default. Deleting the setting keys themselves is left to the pruning slices (S6–S11), so this slice can't break stored data.

| Group | Keeps |
|---|---|
| Anki | Connection status (URL editable only when the connection fails), deck, note type, field mapping for sentence / word / audio / definition / translation |
| Subtitles | Size, position, background on/off, show translation line on/off |
| Shortcuts | Mine, replay line, previous / next line, toggle subtitles, open command bar. About 6 instead of 77 |
| Transcriber | Whisper server URL and a status dot |
| Sites | Per-site on/off, only for the sites kept in S7 |

Target: **one screen, 20 or fewer controls, no tabs.**

## Sub-slices

| # | Sub-slice | Ships |
|---|---|---|
| U0 | **Pick a direction.** Throwaway HTML mocks of directions 1–3 over a paused NPO frame (use the `prototype` skill). You pick one, and the result is written below under "Chosen direction". | A decision, no product code |
| U1 | **Design tokens.** Replace `common/theme/theme.ts` with the chosen palette, type scale, radius and spacing, plus light and dark modes. Every MUI screen picks it up for free. | A new look everywhere, small diff |
| U2 | **One settings screen.** A new single-screen settings form with the table above. The old tabs are no longer routed to. | Fixes option overload |
| U3 | **Video UI.** The chosen in-video interaction (living subtitle, or whatever U0 picked) replaces the hover controls. | Fixes clunky menus over the video |
| U4 | **Menus.** The popup and the subtitle picker are folded into the chosen menu pattern (command bar, or whatever U0 picked). | Fixes the remaining clunky menus |
| U5 | **Anki dialog.** The mining dialog is redesigned in the chosen direction (sentence, word, translation and audio at a glance, one Mine button). S2–S4 keep only the behavior this doesn't cover. | Fixes the last clunky screen |

U2 and U3 are independent after U1, so they can run in either order.

## Acceptance criteria

- [x] U0: three mocks exist, a direction is chosen and recorded here with the reason.
- [x] U1: popup, settings, the Anki dialog and the subtitle picker all render with the new tokens in light and dark mode, with no leftover `#ff3f78` pink.
- [x] U2: the settings screen has no tabs and 20 or fewer controls, and an existing install keeps its Anki deck, fields and shortcuts after upgrading.
- [ ] U3: on NPO Start you can replay a line, look up a word, show the translation and mine the sentence without opening any menu.
- [ ] U4: loading a subtitle file, starting a Whisper transcription and shifting the offset each take one entry point, reachable by the keyboard.
- [ ] Every interactive element is keyboard reachable and meets WCAG AA contrast in both modes.
- [ ] `pnpm run verify` passes (see the S1 note on Windows), and the manual smoke test passes on NPO Start and YouTube.

## Answered questions (2026-11-21)

1. Clunkiest menus: all three (video controls, subtitle picker, toolbar popup). Order stays U3 then U4.
2. Translation line: **on demand**. Dutch only by default, and a key or hover shows the English.
3. Look: **Arc / Apple TV**, so soft, glassy surfaces with lots of space. The mocks lean that way without copying either.
4. Anki dialog: **restyled in this slice** as U5. S2–S4 shrink to the behavior changes that U5 doesn't cover.

## Plan

U1 uses the shared MUI theme for the violet palette, typography, focus rings, and translucent dialog surfaces. The popup and legacy brand accents use the same palette. The iframe background stays transparent so the video remains visible around the dialogs.

U2 rewrites `SettingsForm` as one scrolling screen with no tabs, keeping its props so the popup, the settings page and the app dialog need no changes. There are three sections: Anki (a connection row, with the URL field only while Anki isn't connected; deck; note type; sentence, word, definition, translation and audio fields; test card), Subtitles (size, bottom offset, background on/off), and Shortcuts (mine, mine with dialog, replay, previous, next, toggle subtitles). In the extension there's also a Transcriber status row. Section ids reuse the old tab ids, so deep links still land. The old `*SettingsTab` files stay but are unrouted; deleting them is left to S6–S11. Three deviations from the table above:

- The **translation line on/off** toggle isn't needed, because the English line is on demand (answered question 2). U3 adds the on-demand control.
- The **Whisper URL** isn't a setting (it's fixed in `project.json`), so the Transcriber row is just a status dot.
- **Sites** waits for S7: no per-site on/off setting exists yet, and S7 decides which sites stay.

Filled in per sub-slice before building. Known entry points: `common/theme/theme.ts` (all MUI theming), `common/components/SettingsForm.tsx` + `*SettingsTab.tsx`, `extension/src/ui/components/Popup.tsx`, `common/components/VideoDataSyncDialog.tsx`, `extension/src/entrypoints/video.content/` (overlay and controls).

## Chosen direction

Use the **living subtitle** for replay, word lookup, translation, and mining. Use the **command bar** for loading subtitles, transcribing an episode, shifting timing, and opening settings. This keeps the actions for the current sentence beside the line and the occasional actions within keyboard reach.

The initial extension icon is [Dutch A, Sentence to Flashcard](S13-u0-prototype/icons/codex-dutch/icon-a.svg). [Glass B, Folded Prism](S13-u0-prototype/icons/codex-glass/icon-b.svg) is saved as an alternate.

## Verification log

- U1: the built popup, settings, subtitle picker, and Anki dialog rendered with the new palette in both modes in Chromium. The tested text color pairs passed 4.5:1 contrast, and input borders passed 3:1.
- Common typecheck, client and extension compile, 32 focused tests, and lint and formatting for the touched code passed. Full `pnpm run verify` stopped at the Windows generated-file line-ending issue recorded in S1.
- U2: in the web app's settings dialog (Chromium, dark mode) there are no tabs, 19 controls including the dialog's profile picker, and the `#keyboard-shortcuts` deep link scrolls to its section. The Anki row switched from the URL field to "Connected to Anki" once Anki allowed the origin. No setting keys changed, so stored decks, fields and shortcuts carry over. Common typecheck, client and extension compile, lint, prettier, 69 related tests and locale key parity all passed. The extension popup and settings page were not checked by eye.

## Retro
