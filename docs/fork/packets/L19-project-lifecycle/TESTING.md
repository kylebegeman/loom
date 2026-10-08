# L19 testing

## Automated tests

- `policy.test.ts`: caps (Apple detection, project override), lane and folder names with
  collisions, every pressure transition (steer once per crossing, reset below 60%, clear,
  grow limited by the reserve, remount threshold, machine episode and recovery), holder
  rules for settled, unsettled and archived threads.
- `shell.test.ts`: install and remove leave the rest of `~/.zshenv` untouched and are
  idempotent, including through a symlink; the generated hook, run by `zsh`, sets and
  restores `TMPDIR` and `LOOM_LANE_*` for nested, symlinked and unmounted lanes; the
  `xcodebuild` shim adds paths only to build actions, keeps explicit paths and redirects a
  missing `/tmp` path; the hook exports the lane id, ports and lease file; `lane-run`
  records its process and still runs outside a lane; `lane-run --detach` outlives the
  caller in its own process group, logs to `space/tmp` and is still recorded; `lane-slot` with one slot serializes two
  jobs and passes exit status 75 through; `xcodebuild` runs compiling actions in a slot; the
  `xcrun` shim records `simctl create` only inside a lane.
- `leases.test.ts`: ledger parsing and liveness by start time, process trees, Docker, `lsof`
  and slot holder output.
- `space.test.ts`: attach output and `diskutil info` parsing; on macOS with `diskutil image`,
  create, attach, write, grow, detach and remove a 1 GB image in a temporary directory.
- `ProjectLifecycleService.test.ts`: with mocked thread management and a folder backend,
  `run.created` creates one lane per checkout, concurrent runs share it, settling the last
  holder reclaims it, a running thread at 75% is steered once with a deterministic id, startup
  reconcile reclaims lanes whose threads settled while the server was down. Phase 2, with
  stub `xcrun`, `docker` and `lsof` and a fake `DeviceService`: lanes get distinct port
  blocks; adopting and releasing a real process; settling stops a real `lane-run` process
  and its child, removes the labelled container before its volume, deletes the adopted
  simulator and closes device panels, shutting down only the device no active thread shares.
- `mcp/registration.test.ts` covers the new toolkit.

## Commands

```bash
vp test run apps/server/src/fork/project-lifecycle
vp test run apps/server/src/fork/mcp/registration.test.ts
scripts/fork/loom.sh check
```

## Manual check

On the nightly, after installing shell integration from Settings, Loom, Storage:

1. Start a thread in a worktree; a lane appears under `~/Developer/lanes/<project>/`.
2. Ask the agent to run `echo $TMPDIR` and an `xcodebuild build`; both point into the lane.
3. Ask the agent to fill `tmp` past 75% of a small project cap; it receives one steer and can
   free the lane with the tool.
4. Settle the thread; the lane is detached and removed.
5. Restart Loom with a lane active; it is mounted again.
6. In a lane, ask the agent to start a server with `lane-run` on `$LOOM_LANE_PORT`, create a
   simulator with `xcrun simctl create`, and run a container labelled
   `loom.lane=$LOOM_LANE_ID`. All three show under the lane in Storage; settling the thread
   stops, deletes and removes them.
7. Start two `xcodebuild build` runs in different lanes with build slots set to 1; the second
   waits, and Storage shows the holder.

Steps 1, 2 and 4 to 7 passed on a dev server on 2026-10-08 with a Codex agent, along with
Release from Storage and removing shell integration. Step 3 and closing device panels on
settle were covered only by tests. That run is why `lane-run` has `--detach` and why the lane
status tool scans fresh.

## Merge safety

No upstream files are touched. `scripts/fork/loom.sh check` after each integration covers
the fork registries.
