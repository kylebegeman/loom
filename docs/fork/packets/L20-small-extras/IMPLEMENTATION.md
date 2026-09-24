# L20 implementation plan

Each part is independently shippable. Build step 2 with whichever part comes first; then
steps 3, 4 and 5 in any order. Commit per part: `feat(fork-small-extras): ...`.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Seed a worktree `.t3` from real data if you want real projects in the Containers
filter.

## Steps

### 1. Extension points

Existence checks for `ext-core` (always), `ext-settings` (parts A and C), `ext-panels`
(part B). Create missing ones exactly as specified, one commit each.

### 2. Shared plumbing (with the first part)

1. `packages/contracts/src/fork/small-extras.ts`: `SMALL_EXTRAS_PARTS`,
   `SmallExtrasSettings`, `SmallExtrasInfo`, `SmallExtrasError`, and the `info`,
   `getSettings`, `updateSettings` RPCs. Export and merge into `ForkRpcGroup`.
2. `apps/server/src/fork/small-extras/migrations.ts` (`SmallExtrasMigrations`, id 1
   `Settings`), `store.ts` (read and upsert the single row), `parts.ts`
   (`IMPLEMENTED_SMALL_EXTRAS_PARTS`, grows as parts land), `SmallExtras.ts` (service), and
   `rpc.ts`. Register layer, service type, migration set, feature slug, handlers and scopes.
3. `packages/client-runtime/src/fork/small-extras.ts` (atoms), `apps/web/src/fork/small-extras/state.ts`.
4. `apps/web/src/fork/small-extras/settingsSection.tsx` with the environment gate and one
   block per part (empty until a part lands). Register it.
5. Typecheck contracts, server, client-runtime, web.

### 3. Part A: worktree branch prefix

1. `apps/server/src/fork/small-extras/worktreePrefix.ts` (TECHNICAL.md) and its test.
2. The service sets the holder after loading settings (in the layer's constructor) and after
   each successful `updateSettings`.
3. The seam in `ProviderCommandReactor.ts` (SEAMS.md), then `vp fmt` on that file.
4. Add `"worktree-prefix"` to `IMPLEMENTED_SMALL_EXTRAS_PARTS`.
5. Settings block: `DraftInput` bound to `worktreeBranchPrefix` (empty string saves `null`),
   inline validation with the same schema (`Schema.decodeUnknownEither(WorktreeBranchPrefix)`),
   reset button, and a preview line "New branches look like <prefix>/fix-login-redirect".
6. Test: a focused test on the reactor would need the whole reactor harness; instead test
   `applyForkWorktreeBranchPrefix` plus a service test that `updateSettings` changes what
   `applyForkWorktreeBranchPrefix` returns. Verify the seam manually (TESTING.md).

### 4. Part B: containers

1. Contracts: `ContainerEntry`, `ContainersResult`, `listContainers` RPC.
2. `apps/server/src/fork/small-extras/containers.ts`: runtime detection, `ps` calls through
   `VcsProcess.run`, pure parsers `parseDockerPsLines` and `parsePodmanPsJson`, label parsing,
   project matching via `ProjectionSnapshotQuery.getShellSnapshot` plus `realPath`, error
   classification. Add `"containers"` to the implemented parts.
3. Web: `containersPanel.tsx` (definition), `ContainersPanel.tsx` (list, filters, runtime
   menu writing `containerRuntime` through `updateSettings`, 10 second refresh while
   visible), `followContainerLogs.ts` (TECHNICAL.md). Get `openTerminal` and `writeTerminal`
   with `useAtomCommand(terminalEnvironment.open, ...)` and `.write` exactly as ChatView does
   (`apps/web/src/components/ChatView.tsx:892-893`). Resolve `cwd` from the thread shell:
   `worktreePath ?? project.workspaceRoot`.
4. Register the panel in `FORK_PANELS`.

### 5. Part C: CLI tools

1. Contracts: `CliToolRow`, `CliToolsResult`, `listCliTools` RPC.
2. `apps/server/src/fork/small-extras/cliCatalog.ts` (data), `cliTools.ts` (probe, version
   extraction, manager detection with `homebrewOwnershipFromCommandPath` and
   `npmGlobalPrefixFromCommandPath` imported from `../../provider/providerMaintenance.ts`,
   update checks, caches). Add `"cli-tools"` to the implemented parts.
3. Settings block: grouped table, per-row copy buttons, "Check for updates", "Refresh",
   extra tools textarea bound to `extraCliTools`, link to `/settings/providers`.

Version extraction sketch:

```ts
const FALLBACK_VERSION = /v?(\d+(?:\.\d+){1,3}[0-9A-Za-z.+-]*)/;

export function extractVersion(
  output: { stdout: string; stderr: string },
  pattern?: RegExp,
): string | null {
  for (const text of [output.stdout, output.stderr]) {
    const match = (pattern ?? FALLBACK_VERSION).exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}
```

### 6. Documentation

`docs/fork/user/small-extras.md` (one short section per shipped part), FORK.md row for the
part A seam, packet index Status.

## Pitfalls

- `docker ps --format '{{json .}}'` prints one object per line; Podman's `--format json`
  prints one array. Do not assume either shape for the other runtime.
- Docker's `Labels` is a string; values can contain `=`; split on the first `=` of each
  comma-separated pair.
- `npm outdated -g --json` exits 1 when anything is outdated; use `allowNonZeroExit` and
  parse stdout.
- `brew outdated` can print warnings to stderr; parse stdout only.
- `xcodebuild -version` exits non-zero when only the Command Line Tools are installed;
  report "Xcode is not installed (Command Line Tools only)" rather than an error.
- The prefix holder is process-global; tests must reset it (`afterEach`).
- The terminal command must end with `\r`, not `\n` (upstream writes `\r`).
- Never interpolate a container name into the terminal command; use the validated id.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done) for each
shipped part, plus:

- A: a new worktree thread's branch is `<prefix>/<name>` after the first message; clearing
  the setting restores `t3code/<name>`.
- B: Follow logs opens one terminal tab per container and focuses the existing tab on a
  second click.
- C: the list renders in under five seconds on Kyle's Mac and never runs an installer.
