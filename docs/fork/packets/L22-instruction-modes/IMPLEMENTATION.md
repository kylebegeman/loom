# L22 implementation plan

Ordered steps; each leaves the tree compiling. Commits `feat(fork-instruction-modes): ...`;
extension points in their own `feat(fork): ...` commits.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder, and EXTENSION-POINTS.md section 16 (`ext-turn-input`) in particular. Every question
  is answered in PRODUCT.md, Decisions.
- Develop against a worktree dev server, whose default modes folder is the worktree's
  `.t3/userdata/fork/instruction-modes/`. Never point the folder setting at Kyle's real
  `~/.t3/userdata` or his dotfiles during development.

## File layout

```
packages/contracts/src/fork/instruction-modes.ts         instruction-modes.test.ts
packages/client-runtime/src/fork/instruction-modes.ts
apps/server/src/fork/turnInput/registry.ts                registry.test.ts   (ext-turn-input)
apps/server/src/fork/instruction-modes/
  packLibrary.ts               packLibrary.test.ts
  InstructionModesService.ts   InstructionModesService.test.ts
  contributor.ts               contributor.test.ts
  cleanupReactor.ts            cleanupReactor.test.ts
  migrations.ts  rpc.ts
apps/web/src/fork/instruction-modes/
  ComposerModesControl.tsx  modesLabel.ts  modesLabel.test.ts
  settings.tsx  FolderRow.tsx  PackEditor.tsx  ProblemsList.tsx  ProjectDefaults.tsx
  PreviewDialog.tsx  palette.ts  keybindings.ts  menuStore.ts  state.ts
docs/fork/user/instruction-modes.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core`, `ext-turn-input`, `ext-composer`,
   `ext-settings`, `ext-palette`, `ext-web-root`, `ext-keybindings`. Create missing ones as
   specified, one commit each. For `ext-turn-input`, include `registry.test.ts` and the
   FORK.md row. Typecheck `t3` and `@t3tools/web`.
2. **Contracts.** Schemas, RPC group, `BUILTIN_PACKS` (texts from PRODUCT.md, written fresh,
   each under 1,500 characters), `parsePackFile`, `renderPackFile`, `slugFromName`,
   `renderInstructionModesBlock`, `estimateTokens`, keybinding command. Tests first for the
   pure functions (TESTING.md).
3. **Pack library.** `packLibrary.ts`: folder resolution (`null` to
   `path.join(config.stateDir, "fork", "instruction-modes")`, `~` expansion with
   `expandHomePath`), load with size checks and the 200-file cap, single-flight reload, the
   debounced watch following `apps/server/src/environmentTheme.ts:264-283`, the stale check,
   and the writes (atomic save with hash compare, slug collisions, archive and restore by
   rename into and out of `archived/`, import). No delete anywhere. Test against a temp
   directory with `NodeServices.layer`.
4. **Service and storage.** Migrations (`1_Selections`), repositories for selections and the
   folder setting, resolution with the cache (cleared when the library `seq` changes),
   `setSettings` restarting the watch, RPC operations, registration in `ForkServicesLive`,
   feature slug.
5. **Contributor.** `contributor.ts` over injectable resolution and state, registered in the
   service's layer scope with `registerForkTurnInputContributor` (id `instruction-modes`,
   order 10). It reads only the snapshot; when the snapshot is stale and no watch runs it
   forks a background reload and returns the current block.
6. **Cleanup reactor.** `cleanupReactor.ts` with `forkParked` and `streamDomainEvents`;
   deletes selection rows only.
7. **RPC handlers and client runtime.** Handlers with the scopes from TECHNICAL.md
   (`setSettings` is `terminal:operate`); atoms and commands with the refresh rules.
8. **Web.** Composer control (with missing modes and "Remove") and its menu store; settings
   section with the folder row, library list, editor with the conflict dialog ("Reload",
   "Overwrite"), problems list, import, export, project defaults, preview with the token
   estimate; palette source; keybinding subscription. Gate every entry on
   `supportsLoomFeature(caps, "instruction-modes")`. Refetch `listPacks` on window focus and
   when the Modes menu opens.
9. **End-to-end check in a server test.** One test that builds the fork layer with the turn
   input registry, a temp modes folder, a fake thread shell, sets modes, writes a file
   change, waits for the library `seq` to change (a `Deferred` resolved by the reload), and
   calls `applyForkTurnInput` to see the new text, proving registration and reload wiring
   without a provider.
10. **Docs and status.** `docs/fork/user/instruction-modes.md` (what modes are, the folder and
    file format with one example file, how to keep them in dotfiles, how they reach agents,
    the token cost, that the transcript shows only your text, that mobile turns get them
    too). Update the packet index Status and SEAMS.md.

## Pitfalls

- **Never fail or delay a turn.** The contributor never reads the disk; its errors are
  swallowed and time-limited by the registry.
- **Watch events arrive early.** An editor save can emit several events and fire before the
  content is flushed; always debounce and re-read the whole folder (upstream's theme watcher
  comment says the same).
- **Atomic writes from other editors.** Many editors save by writing a temp file and
  renaming it; the watcher sees a rename, and the reload handles it. Never keep file handles
  open.
- **Hash compare on every save.** An outside edit between open and save must surface as a
  conflict, never be overwritten silently.
- **Nothing is deleted.** There is no delete RPC; archive renames into `archived/`.
- **Folder setting power.** `setSettings` chooses where the server writes; keep it at
  `terminal:operate` and validate the path.
- **Slash commands** and continuations are passed through by the registry itself; the
  contributor is not called for them.
- **Claude skills**: the registry prepends blocks (TECHNICAL.md, "Why prepend").
- **Built-in texts are product copy**: plain language, no em dashes, no emojis, our own words.
- **Drafts**: verify the draft thread id before relying on it (TECHNICAL.md, Storage).
- **Do not add orchestration events** for mode changes.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- With a mode on, a Codex thread and a Claude thread both follow it (for example, "Explain
  as you go" produces the before and after notes) on the next message.
- Editing the mode's file in another editor changes what the next message carries, without
  pressing Reload (watch) and with Reload on a folder where watching is unavailable.
- Turning the mode off produces one cleared notice and then nothing.
- `/compact` still compacts with modes on.
- A message sent from the upstream mobile app to a thread with modes on is decorated (check
  the provider's native event log).
- Two clients editing the same mode: the second save gets the conflict dialog.
