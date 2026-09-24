# L20 implementation plan

Each part is independently shippable. Build step 2 with whichever part comes first; then
steps 3 to 6 in any order (part D after part A is slightly less work, since the reactor seam
then exists). Commit per part: `feat(fork-small-extras): ...`.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Every question is answered (PRODUCT.md, Decisions). Seed a worktree `.t3` from real
data if you want real projects in the Containers filter and the private projects list. For
part D, use a throwaway git repository under the worktree's `.t3/scratch/` as the private
project; never mark one of Kyle's real repositories private during development.

## Steps

### 1. Extension points

Existence checks for `ext-core` (always), `ext-settings` (parts A, C and D), `ext-panels`
(part B), `ext-turn-input`, `ext-palette`, `ext-web-root` and `ext-decide` (part D). Create
missing ones exactly as specified, one commit each (`ext-decide` exactly as
EXTENSION-POINTS.md section 18 specifies).

### 2. Shared plumbing (with the first part)

1. `packages/contracts/src/fork/small-extras.ts`: `SMALL_EXTRAS_PARTS`,
   `SmallExtrasSettings` (default prefix `loom`), `SmallExtrasInfo`, `SmallExtrasError`, and
   the `info`, `getSettings`, `updateSettings` RPCs. Export and merge into `ForkRpcGroup`.
2. `apps/server/src/fork/small-extras/migrations.ts` (`SmallExtrasMigrations`, id 1
   `Settings`), `store.ts` (read and upsert the single row), `parts.ts`
   (`IMPLEMENTED_SMALL_EXTRAS_PARTS`, grows as parts land), `SmallExtras.ts` (service), and
   `rpc.ts`. Register layer, service type, migration set, feature slug, handlers and scopes.
3. `packages/client-runtime/src/fork/small-extras.ts` (atoms), `apps/web/src/fork/small-extras/state.ts`.
4. `apps/web/src/fork/small-extras/settingsSection.tsx` with the environment gate and one
   block per part (empty until a part lands). Register it.
5. Typecheck contracts, server, client-runtime, web.

### 3. Part A: worktree branch prefix

1. `apps/server/src/fork/small-extras/branchNaming.ts` (`registerForkBranchNamer`,
   `forkWorktreeBranchName`, TECHNICAL.md) and its test.
2. The service registers its namer in the layer scope; the namer reads the prefix from the
   settings `Ref` (updated by `updateSettings`).
3. The seam in `ProviderCommandReactor.ts` (SEAMS.md), then `vp fmt` on that file.
4. Add `"worktree-prefix"` to `IMPLEMENTED_SMALL_EXTRAS_PARTS`.
5. Settings block: `DraftInput` bound to `worktreeBranchPrefix` (empty string saves `null`),
   inline validation with the same schema (`Schema.decodeUnknownEither(WorktreeBranchPrefix)`),
   reset button (back to `loom`), and a preview line "New branches look like
   <prefix>/fix-login-redirect".
6. Test: a focused test on the reactor would need the whole reactor harness; instead test
   `forkWorktreeBranchName` (no namer, a namer, a failing and a slow namer) plus a service
   test that `updateSettings` changes what the namer returns. Verify the seam manually
   (TESTING.md).

### 4. Part D: No AI identification

1. **Contracts.** `PrivateProject`, `PrivateProjectState`, `PrivateModeFinding`,
   `PrivateModeWarning`, `PrivateCheckResult`, `PRIVATE_MODE_INSTRUCTION`, the five RPCs, and
   `privateModeWarnings` in `ForkSubscriptionRpcTag`.
2. **Pure modules first, with tests** (`apps/server/src/fork/small-extras/privateMode/`):
   `branchType.ts` (`branchTypeFromKeywords`, `privateBranchName`), `aiMarkers.ts` (commit
   record parsing of the `%x00`/`%x1e` log format, the marker constants, `findMarkers`,
   `buildFixCommand`, `buildRewordCommand`, `buildRenameCommand`, shell quoting).
3. **Storage.** Migration 2 `PrivateMode`; repositories for private projects and scans;
   `cleanupReactor.ts` for `project.deleted` and `thread.deleted`.
4. **Service.** Private set `Ref`, cached thread-to-project lookup, `listPrivateProjects`,
   `setPrivateProject`; the namer's private branch (step 3's namer gains the private case);
   `claudeSettings.ts` with `registerPrivateThreadResolver` and the fail-closed resolver; the
   `ext-turn-input` contributor (id `small-extras-private-mode`, order 5).
5. **Claude seam.** The two marked lines in `ClaudeAdapter.ts` (SEAMS.md), then `vp fmt` on
   the file. If part A has not shipped, also add the reactor seam from SEAMS.md.
6. **Commit check.** `commitCheck.ts` reactor with `forkParked`, per-thread serialization,
   concurrency 2, the git commands through `VcsProcess.run`, the `thread.activity.append`
   dispatch, the `PubSub` behind `privateModeWarnings`; `checkPrivateThread`;
   `renamePrivateBranch` with upstream's rename steps.
