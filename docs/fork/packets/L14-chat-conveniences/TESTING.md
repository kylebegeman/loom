# L14 testing

## Automated tests

Part C, `presets/presets.test.ts`:

- Storage: decode drops invalid entries; at most 9; order preserved; storage that throws
  yields an empty list without errors.
- `inspectPreset`: unknown instance; model no longer available; thread locked to another
  driver; started session in another continuation group; available case.
- `applyPreset` against the real `useComposerDraftStore`: the thread's draft selection and
  sticky selection equal the preset afterwards, with `replaceOptions` semantics (the
  preset's effort replaces the previous effort).

Part D, `apps/server/src/fork/chat-conveniences/AskService.test.ts` (in-memory
orchestration, no provider):

- Posting appends exactly one `thread.activity-appended` event with a
  `user-input.requested` activity whose payload decodes as `UserInputRequestedPayload`
  with `responseMode: "message"`, and `turnId` equal to the thread's latest turn (or null).
- The existing `thread.user-input.respond` command on that request id succeeds and
  produces a `thread.turn.start` whose message text contains the question and the answer
  (this proves the whole answer path with upstream's decider).
- `thread.user-input.dismiss` on it succeeds.
- A fourth open ask on one thread fails with `too-many-open`; answering one frees a
  slot.
- Unknown and archived threads fail with their reasons.
- The fork tool name starts with `loom_` and is unique (ext-mcp's registry test).

Registry invariants (keybinding commands, palette values) run with the
extension points' tests.

## Commands

```sh
vp test run apps/web/src/fork/chat-conveniences/presets/presets.test.ts \
  apps/server/src/fork/chat-conveniences/AskService.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork/chat-conveniences apps/server/src/fork/chat-conveniences \
  packages/contracts/src/fork
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck                  # part D
vp run --filter @t3tools/contracts typecheck  # parts C and D
vp run --filter @t3tools/mobile typecheck     # contracts changed
```

## Manual check

With Kyle's permission, `test-t3-app` on web, then the desktop dev app, with seeded data:

C. Save two presets (different accounts and efforts), apply each from the popover, the
palette and a bound key; the composer's model and effort follow; on a thread locked to
Codex, a Claude preset is dimmed with the reason; delete and undo.
D. In a Claude thread, ask the agent to "ask me which option I prefer using the Loom ask
tool and keep going": the tool call returns at once, the question panel shows, the
agent continues; answer it: the answer appears as a user message and reaches the agent.
Dismiss another. Repeat on Cursor or OpenCode if available. Open the thread in
upstream's mobile app: the pending question shows and can be answered.

Upstream-server case: C works; the agent tool list has no `loom_` tool.

## Merge safety

`git merge-tree` preview (SEAMS.md) on the branch; `scripts/fork/loom.sh integrate
nightly --dry-run` after merging to `main`. The packet has no packet seams.

## Acceptance criteria

- Each built part meets its PRODUCT.md behavior and states on web and desktop (D on every
  client).
- No new orchestration event types; no new wire schemas on upstream methods.
- No Loom entry is written to `keybindings.json`.
