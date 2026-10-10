# L59: PCB follow agent

Status: Needs decision: create the `ext-changed-files` extension point and the shared
`turnFiles.ts` server module (both shared with L41).

Approved by Kyle on 2026-10-10.

When an agent writes or edits a KiCad project or a tscircuit design, the user has to notice it
in the changed files list, open the PCB panel, and pick the design from the menu. With this
packet the turn's changed files card gets a chip, "Open board", that opens the design the turn
touched in the PCB panel. One chip covers a whole KiCad project however many of its `.kicad_*`
files changed, and a design counts as changed when the turn edited any file the panel watches
for it (a sub-sheet, a project library, an imported tscircuit module), so the offer matches
exactly when the panel would reload. If PCB tabs are already open, new designs from the turn
arrive as background tabs. A setting chooses between offering (default), opening
automatically, and doing nothing. Agent-opened PCB tabs also get a real title.

## Scope

- In:
  - Server: `turnDesigns(threadId, runId)` and a `turnDesignEvents(threadId)` stream on
    `PcbPreviewService`, implemented in a new `turnDesigns.ts`, built on a shared
    `apps/server/src/fork/turnFiles.ts` (turn checkpoint lookup, repository prefix, the
    `checkpoint.captured` stream) that L41 uses too.
  - `sourceSnapshot` also returns the workspace-relative files it hashed, so "this design's
    sources" has one definition.
  - Contracts: `PcbTurnDesign`, `PcbTurnDesigns`, two RPC methods.
  - Web: `PcbTurnChip` on the changed files card through the new `ext-changed-files` point,
    `AgentDesignsHost` for background tabs and auto-open, a palette action, a settings row, a
    `pcbSurface` helper that titles every PCB tab.
- Out:
  - Changed dots on PCB tab icons (L41 adds `TabIcon` for 3D; PCB can adopt it later).
  - A "Changed by the agent" section in the design menu.
  - Highlighting what changed inside a design (that is [L60](../L60-pcb-change-highlight/)).
  - Watching the filesystem for edits made outside a turn.
  - Mobile UI.

## Surfaces

- Web and desktop: the chip in the chat timeline, the PCB panel tabs, the palette, Settings.
- Mobile: no PCB panel, nothing here. Mobile users keep seeing the changed files card without
  the chip.
- Remote: the chip and host exchange short path lists over the existing WebSocket. Design
  bytes keep flowing as L24 does today.
- Agents: no new tool. An agent that wants a design on screen already calls
  `loom_pcb_editor` with `action: "open"` (`t3 pcb editor`); this packet gives that tab a title.

## Extension points used

- `ext-panels` (PCB panel surfaces), `ext-rpc` (`loom.pcb-preview.*`), `ext-palette`,
  `ext-settings`, all reused from L24.
- `ext-changed-files` (new, created here or by L41, whichever lands first after approval; see SEAMS.md).

## Packet seams

None of its own. The two lines in `apps/web/src/components/chat/ChangedFilesTree.tsx` belong to
the `ext-changed-files` extension point. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- **L41 `model-follow-agent`**: the source of the design. Both need "files a turn changed".
  After approval, whichever lands first creates `turnFiles.ts` and `ext-changed-files`; the
  other reuses them. If L41 landed before approval with private helpers and its packet seam,
  L59 moves those helpers out of `ModelPreviewService` into `turnFiles.ts` and converts the
  card lines to the registry with both chips registered.
- **L60 `pcb-change-highlight`**: independent. A design opened from the chip that was already
  open shows L60's "Changed" chip on its next reload; a fresh tab has no previous version.
- **L66 `pcb-history`**: while a version is shown, the host does not switch the shown design;
  background tabs still open. L66 can reuse `turnFiles.ts` for its repository prefix.
- **L69 `pcb-change-requests`**: independent.
- No keyboard keys.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and file format facts.
