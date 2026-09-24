# L06 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                       | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/source-control-cockpit/parsers.test.ts`              | Recorded outputs: graph log with merges, tags and a subject containing a tab; unmerged records for all seven XY codes; status v1 with renames; worktree list; stash list; `jobIdFromDetailsUrl` on Actions and third-party URLs; check run and status mapping for every conclusion; `tailUtf8` keeps the end and never splits a multi-byte character; redaction of each token pattern; marker counting; lockfile and generated hints; commands per operation (bisect has no continue); `decideSwitchVerdict` for safe, carry, conflict, blocked; varlock output for clean, findings and config error.                                                                                                                                                                                                            |
| `apps/server/src/fork/source-control-cockpit/SourceControlCockpit.test.ts` | Real git in a temp directory through `VcsProcess` (no network, gh stubbed): lane facts during a real rebase conflict (operation `rebase`, conflicted count); conflicts list after the same rebase; `stale` when HEAD moves between reads (inject the move through a test hook); switch preflight carry vs conflict on real branches; stash push with an untracked file stashes it and leaves an ignored file in place, then list and pop restore it; continue with unmerged files fails `unresolved`; continue after `git add` finishes a one-commit rebase (operation `none`); continue on a two-commit rebase with two conflicts returns operation `rebase` with conflicts; abort restores the original HEAD; a wrong `expectedHead` or operation fails `stale`; target resolution rejects unknown thread ids. |
| `apps/server/src/fork/source-control-cockpit/checks.test.ts`               | gh stubbed with recorded JSON: `NotPushed`, `Unsupported` for a GitLab remote, `GhMissing` on ENOENT, `GhUnauthenticated`, `RateLimited` with `resetAt` from a 403 rate-limit response, dedupe by name, cache hit within 20 seconds and `refresh` bypass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/fork/source-control-cockpit/graphLayout.test.ts`             | Linear history uses one column; a merge opens and closes a second column; two branch tips from one base; columns are stable for a given input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/source-control-cockpit/prompts.test.ts`                 | Fix and resolve prompts include branch, check or files, and cap the log excerpt; appending to an existing draft keeps it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/fork/source-control-cockpit/operationButtons.test.ts`        | Pure `resolveOperationButtons(conflicts, siblingThreads)`: Continue disabled with the unresolved reason while files remain; both disabled while a thread on the checkout is working; none for bisect; labels per operation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

The gh stub is a test `VcsProcess` layer that answers `command: "gh"` from a map of args to
recorded output and delegates `command: "git"` to the real process layer
(`apps/server/src/vcs/VcsProcess.test.ts:28` shows the live layer setup).

## Commands

```sh
vp test run apps/server/src/fork/source-control-cockpit apps/web/src/fork/source-control-cockpit
vp lint apps/server/src/fork/source-control-cockpit apps/web/src/fork/source-control-cockpit \
  packages/contracts/src/fork/source-control-cockpit.ts \
  packages/client-runtime/src/fork/source-control-cockpit.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

Needs Kyle's permission for a dev server and a browser. Seed `.t3` from real data. Conflict
fixture:

```sh
repo=$(mktemp -d)/cockpit-demo && git init -q "$repo" && cd "$repo"
printf 'a\n' > f.txt && git add f.txt && git commit -qm base
git switch -qc feature && printf 'feature\n' > f.txt && git commit -qam feature
git switch -q - && printf 'main\n' > f.txt && git commit -qam main
git switch -q feature && git rebase -q "$(git rev-parse --abbrev-ref @{-1})" || true
echo "$repo"
```

1. Add the fixture folder as a project; open a thread in it.
2. Open Source control from the launcher (letter G). Lane shows "Rebase in progress: 1
   conflicted file"; Conflicts lists `f.txt` as both-modified with 1 marker; "Open file"
   opens it; "Ask the agent to resolve" fills the composer and nothing is sent; the
   commands copy. Continue is disabled with "Resolve and stage every conflicted file
   first."
3. Resolve by hand and `git add f.txt` in the terminal. Continue rebase, confirm: the
   rebase finishes and the banner clears. Recreate the fixture, then Abort rebase, confirm:
   the branch is back at its pre-rebase commit. Cancel in either dialog changes nothing.
4. Make a dirty change to `f.txt` and add an untracked file, open Safe switch, pick the
   other branch: verdict "conflict". "Stash and switch" switches; the untracked file is in
   the stash and an ignored file stays; the old branch's lane shows the stash; Pop
   restores both.
5. On a real GitHub project with Actions (Kyle's choice), Checks lists runs for the head,
   "Open log" shows the tail of a failed job, "Open on GitHub" opens the job.
6. Graph shows HEAD, upstream and the default branch with the merge base marked.
7. Upstream-server case: connect to an environment without `source-control-cockpit`; the
   launcher entry is disabled with "Needs a Loom server" and palette items are gone.
8. Remote case, if available: open a thread on a remote environment; every view reads that
   machine's repository.

## Acceptance criteria

- No view runs a command that writes to the repository except Stash push, Apply and Pop,
  Continue and Abort, each on an explicit click; Continue and Abort only after the
  confirmation dialog.
- "Ask the agent" never sends a turn.
- Read commands never take `index.lock`.
- Logs show the end of the job log.
- The panel adds no WebSocket subscription.

## Merge safety

Run the preview in CONVENTIONS.md ("Merge safety") and record it in SEAMS.md. This packet
adds no packet seams, so any conflict belongs to an extension point. After Kyle merges, run
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`.
