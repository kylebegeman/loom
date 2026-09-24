# L07: Bottom dock

Status: Not started. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

Turns the area under the chat, which today holds only upstream's terminal drawer, into a
tabbed dock. The terminal stays exactly as it is and becomes the dock's first tab. Next to
it come fork tabs, each built and shipped on its own: **Tasks** (the project's scripts and
ad-hoc commands, each with its own live output), **Activity** (a searchable, filterable
timeline of everything that happened in the thread) and **Approvals** (every pending
approval across threads, answerable in place). The dock is resizable, shows one tab at a
time, and remembers its tab and height per thread.

## Phases

Kyle asked for each tab to be its own feature set. Each phase is independently shippable
and ends with the tree green and the feature usable.

| Phase        | Delivers                                                                                                                                                                                                                           | Depends on            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1. Shell     | The dock container, tab registry, per-thread dock store, tab strip, shared height and resize, keyboard and palette plumbing. The terminal drawer is hosted unchanged. With no fork tab registered the UI is identical to upstream. | Extension points only |
| 2. Tasks     | Project scripts and ad-hoc commands, each in its own terminal session, with status and live output in the dock.                                                                                                                    | Phase 1               |
| 3. Activity  | Searchable timeline of messages, tool calls, approvals, errors, plans and checkpoints for the thread.                                                                                                                              | Phase 1               |
| 4. Approvals | Pending approvals and questions across all threads and connected environments, with approve and decline in place.                                                                                                                  | Phase 1               |

Phases 2, 3 and 4 do not depend on each other and can land in any order. Phase 1 is
invisible on its own; land it with whichever tab comes first, or alone if Kyle wants the
seam reviewed separately.

## Scope

- In: the four phases above, web and desktop.
- Out:
  - Old Loom's Run Ledger and Run Packets tabs (they were tied to old Loom's runs and
    artifacts systems, which T3 does not have).
  - Side-by-side dock columns (old Loom allowed three); one tab at a time.
  - Moving the terminal between dock and right panel (upstream already has a right panel
    terminal surface; both keep working as they do).
  - Server-side full-history search for Activity (the tab searches what the client has
    loaded, with "Load older" to page back). A later packet could add a fork RPC.
  - Exit codes for Tasks (tasks run in an interactive shell, like upstream's script
    runner; the tab shows running or finished, not the exit status).
  - Mobile UI.

## Surfaces

- Web and desktop: supported. Desktop uses the same bundle.
- Mobile: not supported. Mobile has no drawer; the upstream app is unaffected.
- Remote: every phase uses upstream client state and upstream RPCs (terminal, orchestration
  commands), so it works over every connection mode.
- Upstream T3 server: works. No phase needs server support, so nothing is gated on
  `loomFeatures`.

## Extension points used

- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (dock commands), may create them.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (dock actions), may create it.
- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core), only for the client helper that `ext-palette` imports; no server code.

## Packet seams

One upstream file: `apps/web/src/components/ChatView.tsx`, 3 marked lines (an import and a
one-element JSX insertion just above the terminal drawer). See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If packet L28 (auto-resume) is present, its `loom.auto-resume.*` markers show in Activity
  like any other activity. No work here.
- If packet L02 or L08 later wants a dock tab, it registers into this packet's dock tab
  registry. That is their decision; nothing here depends on them.

## Size

Phase 1: about 500 lines. Tasks: about 600. Activity: about 700. Approvals: about 600.
Tests included. One agent per phase, roughly one day each.

## How an agent starts

Read `AGENTS.md`, `FORK.md`, the packets `README.md`, `CONVENTIONS.md`,
`EXTENSION-POINTS.md` (sections 5, 8, 9), then this folder in order: PRODUCT, TECHNICAL,
SEAMS, IMPLEMENTATION (the phase you are building), TESTING, REFERENCES. If phase 1 is not
in the tree yet, build it first.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, per phase.
- [TECHNICAL.md](./TECHNICAL.md): the design, per phase.
- [SEAMS.md](./SEAMS.md): the ChatView seam.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps per phase.
- [TESTING.md](./TESTING.md): how each phase is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
