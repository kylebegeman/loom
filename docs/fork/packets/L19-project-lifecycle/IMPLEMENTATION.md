# L19 implementation boundaries

Lanes, leases, selected-computer preparation, linked continuation and managed checkout
release/reopen are implemented. Preserve these boundaries when changing the vertical:

- Lane output and leased resources have explicit ownership. The lane service does not delete
  arbitrary checkout roots or resources it cannot identify.
- Existing connected environments, clone tracking and thread launch own machine selection
  and preparation. Keep transports thin and share service paths across clients and agents.
- Successful Loom clones and explicitly reviewed existing primary repositories create
  ownership receipts. Opening a folder or enabling cleanup never adopts it. Adoption and
  retention changes recheck the authoritative project and review fingerprint under a lease.
- Keep, release-on-settle and inherited defaults govern the primary folder only. Keep restores
  a released owned folder without running setup; worktree cleanup remains independent.
  Version 1 receipts inherit host defaults. Older runtimes cannot read version 2 receipts.
- Publication is an explicit Git workflow. Cleanup and handoff verify fresh publication
  evidence and preserve unique local files rather than committing or pushing them.
- Project records and repository identity survive checkout release. Passive queries must not
  materialize files; explicit use restores verified recovery before work begins.
- Workspace preparation is retryable. Pending setup survives restart, and providers do not
  start before restored setup completes. Internal held leases propagate to script terminals.
- Machine handoff creates a linked continuation. Original history and credentials remain on
  their host, and the destination verifies its own Git and provider readiness.

Tests and user-facing operation instructions are linked from [TESTING.md](./TESTING.md) and
[PRODUCT.md](./PRODUCT.md). Update the actual marker manifest when upstream integration seams
change. Use isolated server homes and disposable repositories for verification, never the
installed userdata or active lanes.
