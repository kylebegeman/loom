# L20 testing

Focused tests per part; no repo-wide checks; no sleeps.

## Automated tests

| File                                                         | Part   | Covers                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/small-extras.test.ts`           | shared | `WorktreeBranchPrefix` accepts `kyle`, `kyle/agents`, `a_b-c`; rejects `Kyle`, `-x`, `x-`, `a//b`, `a--b`, `refs/heads/x`, 65 chars. Settings defaults decode.                                                                                                                                  |
| `apps/server/src/fork/small-extras/store.test.ts`            | shared | Migration applies twice cleanly on `SqlitePersistenceMemory`; invalid JSON yields defaults; update round trip.                                                                                                                                                                                  |
| `apps/server/src/fork/small-extras/worktreePrefix.test.ts`   | A      | No prefix leaves `t3code/fix` unchanged; `kyle` gives `kyle/fix`; nested prefix; names without `t3code/` unchanged; setting `t3code` behaves as none; reset.                                                                                                                                    |
| `apps/server/src/fork/small-extras/SmallExtras.test.ts`      | A      | Service build loads the stored prefix into the holder; `updateSettings` changes it; invalid input fails with `invalid`.                                                                                                                                                                         |
| `apps/server/src/fork/small-extras/containers.test.ts`       | B      | Recorded Docker NDJSON and Podman JSON (running, exited, compose labels, comma values); daemon-down stderr classification; project matching by working dir; 500 cap.                                                                                                                            |
| `apps/server/src/fork/small-extras/cliTools.test.ts`         | C      | `extractVersion` on real outputs (git, node `v22.x`, jq `jq-1.7.1`, rg, xcodebuild, python); manager detection from paths (Cellar, Caskroom, `lib/node_modules`, `~/.bun`, `/usr/bin`, Xcode); `brew outdated --json=v2` and `npm outdated -g --json` parsing; exit 1 from npm treated as data. |
| `apps/web/src/fork/small-extras/followContainerLogs.test.ts` | B      | Rejects a non-hex id; builds `docker logs --follow --tail 200 <id>\r`; a second call for the same container does not open or write again (store and commands stubbed).                                                                                                                          |

Plus the extension point invariant tests if this packet created any (panel id and shortcut
uniqueness in `apps/web/src/fork/panels/registry.test.ts`, settings section ids).

## Commands

```sh
vp test run packages/contracts/src/fork/small-extras.test.ts \
  apps/server/src/fork/small-extras apps/web/src/fork/small-extras
vp lint packages/contracts/src/fork/small-extras.ts apps/server/src/fork/small-extras \
  apps/web/src/fork/small-extras packages/client-runtime/src/fork/small-extras.ts \
  apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

Also run upstream's reactor test once after adding the seam, since the file changed:
`vp test run apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`. It
exercises the first-turn rename with a stubbed `renameBranch` (around lines 298, 471 and 680,
thread branch `t3code/1234abcd`) and must stay green with no prefix configured. Copying that
harness into a fork test is not worth it; the holder test plus the manual check cover the
fork behavior.

## Manual check

Needs Kyle's permission for a dev server and a browser. Seeded worktree `.t3`.

Part A:

1. Settings, Loom, Small extras: enter `Kyle`; the inline error appears. Enter `kyle`; saved.
2. Start a new thread in worktree mode on a git project and send a message. After the title
   appears, the branch toolbar and `git branch` show `kyle/<generated>`.
3. Clear the setting; a new worktree thread gets `t3code/<generated>`.

Part B (needs Docker or Podman running locally):

1. `docker run -d --name loom-demo alpine sh -c 'while true; do date; sleep 2; done'`.
2. Open Containers from the launcher (letter C). `loom-demo` shows under All as running.
3. Follow logs: the terminal drawer opens a tab streaming dates. Click again: the same tab
   is focused, no duplicate.
4. Stop Docker Desktop: the panel shows "Docker is not running" within 10 seconds.
5. Clean up with `docker rm -f loom-demo` (a container Kyle's check created, by name).

Part C:

1. The section lists tools with versions within a few seconds; `jq` shows "Installed with
   Homebrew" and `brew upgrade jq`.
2. "Check for updates" marks outdated Homebrew formulae and npm globals.
3. Add `kubectl` to extra tools; it appears as Missing with a generic hint (or Installed).

Upstream-server case: switch the settings scope to an environment without `small-extras`;
the section says "Needs a Loom server"; the Containers launcher entry is disabled.

## Merge safety

Run the preview in CONVENTIONS.md ("Merge safety"); only `ProviderCommandReactor.ts` may
conflict from this packet, on the marked lines. After Kyle merges, run
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`.
