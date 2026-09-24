# L20 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`).

## Overview

One fork service, `SmallExtrasService`, owns the packet's settings and the server side of
each part. Parts are listed in a constant so clients can tell which ones a server ships:

```
 Loom settings section "small-extras"            Right panel "small-extras:containers"
   |- Worktree branch prefix (A)                   |- list (fork RPC)
   |- CLI tools (C)                                |- Follow logs -> upstream terminal.open + terminal.write
   v                                               v
 loom.small-extras.* (fork RPC)  ------------>  SmallExtrasService (ForkLayer)
                                                  |- settings row (fork_small_extras_settings)
                                                  |- worktree prefix holder  <- read by ProviderCommandReactor seam (A)
                                                  |- container listing (B)
                                                  |- CLI probes and update checks (C)
```

## Shared plumbing

### Contracts (`packages/contracts/src/fork/small-extras.ts`)

```ts
/** Every part this packet can ship. A server lists the ones it implements. */
export const SMALL_EXTRAS_PARTS = ["worktree-prefix", "containers", "cli-tools"] as const;
export type SmallExtrasPart = (typeof SMALL_EXTRAS_PARTS)[number];

export const SMALL_EXTRAS_WS_METHODS = {
  info: "loom.small-extras.info",
  getSettings: "loom.small-extras.getSettings",
  updateSettings: "loom.small-extras.updateSettings",
  listContainers: "loom.small-extras.listContainers", // part B
  listCliTools: "loom.small-extras.listCliTools", // part C
} as const;

export const WorktreeBranchPrefix = Schema.String.check(
  Schema.isMaxLength(64),
  // Old Loom's rule: lowercase, no refs/heads/, no "//" or "--", alphanumeric ends.
  Schema.isPattern(/^(?!refs\/heads(?:\/|$))(?!.*\/\/)(?!.*--)[a-z0-9](?:[a-z0-9/_-]*[a-z0-9])?$/),
);

export const SmallExtrasSettings = Schema.Struct({
  /** null = upstream's "t3code". */
  worktreeBranchPrefix: Schema.NullOr(WorktreeBranchPrefix),
  containerRuntime: Schema.Literals(["auto", "docker", "podman"]),
  /** Extra executables for the CLI tools list, probed with --version. */
  extraCliTools: Schema.Array(
    Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._+-]{1,64}$/)),
  ).check(Schema.isMaxLength(30)),
});
export const DEFAULT_SMALL_EXTRAS_SETTINGS: SmallExtrasSettings = {
  worktreeBranchPrefix: null,
  containerRuntime: "auto",
  extraCliTools: [],
};

export const SmallExtrasInfo = Schema.Struct({
  parts: Schema.Array(Schema.Literals(SMALL_EXTRAS_PARTS)),
});

export class SmallExtrasError extends Schema.TaggedErrorClass<SmallExtrasError>()(
  "SmallExtrasError",
  {
    reason: Schema.Literals(["invalid", "storage", "probe-failed"]),
    message: Schema.String,
  },
) {}
```

| Tag              | Payload                            | Success               | Scope                   |
| ---------------- | ---------------------------------- | --------------------- | ----------------------- |
| `info`           | `{}`                               | `SmallExtrasInfo`     | `orchestration:read`    |
| `getSettings`    | `{}`                               | `SmallExtrasSettings` | `orchestration:read`    |
| `updateSettings` | `SmallExtrasSettings`              | `SmallExtrasSettings` | `orchestration:operate` |
| `listContainers` | `{ projectId: ProjectId \| null }` | `ContainersResult`    | `orchestration:read`    |
| `listCliTools`   | `{ checkUpdates: boolean }`        | `CliToolsResult`      | `orchestration:read`    |

All unary; every `error` is `Schema.Union([SmallExtrasError, EnvironmentAuthorizationError])`.
The first part to ship creates the file with `info`, `getSettings`, `updateSettings` and its
own method; later parts add theirs. The server's `info` returns the parts it implements
(a constant in the server package, `IMPLEMENTED_SMALL_EXTRAS_PARTS`). Clients show a part
only when `loomFeatures` includes `small-extras` and `info.parts` includes the part, so a
newer Loom client on an older Loom server never calls a missing method.

### Storage

