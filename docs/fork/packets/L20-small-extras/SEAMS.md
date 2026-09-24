# L20 seams

## Extension points used

| Extension point  | Parts   | Registration                                                                                                                                                                                                                 |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext-core`       | all     | `SmallExtrasRpcGroup`, `SmallExtrasService.layer`, cleanup and commit check reactors (D), migration set, handlers, scopes, `"small-extras"` in `LOOM_SERVER_FEATURES`, `privateModeWarnings` in `ForkSubscriptionRpcTag` (D) |
| `ext-settings`   | A, C, D | `smallExtrasSettings` in `FORK_SETTINGS_SECTIONS`                                                                                                                                                                            |
| `ext-panels`     | B       | `containersPanel` in `FORK_PANELS` (id `small-extras:containers`, shortcut `C`)                                                                                                                                              |
| `ext-turn-input` | D       | contributor `small-extras-private-mode`, order 5, registered at runtime by `SmallExtrasService`                                                                                                                              |
| `ext-palette`    | D       | `smallExtrasPaletteSource` in `FORK_COMMAND_PALETTE_SOURCES`                                                                                                                                                                 |
| `ext-web-root`   | D       | `{ id: "small-extras-private-warnings", Component: PrivateModeWarningToasts }` in `FORK_ROOT_COMPONENTS`                                                                                                                     |
| `ext-decide`     | D       | feature `small-extras.branch-type` in the decide feature registry (EXTENSION-POINTS.md, section 18)                                                                                                                          |

Part D's server pieces that upstream code calls (the branch namer and the private thread
resolver) are registered at runtime through module-level functions in fork files, the same
pattern `ext-turn-input` uses; they are not extension points.

## Extension points created by this packet

Whichever of the above is missing, created exactly as EXTENSION-POINTS.md specifies, one
commit each, before packet code. `ext-decide` is created "if missing, exactly as specified in
EXTENSION-POINTS.md section 18". Record the commits here, or "None: all existed".

## Packet seams

| File                                                             | Marker               | Lines                     | Why                                                                                             |
| ---------------------------------------------------------------- | -------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | `fork: small-extras` | 2 (import, one statement) | Parts A and D: name the generated worktree branch (prefix, or change type in private projects). |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts`               | `fork: small-extras` | 2 (import, one spread)    | Part D: turn off Claude Code's commit and PR attribution for sessions in private projects.      |

Parts B and C add no seams. Part A and part D share the reactor seam; whichever ships first
adds it.

### `ProviderCommandReactor.ts`

Verified against `137e432394` (2026-09-24). Import, after the `@t3tools/shared/git` import
(line 17). The line is longer than 90 characters with a trailing marker, so the marker sits
on its own line above it:

```diff
 import { isTemporaryWorktreeBranch, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
+// fork: small-extras
+import { forkWorktreeBranchName } from "../../fork/small-extras/branchNaming.ts";
```

Call site in `maybeGenerateAndRenameWorktreeBranchForFirstTurn` (line 914), inside the
`Effect.gen(function* () { ... })` that starts at line 896, so `yield*` is available. The line
is longer than 90 characters after the change, so the marker goes on its own line above it:

```diff
       if (!generated) return;

-      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
+      // fork: small-extras
+      const targetBranch = yield* forkWorktreeBranchName({ threadId: input.threadId, branch: buildGeneratedWorktreeBranchName(generated.branch), messageText: input.messageText });
       if (targetBranch === oldBranch) return;
```

Run `vp fmt` on the file afterwards; the formatter wraps the call, which is why the marker
sits on its own line. Expected marker count in the file: 2.

`forkWorktreeBranchName` never fails and needs no service (TECHNICAL.md, "Design: one branch
namer for parts A and D"): with no namer registered, which is the case in upstream's
`ProviderCommandReactor.test.ts`, it returns the upstream name unchanged.

Why no extension point covers it: the rename is internal reactor behavior that no extension
point or existing command can change before upstream's rename. Changing the branch name after
upstream's rename would mean a second rename (a second `git branch -m`, a second
`thread.meta.update` and a window where clients see the upstream name, which in a private
project is exactly what must not happen), which is worse than one wrapped expression.

### `ClaudeAdapter.ts`

Verified against `137e432394` (2026-09-24). The Agent SDK query options are built in
`startSession` (`Effect.fn("startSession")(function* ...)`, line 4210), so `yield*` is
available. `const threadId = input.threadId;` is at line 4235. The `settings` object is built
at lines 4703-4710 and passed at line 4742
(`...(Object.keys(settings).length > 0 ? { settings } : {}),`), after the permission mode
and before `resume`; the same object is logged at line 4787 (`claude.query.settings_json`).

Import, after the last import of the file (line 118):

```diff
 import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
+// fork: small-extras
+import { forkClaudeSessionSettings } from "../../fork/small-extras/privateMode/claudeSettings.ts";
```

First entry of the `settings` object (inserted at the start of the list, per CONVENTIONS.md;
later upstream keys still apply because none of them is `attribution` or
`includeCoAuthoredBy`):

```diff
       const settings = {
+        // fork: small-extras
+        ...(yield* forkClaudeSessionSettings(threadId)),
         ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
         ...(fastMode ? { fastMode: true } : {}),
```

Expected marker count in the file: 2. For non-private threads (and whenever the packet is
absent) the spread adds nothing, so `Object.keys(settings).length` and the rest of the call
are unchanged; for private threads `settings` becomes non-empty and is passed, which is the
point. The object satisfies the SDK's `Settings` type: `attribution.commit`,
`attribution.pr`, `attribution.sessionUrl` and `includeCoAuthoredBy` all exist in
`@anthropic-ai/claude-agent-sdk` 0.3.260's `sdk.d.ts`.

Why no extension point covers it: `ext-turn-input` only adds text to a turn, which the model
may ignore; `ext-providers` is for fork drivers, not upstream's Claude adapter; and the
`settings` object is a local inside `startSession` with no hook. Claude Code's `attribution`
setting is the one deterministic switch, and the only way to set it without writing a file
into the work repository is the SDK option built here. One spread line is the smallest
change.

Rejected alternative: writing `attribution` into `<project>/.claude/settings.local.json`
(no seam, but it writes into the work repository and affects Kyle's manual sessions there).

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected conflicts from this packet: at most `ProviderCommandReactor.ts` when upstream edits
the import line or the rename call, and `ClaudeAdapter.ts` when upstream edits the import
block's end or the `settings` object (the adapter is one of upstream's busiest files: 50
commits since June). Resolve by keeping upstream's lines and reapplying the marked changes;
for the adapter, the spread goes first in whatever object upstream now passes as the SDK
`settings` option. Record the tag and result here.

## FORK.md rows

"Packet seams" table:

| File                                                             | Packet         | Why                                                                                                                                     |
| ---------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | `small-extras` | Worktree branch naming on the first-turn rename (prefix, or change type in private projects). See `docs/fork/packets/L20-small-extras`. |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts`               | `small-extras` | Claude attribution off for sessions in private projects. See `docs/fork/packets/L20-small-extras`.                                      |
