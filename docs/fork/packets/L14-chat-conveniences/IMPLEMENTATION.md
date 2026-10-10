# L14 implementation plan

Three parts (C, D and E; A and B were retired on 2026-10-09). Build them in any order,
except E after C; each ends with its own commit and leaves the tree compiling. The shared settings section and palette source are created by
the first part that needs them and extended by the others.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Work in a worktree; seed its `.t3` with a `VACUUM INTO` copy of real data. Ask
Kyle before dev servers and browsers. Part E never calls the real Jev API in tests; the manual check uses Kyle's key, entered by Kyle in the running app.

## File layout

```
apps/web/src/fork/chat-conveniences/settings.ts            # client preferences store
apps/web/src/fork/chat-conveniences/SettingsSection.tsx     # ext-settings section
apps/web/src/fork/chat-conveniences/palette.tsx             # ext-palette source
apps/web/src/fork/chat-conveniences/commands.ts             # onForkCommand handlers
apps/web/src/fork/chat-conveniences/presets/presets.ts
apps/web/src/fork/chat-conveniences/presets/presets.test.ts
apps/web/src/fork/chat-conveniences/presets/PresetsBlock.tsx
apps/web/src/fork/chat-conveniences/presets/autoPreset.ts
apps/web/src/fork/chat-conveniences/presets/autoPreset.test.ts
apps/web/src/fork/chat-conveniences/presets/AutoPresetEditor.tsx
apps/web/src/fork/chat-conveniences/presets/AutoChip.tsx
apps/web/src/fork/chat-conveniences/presets/useAutoSuggestion.ts
apps/web/src/fork/chat-conveniences/state.ts
packages/contracts/src/fork/chat-conveniences.ts
packages/contracts/src/fork/chat-conveniences.test.ts
packages/client-runtime/src/fork/chat-conveniences.ts
apps/server/src/fork/chat-conveniences/AskService.ts
apps/server/src/fork/chat-conveniences/AskService.test.ts
apps/server/src/fork/chat-conveniences/mcp.ts
apps/server/src/fork/chat-conveniences/autoPresetRequest.ts
apps/server/src/fork/chat-conveniences/autoPresetRequest.test.ts
apps/server/src/fork/chat-conveniences/AutoPresetService.ts
apps/server/src/fork/chat-conveniences/AutoPresetService.test.ts
apps/server/src/fork/chat-conveniences/decide.ts
apps/server/src/fork/chat-conveniences/rpc.ts
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

## Part E: Auto preset (Jev), after part C

1. Extension points: `ext-core` and `ext-decide` existence checks; create missing ones
   exactly as EXTENSION-POINTS.md specifies (section 18 for ext-decide), one commit each.
2. Contracts: `CHAT_CONVENIENCES_WS_METHODS`, the Auto schemas, `LoomChatConveniencesError`
   and `ChatConveniencesRpcGroup` in `chat-conveniences.ts`; merge into `fork/rpc.ts`.
   `chat-conveniences.test.ts`: tag prefix, candidate count and length limits.
3. Server, test first: `autoPresetRequest.ts` + test (buckets, questions, label keys,
   duplicate labels; no threshold in the request; redaction and budget are `decide`'s job).
   Then `AutoPresetService.ts` + test with a scripted `LoomDecide` test layer (TESTING.md;
   section 18 says consumers never call TypeSafe in tests). `decide.ts` exports the
   `DecideFeature` (`packet: "L14"`, `agentTool: false`, `defaultThreshold: 0.5`); append it
   to `FORK_DECIDE_FEATURES` in `apps/server/src/fork/decide/registry.ts` and add the row
   to L29's feature catalog if L29's documents are present.
   `rpc.ts` handlers; scope `orchestration:operate`; service in `ForkServicesLive` and
   `ForkServices`; `"chat-conveniences"` in `LOOM_SERVER_FEATURES` if part D has not added
   it.
4. Client runtime: `packages/client-runtime/src/fork/chat-conveniences.ts` with the
   `autoSuggest` command atom; web `state.ts` binds it.
5. Web: `autoPreset.ts` + `autoPreset.test.ts` first (storage, `resolveAutoSelection`,
   `shouldRequestSuggestion`, `autoChipState`), then `AutoPresetEditor.tsx`,
   `useAutoSuggestion.ts`, `AutoChip.tsx`, the Auto entry in `PresetsBlock.tsx` (gated on
   `useDecideFeature(environmentId, "chat-conveniences.auto-preset").usable` from
   `apps/web/src/fork/decide/state.ts` and on `chat-conveniences`), the "Auto: suggest while
   typing" switch, the
   `loom.chat-conveniences.auto-accept` command and the two palette items.
6. Checks (TESTING.md). Commit `feat(fork-chat-conveniences): suggest a model and effort per message with Jev`.

## After all parts

- `docs/fork/user/chat-conveniences.md`: presets (suggested bindings), the Auto preset (what it sends to Jev, that it only suggests, where
  its mode and the per-project switch live), how agents ask without stopping and how to
  answer or dismiss.
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
- Part E: never apply a suggestion without **Use**. Never await `autoSuggest` in the send
  path. Drop results whose request text no longer matches the draft.
- Part E: keep numbers out of the questions; buckets are computed in code. Do not add the
  thread history to the state (Jev accuracy drops with irrelevant state).
- Part E: never compare confidence with a threshold in this packet and never pass
  `threshold` in the call; `decide` applies the feature's configured threshold (so L29's
  Tuning works) and returns `low-confidence` with `answers` attached.
- Part E: descriptors can change between saving the Auto preset and using it (a provider
  update renames an effort level); `resolveAutoSelection` falls back to the saved
  selection instead of guessing.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done) for each
part built, plus:

- C: an unavailable preset explains itself and cannot be applied.
- D: a Claude session can post a question, keep working, and receive the answer as a
  message; dismiss works; the upstream mobile app shows and answers it. A Codex session
  sees the tool too.
- E: with a key, Auto suggests a choice and effort inside that choice's range and shows its
  confidence; **Use** applies it; sending without **Use** keeps the current selection;
  every fallback reason shows its copy; a low-confidence fallback shows what Jev leaned to
  without applying it; when `useDecideFeature(...).usable` is false, Auto is not offered.
