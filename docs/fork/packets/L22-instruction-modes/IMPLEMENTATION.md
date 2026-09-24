# L22 implementation plan

Ordered steps; each leaves the tree compiling. Commits `feat(fork-instruction-modes): ...`;
extension points in their own `feat(fork): ...` commits.

## Before starting

- Confirm with Kyle that L22 is wanted (it is not in selections.md) and ask his open
  questions in PRODUCT.md, or proceed with the defaults written there.
- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder, and EXTENSION-POINTS.md section 16 (`ext-turn-input`) in particular.

## File layout

```
packages/contracts/src/fork/instruction-modes.ts         instruction-modes.test.ts
packages/client-runtime/src/fork/instruction-modes.ts
apps/server/src/fork/turnInput/registry.ts                registry.test.ts   (ext-turn-input)
apps/server/src/fork/instruction-modes/
  InstructionModesService.ts   InstructionModesService.test.ts
  contributor.ts               contributor.test.ts
  cleanupReactor.ts            cleanupReactor.test.ts
  migrations.ts  rpc.ts
apps/web/src/fork/instruction-modes/
  ComposerModesControl.tsx  modesLabel.ts  modesLabel.test.ts
  settings.tsx  PackEditor.tsx  ProjectDefaults.tsx  PreviewDialog.tsx
  palette.ts  keybindings.ts  menuStore.ts  state.ts
docs/fork/user/instruction-modes.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core`, `ext-turn-input`, `ext-composer`,
   `ext-settings`, `ext-palette`, `ext-web-root`, `ext-keybindings`. Create missing ones as
   specified, one commit each. For `ext-turn-input`, include `registry.test.ts` and the
   FORK.md row. Typecheck `t3` and `@t3tools/web`.
2. **Contracts.** Schemas, RPC group, `BUILTIN_PACKS` (texts from PRODUCT.md, written fresh,
   each under 1,500 characters), `renderInstructionModesBlock`, `parsePackMarkdown`,
   keybinding command. Tests: tag prefixes; render output shape; cap and "omitted" line;
   parse with and without frontmatter; built-in ids unique and valid.
3. **Service and storage.** Migrations, repositories, resolution with cache invalidation,
   RPC operations, registration in `ForkServicesLive`, feature slug.
4. **Contributor.** `contributor.ts` as a pure-ish function over the service (injectable
   resolution and state), registered in the service's layer scope with
   `registerForkTurnInputContributor` (id `instruction-modes`, order 10). Tests: the block
   when modes are on, `undefined` when off; cleared notice once then nothing; thread "No modes" beats a project default;
   project default applies to a thread without a row; failures return `undefined`.
5. **Cleanup reactor.** `cleanupReactor.ts` with `forkParked` and `streamDomainEvents`;
   test with a fake engine stream and a `Deferred` signaled after the delete.
6. **RPC handlers and client runtime.** Handlers with scopes; atoms and commands.
7. **Web.** Composer control and its menu store; settings section with the editor, import,
   export, project defaults, preview; palette source; keybinding subscription. Gate every
   entry on `supportsLoomFeature(caps, "instruction-modes")`.
8. **End-to-end check in a server test.** One test that builds the fork layer with the turn
   input registry, a fake thread shell, sets modes, and calls
   `applyForkTurnInput` to see the block, proving registration wiring without a
   provider.
9. **Docs and status.** `docs/fork/user/instruction-modes.md` (what modes are, how they reach
   agents, the token cost, that the transcript shows only your text, that mobile turns get
   them too). Update the packet index Status and SEAMS.md.

## Pitfalls

- **Never fail or delay a turn.** The contributor's errors are swallowed and time-limited by
  the registry. Keep SQL off the hot path after the first turn.
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
- Turning the mode off produces one cleared notice and then nothing.
- `/compact` still compacts with modes on.
- A message sent from the upstream mobile app to a thread with modes on is decorated (check
  the provider's native event log).
