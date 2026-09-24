# L19 testing

Focused tests, no repo-wide checks, no sleeps (AGENTS.md, "Verifying").

## Automated tests

| File                                                              | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/project-lifecycle/ignoredFiles.test.ts`     | Table of paths to `safe` / `keep` / `review`: `node_modules/`, `apps/web/dist/`, `target/`, `.DS_Store`, `x.tsbuildinfo`, `.env`, `.env.local`, `.env.example` (review), `data/app.sqlite`, `recordings/demo.mov`, `.t3/`, `notes.txt` (review); extra patterns win; `\` separators.                                                                                                                                                                                       |
| `apps/server/src/fork/project-lifecycle/assessPark.test.ts`       | `parseStatusZ` on recorded output (renames, unmerged, ignored dirs); `decideParkBlockers` for each blocker code; `fixableByPush` only on commits and tags; empty facts give no blockers; an incomplete step always blocks; token changes when any safety fact changes and not when order changes.                                                                                                                                                                          |
| `apps/server/src/fork/project-lifecycle/ProjectLifecycle.test.ts` | Real git in a temp dir (no network): a bare repo as origin, a clone, then: clean clone parks (trash stubbed to a rename inside the temp dir); dirty file blocks; local-only branch blocks with `unpushed-commits`, `pushAll` clears it; stash blocks; stale token refuses; protected paths (`cwd`, `baseDir`, home) refuse; `park` inserts a record and dispatches `thread.archive` for the project's threads (engine stubbed, assert on a Deferred of received commands). |
| `apps/server/src/fork/project-lifecycle/trash.test.ts`            | Destination naming; `EXDEV` refused; availability per platform (platform injected).                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/project-lifecycle/noDelete.test.ts`         | Reads every `.ts` file in the packet folder and fails on `.remove(`, `rmSync`, `rm -rf`, `fs.rm(` or `"rm"` in argv. Guards the old Loom bug.                                                                                                                                                                                                                                                                                                                              |
| `apps/server/src/fork/project-lifecycle/store.test.ts`            | Migrations apply twice cleanly on `SqlitePersistenceMemory`; parked insert, list, mark reopened, forget; settings default on invalid JSON.                                                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/project-lifecycle/githubInventory.test.ts`  | Decoding a recorded `--slurp` output; ENOENT maps to `Missing`; "not logged in" stderr maps to `Unauthenticated`; cache hit within TTL; `refreshGitHub` bypasses.                                                                                                                                                                                                                                                                                                          |
| `apps/web/src/fork/project-lifecycle/repositoriesModel.test.ts`   | Join by `remoteKey` (ssh vs https forms of one repo match); Local only rows; parked row hidden when a live checkout exists; filters and search.                                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/fork/project-lifecycle/repositoriesSearch.test.ts`  | Search param validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Plus the extension point invariant tests if this packet created any extension point.

The server test drives real `git` through `VcsProcess` (upstream tests do the same with
`VcsProcess.layer` and `NodeServices.layer`, `apps/server/src/vcs/VcsProcess.test.ts:28`) and
injects a fake trash implementation so no test touches the real Trash.

## Commands

```sh
vp test run apps/server/src/fork/project-lifecycle apps/web/src/fork/project-lifecycle
vp lint apps/server/src/fork/project-lifecycle apps/web/src/fork/project-lifecycle \
  packages/contracts/src/fork/project-lifecycle.ts packages/client-runtime/src/fork/project-lifecycle.ts \
  apps/web/src/routes/loom.repositories.tsx
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web build   # regenerates routeTree.gen.ts
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck   # contracts changed; mobile imports them
```

## Manual check

Needs Kyle's permission for a dev server and a browser (AGENTS.md). Use a seeded worktree
`.t3` and a fixture directory, never real checkouts:

```sh
fixture=$(mktemp -d)/loom-park-fixture
mkdir -p "$fixture/origin" "$fixture/active"
git init -q --bare "$fixture/origin/demo.git"
git clone -q "$fixture/origin/demo.git" "$fixture/active/demo"
(cd "$fixture/active/demo" && git commit -q --allow-empty -m init && git push -q -u origin HEAD \
  && git switch -q -c backup/local-only && git commit -q --allow-empty -m local \
  && printf 'SECRET=1\n' > .env && printf '.env\nnode_modules/\n' > .gitignore \
  && git add .gitignore && git commit -q -m ignore && mkdir node_modules)
echo "$fixture/active"
```

1. Set Settings, Loom, Repositories, clone location to the printed `active` path.
2. Open Repositories from the palette. `demo` shows as Local only (its origin is a file
   path, not GitHub). GitHub rows show if `gh` is signed in, else the banner.
3. Adopt `demo` as a project. The project appears in the sidebar.
4. Park `demo`: "Commits not on GitHub" blocks. Click "Push all branches and tags"; the
   report refreshes and the blocker is gone. `.env` is under Keep, `node_modules/` under Safe.
   Tick the acknowledgement, keep "Archive threads", "Move to Trash". The folder is in the
   Trash (check `~/.Trash` or Finder), the project's threads are in Settings, Archive.
5. Parked filter shows the record. Reopen: the upstream clone toast shows progress, the
   folder is back, the project id is unchanged, threads are unarchived when chosen.
6. Forget a parked record; it disappears; nothing on disk changes.
7. Upstream-server case: connect the client to an environment running upstream T3 Code (or
   remove `project-lifecycle` from `LOOM_SERVER_FEATURES` in a scratch build). Palette items
   are gone; `/loom/repositories` explains "Repositories needs a Loom server".
8. Remote case, if available: pick a remote environment in the page's select; confirm every
   dialog names that environment, and the fixture paths are resolved on that machine.

## Acceptance criteria

- Park never runs with a blocker present, and every blocker in `dev-park` has an equivalent.
- The folder goes to the Trash (or `~/.Trash` rename) and can be restored; nothing is deleted.
- A stale report cannot be used to park.
- The environment is named in every confirmation.
- GitHub inventory failures never hide local clones.

## Merge safety

Run the preview in CONVENTIONS.md ("Merge safety") and record the tag and result in
SEAMS.md. Only `apps/web/src/routeTree.gen.ts` may conflict. After Kyle merges to `main`, run
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`.
