# L07: Bottom dock

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

Turns the area under the chat, which today holds only upstream's terminal drawer, into a
tabbed dock. The terminal stays exactly as it is and becomes the dock's first tab. Next to
it come fork tabs, each built and shipped on its own: **Tasks** (the project's scripts and
ad-hoc commands, each with its own live output) and **Approvals** (every pending approval
across threads, answerable in place). The dock is resizable, shows one tab at a time, and
remembers its tab and height per thread.

## Retired parts

Kyle approved on 2026-10-09 retiring two phases. The remaining phases keep their original
numbers.

- **Phase 3, Activity** (a searchable, filterable timeline of the thread): upstream T3 Code
  (Orchestrator V2, now in Loom nightly) covers it with find in thread and the timeline
  minimap.
- **Phase 5, Risk** (an advisory Jev risk badge on each pending approval): Kyle dropped Jev
  support from Loom; Jev moved to its own project outside Loom.

Their design, tests and steps are removed from this folder; git history keeps them. Phase 5
was the only phase with server code, so the packet is now client-only.

## Phases

Kyle asked for each tab to be its own feature set. Each phase is independently shippable
and ends with the tree green and the feature usable.

| Phase        | Delivers                                                                                                                                                                                                                           | Depends on            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1. Shell     | The dock container, tab registry, per-thread dock store, tab strip, shared height and resize, keyboard and palette plumbing. The terminal drawer is hosted unchanged. With no fork tab registered the UI is identical to upstream. | Extension points only |
| 2. Tasks     | Project scripts and ad-hoc commands, each in its own terminal session, with status and live output in the dock.                                                                                                                    | Phase 1               |
| 4. Approvals | Pending approvals and questions across all threads and connected environments, with approve and decline in place.                                                                                                                  | Phase 1               |

Phases 2 and 4 do not depend on each other and can land in either order. Phase 1 is
invisible on its own (the tab strip stays hidden while Terminal is the only tab); land it
with whichever tab comes first, or alone if Kyle wants the seam reviewed separately.

## Scope

- In: the three phases above, web and desktop. Task sessions (`task-*`) also stay listed in
  the Terminal tab's session list (no seam to hide them).
- Out:
  - Old Loom's Run Ledger and Run Packets tabs (they were tied to old Loom's runs and
    artifacts systems, which T3 does not have).
  - Side-by-side dock columns (old Loom allowed three); one tab at a time.
  - Moving the terminal between dock and right panel (upstream already has a right panel
    terminal surface; both keep working as they do).
  - Exit codes for Tasks (tasks run in an interactive shell, like upstream's script
    runner; the tab shows running or finished, not the exit status).
  - Mobile UI.
  - The Activity tab and the Jev risk badge: retired, see above.

## Surfaces

- Web and desktop: supported. Desktop uses the same bundle.
- Mobile: not supported. Mobile has no drawer; the upstream app is unaffected.
- Remote: every phase uses upstream client state and upstream RPCs (terminal, orchestration
  commands), so all work over every connection mode.
- Upstream T3 server: every phase works (no server support needed, no `loomFeatures`
  entry).

## Extension points used

- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (dock commands), may create them.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (dock actions), may create it.
- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): only the client helper that `ext-palette` imports; no server pieces.

## Packet seams

One upstream file: `apps/web/src/components/ChatView.tsx`, 3 marked lines (an import and a
one-element JSX insertion just above the terminal drawer). See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If packet L02 later wants a dock tab, it registers into this packet's dock tab registry.
  That is its decision; nothing here depends on it.

## Size

Phase 1: about 500 lines. Tasks: about 600. Approvals: about 600. Tests included. One agent
per phase, roughly one day each.

## How an agent starts

Read `AGENTS.md`, `FORK.md`, the packets `README.md`, `CONVENTIONS.md`,
`EXTENSION-POINTS.md` (sections 5, 8 and 9), then this folder in order: PRODUCT, TECHNICAL,
SEAMS, IMPLEMENTATION (the phase you are building), TESTING, REFERENCES. If phase 1 is not
in the tree yet, build it first.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, per phase.
- [TECHNICAL.md](./TECHNICAL.md): the design, per phase.
- [SEAMS.md](./SEAMS.md): the ChatView seam.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps per phase.
- [TESTING.md](./TESTING.md): how each phase is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
