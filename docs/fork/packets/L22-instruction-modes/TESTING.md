# L22 testing

Focused tests, no repo-wide checks, no sleeps (`TestClock` for the contributor time limit,
`Deferred` for the reactor). No test starts a provider.

## Automated tests

| File                                                                     | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/turnInput/registry.test.ts`                        | The `ext-turn-input` contract (EXTENSION-POINTS.md, section 16, Tests).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/contracts/src/fork/instruction-modes.test.ts`                  | Tag prefixes; built-in ids unique, valid, under 1,500 characters, no em dashes; `parsePackFile` for each rule (valid file, missing frontmatter, no `name`, invalid YAML, name and description too long, rules over 4,000 characters, bad file name such as `README.md` or `Minimal.md`, extra keys kept and ignored, a ponytail-shaped `SKILL.md`); `renderPackFile` then `parsePackFile` round-trips; `slugFromName`; block rendering, closing-tag escaping and the 10,000 cap; `estimateTokens`.                                                                                                                                                                                                                                                                                                                            |
| `apps/server/src/fork/instruction-modes/packLibrary.test.ts`             | Temp directory with `NodeServices.layer`: missing folder gives `missing` and built-ins only; a file that is a path, not a folder, gives `unreadable`; load lists packs, archived packs and problems; files over 20 KB and past the 200-file cap become problems; save creates `<slug>.md`, collisions get `-2`; save with a stale `expectedHash` fails with `conflict` and returns the disk hash; archive and restore rename and refuse an existing destination; import normalizes the frontmatter; a write followed by an outside write, then a reload, yields the outside content; the watcher path: an outside write resolves a `Deferred` on the next `seq` (no sleeps; skip with a clear message only if the platform reports that watching is unsupported). A grep assertion that the folder code never calls `remove`. |
| `apps/server/src/fork/instruction-modes/InstructionModesService.test.ts` | `SqlitePersistenceMemory` plus a temp folder: resolution order (thread explicit, thread empty, project default, none); archived, invalid and unknown ids land in `missing`, not `effective`; cache cleared after selection writes and after a library reload; `setSettings` switches folders and keeps selections by id; builtin writes fail with `builtin-read-only`; migrations idempotent and tables prefixed `fork_`.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/server/src/fork/instruction-modes/contributor.test.ts`             | Block returned on every turn while modes are on (twice in a row, same text); hash stored only when it changes; cleared notice once after turning off, then `undefined`; no disk read on the call (library stubbed to fail on read); a stale snapshot without a watch forks one background reload; through `applyForkTurnInput`, a `$skill` mention stays after the block; failures return `undefined`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/instruction-modes/cleanupReactor.test.ts`          | `thread.deleted` removes the thread row; `project.deleted` removes the project default; other events ignored; mode files untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/fork/instruction-modes/modesLabel.test.ts`                 | Label for none, one, several, project-default, "No modes", and a selection with missing modes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Registry invariants (composer block ids, settings section ids, palette values, keybinding
command) come from the extension point tests.

## Commands

```sh
vp test run apps/server/src/fork/turnInput/registry.test.ts \
  packages/contracts/src/fork/instruction-modes.test.ts \
  apps/server/src/fork/instruction-modes \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/web/src/fork/instruction-modes/modesLabel.test.ts \
  packages/contracts/src/fork/keybindings.test.ts

vp lint packages/contracts/src/fork apps/server/src/fork apps/web/src/fork packages/client-runtime/src/fork \
  apps/server/src/provider/Layers/ProviderService.ts

vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

Upstream's own `ProviderService` tests must still pass with the seam in place:

```sh
vp test run apps/server/src/provider/Layers/ProviderService.test.ts
```

## Manual check

With Kyle's permission for a dev server and browser; seed the worktree `.t3` per AGENTS.md.
The default folder is then the worktree's `.t3/userdata/fork/instruction-modes/`.

1. Open a Codex thread; Modes > Explain as you go; send a small request; the reply explains
   before and after. Check the native event log (`.t3/userdata/logs`) for the
   `<loom_instruction_modes>` block in the turn input; the transcript shows only the typed text.
2. Same on a Claude thread, including a message with a `$skill` mention: the skill runs and the
   mode still applies.
3. Turn the mode off; the next turn carries the cleared notice; the one after carries nothing.
4. Send `/compact` with a mode on; compaction works.
5. Set a project default; a new thread shows it; choose "No modes" in that thread; the default
   no longer applies there.
6. Create a user mode; the file appears in the folder. Duplicate a built-in to edit. Import a
   Markdown file, export a mode, archive it (the file moves into `archived/`) and restore it.
7. Edit a mode file in another editor; within a few seconds the preview shows the new text
   and the next message carries it. Add a `README.md` and a file without frontmatter; both
   appear under "Files that are not modes" and never reach the agent.
8. Change the folder to a scratch directory under the worktree with a copy of one mode file;
   the library switches, a thread using that mode keeps it, a thread using another mode shows
   it as missing. "Use default" switches back.
9. From a remote client (tailnet), toggle a mode and edit a pack; from the first client, open
   the same pack, save, and see the conflict dialog; focus the window and see the change.
10. Preview shows characters and "about N tokens".
11. Upstream server: the composer control is hidden; the settings section explains itself.

## Acceptance criteria

- Modes reach every provider available on the test machine, from web, desktop and a remote
  client, and from a message sent by an upstream client to a Loom server.
- No turn fails or waits noticeably because of the contributor (the registry's 2 second limit is
  never hit in normal use; check traces for `sendTurn` duration).
- The transcript never contains the block.
- No mode text is stored in `state.sqlite` (check the fork tables); nothing in the modes
  folder is ever deleted by Loom.

## Merge safety

Merge preview from CONVENTIONS.md on the packet branch, recorded in SEAMS.md; conflicts only
on `fork: ext-*` lines. After Kyle merges, `scripts/fork/loom.sh integrate nightly --dry-run`
from a clean, synced `main`.
