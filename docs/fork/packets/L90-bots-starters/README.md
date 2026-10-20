# L90: Starter bots

Status: Implemented on `feat/loom-bots`.

Loom ships three ready-made bots that Kyle can run on day one and edit like any other bot: a
merge conflict resolver, a reviewer and a verifier. They are seeded once into the bot library,
marked as starters, and can be restored to the shipped text at any time. They also serve as the
reference examples that "Save as bot" (L96) and version history (L98) point to.

B01 | Complexity: Small | Impact: High | Depends on: L89

## Scope

- In: three starter definitions with tuned instructions, typed inputs, fixed modes, timeouts and
  concurrency; a `caller` checkout option so the resolver runs in the checkout that holds the
  conflict; one-time seeding on startup; a starter marker on the definition; "Restore
  starter" on the Bots page and through MCP; recreating a deleted starter on request.
- Out: automatic upgrades when a later Loom ships a new starter text (the page offers a restore
  instead); starters for other roles; per-adapter tool allowlists (the reviewer is read-only by
  instruction and interaction mode, not by a tool filter, as in L89).

## Surfaces

Web and desktop: a "Starter" chip on the bot card and a "Restore starter" action in the editor.
Mobile: nothing new; bots are not on mobile yet. Remote: seeding is server-side, so every
environment seeds its own starters; restore is an RPC like any other bot write.

## Extension points used

None new (L89's): `ext-core`, persistence, background work under `forkParked`, `ext-mcp`.
Capability sub-feature `bots-starters` in `LOOM_SERVER_FEATURES`.

## Packet seams

None.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
