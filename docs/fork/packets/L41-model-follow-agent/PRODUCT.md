# L41 product

## Problem

Most CAD work in Loom is a loop: ask the agent for a change, look at the part, ask again. Today
the looking step starts with a hunt. After a turn you open the 3D panel, search the picker for
the file the agent just wrote, and open it. When the agent edits `gear.scad`, nothing tells you
that `bracket.scad`, which includes it, now looks different. And when the agent opens a model
for you through the editor tool, its tab is titled "3D model" instead of the file name.

## What the user can do

- See which models a turn produced, right on that turn's changed files card, and open them with
  one click: "Open bracket.scad" for one model, "Open 3 models" for several.
- Keep the 3D panel open while working and have new models appear as background tabs, without
  the panel jumping away from the part you are looking at.
- See a dot on any open model tab whose file (or an included file) the agent changed, until you
  switch to that tab.
- Choose in settings how far Loom goes: "Offer to open", "Open automatically" or "Do nothing".
- Reopen the agent's models later from the model picker ("Changed by the agent") or the command
  palette ("3D model: Open models from the last turn").

## Entry points

| Way in                                                                    | Way out                                                                     | Way to see the state                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| Turn chip "Open bracket.scad" / "Open 3 models" on the changed files card | Close the tabs; the chip stays for a later reopen                           | The tab appears and is active                         |
| Chip dismiss button ("Hide for this turn")                                | None needed per turn; the models stay in the picker section and the palette | The chip is gone for that turn on this browser        |
| Setting "When an agent writes a model"                                    | Choose "Offer to open" or "Do nothing" again                                | The setting row shows the current choice              |
| Background tab (panel already open)                                       | Close the tab                                                               | The tab sits after the active one with a dot          |
| Changed dot on an open tab                                                | Switch to the tab; the dot clears                                           | The dot; its tooltip "Changed by the agent in turn 6" |
| "Open automatically" with the panel closed                                | Close the panel or the tab                                                  | The panel opens on the first model                    |
| Picker section "Changed by the agent"                                     | Close the tabs                                                              | The section lists the last turn's models              |
| Palette "3D model: Open models from the last turn"                        | Close the tabs                                                              | The tabs open; an empty result says so                |

The agent can already open, close and maximize the panel through `loom_model_preview_3d_editor`.
The setting is part of the 3D settings, so `loom_model_preview_3d_settings` and
`loom_model_preview_3d_save_settings` read and change it.

## Behavior by setting

|                         | Panel closed                                                     | Panel open with a 3D tab                                   |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Offer to open (default) | Chip only                                                        | Chip, background tabs for new models, dots on changed tabs |
| Open automatically      | Opens the panel on the first model; the rest are background tabs | Same as "Offer to open"                                    |
| Do nothing              | Nothing                                                          | Nothing (live reload still updates open tabs)              |

"Panel open with a 3D tab" means the thread's right panel is open and already holds at least one
3D model tab. An open panel showing only the diff or a browser is treated as closed for models,
so a turn never fills the diff user's tab bar with models they did not ask for.

A turn opens at most 8 background tabs. When a turn affects more models than that, the chip reads
"Show 12 models" and opens the picker filtered to that turn.

## States

- Loading: the chip is not shown until the model list arrives (usually under 100 ms). The card's
  "Open diff" button is unaffected and never waits for it.
- Empty: a turn that changed no models shows no chip. The picker section is hidden when the last
  turn with models is not known; the palette entry says "The agent has not changed a model in
  this thread."
- Error: if the lookup fails, the chip is hidden and the error is logged; the turn card must
  never show a broken control. The palette entry shows the failure as a toast.
- Disabled: "Do nothing" hides chips, tabs and dots. Without the `model-preview-3d` capability,
  or when the 3D panel is unavailable, nothing renders. A connection without the operate scope
  can still open tabs (opening is client state); the setting row is read-only, like other rows.
- Stale: a model deleted after the turn is left out of the chip. A model the chip already opened
  that is later deleted shows the panel's existing "The file was deleted or moved." message.
  A dismissed chip stays dismissed on this browser even after a reload.

## Surfaces and connection modes

Web and desktop share the code. Mobile has no 3D panel and shows no chip. Over LAN, Tailscale and
T3 Connect the lookup is one small RPC per visible turn card that changed a candidate file, and
one stream per open thread for background tabs. Mesh bytes keep using the signed file route.
Each client acts on its own panel: two browsers on one thread both get background tabs, which
is correct because each has its own tabs.

## Decisions

- The checkpoint is the source of truth. It is the same file list as "Open diff", it covers every
  provider, and it costs nothing extra to capture.
- The chip goes on the changed files card, next to "Open diff". It is per turn, it only exists
  when files changed, and it is where people already look after a turn.
- The chip appears on every turn card that changed models, not only the latest. Older turns are
  where you go to reopen a model from earlier, and "Open diff" works the same way.
- Background tabs only when the panel already shows a 3D tab. An open panel means you are working
  on models, and a background tab costs nothing until clicked.
- Dismissal is per turn and stored on this browser. It is a view preference, like collapsed
  folders, not shared state.
- The setting is environment-wide, next to the other 3D settings, so agents can read it and every
  client of the environment behaves the same.
- Auto-open never fights the diff. If upstream's proactive panels open the diff for the same turn,
  the model tabs arrive in the background beside it (TECHNICAL.md, "Proactive diff").
- Files Git ignores never trigger. The checkpoint only records files Git would track, so an STL
  exported into an ignored `build/` folder gets no chip. The picker still lists it.
- A SCAD file counts as changed through includes, `use` libraries and literal `import()` and
  `surface()` paths inside the workspace. Library files outside the workspace never trigger.

## Decisions needed from Kyle

None block the build. Two are worth a glance:

1. The chip is a packet seam of two marked lines in
   `apps/web/src/components/chat/ChangedFilesTree.tsx`, a file with 19 upstream commits since
   July. Recommendation: accept it. The header action group the seam sits in has been stable,
   and if the seam ever becomes a burden, the picker section, palette entry, background tabs
   and dots still carry the feature without it.
2. Upstream's proactive diff (the "Proactive panels" setting) can switch the panel from
   a model to the diff when a turn edits at least 3 files or 50 lines, even while you are
   looking at the model (`apps/web/src/components/ChatView.logic.ts:183-205`).
   Recommendation: leave it for now. Suppressing it would need a second seam in
   `ChatView.logic.ts`; revisit if it annoys you in practice.
