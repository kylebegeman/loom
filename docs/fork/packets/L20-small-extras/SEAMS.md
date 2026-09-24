# L20 seams

## Extension points used

| Extension point | Parts | Registration                                                                                                                   |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ext-core`      | all   | `SmallExtrasRpcGroup`, `SmallExtrasService.layer`, migration set, handlers, scopes, `"small-extras"` in `LOOM_SERVER_FEATURES` |
| `ext-settings`  | A, C  | `smallExtrasSettings` in `FORK_SETTINGS_SECTIONS`                                                                              |
| `ext-panels`    | B     | `containersPanel` in `FORK_PANELS` (id `small-extras:containers`, shortcut `C`)                                                |

## Extension points created by this packet

Whichever of the above is missing, created exactly as EXTENSION-POINTS.md specifies, one
commit each, before packet code. Record the commits here, or "None: all existed".

## Packet seams

| File                                                             | Marker               | Lines | Why                                                                        |
| ---------------------------------------------------------------- | -------------------- | ----- | -------------------------------------------------------------------------- |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | `fork: small-extras` | 2     | Part A: apply the configured prefix to the generated worktree branch name. |

Parts B and C add no seams.

### `ProviderCommandReactor.ts`

Import, after the `@t3tools/shared/git` import (line 17):

```diff
 import { isTemporaryWorktreeBranch, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
+import { applyForkWorktreeBranchPrefix } from "../../fork/small-extras/worktreePrefix.ts"; // fork: small-extras
```

Call site in `maybeGenerateAndRenameWorktreeBranchForFirstTurn` (line 914). The line is
longer than 90 characters after the change, so the marker goes on its own line above it:

```diff
       if (!generated) return;

-      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
+      // fork: small-extras
+      const targetBranch = applyForkWorktreeBranchPrefix(buildGeneratedWorktreeBranchName(generated.branch));
       if (targetBranch === oldBranch) return;
```

Run `vp fmt` on the file afterwards; the formatter may wrap the call, which is why the
marker sits on its own line.

Why no extension point covers it: the rename is internal orchestration behavior in a
reactor. EXTENSION-POINTS.md, "Orchestration", allows a packet seam when no command or event
path can express it; changing the branch name after upstream's rename would mean a second
rename (a second `git branch -m`, a second `thread.meta.update` and a window where clients
see the upstream name), which is worse than one wrapped expression.

Optional seams, only if Kyle answers yes to PRODUCT.md question 2 (PR checkout branches):

| File                                            | Line | Change                                                                  |
| ----------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `apps/server/src/git/GitManager.ts`             | 277  | ``return applyForkWorktreeBranchPrefix(`t3code/pr-${...}/${suffix}`);`` |
| `apps/server/src/sourceControl/BitbucketApi.ts` | 525  | Same wrap around the template literal.                                  |

Each with its import and `// fork: small-extras` marker, added to this table and FORK.md.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected conflicts from this packet: at most `ProviderCommandReactor.ts` when upstream edits
the import line or the rename call. Resolve by keeping upstream's lines and reapplying the
two marked changes. Record the tag and result here.

## FORK.md rows

"Packet seams" table:

| File                                                             | Packet         | Why                                                                                                     |
| ---------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | `small-extras` | Configurable worktree branch prefix on the first-turn rename. See `docs/fork/packets/L20-small-extras`. |
