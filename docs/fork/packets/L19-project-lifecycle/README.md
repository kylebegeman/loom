# L19: Project lifecycle

Status: In progress (`feat/loom-project-lifecycle`). Phase 1 started 2026-10-08.

Every thread gets a **lane**: a capped space for the disposable output its agent produces
(scratch files, DerivedData, package caches, build products). Loom creates the lane when
the thread starts work, keeps it inside its cap, lets the agent clean it, and throws it away
when the thread settles. Free space stops swinging by hundreds of gigabytes because output no
longer lands in shared, unowned places like `/tmp` and `~/Library/Developer/Xcode/DerivedData`.

Later phases build on lanes: leases for simulators, databases, ports and build slots
(phase 2), then the persistent machine pool with on-demand checkouts, publication and safe
parking that Kyle agreed on 2026-09-27 (phase 3).

## Scope

Phase 1 (this branch):

- In: a lane per (project, checkout), created on the first run in that checkout, under
  `~/Developer/lanes/<project>/<lane>/`.
- In: on macOS, each lane's space is a sparse ASIF disk image mounted at the lane, so its cap
  is enforced by the filesystem. Elsewhere, a plain folder with a soft cap.
- In: generous default caps (100 GB for Apple projects, 40 GB otherwise), a per-project
  override and a 40 GB machine reserve.
- In: pressure handling: steer a running agent at 75%, clear an idle lane's `tmp` at 90%,
  grow an idle full lane by half when the machine has room, warn and steer when the machine
  drops below its reserve.
- In: agent tools to read lane status, free scratch, build output or everything rebuildable,
  and grow the lane.
- In: opt-in shell integration that points `TMPDIR` and `xcodebuild` at the lane when a
  command runs inside a lane's checkout.
- In: reclaim on settle, archive and delete: the space is detached and deleted once no
  active thread uses the checkout.
- In: a Storage section in Loom settings with lanes, usage and actions; a palette entry; a
  low-space notice.
- Out (phase 2): simulator, database, port, process and build-slot leases. Simulator cleanup
  joins L09's device work.
- Out (phase 3): Loom-owned checkout preparation (moving checkouts under the lane), the
  machine pool, publication policy, park and reopen. Checkout removal stays with upstream's
  worktree cleanup rules (Settings, Storage cleanup) until then.

## Surfaces

Web and desktop: the Storage section and notices. Mobile: none; lanes still work for threads
started from mobile because everything is server-side. Remote: the server owns the lanes, so
local, tailnet and T3 Connect clients all see the same state. A client connected to a plain
T3 server or an older Loom server hides the section (`project-lifecycle` capability).

## Extension points used

`ext-core` (service, migrations, RPC, capability), `ext-settings`, `ext-palette`, `ext-root`
(low-space notice host), `ext-mcp`.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
