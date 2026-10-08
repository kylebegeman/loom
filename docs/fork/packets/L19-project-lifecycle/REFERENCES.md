# L19 references

## Kyle's workspace

- `~/Developer/docs/workflow/ephemeral-checkouts.md`: checkouts are a cache of GitHub;
  what "nothing unique" means before a checkout can go. Lesson recorded there: 53 GB Rust
  `target/` folders must never argue for keeping a checkout.
- `~/.local/bin/dev-park`: the CLI stopgap for parking a checkout (phase 3 input).
- `~/dotfiles/shell/zshenv` (linked from `~/.zshenv`): already exports `DEV_SCRATCH` and
  similar. Shell integration appends one marked block to it.
- AspectAvy threads' `st3-slot.sh`: an agent-written build scheduler with six machine-wide
  slots. Evidence for phase 2 build-slot leases.

Measurements, 2026-10-08: 18 booted simulators and 13+ long-lived `xcodebuild` runner
sessions (2 to 11 hours) holding them; Devices 159 GB, DerivedData 67 GB, `/tmp` 100 GB.
Removing shut-down simulators and DerivedData took free space from 53 to 148 GB.

## Old Loom

- Selection F12 ("Repository Estate", reshaped). Old Loom's estate (about 9.5k lines)
  modelled checkout safety and reclamation, not build output; nothing from it is reused in
  phase 1. Its file-by-file review and the earlier manual Repositories-page proposal are kept
  in this packet's history at `e2c69a1bcd` for phase 3.
- [Projects and Execution](https://github.com/bagelvault/loom/blob/a79ec506/docs/architecture/loom-projects-and-execution.md),
  [retained project working copies](https://github.com/bagelvault/loom/blob/a79ec506/docs/technical/retained-project-workspaces.md),
  [runner-backed provider execution](https://github.com/bagelvault/loom/blob/a79ec506/docs/technical/runner-provider-turn-gateway.md):
  phase 3 background; the runner system is what this fork avoids rebuilding.

## Upstream T3 Code

| Source                                                                                                                                                                                                | Use                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/orchestration-v2/RuntimePolicy.ts`                                                                                                                                                   | Provider cwd is `thread.worktreePath ?? project.workspaceRoot`: the lane key.                                                      |
| `apps/server/src/storageCleanup.ts`                                                                                                                                                                   | Upstream worktree removal (after merge, unchanged, after days). Checkout removal stays here in phase 1; also the idle-thread test. |
| `apps/server/src/orchestration-v2/ThreadSettlementService.ts`                                                                                                                                         | Domain event consumption pattern for `thread.settled`.                                                                             |
| `apps/server/src/orchestration-v2/ThreadManagementService.ts`                                                                                                                                         | `getShellSnapshot`, `streamDomainEvents`, `sendToThread` (steer).                                                                  |
| `apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts`                                                                                                                                        | Deterministic command and message ids for server-sent messages.                                                                    |
| `apps/server/src/terminal/Manager.ts` (`createTerminalSpawnEnv`)                                                                                                                                      | Where a terminal env hook would go; not needed while the shell hook covers terminals.                                              |
| `apps/server/src/mcp/McpProviderSession.ts` (`withAgentDeviceEnvironment`)                                                                                                                            | Per-thread provider env precedent for a future upstream PR.                                                                        |
| [remote access](../../../user/remote-access.md), `packages/client-runtime/src/state/projectGrouping.ts`, `apps/web/src/hooks/useLoadBalancedEnvironment.ts`, `packages/contracts/src/projectClone.ts` | Phase 3: machine selection, repository grouping, tracked clones.                                                                   |

## External

- `diskutil image` (macOS 26+): `create blank --format ASIF`, `attach --mountPoint`,
  `resize`, `info`. See `diskutil help image <subcommand>`. Behavior in TECHNICAL was
  probed on macOS 27 (Darwin 27.0.0) on 2026-10-08.
- `tmutil addexclusion` (sticky exclusion, no root).
- `.metadata_never_index` at a volume root disables Spotlight indexing of that volume.
- `xcodebuild -derivedDataPath`, `-clonedSourcePackagesDirPath` (`man xcodebuild`).
- Node `fs.statfs` for volume capacity and free space.
