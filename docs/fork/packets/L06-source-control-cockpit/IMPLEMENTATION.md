# L06 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling and can be its own commit
(`feat(fork-source-control-cockpit): ...`).

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder.
- Seed the worktree `.t3` from real data (AGENTS.md, "Test data") so threads with branches,
  worktrees and PR links exist.
- For git behavior, build throwaway repositories in a temp directory (TESTING.md has a
  script for a rebase conflict). Never create conflicts in a real checkout.

## Steps

### 1. Extension points

Existence checks for `ext-core`, `ext-panels`, `ext-palette`, `ext-web-root`,
`ext-keybindings`; create missing ones exactly as specified, one commit each.

### 2. Contracts

`packages/contracts/src/fork/source-control-cockpit.ts` with the schemas, error and
`SourceControlCockpitRpcGroup` from TECHNICAL.md. Import `PullRequestCheckStatus`,
`ThreadId`, `ProjectId`, `IsoDateTime`, `NonNegativeInt`, `PositiveInt`,
`TrimmedNonEmptyString` from `@t3tools/contracts` sources (relative imports inside the
package, `../pullRequest.ts`, `../baseSchemas.ts`). Export from `fork/index.ts`, merge into
`ForkRpcGroup`, add `"loom.source-control-cockpit.toggle"` to `FORK_KEYBINDING_COMMANDS`.
Typecheck `@t3tools/contracts`.

### 3. Pure parsers, test first

`apps/server/src/fork/source-control-cockpit/parsers.ts`:

```ts
export function parseGraphLog(stdout: string): GraphCommit[]; // \x1e records, \x1f fields
export function parseUnmergedRecords(
  statusV2Z: string,
): Array<{ path: string; kind: ConflictKind }>;
export function parseStatusV1Z(stdout: string): { tracked: string[]; untracked: string[] }; // handles rename pairs
export function parseWorktreeList(
  porcelain: string,
): Array<{ path: string; branch: string | null }>;
export function parseStashList(
  stdout: string,
): Array<{ ref: string; message: string; branch: string | null }>;
export function jobIdFromDetailsUrl(url: string | null): string | null;
export function mapCheckRun(run: GitHubCheckRun): CockpitCheck;
export function mapCommitStatus(status: GitHubCommitStatus): CockpitCheck;
export function tailUtf8(text: string, maxBytes: number): { text: string; truncated: boolean };
export function redactLog(text: string): { text: string; redactions: number };
export function countConflictMarkers(content: string): number;
export function conflictHint(path: string): "lockfile" | "generated" | null;
export function continueAbortCommands(op: GitOperation): {
  continue: string | null;
  abort: string | null;
};
export function decideSwitchVerdict(facts: SwitchFacts): SwitchPreflightResult;
export function parseVarlockOutput(exitCode: number, output: string): LeakScanResult;
```

Record real outputs for fixtures by running the commands in a temp repository once and
pasting them into the tests.

### 4. Server service

In `apps/server/src/fork/source-control-cockpit/`:

