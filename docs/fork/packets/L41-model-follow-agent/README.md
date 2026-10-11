# L41: Follow the agent's models

Status: Implemented locally (`feat/model-follow-ghost-snap`).

Focused evidence and remaining client checks: [TESTING.md](./TESTING.md).

Approved by Kyle on 2026-10-10.

When an agent turn writes or changes a model, Loom offers to open it. The turn's changed files
card in the chat gets a chip that reads "Open bracket.scad" or "Open 3 models". If the 3D panel
is already open in that thread, new models arrive as background tabs and tabs whose file changed
get a dot until you look at them. A setting chooses how far Loom goes: offer to open (the
default), open automatically, or do nothing. Loom learns what changed from the turn's checkpoint,
the same record the diff panel uses, so it never watches the whole workspace. A SCAD file counts
as changed when the turn edited a file it includes or imports.

## Scope

- In:
  - A server method that maps one turn's checkpoint files to the models it affects: model files
    written directly, and SCAD files whose includes, `use` libraries or imports changed.
  - A turn chip on the changed files card, with a dismiss button.
  - Background tabs for new models and a changed dot on open model tabs, while the panel is open.
  - "Open automatically", which opens the panel on the first model when it is closed.
  - The setting "When an agent writes a model" in Settings > Loom > 3D model.
  - A "Changed by the agent" section in the model picker and a palette entry
    "3D model: Open models from the last turn", both of which work without the chip.
  - Tab titles for agent-opened models (today they read "3D model", see TECHNICAL.md).
- Out:
  - Watching the filesystem for edits made outside agent turns. Live reload already covers open
    tabs; files you write yourself are not "the agent's models".
  - Turns in workspaces that are not Git repositories. They have no checkpoint, so no chip.
  - Subagent and tool checkpoint scopes. Only root turns get a chip, like "Open diff".
  - Timeline and restore of older versions. That is L49.
  - Mobile. It has no 3D panel.

## Surfaces

- Web and desktop: supported. The chip lives in the chat timeline; tabs and marks live in the
  right panel.
- Mobile: not supported. The mobile timeline shows no chip because mobile has no 3D panel.
- Remote: works over LAN, Tailscale and T3 Connect. The client sends a thread and run id and
  gets back a short list of paths; mesh bytes still load over the signed file route.
- Upstream T3 server: the chip and the setting are hidden because the environment lacks the
  `model-follow-agent` capability (along with the base `model-preview-3d` capability).

## Extension points used

- Existing from L23: `ext-core` (RPCs), `ext-panels` (the 3D panel and its tab icon),
  `ext-settings` (the settings section), `ext-palette` (the palette entry), `ext-web-root`
  (the host component already mounted as `ModelPreview3dShortcuts`).
- Refined, fork-owned only: `ext-panels` gains an optional `TabIcon` on `ForkPanelDefinition`
  so a panel can decorate its own tab. No upstream line changes; EXTENSION-POINTS.md needs a
  sentence (see SEAMS.md).

## Packet seams

One upstream file, two marked lines: `apps/web/src/components/chat/ChangedFilesTree.tsx` gets
an import and one JSX line that renders the fork's turn chip at the start of the changed files
card's header actions (`fork: model-follow-agent`). EXTENSION-POINTS.md says a spot with one
consumer stays a packet seam until a second packet needs it, so this is not a new extension
point. L59 (PCB follow-agent) is that second packet: it proposes promoting the spot to an
`ext-changed-files` registry, pending Kyle's decision. If he approves, whichever of L41 and
L59 lands first creates the registry (L59 SEAMS.md) and L41 registers its chip there instead
of this seam. The turn-to-files logic is shared too, in `apps/server/src/fork/turnFiles.ts`
(L59 TECHNICAL.md, "Shared module"); whichever lands first creates it. Background tabs go through the panel store's public `setState` from fork code
(TECHNICAL.md, "Background tabs"), not through a new store action.

## New dependencies

None.

## Relationship to other follow-up packets

- L49 (history): independent. Both read checkpoints. They share the SCAD reference parser
  `apps/server/src/fork/model-preview-3d/scadIncludes.ts`; whichever lands first creates it as
  written in TECHNICAL.md. With L49, the changed tab's dot tooltip offers "Compare with the
  previous version".
- L42 (change ghost): independent. The dot says a tab changed; L42's ghost shows what changed
  once you open it. Neither needs the other.
- L50 (Python CAD): adds `.py` build123d sources and STEP previews. This packet reads the
  previewable format list from one place (`PREVIEWABLE_FORMATS`), so L50 adds its formats there.
- L59 (PCB follow-agent): shares the changed files card integration and background-tab
  behavior. After its extension point decision is approved, both chips use the same registry.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
