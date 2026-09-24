# L07: Bottom dock

Status: Ready to build. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

Turns the area under the chat, which today holds only upstream's terminal drawer, into a
tabbed dock. The terminal stays exactly as it is and becomes the dock's first tab. Next to
it come fork tabs, each built and shipped on its own: **Tasks** (the project's scripts and
ad-hoc commands, each with its own live output), **Activity** (a searchable, filterable
timeline of everything that happened in the thread) and **Approvals** (every pending
approval across threads, answerable in place, with an optional Jev risk badge). The dock is
resizable, shows one tab at a time, and remembers its tab and height per thread.

## Phases

Kyle asked for each tab to be its own feature set. Each phase is independently shippable
and ends with the tree green and the feature usable.

| Phase        | Delivers                                                                                                                                                                                                                           | Depends on            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1. Shell     | The dock container, tab registry, per-thread dock store, tab strip, shared height and resize, keyboard and palette plumbing. The terminal drawer is hosted unchanged. With no fork tab registered the UI is identical to upstream. | Extension points only |
| 2. Tasks     | Project scripts and ad-hoc commands, each in its own terminal session, with status and live output in the dock.                                                                                                                    | Phase 1               |
| 3. Activity  | Searchable timeline of tool calls, approvals, errors, plans and checkpoints for the thread; chat messages behind a "Messages" toggle (off by default).                                                                             | Phase 1               |
| 4. Approvals | Pending approvals and questions across all threads and connected environments, with approve and decline in place.                                                                                                                  | Phase 1               |
| 5. Risk      | Advisory Jev badge on each pending approval (Read-only, Reversible, Irreversible) through `ext-decide`; no badge when Jev is off, slow, failing or unsure. The only phase with server code.                                        | Phase 4, `ext-decide` |

Phases 2, 3 and 4 do not depend on each other and can land in any order. Phase 1 is
invisible on its own (the tab strip stays hidden while Terminal is the only tab); land it
with whichever tab comes first, or alone if Kyle wants the seam reviewed separately. Phase 5
follows phase 4.

## Scope

- In: the five phases above, web and desktop. Task sessions (`task-*`) also stay listed in
  the Terminal tab's session list (no seam to hide them).
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
  - Any automatic action from the risk badge (auto-approve, auto-decline, reordering by
    risk). The badge is advice only.

## Surfaces

- Web and desktop: supported. Desktop uses the same bundle.
- Mobile: not supported. Mobile has no drawer; the upstream app is unaffected.
- Remote: phases 1 to 4 use upstream client state and upstream RPCs (terminal, orchestration
  commands); phase 5 uses one fork RPC. All work over every connection mode.
- Upstream T3 server: phases 1 to 4 work (no server support needed). The risk badge is
  gated on `loomFeatures` containing both `bottom-dock` and `decide`; without them no badge
  is shown.

## Extension points used

- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (dock commands), may create them.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (dock actions), may create it.
- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): phases 1 to 4 only need the client helper that `ext-palette` imports; phase 5 adds the fork RPC group entry, a `ForkLayer` service and the `bottom-dock` capability.
- `ext-decide` ([EXTENSION-POINTS.md, section 18](../EXTENSION-POINTS.md#18-decisions-with-jev-ext-decide), phase 5): the
  `bottom-dock.approval-risk` feature (`agentTool: false`). If it does not exist, create it
  exactly as specified in EXTENSION-POINTS.md section 18, in its own commit, before phase 5
  code. It needs [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (its Jev
  section), which phase 5 creates first if missing.

## Packet seams

One upstream file: `apps/web/src/components/ChatView.tsx`, 3 marked lines (an import and a
one-element JSX insertion just above the terminal drawer). See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If packet L28 (auto-resume) is present, its `loom.auto-resume.*` markers show in Activity
  like any other activity. No work here.
- If packet L02 or L08 later wants a dock tab, it registers into this packet's dock tab
  registry. That is their decision; nothing here depends on them.
- If packet L29 (Jev hub) is present, risk badge decisions show in its Decisions panel and
  can be rated and replayed there, because they are logged in the shared `fork_decide_decisions`
  table. No work here.

## Size

Phase 1: about 500 lines. Tasks: about 600. Activity: about 700. Approvals: about 600. Risk
badge: about 450 (server service, contract, badge, tests). Tests included. One agent per
phase, roughly one day each (half a day for phase 5).

## How an agent starts

Read `AGENTS.md`, `FORK.md`, the packets `README.md`, `CONVENTIONS.md`,
`EXTENSION-POINTS.md` (sections 5, 8, 9; for phase 5 also 1, 7 and 18), then this folder in order: PRODUCT, TECHNICAL,
SEAMS, IMPLEMENTATION (the phase you are building), TESTING, REFERENCES. If phase 1 is not
in the tree yet, build it first.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, per phase.
- [TECHNICAL.md](./TECHNICAL.md): the design, per phase.
- [SEAMS.md](./SEAMS.md): the ChatView seam.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps per phase.
- [TESTING.md](./TESTING.md): how each phase is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