Fork migration set, slug `small-extras`, table `fork_migrations_small_extras`:

```sql
-- 1_Settings
CREATE TABLE IF NOT EXISTS fork_small_extras_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Settings decode with `SmallExtrasSettings`; invalid or missing JSON yields the defaults (and
logs a warning). One row per environment by construction (each server has its own
`state.sqlite`).

### Service

`apps/server/src/fork/small-extras/SmallExtras.ts`:

```ts
export class SmallExtrasService extends Context.Service<
  SmallExtrasService,
  {
    readonly info: Effect.Effect<SmallExtrasInfo>;
    readonly getSettings: Effect.Effect<SmallExtrasSettings, SmallExtrasError>;
    readonly updateSettings: (
      next: SmallExtrasSettings,
    ) => Effect.Effect<SmallExtrasSettings, SmallExtrasError>;
    readonly listContainers: (input: {
      projectId: ProjectId | null;
    }) => Effect.Effect<ContainersResult>;
    readonly listCliTools: (input: { checkUpdates: boolean }) => Effect.Effect<CliToolsResult>;
  }
>()("loom/small-extras/SmallExtrasService") {}
```

The layer loads settings once at build time and pushes the prefix into the part A holder
(below); `updateSettings` writes the row and updates the holder. Dependencies: `SqlClient`,
`VcsProcess`, `ProjectionSnapshotQuery`, `ServerConfig`, `FileSystem`, `Path`.

### Web settings section

`apps/web/src/fork/small-extras/settingsSection.tsx`, registered as
`{ id: "small-extras", title: "Small extras", Component }` in `FORK_SETTINGS_SECTIONS`. It
reads the selected settings scope (EXTENSION-POINTS.md, Settings: the page is scope-gated
like General; use the scope context from `apps/web/src/components/settings/useScopedSettings.ts:30`)
to pick the environment, checks `supportsLoomFeature(..., "small-extras")`, loads `info` and
`getSettings`, and renders one block per available part. Rows use upstream's
`SettingsRow` and `DraftInput` (`apps/web/src/components/settings/settingsLayout.tsx:268`;
`DraftInput` as used in `SettingsPanels.tsx:2849-2858`).

## Part A: worktree branch prefix

### How upstream names worktree branches

- `WORKTREE_BRANCH_PREFIX = "t3code"` and the temporary branch pattern
  `^t3code/(<8 hex>|<uuid v4>)$` (`packages/shared/src/git.ts:13-20`);
  `buildTemporaryWorktreeBranchName` (`:95-105`) and `isTemporaryWorktreeBranch` (`:107-109`).
- The client picks the temporary branch when it prepares the worktree: web
  `apps/web/src/components/ChatView.tsx:7935`, mobile
  `apps/mobile/src/state/use-thread-outbox-drain.ts:956`; the server passes it through
  (`apps/server/src/ws.ts:1463`, `newRefName: prepareWorktree.branch`).
- On the first user message, `ProviderCommandReactor` generates a name with text
  generation and renames the branch:
  `maybeGenerateAndRenameWorktreeBranchForFirstTurn`
  (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:877-936`) returns early
  unless `isTemporaryWorktreeBranch(branch)`, then
  `const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);` (`:914`),
  `gitWorkflow.renameBranch`, and `thread.meta.update`.
  `buildGeneratedWorktreeBranchName` (`:185-206`) strips a leading `t3code/`, sanitizes and
  returns `t3code/<fragment>`.
- Other code that recognizes temporary branches: `CheckpointReactor.ts:553` (skips branch
  drift for temporary refs) and `GitActionsControl.logic.ts:405-406` (does not regress a
  semantic branch to a temporary one). Both keep working because temporary branches keep
  the `t3code/` form.

### Design

Rewrite only the final name. A fork module holds the configured prefix:

