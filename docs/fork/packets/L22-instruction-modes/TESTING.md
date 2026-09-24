# L22 testing

Focused tests, no repo-wide checks, no sleeps (`TestClock` for the contributor time limit,
`Deferred` for the reactor). No test starts a provider.

## Automated tests

| File                                                                     | Covers                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/turnInput/registry.test.ts`                        | The `ext-turn-input` contract (EXTENSION-POINTS.md, section 16, Tests).                                                                                                                                                                                  |
| `packages/contracts/src/fork/instruction-modes.test.ts`                  | Tag prefixes; built-in ids unique, valid, under 1,500 characters, no em dashes; block rendering and the 10,000 cap; `parsePackMarkdown` with and without frontmatter and with a ponytail-shaped `SKILL.md`.                                              |
| `apps/server/src/fork/instruction-modes/InstructionModesService.test.ts` | `SqlitePersistenceMemory`: save, archive, restore, import; resolution order (thread explicit, thread empty, project default, none); archived and unknown ids dropped; cache invalidated after writes; migrations idempotent and tables prefixed `fork_`. |
| `apps/server/src/fork/instruction-modes/contributor.test.ts`             | Block returned while modes are on; hash stored; cleared notice once after turning off, then `undefined`; through `applyForkTurnInput`, a `$skill` mention stays after the block; failures return `undefined`.                                            |
| `apps/server/src/fork/instruction-modes/cleanupReactor.test.ts`          | `thread.deleted` removes the thread row; `project.deleted` removes the project default; other events ignored.                                                                                                                                            |
| `apps/web/src/fork/instruction-modes/modesLabel.test.ts`                 | Label for none, one, several, project-default and "No modes".                                                                                                                                                                                            |

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

1. Open a Codex thread; Modes > Explain as you go; send a small request; the reply explains
   before and after. Check the native event log (`.t3/userdata/logs`) for the
   `<loom_instruction_modes>` block in the turn input; the transcript shows only the typed text.
2. Same on a Claude thread, including a message with a `$skill` mention: the skill runs and the
   mode still applies.
3. Turn the mode off; the next turn carries the cleared notice; the one after carries nothing.
4. Send `/compact` with a mode on; compaction works.
5. Set a project default; a new thread shows it; choose "No modes" in that thread; the default
   no longer applies there.
6. Create a user mode, import a Markdown file, export a mode, archive and restore it.
7. From a remote client (tailnet), toggle a mode; from the first client, focus the window and
   see the change.
8. Upstream server: the composer control is hidden; the settings section explains itself.

## Acceptance criteria

- Modes reach every provider available on the test machine, from web, desktop and a remote
  client, and from a message sent by an upstream client to a Loom server.
- No turn fails or waits noticeably because of the contributor (the registry's 2 second limit is
  never hit in normal use; check traces for `sendTurn` duration).
- The transcript never contains the block.

## Merge safety

Merge preview from CONVENTIONS.md on the packet branch, recorded in SEAMS.md; conflicts only
on `fork: ext-*` lines. After Kyle merges, `scripts/fork/loom.sh integrate nightly --dry-run`
from a clean, synced `main`.
