# Lxx implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Seed a worktree `.t3` with real data if the feature needs it (AGENTS.md, "Test data").

## Steps

1. Extension points: run each existence check; create missing ones in their own commits.
2. Contracts.
3. Server services, storage and RPC handlers.
4. Client-runtime atoms.
5. Web UI and registrations.
6. Desktop or mobile parts, if in scope.
7. Documentation: `docs/fork/user/<slug>.md` if users need it, FORK.md rows, the packet
   index Status.

Replace the list with concrete, packet-specific steps.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus any
packet-specific acceptance criteria listed here.
