# L14 implementation plan

Two parts (C and D; A, B and E were retired on 2026-10-09). Build them in either order;
each ends with its own commit and leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Work in a worktree; seed its `.t3` with a `VACUUM INTO` copy of real data. Ask
Kyle before dev servers and browsers.

## File layout

```
apps/web/src/fork/chat-conveniences/palette.tsx             # ext-palette source
apps/web/src/fork/chat-conveniences/commands.ts             # onForkCommand handlers
apps/web/src/fork/chat-conveniences/presets/presets.ts
apps/web/src/fork/chat-conveniences/presets/presets.test.ts
apps/web/src/fork/chat-conveniences/presets/PresetsBlock.tsx
packages/contracts/src/fork/chat-conveniences.ts
apps/server/src/fork/chat-conveniences/AskService.ts
apps/server/src/fork/chat-conveniences/AskService.test.ts
apps/server/src/fork/chat-conveniences/mcp.ts
docs/fork/user/chat-conveniences.md
```

## Part D: Ask without stopping (smallest; server only)

1. Extension points: `ext-core`, `ext-mcp` existence checks; create if missing.
2. Contracts: `packages/contracts/src/fork/chat-conveniences.ts` (tool schemas only);
   export from `fork/index.ts`.
3. `AskService.ts` (TECHNICAL.md, part D) and `AskService.test.ts` against an in-memory
   engine: use the orchestration test harness upstream uses for decider and engine tests
   (see `apps/server/src/orchestration/decider.userInputDismiss.test.ts` and
   `Layers/OrchestrationEngine.test.ts` for how they build a read model and dispatch).
4. `mcp.ts` toolkit and registration in `ForkMcpToolkitsLive`; service in
   `ForkServicesLive` and `ForkServices`; `"chat-conveniences"` in
   `LOOM_SERVER_FEATURES`.
5. Checks; commit `feat(fork-chat-conveniences): let agents ask a question and keep working`.

## Part C: Model presets

1. Extension points: `ext-composer`, `ext-keybindings`, `ext-palette`.
2. `presets.ts`: schema, storage, `inspectPreset`, `applyPreset`, `savePreset`, reorder,
   delete and undo. `presets.test.ts` covers inspection rules against fixtures built from
   upstream types, and storage edge cases.
3. `PresetsBlock.tsx` registered in `FORK_COMPOSER_BLOCKS` (id `model-presets`).
4. Palette items and the six keybinding commands; handlers in `commands.ts`.
5. Checks; commit `feat(fork-chat-conveniences): save and apply model presets`.

## After all parts

- `docs/fork/user/chat-conveniences.md`: presets (suggested bindings), how agents ask
  without stopping and how to answer or dismiss.
- Packet index Status (for example "In progress: C, D done").

## Pitfalls

- Part C: keep `inspectPreset` in step with `onProviderModelSelect`
  (`ChatView.tsx:8838-8905`). Do not edit `ChatView.tsx`; put a pointer comment in `presets.ts` only, and add a test fixture for each rule so an
  upstream change in the shared helpers shows up in this test.
- Part D: never create a new activity kind or event type; the activity must decode as
  `UserInputRequestedPayload`, or answering fails with "This question has already been
  answered."
- Part D: the tool description is prompt text on every turn for every session; keep it
  as short as TECHNICAL.md has it.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done) for each
part built, plus:

- C: an unavailable preset explains itself and cannot be applied.
- D: a Claude session can post a question, keep working, and receive the answer as a
  message; dismiss works; the upstream mobile app shows and answers it. A Codex session
  sees the tool too.