```ts
// apps/server/src/fork/small-extras/worktreePrefix.ts
import { WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";

let configuredPrefix: string | null = null;

/** Set by SmallExtrasService at startup and on every settings update. */
export const setForkWorktreeBranchPrefix = (prefix: string | null): void => {
  configuredPrefix = prefix === WORKTREE_BRANCH_PREFIX ? null : prefix;
};

/**
 * Applied by ProviderCommandReactor (fork: small-extras) to the generated name
 * `t3code/<fragment>`. Returns the input unchanged when no prefix is configured
 * or the name does not carry upstream's prefix.
 */
export function applyForkWorktreeBranchPrefix(branch: string): string {
  if (configuredPrefix === null) return branch;
  const upstream = `${WORKTREE_BRANCH_PREFIX}/`;
  return branch.startsWith(upstream)
    ? `${configuredPrefix}/${branch.slice(upstream.length)}`
    : branch;
}
```

A module-level value instead of an Effect service keeps the seam to one expression in a
synchronous helper's caller, and the reactor gains no service requirement. The value is set
before reactors start because `ForkLayer` is built ahead of `ReactorLayerLive` (it is
provided to it through `RuntimeCoreDependenciesLive`, EXTENSION-POINTS.md, Server core).
Tests reset it with `setForkWorktreeBranchPrefix(null)`.

Edge cases:

- If the generated name already exists as a branch, upstream's `renameBranch` handles the
  collision the same way for any prefix (verify in `GitVcsDriverCore.renameBranch`).
- If text generation fails, upstream leaves the temporary `t3code/<hex>` branch; the prefix
  does not apply. Documented, not fixed.
- A nested prefix (`kyle/agents`) is allowed; the worktree directory name replaces `/` with
  `-` (`GitVcsDriverCore.ts:3056-3058`), which is harmless.

## Part B: containers

### Runtime detection

`containerRuntime: "auto"` tries `docker` then `podman` with `resolveCommandPath`
(`packages/shared/src/shell.ts:619-627`); an explicit choice uses only that one. The server
PATH is already hydrated from the login shell at startup (`apps/server/src/os-jank.ts:20-51`),
so Homebrew, OrbStack and Docker Desktop binaries resolve.

### Listing

| Runtime | Command (through `VcsProcess.run`, `timeoutMs: 10_000`, `maxOutputBytes: 2 MiB`) | Output                   |
| ------- | -------------------------------------------------------------------------------- | ------------------------ |
| Docker  | `docker ps --all --no-trunc --format '{{json .}}'`                               | one JSON object per line |
| Podman  | `podman ps --all --format json`                                                  | one JSON array           |

(Arguments are passed as an argv array, so the `{{json .}}` needs no shell quoting.)

Mapped to:

```ts
export const ContainerEntry = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9]{12,64}$/)),
  name: Schema.String,
  image: Schema.String,
  state: Schema.Literals([
    "running",
    "paused",
    "restarting",
    "created",
    "exited",
    "dead",
    "removing",
    "unknown",
  ]),
  status: Schema.String, // "Up 3 minutes (healthy)"
  ports: Schema.String,
  composeProject: Schema.NullOr(Schema.String),
  composeService: Schema.NullOr(Schema.String),
  composeWorkingDir: Schema.NullOr(Schema.String),
  matchesProject: Schema.Boolean,
});
export const ContainersResult = Schema.Union([
  Schema.TaggedStruct("Ok", {
    runtime: Schema.Literals(["docker", "podman"]),
    containers: Schema.Array(ContainerEntry),
  }),
  Schema.TaggedStruct("NoRuntime", {}),
  Schema.TaggedStruct("DaemonUnavailable", {
    runtime: Schema.Literals(["docker", "podman"]),
    detail: Schema.String,
  }),
  Schema.TaggedStruct("Failed", {
    runtime: Schema.Literals(["docker", "podman"]),
    detail: Schema.String,
  }),
]);
```

- Docker `Labels` is a comma-separated `k=v` string; Podman `Labels` is an object. Read
  `com.docker.compose.project`, `com.docker.compose.service`,
  `com.docker.compose.project.working_dir` (Podman compose sets the same keys when used
  through `docker-compose`; `podman-compose` sets `io.podman.compose.project`; read both).
- Docker `Names` is a string; Podman `Names` is an array (take the first).
- `matchesProject`: the realpath of `composeWorkingDir` equals the project's
  `workspaceRoot` or one of its threads' worktree paths (from `getShellSnapshot`).
- Daemon down: Docker exits non-zero with "Cannot connect to the Docker daemon" or "Is the
  docker daemon running"; Podman with "Cannot connect to Podman". Map to
  `DaemonUnavailable`, other failures to `Failed` with the first stderr line.
