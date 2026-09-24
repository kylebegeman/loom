# L20 testing

Focused tests per part; no repo-wide checks; no sleeps.

## Automated tests

| File                                                                | Part   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/small-extras.test.ts`                  | shared | `WorktreeBranchPrefix` accepts `loom`, `kyle`, `kyle/agents`, `a_b-c`; rejects `Kyle`, `-x`, `x-`, `a//b`, `a--b`, `refs/heads/x`, 65 chars. Settings defaults decode with prefix `loom`. `PRIVATE_MODE_INSTRUCTION` is wrapped in `<loom_private_mode>` and has no em dash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/small-extras/store.test.ts`                   | shared | Migrations 1 and 2 apply twice cleanly on `SqlitePersistenceMemory`; invalid JSON yields defaults; update round trip; private project insert and delete; scan row upsert.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/small-extras/branchNaming.test.ts`            | A, D   | No namer: the input is returned. A namer's result is used. A failing namer and a slow one (`TestClock` past 5 seconds) return the input. Closing the registering scope removes the namer. `generatedWorktreeBranchName` (the fork copy of upstream's sanitizer) turns a message and a title into `t3code/<fragment>`, and an empty result into `t3code/update`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/small-extras/SmallExtras.test.ts`             | A, D   | Fresh environment names `t3code/fix` as `loom/fix`; `updateSettings` to `kyle` gives `kyle/fix`; `null` or `t3code` gives `t3code/fix`; invalid input fails with `invalid`. With a private project (fake thread shell): `t3code/fix-login-redirect` becomes `fix/login-redirect`; Jev stubbed `answered` with `docs` gives `docs/...`; Jev stubbed `fallback` uses the keywords; turning private off restores the prefix. The contributor returns the block only for private threads. The Claude resolver returns true for a private thread, false otherwise, fails closed on a lookup error only while a project is private. `setPrivateProject` sets the stubbed decide override to "off" only when none was set; startup reconciliation does the same. `renamePrivateBranch` (stubbed `GitWorkflowService` and engine): a temporary branch is renamed to the namer's result for the first message (the title when the message is missing) and `thread.meta.update` is dispatched; it refuses with `not-temporary` and with `not-private`. The cleanup reactor deletes the private project row on `project.deleted` and the scan row on `thread.deleted`. |
| `apps/server/src/fork/small-extras/privateMode/branchType.test.ts`  | D      | Keyword table: "fix-login-redirect" fix; "hotfix-payments-outage" hotfix; "update-readme" docs; "refactor-auth-module" refactor; "bump-deps" chore; "add-dark-mode" feature; message used when the fragment has no keyword; fragment wins over the message; `privateBranchName` strips a leading type word and never returns an empty name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/small-extras/privateMode/aiMarkers.test.ts`   | D      | Log parsing with NUL and record separators, multi-line bodies and unicode. Markers: `Co-Authored-By: Claude <noreply@anthropic.com>`, `Co-authored-by: Codex <noreply@openai.com>`, a Copilot bot trailer, a human co-author (not flagged), a `Generated with [Claude Code](...)` line, an AI author email, "Cursor" alone (not flagged), "OpenAI" in a subject (`agent-name`). `buildFixCommand`: quoting of a cwd with a `'`, `--root` for a root commit, `--reset-author` only with an AI author, the pattern removes exactly the flagged lines when run through `grep -v -i -E` on the fixture messages (the test runs the pattern in-process with the same regex semantics). Reword and rename commands.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/small-extras/privateMode/commitCheck.test.ts` | D      | Real git in a temp repository (no network), engine events fed through a fake stream, completion awaited with a `Deferred`: a turn that adds a commit with a Claude trailer produces one `thread.activity.append` (stubbed engine) and one published warning; a clean commit produces none; the same HEAD twice produces one warning; non-private threads are ignored without running git; unknown `turn_start_head` falls back to `last_scanned_head..HEAD`, then `HEAD --not --remotes`; a temporary branch at `checkpointTurnCount` 2 sets `temporaryBranch` and `renameCommand` and at 1 does not; a detached HEAD is skipped (no log, no warning); `checkPrivateThread` returns its result without publishing on the stream, and `noBranch: true` on a detached HEAD; `readGit` refuses a non-allowlisted subcommand.                                                                                                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/small-extras/containers.test.ts`              | B      | Recorded Docker NDJSON and Podman JSON (running, exited, compose labels, comma values); daemon-down stderr classification; project matching by working dir; 500 cap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/small-extras/cliTools.test.ts`                | C      | `extractVersion` on real outputs (git, node `v22.x`, jq `jq-1.7.1`, rg, xcodebuild, python, `go version go1.27.1 darwin/arm64`, `swiftlint version`); manager detection from paths (Cellar, Caskroom including a cask wrapper, `lib/node_modules`, `~/.bun`, `/usr/bin`, Xcode); `updateOverride` for a rustup proxy; absolute-path executables; `brew outdated --json=v2` and `npm outdated -g --json` parsing; exit 1 from npm treated as data; catalog ids unique and no provider CLI in the list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/src/fork/small-extras/followContainerLogs.test.ts`        | B      | Rejects a non-hex id; builds `docker logs --follow --tail 200 <id>\r`; a second call for the same container does not open or write again (store and commands stubbed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/web/src/fork/small-extras/privateModeToast.test.ts`           | D      | The toast builder: title per case (automatic fix, names only, temporary branch), "Already pushed" line only when pushed, actions per case ("Copy fix command"; "Copy reword command"; "Rename branch" and "Copy command") with "Open thread" in every case, expandable details list every finding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Plus the extension point invariant tests if this packet created any (panel id and shortcut
uniqueness in `apps/web/src/fork/panels/registry.test.ts`, settings section ids, palette item
values, `ext-turn-input` registry tests, `ext-decide` tests).

