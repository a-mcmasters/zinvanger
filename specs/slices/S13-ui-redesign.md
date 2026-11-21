# S13: Redesign the UI around watch, replay, look up, mine

Status: Specced (2026-11-21)
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

U2 and U3 are independent after U1, so they can run in either order.

## Acceptance criteria

- [ ] U0: three mocks exist, a direction is chosen and recorded here with the reason.
- [ ] U1: popup, settings, the Anki dialog and the subtitle picker all render with the new tokens in light and dark mode, with no leftover `#ff3f78` pink.
- [ ] U2: the settings screen has no tabs and 20 or fewer controls, and an existing install keeps its Anki deck, fields and shortcuts after upgrading.
- [ ] U3: on NPO Start you can replay a line, look up a word, show the translation and mine the sentence without opening any menu.
- [ ] U4: loading a subtitle file, starting a Whisper transcription and shifting the offset each take one entry point, reachable by the keyboard.
- [ ] Every interactive element is keyboard reachable and meets WCAG AA contrast in both modes.
- [ ] `pnpm run verify` passes (see the S1 note on Windows), and the manual smoke test passes on NPO Start and YouTube.

## Open questions

1. Which menus feel clunkiest: the toolbar popup, the subtitle picker, or the right-click and hover controls on the video? This sets the order of U3 and U4.
2. Should a translation line show by default (as an A1–A2 learner), or only on demand?
3. Is there an app whose look you like (Linear, Arc, Duolingo, Language Reactor, Apple TV)? It's useful input for U0, not a template to copy.
4. The S2–S4 Anki dialog work overlaps U1–U4. Should the dialog be restyled in this slice, or keep S2–S4 as they are and just inherit the U1 tokens?

## Plan

Filled in per sub-slice before building. Known entry points: `common/theme/theme.ts` (all MUI theming), `common/components/SettingsForm.tsx` + `*SettingsTab.tsx`, `extension/src/ui/components/Popup.tsx`, `common/components/VideoDataSyncDialog.tsx`, `extension/src/entrypoints/video.content/` (overlay and controls).

## Chosen direction

_Filled in after U0._

## Verification log

## Retro
