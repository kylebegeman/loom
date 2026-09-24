# L08: Multi-thread runs and swarm dock

Status: Ready to build.

Work that spans several threads at once. **Compare**: send one prompt to several providers
or models in one step, or to one model several times, each in its own thread and (by
default) its own worktree, grouped as a run, with an optional Jev ranking hint. **Delegation**: an agent can start another thread through exactly two MCP tools,
`loom_multi_thread_runs_start_thread` and `loom_multi_thread_runs_get_thread`, including on a
different provider (a Claude thread hands a task to Codex and later reads the result), with
optional Jev routing of model and effort when the agent names none. The children are
ordinary threads the user can open, steer and stop. A **Runs** panel lists the
project's runs with live status, filters, and actions to open, stop, archive or view members
side by side.

## Scope

- In:
  - Compare dialog: prompt, 2 to 6 members (provider instance and model each), or one
    provider and model run 2 to 6 times ("Same model, several times"); workspace (separate
    worktrees or project root), base branch, runtime and interaction mode.
  - Jev ranking hint on a finished compare run against an editable rubric (feature
    `multi-thread-runs.compare-rank`), labeled as a hint from excerpts; fallback: no ranking.
  - Jev routing of model and reasoning effort for delegated threads that name no model
    (feature `multi-thread-runs.delegate-routing`), from Kyle's routing candidates, only with
    "Let agents use this" on; fallback: the caller's model and effort.
  - Server-side thread starter shared by compare and delegation: optional worktree, thread
    creation, project setup script, first turn. All through existing commands.
  - Run grouping in fork tables (`fork_multi_thread_runs_runs`,
    `fork_multi_thread_runs_members`), one run per compare and one delegation run per agent
    thread.
  - Two MCP tools on T3's existing MCP server, gated by a Loom setting that is off by
    default, with limits: at most N active children per thread, depth limit, runtime mode
    never above the calling thread's. Delegated threads get a new worktree by default;
    `worktree: false` uses the caller's workspace for read-only jobs.
  - `get_thread` returns status, the last assistant message and a change summary, and can
    wait (event-driven, up to 120 s) until the child stops working.
  - Runs panel (right panel `multi-thread-runs`, letter N): project-wide, filterable by
    status, provider and text; per-member status, open, stop, side by side (when L02 is
    present); run actions stop all, archive, unarchive, remove.
  - Loom settings section "Multi-thread runs" for the delegation toggle and limits.
  - Palette items and unbound keybindings for "Compare models" and "Show runs".
  - Cleanup when threads or projects are deleted.
- Out:
  - Old Loom's orchestration toolkit (about 15 tools: list, send, wait, transfer,
    interrupt, delegate tasks, schedules). Exactly two tools here.
  - Automatic merging or judging of compare results, and any action taken from the Jev
    ranking hint (it only informs).
  - DAG scheduling, retries, budgets, leases (old Loom Swarm phase 59).
  - A bottom dock of its own. The Runs view is a right panel; if L07's bottom dock is
    present it can also host it.
  - Attachments in compare prompts (text only in v1).
  - Mobile UI.

## Surfaces

Web and desktop: supported. Mobile: not supported; compare members and delegated threads
appear as ordinary threads in the upstream mobile app. Remote: works over every connection
mode (fork RPCs; MCP tools run on the environment's server). Upstream T3 server: every entry
point is hidden (`loomFeatures` lacks `multi-thread-runs`); the MCP tools do not exist there.
Jev UI is hidden when the server lacks the `decide` capability.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPCs, services, persistence, reactor, capability).
- [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp) (the two tools).
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (Runs panel).
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (delegation settings section).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (compare dialog host, command listener) and [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette).
- `ext-decide` ([EXTENSION-POINTS.md, section 18](../EXTENSION-POINTS.md#18-decisions-with-jev-ext-decide)): the features
  `multi-thread-runs.delegate-routing` and `multi-thread-runs.compare-rank`. If it does not
  exist, create it exactly as specified in EXTENSION-POINTS.md section 18, in its own commit,
  before packet code.

## Packet seams

None. Everything goes through extension points.

## Optional integrations

- If L02 (thread lineage) is present:
  - the server records each delegated child in `fork_thread_lineage_links` (kind
    `delegate`) when that table exists, so it shows in L02's Related threads panel;
  - member rows offer "Open side by side" through L02's `thread-lineage:thread` panel when
    it is registered.
- If L07 (bottom dock) is present, register the runs list as a dock tab through L07's
  registry.
- If L04 (thread inspector) is present, register a "Runs" inspector section (the thread's
  delegated children and their status).

- If L29 (Jev hub) is present, routing and ranking decisions appear in its Decisions panel
  (they are logged in the shared `fork_decide_decisions` table), where Kyle can rate them and tune
  the thresholds. No work here.

None is required.

## Size

About 2,700 to 3,300 lines including tests: thread starter, run service, MCP toolkit and
reactor about 1,000; Jev routing and ranking about 400; contracts 250; web panel, dialog
(both modes), rank hint, settings (with routing candidates) and palette about 1,400.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
every file here, then follow [IMPLEMENTATION.md](./IMPLEMENTATION.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