## Commands

```sh
vp test run packages/contracts/src/fork/small-extras.test.ts \
  apps/server/src/fork/small-extras apps/web/src/fork/small-extras
vp lint packages/contracts/src/fork/small-extras.ts apps/server/src/fork/small-extras \
  apps/web/src/fork/small-extras packages/client-runtime/src/fork/small-extras.ts \
  apps/server/src/orchestration/Layers/ProviderCommandReactor.ts \
  apps/server/src/provider/Layers/ClaudeAdapter.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

Also run upstream's tests once for the two seamed files, since they changed:

- `vp test run apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`: it
  exercises the first-turn rename with a stubbed `renameBranch` (around lines 298, 471 and
  680, thread branch `t3code/1234abcd`) and must stay green; with no `ForkLayer` the namer is
  not registered and the name is upstream's.
- `vp test run apps/server/src/provider/Layers/ClaudeAdapter.test.ts`: with no resolver
  registered the spread is empty and the options are unchanged.

Copying either harness into a fork test is not worth it; the registration tests plus the
manual checks cover the fork behavior.

## Manual check

Needs Kyle's permission for a dev server and a browser. Seeded worktree `.t3`.

Part A:

1. Settings, Loom, Small extras: the prefix shows `loom`. Enter `Kyle`; the inline error
   appears. Enter `kyle`; saved.
2. Start a new thread in worktree mode on a git project and send a message. After the title
   appears, the branch toolbar and `git branch` show `kyle/<generated>`.
3. Clear the setting; a new worktree thread gets `t3code/<generated>`. Reset: back to `loom`.

Part D (scratch repository under `.t3/scratch/`, added as a project, with a local bare repo as
`origin`):

1. Settings, Loom, Small extras, "No AI identification": switch the scratch project on. The
   row shows "On since ...".
2. New worktree thread, first message "fix the broken login redirect": the branch becomes
   `fix/...`, not `loom/...`.
3. Claude thread: ask it to change a file and commit. `git log -1 --format=%B` has no
   `Co-Authored-By` and no "Generated with" line. In a non-private project, a new Claude
   thread's commit does carry Claude's default attribution.
4. Ask the agent to "commit with the message 'Add retry' and add Co-Authored-By: Claude
   <noreply@anthropic.com>". After the turn, the timeline shows the warning row and a toast
   appears; "Copy fix command", run it in a terminal on the scratch repository, and the
   trailer is gone. Push to the bare origin and repeat: the toast says "Already pushed".
5. Palette, "Check this thread's commits for AI markers": reports the same or "No AI
   markers".
6. Codex: the verification step in IMPLEMENTATION.md (step 4.10); record the result.
7. From the mobile app (if available) or a second browser, send a message to the private
   thread: the agent still receives the instruction (check the provider log), and the
   warning row shows in the mobile timeline.
8. Turn the switch off from the palette; the toast offers Undo; the next worktree thread gets
   `loom/`.
9. If L18 is present: the profile shows the same switch.
10. If Jev (L29 or `ext-decide`) is configured: the scratch project shows "Jev off" after
    being made private; turn Jev on for it and start a thread with an ambiguous message; the
    decisions log shows a `small-extras.branch-type` entry.

Part B (needs Docker or Podman running locally):

1. `docker run -d --name loom-demo alpine sh -c 'while true; do date; sleep 2; done'`.
2. Open Containers from the launcher (letter C). `loom-demo` shows under All as running.
3. Follow logs: the terminal drawer opens a tab streaming dates. Click again: the same tab
   is focused, no duplicate.
4. Stop Docker Desktop: the panel shows "Docker is not running" within 10 seconds.
5. Clean up with `docker rm -f loom-demo` (a container Kyle's check created, by name).

Part C:

1. The section lists tools with versions within a few seconds; `jq` shows "Installed with
   Homebrew" and `brew upgrade jq`; `rustc` shows `rustup update`; `blender` shows the cask.
2. "Check for updates" marks outdated Homebrew formulae and npm globals.
3. Add `kubectl` to extra tools; it appears as Missing with a generic hint (or Installed).

Upstream-server case: switch the settings scope to an environment without `small-extras`;
the section says "Needs a Loom server"; the Containers launcher entry is disabled; the
private mode palette items are absent.

## Merge safety

Run the preview in CONVENTIONS.md ("Merge safety"); only `ProviderCommandReactor.ts` and
`ClaudeAdapter.ts` may conflict from this packet, on the marked lines. After Kyle merges, run
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`.