1. `SourceControlCockpit.ts`: service shape with one method per RPC; `resolveTarget` using
   `ProjectionSnapshotQuery`; a `git(cwd, args, opts)` helper around `VcsProcess.run`
   (`command: "git"`, env `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, default
   `timeoutMs: 15_000`, `maxOutputBytes: 2 MiB`, `allowNonZeroExit` where the exit code is
   data) and a `gh(args, opts)` helper (`command: "gh"`, `cwd` = lane cwd,
   `timeoutMs: 30_000`).
2. `laneFacts.ts`, `graph.ts`, `conflicts.ts`, `switchPreflight.ts`, `stash.ts` using the
   parsers. Stash operations run under a per-cwd `Semaphore` and call
   `VcsStatusBroadcaster.refreshLocalStatus(cwd)` afterwards, ignoring its failure.
3. `checks.ts` and `checkLog.ts` with the cache from TECHNICAL.md (a `Ref<Map>` with
   timestamps; no new dependency).
4. `leakScan.ts`: availability check and scan.
5. `rpc.ts`: `makeSourceControlCockpitRpcHandlers(auth)`; every handler is
   `auth.effect(TAG, withForkRuntime(service.method(input)))`.
6. Register the layer, the service type, the feature slug, the handlers and the scopes
   (EXTENSION-POINTS.md, "Registering a packet").
7. Typecheck `t3`.

Error mapping sketch:

```ts
const toCockpitError = (step: string) => (error: VcsError) =>
  new SourceControlCockpitError({
    reason: "git-failed",
    message: `${step} failed: ${firstLine(error)}`, // include git's stderr first line
  });
```

### 5. Client runtime

`packages/client-runtime/src/fork/source-control-cockpit.ts` with
`createSourceControlCockpitAtoms(runtime)` (query families and serial commands keyed by
environment, as in `packages/client-runtime/src/state/sourceControl.ts`). Export it.
Typecheck `@t3tools/client-runtime`.

### 6. Web

In `apps/web/src/fork/source-control-cockpit/`, in this order:

1. `state.ts`, `viewStore.ts`.
2. `panel.tsx` and `CockpitPanel.tsx` with the view tabs; register in `FORK_PANELS`.
3. `LaneView.tsx`: status from upstream's `vcsEnvironment.status` family (find the exact
   call in `apps/web/src/components/GitActionsControl.tsx:1064-1070`), lane facts, sibling
   threads, PR rows, stash rows with Apply and Pop, operation banner.
4. `graphLayout.ts` (pure, tested) and `GraphView.tsx`.
5. `ConflictsView.tsx` and `prompts.ts` (`buildResolveLocalConflictsPrompt`).
6. `SafeSwitch.tsx`: ref picker from `vcsEnvironment.listRefs`, preflight, then the switch
   sequence copied from `BranchToolbarBranchSelector.tsx:409-467` and its `setThreadBranch`
   (`:170-205`): `resolveBranchSelectionTarget`, `vcsEnvironment.switchRef`,
   `updateThreadMetadata`, `stopThreadSession` when the worktree changes. For "Stash and
   switch": `stashPush` first; on success continue; on failure stop and show the message.
   After a successful stash and switch, the lane card of the old branch shows the stash with
   Apply and Pop.
7. `ChecksView.tsx` with the 30 second poll (`useEffect` interval that runs only while the
   view is mounted, `document.visibilityState === "visible"` and a check is pending) and the
   log drawer; `buildFixCheckPrompt` in `prompts.ts`.
8. Leak check button in the lane card when `leakCheck.available`.
9. `palette.tsx` and `ShortcutHost.tsx`; register both.
10. Typecheck `@t3tools/web`.

Prompt builder sketch:

````ts
export function buildFixCheckPrompt(input: {
  branch: string;
  check: CockpitCheck;
  failedSteps: ReadonlyArray<string>;
  logTail: string;
}): string {
  const tail = input.logTail.split("\n").slice(-80).join("\n");
  return [
    `The CI check "${input.check.name}" failed on ${input.branch}.`,
    input.failedSteps.length > 0 ? `Failed steps: ${input.failedSteps.join(", ")}.` : "",
    input.check.url ? `Details: ${input.check.url}` : "",
    "",
    "End of the job log:",
    "```text",
    tail,
    "```",
    "",
    "Find the cause, fix it, and run the failing step locally if you can before pushing.",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}
````

### 7. Documentation

- `docs/fork/user/source-control-cockpit.md`: what each view shows, the safe switch
  verdicts, where logs come from, the GitHub-only limit, and the optional varlock check.
- Packet index Status.

## Pitfalls

- Read commands must not take `index.lock`: use `GIT_OPTIONAL_LOCKS=0` so a status call
  never blocks an agent's commit.
- `git status -z` rename and copy records carry two paths; porcelain v2 `2` records too.
- `git log --format` with `%D` prints decorations without parentheses; empty when none.
- `refs/remotes/origin/HEAD` is missing in some clones; fall back to `main`, then `master`,
  if those exist on origin, else null.
- Worktrees: the git dir of a linked worktree is `.git/worktrees/<name>`; operation markers
  (`MERGE_HEAD`, `rebase-merge`) live there, which `--absolute-git-dir` already returns.
- `gh api .../logs` for a job still running returns 404 or a partial log; show "The log is
  available when the job finishes."
- Job logs can be large; `maxOutputBytes` must be high enough to reach the tail. If the
  output was truncated by `VcsProcess` (flag `stdoutTruncated`), say so; the tail is then the
  middle of the log.
- `setPrompt` replaces the draft; read the current draft first
  (`useComposerDraftStore.getState().getComposerDraft(threadRef)`) and append. Verify the
  editor reflects external `setPrompt` calls; if it does not while mounted, fall back to
  copying the prompt to the clipboard with a toast.
- Stash refs shift after a push or pop; always re-read the list after a stash operation and
  never cache `stash@{n}` across operations.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Switching with an overlapping dirty file never reaches git's refusal: the preflight says
  "conflict" first and "Stash and switch" works, and the stash can be popped back.
- A rebase with conflicts shows every unmerged file with its kind.
- A failed Actions job shows the end of its log.
