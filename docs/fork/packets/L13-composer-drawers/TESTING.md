# L13 testing

## Automated tests

`apps/web/src/fork/composer-drawers/clipboardFilter.test.ts`:

- Skips: a PEM private key block, `ghp_` and `github_pat_` tokens, `sk-ant-...`, `AKIA`
  keys, a JWT, `API_KEY=abc123...`, `password: hunter2`, a 32-character random
  mixed-class string.
- Keeps: ordinary prose, a code snippet with the word "token" but no assignment, a URL, a
  long sentence, a UUID (only hex and dashes: two classes), a file path.
- Skips empty, whitespace-only and over-20,000-character text.

`clipboard.test.ts` (store logic with an injected clock and storage):

- Newest first, capped at 30, duplicates move to the top, entries over 24 hours are
  dropped on read.
- Disabled: `record` is a no-op; disabling clears memory and the persisted key.
- `persist` on: survives a store re-creation with the same storage; storage that throws
  degrades to memory without errors.

`schema.test.ts`:

- Valid object and boolean schemas pass and pretty-print; arrays, strings, numbers fail
  with "A JSON Schema is an object."; malformed JSON fails with the parse message.
- `formatSchemaInstruction` output is exactly the documented text; a schema containing
  ` ``` ` gets a longer fence.

`shell.test.ts`:

- `formatShellAttachment`: exit code, duration formatting, stderr section only when
  non-empty, fence lengthening, truncation note, home directory shortened to `~` in the
  cwd label.
- `readShellSettings`: missing or throwing storage gives 30 s and 64 KB; values outside
  the choice lists (for example 120,000,000 ms or 5 MB) fall back to the defaults; valid
  choices round-trip.

`once.test.ts`:

- `onceRestoreActions`: not ready while the latest turn predates `sentAt` or is running
  (every non-terminal `OrchestrationLatestTurnState`); ready with only the fields that
  still equal the override captured at send time; nothing to restore when the user already
  switched back.
- Snapshot and composer restore against the real `useComposerDraftStore` (create a draft
  for a thread ref, arm, change the selection and runtime mode with the store's public
  setters as upstream's pickers do, restore, compare the four fields and the sticky
  fields). This is behavior, not markup, and guards the coupling to the store's shape.
- Records older than 24 hours are dropped on load.

`apps/server/src/fork/composer-drawers/ShellRunner.test.ts` (with a real temporary
directory and the real `ProcessRunner` layer, POSIX only; skip on Windows CI):

- `echo hello` in a project root returns exit 0, stdout `hello\n`, the resolved cwd.
- A thread with a `worktreePath` runs there; a thread whose project differs from the input
  fails `unknown-thread`; an unknown project fails `unknown-project`; a missing directory
  fails `no-workspace`.
- `exit 3` returns exit code 3 (not an error).
- A command that prints more than 64 KB with `maxOutputBytes` 64 KB returns
  `truncated: true` and at most the cap plus the marker per stream; the same command with
  `maxOutputBytes` 1 MB and output under 1 MB returns it whole.
- `sleep 5` with a 1-second timeout returns `timedOut: true` promptly. Use the smallest
  timeout the schema allows (1,000 ms); this is the runner's own timeout, not a sleep in
  the test.
- Projection data for these tests comes from a stub `ProjectionSnapshotQuery` layer with
  `getThreadShellById` and `getProjectShellById` only.

`packages/contracts/src/fork/composer-drawers.test.ts`: `ComposerShellRunInput` rejects
`timeoutMs` above 600,000 and below 1,000, and `maxOutputBytes` above 1,048,576; every
value in the two choice lists decodes.

`apps/server/src/fork/rpcAuthorization.test.ts` (ext-core): the new tag has a scope and a
`loom.` prefix.

## Commands

```sh
vp test run apps/web/src/fork/composer-drawers/clipboardFilter.test.ts \
  apps/web/src/fork/composer-drawers/clipboard.test.ts \
  apps/web/src/fork/composer-drawers/schema.test.ts \
  apps/web/src/fork/composer-drawers/shell.test.ts \
  apps/web/src/fork/composer-drawers/once.test.ts \
  apps/server/src/fork/composer-drawers/ShellRunner.test.ts \
  packages/contracts/src/fork/composer-drawers.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork/composer-drawers apps/server/src/fork/composer-drawers \
  packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

With Kyle's permission, `test-t3-app` on web and the desktop dev app, seeded data, a
signed-in provider:

1. Tools button in the composer footer opens the drawer; Escape closes; the stash menu
   (`mod+s`) hides it while open; an approval hides it.
2. Once: on an idle thread with Sonnet and "approval-required", arm, switch to Opus and
   "full-access" with upstream's pickers, send. The composer immediately shows Sonnet and
   approval-required again; the turn runs with Opus and full access (check the work log
   and the thread's model label); after the turn, the thread's stored settings return to
   Sonnet and approval-required. Change the model during the turn: the restore leaves the
   user's change alone. Cancel before sending restores at once. Reload between send and
   turn end: the restore still happens.
3. Schema: paste a schema, add to prompt, send to a provider; save and reuse.
4. Shell: `git status --short` attaches a fenced block; `exit 3` shows the red code;
   `yes | head -c 200000` shows truncation at 64 KB; raise "Output limit" to 256 KB in
   settings and the same command returns whole; `sleep 60` with 10 s stops at 10 s; change
   "Default timeout" to 2 min and the tab preselects it; `sleep 610` with 10 min stops at
   10 minutes and the result still arrives (long unary RPC); on a thread with a worktree
   the cwd is the worktree.
5. Clipboard: off by default (tab explains, "Turn on"). On: copy a code block with its
   copy button and a selected paragraph: both appear. Copy a fake `ghp_` token: not
   recorded. Desktop: copy in another app, switch back to Loom: the item appears. Insert
   at the caret. Clear all. Turn off: list empties. With "Keep across restarts" off, a
   reload empties it; on, it survives.
6. Upstream-server case (or `composer-drawers` removed from `LOOM_SERVER_FEATURES`):
   Shell shows "Running commands needs a Loom server."; the other tabs work.
7. Remote: run a shell command on a thread of a remote environment; the cwd shown is on
   that machine.

## Merge safety

`git merge-tree` preview (SEAMS.md) on the branch; after merging to `main`,
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`. After each
upstream merge, rerun `once.test.ts`: it is the guard for the composer store coupling.

## Acceptance criteria

- No change to upstream's send path; every override goes through upstream controls and
  commands.
- No clipboard data leaves the client; nothing is captured while disabled.
- Shell output is bounded (64 KB per stream by default, never more than 1 MB per stream)
  and time-bounded (30 s by default, never more than 10 minutes), enforced by the server.