- At most 500 containers returned.

### Follow logs (web only, upstream terminal)

`apps/web/src/fork/small-extras/followContainerLogs.ts`:

```ts
export async function followContainerLogs(input: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  cwd: string; // thread worktree or project root
  runtime: "docker" | "podman";
  container: ContainerEntry;
  openTerminal: AtomCommand<typeof terminalEnvironment.open>;
  writeTerminal: AtomCommand<typeof terminalEnvironment.write>;
}) {
  if (!/^[a-f0-9]{12,64}$/.test(input.container.id)) return;
  const terminalId = `loom-logs-${input.container.id.slice(0, 12)}`;
  const store = useTerminalUiStateStore.getState();
  const alreadyOpen = selectThreadTerminalUiState(
    store.terminalUiStateByThreadKey,
    input.threadRef,
  ).terminalIds.includes(terminalId);
  // Creates the tab if needed, opens the drawer and focuses the tab.
  store.ensureTerminal(input.threadRef, terminalId, { open: true, active: true });
  if (alreadyOpen) return; // the logs are already streaming in that tab
  const opened = await input.openTerminal({
    environmentId: input.environmentId,
    input: { threadId: input.threadRef.threadId, terminalId, cwd: input.cwd },
  });
  if (opened._tag === "Failure") return; // toast with the error
  await input.writeTerminal({
    environmentId: input.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      terminalId,
      data: `${input.runtime} logs --follow --tail 200 ${input.container.id}\r`,
    },
  });
}
```

This mirrors how upstream runs a project script in a new terminal
(`apps/web/src/components/ChatView.tsx:4170-4231`): `storeNewTerminal`, open, then write the
command followed by `\r`. The terminal UI store is global
(`apps/web/src/terminalUiStateStore.ts:563-585`: `ensureTerminal`, `setTerminalOpen`,
`newTerminal`, `setActiveTerminal`; `selectThreadTerminalUiState` at `:480`; verify its
signature and the `terminalIds` field name), and the terminal commands are `terminalEnvironment.open` and `.write`
(`apps/web/src/state/terminal.ts:5`). Terminal ids are free-form strings up to 128 chars
(`packages/contracts/src/terminal.ts:19`). The id is validated as hex before it reaches the
shell, and the runtime is a closed literal, so nothing user-controlled is interpolated.
Upstream authorizes `terminal.open` and `terminal.write` with `terminal:operate`; a token
without it gets upstream's authorization error, shown as a toast.

### Panel

`apps/web/src/fork/small-extras/containersPanel.tsx`: `ForkPanelDefinition` with id
`small-extras:containers`, title "Containers", icon `ContainerIcon` (lucide), shortcut `C`,
`isAvailable` = thread present and `loomFeatures` has `small-extras` (the panel itself
shows a message when `info.parts` lacks `containers`). The list refreshes on mount, on the
Refresh button, and every 10 seconds while the panel is mounted and the document is visible.

## Part C: CLI tools

### Catalog

`apps/server/src/fork/small-extras/cliCatalog.ts`, plain data:

```ts
export interface CliToolDefinition {
  readonly id: string;
  readonly label: string;
  readonly category:
    "source-control" | "javascript" | "python" | "apple" | "containers" | "data" | "utilities";
  readonly executables: ReadonlyArray<string>; // first found wins
  readonly versionArgs: ReadonlyArray<string>; // default ["--version"]
  readonly versionPattern?: RegExp; // capture group 1; default: first version-like token
  readonly installHint: string;
  readonly npmPackage?: string; // to match `npm outdated -g`
}
```

Proposed initial list (Kyle to confirm, PRODUCT.md question 3): git, gh, jj; node, npm,
pnpm, bun, vp (Vite+); python3, uv; xcodebuild (`-version`), xcrun (`--version`), swift,
xcodegen, fastlane; docker, podman; sqlite3, jq, yq; rg, fd, ffmpeg, tailscale, op
(1Password CLI), varlock, tsci (tscircuit). Provider CLIs are excluded; the section links to
Settings, Providers, where upstream shows their versions and updates
(`apps/server/src/provider/providerMaintenance.ts`).

### Probe

