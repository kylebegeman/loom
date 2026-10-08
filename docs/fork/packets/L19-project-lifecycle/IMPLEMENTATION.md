# L19 implementation plan

Phase 1: lanes. Phase 2: leases. Branch `feat/loom-project-lifecycle`.

## Before starting

- Read [CONVENTIONS.md](../CONVENTIONS.md) and the `ext-core`, `ext-settings`, `ext-palette`,
  `ext-root` and `ext-mcp` sections of [EXTENSION-POINTS.md](../EXTENSION-POINTS.md).
- Use the 3D preview packet as the template for contracts, store, RPC, MCP and the settings
  section (`apps/server/src/fork/model-preview-3d/`, `apps/web/src/fork/model-preview-3d/`).
- Never test the image backend against `~/Developer/lanes` from a dev server: dev servers
  default to a lanes root under their own state directory and start disabled.

## Steps

1. **Contracts**: `packages/contracts/src/fork/project-lifecycle.ts` with settings, lane,
   status, error, methods and RPC group. Merge the group in `fork/rpc.ts`, add the watch tag
   to `ForkSubscriptionRpcTag`, add write scopes to `FORK_CLIENT_GUARDED_RPC_SCOPES`, export
   from `fork/index.ts`.
2. **Pure policy, test first**: `policy.ts` with project caps (Apple detection), lane and
   project folder naming, lane pressure actions and machine pressure, plus `policy.test.ts`.
3. **Shell files, test first**: `shell.ts` renders `lanes.tsv`, `lanes.zsh`, the
   `xcodebuild` shim and the `~/.zshenv` block; install and remove keep everything outside the
   block byte for byte. Test the hook by running `zsh` against generated files in a temporary
   directory, and the shim against a stub `xcodebuild`.
4. **Space backends**: `space.ts` image and folder backends behind one interface. Command
   output parsing is pure and tested; a macOS-only test creates, grows and detaches a small
   image in a temporary directory.
5. **Store and migrations**: settings and lanes tables, registered in `FORK_MIGRATION_SETS`.
6. **Service**: registry, ensure and reclaim with per-checkout locks, startup reconcile,
   domain event reactor, watchdog, steering, actions and the status stream. Register in
   `ForkLayer`, `ForkServices` and `LOOM_SERVER_FEATURES` (`project-lifecycle`).
7. **Transport**: RPC handlers and scopes; MCP toolkit appended to `FORK_MCP_TOOLKITS`.
8. **Client runtime**: atoms for settings and status, action helpers.
9. **Web**: Storage settings section, palette source, root low-space notice.
10. **Docs**: `docs/fork/user/project-lifecycle.md`; update the packet index and selections
    when the status changes.

## Phase 2 steps

1. **Contracts**: `buildSlots` setting, lane `ports`, `leases` and `helpers`, status
   `buildSlots`, `releaseLease` RPC with `orchestration:operate`.
2. **Policy, test first**: port blocks and the automatic slot count.
3. **Shell, test first**: index columns for lane id and port, hook exports, the `xcrun`
   function, `lane-run`, `lane-slot` and `xcrun` shims, slotted `xcodebuild` actions.
4. **Leases**: `leases.ts` parsers (tested) and commands; migration 2 for `port_base`.
5. **Service**: scan on each tick, release before detach, thread device release on settle,
   adopt and release actions, slot holders in status. Requires `DeviceService`.
6. **Transport and web**: RPC handler, MCP adopt and release tools, Storage section build
   slots, lane ports and leases with Release.

- A new thread's first run creates a mounted, capped lane; settling its last thread removes
  it; restarting the server re-attaches lanes.
- With shell integration installed, `echo $TMPDIR` inside the checkout points into the lane
  and `xcodebuild build` writes DerivedData there.
- An agent can read its lane, free it and grow it through the tools.
- Settling a lane's last thread stops its `lane-run` processes and port listeners, deletes its
  simulators and labelled Docker resources, and closes the thread's device panels.
- Two heavy `xcodebuild` builds with one slot run one after the other.
- The Storage section shows lanes and machine space and its actions work.
- `scripts/fork/loom.sh check` passes.
