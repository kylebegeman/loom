# L94: Inbox

Status: Implemented on `feat/loom-bots`. See [SEAMS.md](./SEAMS.md) for where the build
differs from this plan.

One place for bot runs that need Kyle. Failed runs, timed-out runs and runs whose verdict is
"needs attention" collect in a Bots inbox with a count ("2 need attention") on the Bots entry.
Each item offers retry, retry on another model, dismiss, and "Open as thread", which forks the
hidden run into an ordinary sidebar thread so Kyle can take over the conversation. Runs that are
blocked on an approval or question show at the top, because a hidden run cannot ask anyone.

B05 | Complexity: Medium | Impact: High | Depends on: L89 (L92 for verdicts)

## Scope

- In: the inbox predicate and query; the count; retry with an optional model override; dismiss
  and undismiss; "Open as thread"; a "Waiting for you" section for runs with a pending approval or
  question; recording the model each run used; MCP `loom_bots_inbox`, `loom_bots_retry`,
  `loom_bots_dismiss`; palette "Open bots inbox".
- Out: notifications outside the app; grouping by error class; automatic retry policies (L97
  triggers can rerun on a schedule).

## Surfaces

Web and desktop: an Inbox tab on the Bots page and a count on the Bots footer entry. Mobile:
nothing new; promoted threads are ordinary threads and appear on mobile like any other. Remote:
RPC and the existing `loom.bots.watch` stream. Gated on `bots-inbox`.

## Extension points used

None new (L89's): `ext-core`, persistence, `ext-palette`, `ext-mcp`. Capability sub-feature
`bots-inbox`.

## Packet seams

None. Promotion dispatches `thread.fork` through `ThreadManagementService`, the same path as the
`t3_thread_fork` MCP tool.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
