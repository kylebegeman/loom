# L01 testing

Focused tests only (AGENTS.md). No repo-wide checks, no sleeps.

## Automated tests

`packages/client-runtime/src/fork/snippetsEngine.test.ts` (pure):

- Fields: `[[name]]`, `[[name|default]]`, duplicates collapse in first-appearance order,
  `\[[x]]` stays literal, `[[1, 2]]` and `[[ ]]` do not match, names over 64 characters do
  not match, more than 100 distinct fields is an error.
- Expansion: values are inserted once and never re-parsed (a value containing `[[x]]`
  stays literal); `[[cursor]]` sets the offset and is removed (first wins, later ones
  removed too); built-ins with missing context expand to "" and appear in `unresolved`;
  empty values are allowed.
- Ranking: exact alias beats everything; in-project beats global on ties; a project alias
  equal to a global alias resolves to the project snippet in that project and to the
  global one elsewhere; empty query ordering (pinned, recent use, recent update); fuzzy
  subsequence matches rank below substring matches.
- Performance guard: ranking 1,000 snippets with 2,000-character bodies stays under a
  generous bound (for example 50 ms) so CI flakiness is unlikely while regressions to
  quadratic behavior fail.
- Artifacts: round trip one and many snippets; reads old Loom's exact export (the block
  in TECHNICAL.md, with `id`, `scopes`, `enabled`, `sortOrder`), ` ```json ` fences
  and bare JSON; comma-separated aliases and tags; leading `;` stripped; invalid aliases
  dropped with a warning.
- Legacy conversion: `{{name}}`, `{{ name | default }}`, `{{cursor}}`,
  `{{workspaceRoot}}` convert; `{{selection}}`, `{{profile.name}}` and `{{> alias}}` stay
  literal with warnings; `${{ secrets.X }}` (GitHub Actions) is left untouched because
  a `{{` preceded by `$` is never converted.

`apps/server/src/fork/snippets/SnippetService.test.ts` (on `SqlitePersistenceMemory`,
`apps/server/src/persistence/Layers/Sqlite.ts:41-44`, with the fork migrations run):

- Create, update, read back; an unchanged save does not add a revision; a changed save
  does; revisions are capped at 50 (oldest pruned).
- Alias uniqueness per scope, case-insensitive; the same alias in a project and globally
  is allowed; a conflicting save fails with `SnippetAliasConflictError` naming the other
  snippet.
- `expectedHeadRevision` mismatch fails.
- Soft delete releases aliases and keeps revisions; `restoreDeleted` reinstates free
  aliases and reports taken ones; purge removes rows and revisions; the startup purge
  removes only items deleted more than 30 days ago (inject the clock with `TestClock`).
- `restoreRevision` creates a new head and fails cleanly on a taken alias.
- Limits: the 1,001st live snippet and a body total over the limit fail with
  `SnippetLimitError`.
- Import: mixed valid and invalid items in one call; skipped reasons; dropped aliases.
- Subscription: the first element is the current library; a mutation publishes a new
  snapshot with a higher `version`; `recordUse` publishes nothing. Wait on the stream's
  elements (take N), never on time.

`apps/server/src/fork/rpcAuthorization.test.ts` (from ext-core) already asserts every fork
tag has a scope and does not collide with upstream; run it.

`apps/web/src/fork/snippets/terminalSend.test.ts` (pure parts):

- Target resolution order: drawer terminal when open, else the active right-panel
  terminal surface, else none.
- Single-line text unchanged; multi-line wrapped in bracketed-paste markers; never a
  trailing newline; text over 65,536 characters rejected with a message.

`apps/web/src/fork/snippets/composerMenu.test.ts` (pure `detect`):

- `;r`, `;review`, `;.x` and `;)` at the start of a line or after whitespace open the menu
  with the text after `;` as the query.
- A bare `;`, `; ` and `;` at the end of a word (`done;`) or inside one (`a;b`) return
  `null`.
- The range covers the whole token from `;` to the cursor.

Registry invariants come from the extension points' own tests (panel ids and letters,
palette values `action:loom:`, keybinding commands `loom.`, composer ids). Run them after
registering.

## Commands

```sh
vp test run packages/client-runtime/src/fork/snippetsEngine.test.ts \
  apps/server/src/fork/snippets/SnippetService.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/server/src/fork/persistence/migrations.test.ts \
  apps/web/src/fork/snippets/terminalSend.test.ts \
  apps/web/src/fork/snippets/composerMenu.test.ts \
  apps/web/src/fork/panels/registry.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint packages/contracts/src/fork packages/client-runtime/src/fork apps/server/src/fork apps/web/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck   # contracts changed; mobile imports them
```

(Include the palette and composer registry tests if their extension points ship them.)

## Manual check

With Kyle's permission, one integrated pass with `test-t3-app` on web against a seeded
worktree `.t3`, then the desktop dev app:

1. Snippets panel from the launcher (letter S): create a global snippet "Review" with
   alias `review` and body `Review [[scope|the diff]] for bugs.[[cursor]]`; create a
   project snippet with alias `review` too.
2. In a thread of that project, type `;rev`: the menu shows the project snippet first;
   Tab opens the fill-in drawer with "the diff" prefilled; Enter inserts; the cursor sits
   at the end. In another project, `;review` + Tab picks the global one.
3. `;zzz` + Tab: no menu item, Tab behaves as without Loom (focus is not trapped). Typing
   `;` alone, or `; ` followed by words, never opens the menu.
4. Bind `loom.snippets.search` in Settings > Keybindings, open the dialog, type, insert,
   copy, send a multi-line snippet to an open terminal (no command runs).
5. Edit the snippet twice; history shows three revisions; restore the first; delete and
   restore from the Deleted filter.
6. Import an old Loom `.loom-snippet.md` export; fields convert. Export all and re-import.
7. Open a second browser (or desktop plus web) on the same environment: edits appear
   without reload.
8. Upstream-server case: connect a Loom client to an upstream T3 server (or run the dev
   server with `"snippets"` removed from `LOOM_SERVER_FEATURES`): the launcher row is
   disabled with "Snippets need a Loom server.", palette items are absent, `;` does
   nothing special.

## Merge safety

On the packet branch: the `git merge-tree` preview from SEAMS.md, result recorded there.
After Kyle merges to `main`: `scripts/fork/loom.sh integrate nightly --dry-run` from a
clean, synced `main`. Note the known `loom.sh` gap (CONVENTIONS.md): it does not yet
typecheck `apps/server`, `packages/contracts` or `packages/client-runtime`, so run those
typechecks yourself.

## Acceptance criteria

- Every PRODUCT.md behavior works on web and desktop, with loading, empty, error and
  unsupported states.
- No RPC is issued while typing in the `;` menu or the dialog.
- A bare `;` or `; ` never opens the menu; `;` followed by any non-space character does.
- No default keybinding is added for the snippet commands.
- Unchanged saves add no revision; deletes are restorable for 30 days.
- The upstream prompt stash, ArrowUp recall and `$` skills menu behave exactly as before.