7. **Jev branch type.** `decide.ts`: register `small-extras.branch-type` in the `ext-decide`
   registry; `chooseBranchType` calls `decide` and falls back to the keyword rules; the
   "Jev off by default" reconciliation on `setPrivateProject` and at startup, using section
   18's per-project override API (TECHNICAL.md names it).
8. Add `"private-mode"` to `IMPLEMENTED_SMALL_EXTRAS_PARTS`.
9. **Web.** `PrivateProjectsBlock.tsx` in the settings section; `palette.tsx` (toggle with
   Undo, check); `PrivateModeWarningToasts.tsx` in `FORK_ROOT_COMPONENTS` with the shared
   toast builder `privateModeToast.ts`; `PrivateModeProfileRow.tsx` and, if L18 exists, its
   registration in `PROFILE_SECTION_ROWS`.
10. **Verify Codex's commit behavior** (TECHNICAL.md, Provider decisions): with the installed
    codex-cli (record `codex --version`), in a scratch repository marked private on a dev
    server, ask a Codex thread to make a small change and commit it. Inspect
    `git log -1 --format='%B%n%an <%ae>%n%cn <%ce>'`. Then repeat with the project not
    private. Record in TECHNICAL.md, "Codex facts": the version, whether Codex added
    `Co-authored-by: Codex <noreply@openai.com>` in each case, and whether the commit check
    caught it. If Codex adds the trailer despite the instruction, add a line to PRODUCT.md's
    Out of scope follow-up with the evidence; do not add a Codex seam in this packet.
11. **Verify Claude's attribution** the same way: in the private scratch project, a Claude
    thread's commit has no `Co-Authored-By` and no "Generated with" line; with the project
    not private (new thread), the default attribution appears (proves the seam is what
    turned it off). Check `claude.query.settings_json` in the trace shows the attribution
    object only for the private thread.

### 5. Part B: containers

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

### 6. Part C: CLI tools

1. Contracts: `CliToolRow`, `CliToolsResult`, `listCliTools` RPC.
2. `apps/server/src/fork/small-extras/cliCatalog.ts` (the list in TECHNICAL.md), `cliTools.ts`
   (probe with names and absolute paths, version extraction, manager detection with
   `updateOverride`, `homebrewOwnershipFromCommandPath` and `npmGlobalPrefixFromCommandPath`
   imported from `../../provider/providerMaintenance.ts`, update checks, caches). For each
   catalog entry marked unverified, check the tool's own `--help` or docs for the executable
   name, version arguments and install hint, and fix the entry. Add `"cli-tools"` to the
   implemented parts.
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

### 7. Documentation

`docs/fork/user/small-extras.md` (one short section per shipped part; for part D: what the
switch does per provider, the known limits from PRODUCT.md, how to use the fix command, and
that Loom never rewrites history), FORK.md rows for the seams, packet index Status.

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
- The branch namer and the private thread resolver are process-global registrations; tests
  build them inside a scope and close it (`afterEach` is not needed when every test scopes
  its layer).
- The terminal command must end with `\r`, not `\n` (upstream writes `\r`).
- Never interpolate a container name into the terminal command; use the validated id.
- **Never write to the work repository on your own.** The commit check reads git state
  only; the fix commands are text for the user. Every git call in `privateMode/` goes through
  one `readGit(cwd, args)` helper that refuses any subcommand outside an allowlist
  (`rev-parse`, `symbolic-ref`, `log`, `branch --remotes --contains`), and a test asserts
  the allowlist. The only write, `renamePrivateBranch`, runs on the user's click through
  upstream's `GitWorkflowService.renameBranch`.
- **Fail closed only when something is private.** The Claude resolver hides attribution on a
  lookup failure only while at least one project is private.
- **Git log parsing.** Messages can contain any byte except NUL; use `%x00` between fields and
  `%x1e` between records, and never split on newlines.
- **The first turn races the rename.** Skip the temporary branch finding when
  `checkpointTurnCount < 2`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done) for each
shipped part, plus:

- A: a new worktree thread's branch is `loom/<name>` after the first message on a fresh
  environment; clearing the setting restores `t3code/<name>`.
- D: in a private scratch project, a new worktree thread's branch is `<type>/<name>`; Claude's
  commit carries no attribution; a commit with a Claude or Codex trailer made in a turn
  produces one timeline row and one toast whose copied command removes the trailer when run
  by hand; the palette check reports the same; turning the switch off restores `loom/`
  naming and Claude's default attribution for new sessions; the Codex verification is
  recorded in TECHNICAL.md.
- B: Follow logs opens one terminal tab per container and focuses the existing tab on a
  second click.
- C: the list renders in under five seconds on Kyle's Mac and never runs an installer.