For each tool (concurrency 6):

1. `resolveCommandPath(executable)`; none found: `missing` with `installHint`.
2. `VcsProcess.run({ command: resolvedPath, args: versionArgs, cwd: config.cwd, timeoutMs: 5_000, maxOutputBytes: 8_000 })`
   (the same pattern as upstream's `SourceControlDiscovery.probe`,
   `apps/server/src/sourceControl/SourceControlDiscovery.ts:73-128`). Non-zero exit or
   timeout: `error` with the first line.
3. Version: `versionPattern` group 1, else the first match of
   `/v?(\d+(?:\.\d+){1,3}[0-9A-Za-z.+-]*)/` on stdout, then stderr (old Loom's
   `extractVersion` fallback).
4. Install manager from the real path (`FileSystem.realPath`):
   - Homebrew: `homebrewOwnershipFromCommandPath` (exported,
     `apps/server/src/provider/providerMaintenance.ts:268-282`) gives formula or cask and
     name; update `brew upgrade [--cask] <name>`.
   - npm global: `npmGlobalPrefixFromCommandPath(realPath, npmPackage)` (`:232-250`) when the
     tool declares `npmPackage`; update `npm install -g <pkg>@latest`.
   - Bun global: real path under `~/.bun/`; update `bun add -g <pkg>@latest`.
   - macOS system: under `/usr/bin` or `/bin`; "Part of macOS".
   - Xcode: under `/Applications/Xcode*.app` or `/Library/Developer/CommandLineTools`;
     "Part of Xcode".
   - Otherwise "Unknown install", no command.
     Probe results are cached for 60 seconds in the service.

### Update check (on request)

`checkUpdates: true` additionally runs, in parallel, with 60 second timeouts:

- `brew outdated --json=v2` (reads Homebrew's local metadata; it does not run
  `brew update`, so results are as fresh as the last update, and the UI says so);
- `npm outdated -g --json` (asks the npm registry; exit code 1 means "something is
  outdated", not failure).

Matched by formula or cask name and npm package name to set `latestVersion` and
`updateAvailable`. Cached for one hour. A missing `brew` or `npm` just skips that source.

```ts
export const CliToolRow = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  category: Schema.String,
  status: Schema.Literals(["installed", "missing", "error"]),
  version: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  manager: Schema.Literals(["homebrew", "npm", "bun", "system", "xcode", "unknown"]),
  updateCommand: Schema.NullOr(Schema.String),
  latestVersion: Schema.NullOr(Schema.String),
  updateAvailable: Schema.NullOr(Schema.Boolean), // null until an update check ran
  detail: Schema.NullOr(Schema.String), // install hint or error line
  custom: Schema.Boolean,
});
export const CliToolsResult = Schema.Struct({
  tools: Schema.Array(CliToolRow),
  probedAt: IsoDateTime,
  updatesCheckedAt: Schema.NullOr(IsoDateTime),
});
```

## Agent-facing tools

None. Agents can run `which` and `--version` themselves.

## Performance

- Part A: one string replacement per first turn; no I/O.
- Part B: one `ps` call per refresh, 10 second cadence only while the panel is visible;
  payload under 500 small rows. Logs flow through upstream's terminal stream, which already
  handles backpressure and scrollback.
- Part C: about 30 short processes on section open, bounded to 6 at a time, cached 60
  seconds; update checks only on click, cached an hour.
- Nothing subscribes; nothing animates.

## Alternatives considered

- **Prefix the temporary branch too.** Needs seams in `packages/shared/src/git.ts`,
  `ChatView.tsx` and mobile, and upstream's mobile app would keep creating `t3code/<hex>`
  anyway. Old Loom went further and persisted per-thread provenance (a migration plus
  projection changes across 44 files); far too heavy.
- **Add the prefix to upstream `ServerSettings`.** Forbidden: unknown keys are dropped and
  the file is rewritten (EXTENSION-POINTS.md, Persistence).
- **A fork log streamer** (`docker logs -f` over a streaming RPC into a custom viewer).
  More code and a new subscription for what the terminal already does well.
- **Old Loom's CLI registry** (about 6.3k lines: sandboxed execution, receipts, tool packs,
  risk policies). Only its declarative catalog and version extraction are kept.
