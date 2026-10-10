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

Part E, `presets/autoPreset.test.ts` (pure):

- Storage: decode drops invalid choices; fewer than two valid choices reads as "not set
  up"; storage that throws reads as "not set up".
- `resolveAutoSelection`: for ranges of 1, 2, 3 and 5 options, `light` is the lowest,
  `deep` the highest, `standard` the (lower) middle, never outside `lowest`..`highest`;
  only the effort option changes; `effort: null` and a vanished descriptor or bound return
  the saved selection.
- `shouldRequestSuggestion`: no request under 12 characters, before 800 ms idle, within
  3 s of the last request, with the same text, while one is in flight, with Auto off, or
  with typing suggestions off.
- `autoChipState`: every fallback reason maps to its copy; a suggestion equal to the
  current selection reads "current model fits"; a suggestion that part C's
  `inspectPreset` rejects has no **Use**.

Part E, `apps/server/src/fork/chat-conveniences/autoPresetRequest.test.ts` (pure):

- Buckets at the boundaries (119, 120, 599, 600, 2,999, 3,000 characters), images yes and
  no, new thread and follow-up.
- `model` criteria keys equal the labels and values the descriptions; `effort` criteria are
  exactly light, standard, deep; no digits in any instruction.
- Duplicate labels (case-insensitive) fail `duplicate-candidates`.
- The state holds exactly the four documented fields; the request has no `threshold`.
  (Redaction, budget and threshold are `decide`'s and are tested in ext-decide's own
  `redact.test.ts`, `budget.test.ts` and `LoomDecide.test.ts`.)

Part E, `AutoPresetService.test.ts`, with a scripted `LoomDecide` test layer (section 18,
"Registering a packet", step 5: consumers never call TypeSafe in tests; this stands in for
a stubbed Jev client) and a stub `ProjectionSnapshotQuery`:

- The call uses feature `chat-conveniences.auto-preset`, the input's `origin`, the thread's
  `threadId` and derived `projectId`, and no `threshold`.
- Scripted `answered` with `model: "Opus"` at 0.9 and `effort: "deep"` at 0.8: result
  `suggested` with that candidate's id, `deep`, confidence 0.8 and the `decisionId`.
- Scripted `fallback: low-confidence` with `answers` attached: result `fallback` with the
  `decisionId` and `leaning` mapped to the candidate and level; with an unknown label in
  those answers, no `leaning`.
- An `answered` label that is not a candidate: `fallback: error`.
- Scripted `disabled`, `no-key`, `project-off`, `timeout` and `error`: passed through
  unchanged, with no retry (the layer counts calls: exactly one).
- Unknown `threadId`: `unknown-thread` and `decide` is not called; with a thread,
  `thread_stage` follows `latestTurn`.

`apps/server/src/fork/decide/registry.test.ts` (ext-decide) covers the feature's id,
`packet: "L14"` and threshold range once it is in `FORK_DECIDE_FEATURES`.

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

Registry invariants (keybinding commands, palette values, settings ids) run with the
extension points' tests.

## Commands

```sh
vp test run apps/web/src/fork/chat-conveniences/presets/presets.test.ts \
  apps/web/src/fork/chat-conveniences/presets/autoPreset.test.ts \
  apps/server/src/fork/chat-conveniences/AskService.test.ts \
  apps/server/src/fork/chat-conveniences/autoPresetRequest.test.ts \
  apps/server/src/fork/chat-conveniences/AutoPresetService.test.ts \
  apps/server/src/fork/decide/registry.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  packages/contracts/src/fork/chat-conveniences.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork/chat-conveniences apps/server/src/fork/chat-conveniences \
  packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck                  # parts D and E
vp run --filter @t3tools/contracts typecheck  # parts C, D and E
vp run --filter @t3tools/client-runtime typecheck  # part E
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

E. With Kyle's key entered in Settings > Loom > Jev (by Kyle): set up Auto with a fast
model (effort low to medium) and a strong one (effort medium to high); apply Auto; type
"rename foo to bar in utils.ts": the chip suggests the fast model with its low effort and a
percentage; press **Use**: the composer shows it. Type a design question: the strong model
with high effort is suggested; send without **Use**: the turn runs on the current
selection. Paste a draft over 8,000 characters: a suggestion still arrives. Check the
network panel: one request per pause, none while idle. Turn "suggest while typing" off:
only **Suggest** asks. The Jev section shows only "Use Jev" for Auto (no "Let agents use
this"). Switch the feature Off there: Auto is no longer offered, and on a thread where it
was on, the chip shows the reason. Switch it back on and turn "Jev off for this project":
Auto is still offered, and the chip reads "Auto: keeping current model" with the reason
"Jev is off for this project." Last, remove the key: "No Jev key on this environment."

Upstream-server case: C works; the agent tool list has no `loom_` tool; Auto is
hidden. Loom server without ext-decide's `decide` capability: Auto is hidden and no
`loom.decide.*` request is sent.

## Merge safety

`git merge-tree` preview (SEAMS.md) on the branch; `scripts/fork/loom.sh integrate
nightly --dry-run` after merging to `main`. The packet has no packet seams.

## Acceptance criteria

- Each built part meets its PRODUCT.md behavior and states on web and desktop (D on every
  client).
- No new orchestration event types; no new wire schemas on upstream methods.
- Auto never changes the selection without **Use**, never delays a send, and its every
  failure leaves the current selection in place.
- No Loom entry is written to `keybindings.json`.
