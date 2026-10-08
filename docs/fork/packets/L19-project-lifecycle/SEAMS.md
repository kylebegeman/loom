# L19 seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points created by this packet

None: all existed.

## Packet seams

None. Phase 1 uses only fork registries: `ForkLayer`, `ForkServices`, `LOOM_SERVER_FEATURES`,
`FORK_MIGRATION_SETS`, `ForkRpcGroup`, `FORK_RPC_REQUIRED_SCOPES`,
`FORK_CLIENT_GUARDED_RPC_SCOPES`, `FORK_MCP_TOOLKITS`, `FORK_SETTINGS_SECTIONS`,
`FORK_COMMAND_PALETTE_SOURCES` and `FORK_ROOT_COMPONENTS`.

Routing agent output into lanes is done by the opt-in shell hook rather than a provider or
terminal environment seam: no single upstream hook covers every provider adapter and the
terminal manager, and providers already run commands through the user's shell.

Upstream PR candidates that would let later phases drop the shell hook or reuse upstream
cleanup: a per-thread provider environment, a worktree-removal hook, and configurable safe
ignored paths in `storageCleanup.ts`.

## Merge check

No upstream file changes, so upstream merges cannot conflict with this packet. Run
`scripts/fork/loom.sh check` after each integration: it typechecks the fork registries this
packet appends to and runs its tests.

## FORK.md rows

None.
