# L14 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`); search for the quoted code
when lines drift. The two parts are independent and share no glue.

Parts A (find in thread) and B (Mermaid diagrams) were retired on 2026-10-09 because
upstream ships both, and part E (Auto preset with Jev) the same day because Jev moved to
its own project outside Loom (README, "Retired parts"). The remaining parts keep their
letters.

## C. Model presets

### Constraints found in upstream

- No presets exist upstream (no `preset` in `packages/contracts/src/settings.ts`).
- Model selection is per thread in the composer draft store and sticky across new
  threads: `setModelSelection(threadRef, selection, { explicit: true })` plus
  `setStickyModelSelection(selection)` is what the picker path does
  (`ChatView.tsx:8838-8905`, `onProviderModelSelect`).
- That path validates first: the provider instance must exist; a thread locked to a
  driver (`deriveLockedProvider`, `ChatView.logic.ts:1086`, inputs computed at
  `ChatView.tsx:2540-2549`) cannot switch driver; a started session cannot switch
  continuation group; `resolveAppModelSelectionForInstance` (`apps/web/src/modelSelection.ts:289`)
  must resolve the model; `getStartedThreadModelChangeBlockReason`
  (`ChatView.logic.ts:1114`) may block with a toast.
- Effort and other traits are `options` on `ModelSelection` (provider option selections).

### Design

```ts
// apps/web/src/fork/chat-conveniences/presets/presets.ts
export interface LoomModelPreset {
  readonly id: string; // crypto.randomUUID()
  readonly name: string; // 1..32 characters
  readonly selection: ModelSelection; // instanceId, model, options
  readonly createdAt: string;
}
// localStorage `loom:chat-conveniences:model-presets:v1`, at most 9, user order.
```

- Decode stored data with `Schema.Array(LoomModelPresetSchema)` (using upstream's
  `ModelSelection` schema) and drop entries that fail, so upstream schema changes cannot
  crash the UI.
- `inspectPreset(preset, context)` (pure, tested) returns `{ available: true }` or
  `{ available: false, reason }` using the same helpers `onProviderModelSelect` uses, in
  the same order. Keep it in one function with a comment pointing at
  `ChatView.tsx:8838-8905` so a maintainer updates both together.
- `applyPreset(threadRef, preset)`: inspect; then
  `setModelSelection(threadRef, { ...selection, model: resolvedModel }, { explicit: true, replaceOptions: true })`
  and `setStickyModelSelection(same)`; then `composerHandle.focusAtEnd()` if available.
  `replaceOptions: true` makes the preset's effort replace the current one
  (`composerDraftStore.ts:573-586`).
- Save: from `composerHandle.getSendContext().selectedModelSelection`
  (`ChatComposer.tsx:1254-1270`), which already includes the effective options.
- UI: an ext-composer footer block `model-presets` (lucide `Bookmark` icon) with a
  `Popover` list: presets (name, provider icon via upstream's `ProviderInstanceIcon`,
  model, effort label), keyboard navigation, Enter applies, rename inline, move up and
  down buttons, delete with an Undo toast. "Save current setup" at the bottom. With 9
  presets, saving enters "Replace a preset" mode.
- The block gets `threadRef` and `environmentId` from ext-composer props; the providers
  list comes from the environment's server config (`useServerConfigs().get(environmentId)`),
  settings from `useEnvironmentSettings(environmentId)` as `ChatView` does.
- Palette source: "Apply model preset: <name>" per preset (disabled with the reason when
  unavailable; needs the active thread), "Save model preset", "Manage model presets"
  (opens the popover through `requestPresetsPopover()`).
- Keybindings: `loom.chat-conveniences.presets` opens the popover;
  `loom.chat-conveniences.preset-1` to `preset-5` apply by position. Unbound by default;
  the user doc suggests `mod+alt+1` to `mod+alt+5` (check the Keybindings settings page for
  conflicts first).

Presets are per client, not per environment: provider instance ids can differ between
environments, and unavailable presets explain themselves.

## D. Ask without stopping (agent tool)

### Constraints found in upstream

- A message-mode question is a `user-input.requested` activity whose payload has
  `responseMode: "message"` (`UserInputRequestedPayload`,
  `packages/contracts/src/providerRuntime.ts:548`; ingestion copies it at
  `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:571-586`). Only Codex
  produces them today (`apps/server/src/provider/Layers/CodexAdapter.ts:1673-1692`).
- Such a question does not pause the turn (`ProviderRuntimeIngestion.ts:1823-1826`), stays
  open past the turn (1965-1985), stays in the activity window
  (`apps/server/src/orchestration/projector.ts:62-72`), can be dismissed
  (`decider.ts:1742-1784`), and its answer becomes a `thread.turn.start` with the question
  and answer as the message text (`decider.ts:1618-1690`).
- Clients render it with upstream's question panel; `dismissible` is derived from
  `responseMode === "message"` (`packages/client-runtime/src/pendingRequests.ts:161-169`).
- A fork service can append an activity with the existing internal command
  `thread.activity.append` (`packages/contracts/src/orchestration.ts:1492-1498`) through
  `OrchestrationEngineService.dispatch`. No new event type (EXTENSION-POINTS.md,
  Orchestration, rule 1).
- MCP tools see the calling thread through `McpInvocationContext`
  (`apps/server/src/mcp/McpInvocationContext.ts:13-25`); every adapter wires the same
  `t3-code` server (EXTENSION-POINTS.md, MCP tools).

### Design

Contracts: `packages/contracts/src/fork/chat-conveniences.ts` holds only the tool schemas
(no RPC group is needed; clients use upstream's existing question UI):

```ts
export const LoomAskQuestion = Schema.Struct({
  question: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  header: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(40))),
  options: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(80))).check(Schema.isMaxLength(6)),
  ),
});
export const LoomAskInput = Schema.Struct({
  questions: Schema.Array(LoomAskQuestion).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
});
export const LoomAskResult = Schema.Struct({ requestId: Schema.String, note: Schema.String });
export class LoomAskError extends Schema.TaggedError<LoomAskError>()("LoomAskError", {
  reason: Schema.Literals([
    "thread-not-found",
    "thread-archived",
    "too-many-open",
    "dispatch-failed",
  ]),
  message: Schema.String,
}) {}
```

Server: `apps/server/src/fork/chat-conveniences/`:

- `AskService.ts`: `Context.Service` depending on `OrchestrationEngineService` and
  `ProjectionSnapshotQuery`. Keeps an in-memory `Map<ThreadId, Set<ApprovalRequestId>>`
  of the asks (requests) it posted.
  1. `getThreadShellById(threadId)`; fail `thread-not-found` or `thread-archived`
     (`archivedAt !== null`).
  2. Prune the thread's set: for each id, `getUserInputActivity({ threadId, requestId })`
     (`ProjectionSnapshotQuery.ts:81-84`); drop ids whose latest activity is
     `user-input.resolved`. If 3 remain, fail `too-many-open` with PRODUCT.md's message
     ("You already have 3 unanswered asks in this thread. ..."). The limit counts asks,
     one request each as upstream's panel shows them, not the questions inside them.
  3. `requestId = ApprovalRequestId.make("loom-ask:" + threadId + ":" + randomUUID())`.
  4. Dispatch:

     ```ts
     yield *
       engine.dispatch({
         type: "thread.activity.append",
         commandId: CommandId.make(`server:loom-ask:${randomUUID()}`),
         threadId,
         createdAt: now,
         activity: {
           id: EventId.make(`loom-ask:${requestId}`),
           tone: "info",
           kind: "user-input.requested",
           summary: "User input requested",
           turnId: shell.latestTurn?.turnId ?? null,
           createdAt: now,
           payload: {
             requestId,
             responseMode: "message",
             questions: input.questions.map((q, index) => ({
               id: String(index),
               header: q.header ?? "Question",
               question: q.question,
               options: (q.options ?? []).map((label) => ({ label, description: "" })),
               allowCustomAnswer: true,
               multiSelect: false,
             })),
           },
         },
       });
     ```

     The payload matches `UserInputRequestedPayload` exactly, because the decider decodes
     it when the answer arrives (`decodeUserInputRequestedPayload`, `decider.ts:1624`).

  5. Add the id to the set; return
     `{ requestId, note: "Posted. The user's answer will arrive later as a new user message. Continue your work." }`.
- `mcp.ts`: the toolkit, following EXTENSION-POINTS.md (Registering a toolkit):

  ```ts
  const AskTool = Tool.make("loom_chat_conveniences_ask", {
    description:
      "Ask the user up to 3 questions without waiting. Returns immediately; their answer arrives later as a new user message. Keep working meanwhile. Use your built-in question tool instead when you cannot continue without the answer.",
    parameters: LoomAskInput,
    success: LoomAskResult,
    failure: LoomAskError,
    dependencies: [McpInvocationContext.McpInvocationContext],
  })
    .annotate(Tool.Title, "Ask the user without stopping")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false);
  ```

  Handler: read `McpInvocationContext` for `threadId`, then
  `withForkRuntime(AskService.ask(threadId, input))`. No `McpCapability` (EXTENSION-POINTS.md
  forbids extending it); the thread checks happen in the service.

- Registrations: `AskService.layer` in `ForkServicesLive`, `AskService` in `ForkServices`,
  `"chat-conveniences"` in `LOOM_SERVER_FEATURES`, `ChatConveniencesToolkitRegistrationLive`
  in `ForkMcpToolkitsLive`.

Provider by provider:

| Provider    | Native question behavior today                                                                                                            | With the tool                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Native async questions (`delivery: "async"`) plus blocking `requestUserInput`.                                                            | Tool offered too (Kyle's decision, no refusal); the description steers it to native tools when it must wait. Both paths produce the same UI. |
| Claude      | `AskUserQuestion` blocks the turn until answered (`handleAskUserQuestion`, `apps/server/src/provider/Layers/ClaudeAdapter.ts:4266-4300`). | Non-blocking questions become possible.                                                                                                      |
| Cursor      | Blocking user input (`CursorAdapter.ts:128-170`).                                                                                         | Non-blocking questions become possible.                                                                                                      |
| Grok        | Blocking user input (`GrokAdapter.ts:123-200`).                                                                                           | Same.                                                                                                                                        |
| OpenCode    | Blocking questions.                                                                                                                       | Same.                                                                                                                                        |
| Antigravity | Questions with fixed choices (docs/user/providers-antigravity.md).                                                                        | Same.                                                                                                                                        |

What happens to the answer while the provider is mid-turn follows upstream's normal turn
path for a message sent during a running turn (steer or queue, per provider and the user's
follow-up setting). That is the same behavior Codex async answers get today; this packet
does not change it. Verify per adapter during the manual check and note results in the
user doc.

## Palette and keybindings summary

Commands (`FORK_KEYBINDING_COMMANDS`, all unbound): `loom.chat-conveniences.presets`,
`loom.chat-conveniences.preset-1` to `loom.chat-conveniences.preset-5`. Palette values:
`action:loom:chat-conveniences:presets`, `...:save-preset`, `...:apply-preset:<id>`. The
packet has no default key.

## Agent-facing tools

`loom_chat_conveniences_ask` (part D), offered to every provider. One tool, short
description, a non-empty parameter struct (EXTENSION-POINTS.md: empty structs make some
providers drop every tool).

## Performance

- C: localStorage reads on popover open; nothing per keystroke.
- D: one dispatch per question; the tool's prompt cost is one short description.

## Alternatives considered

- C: a strip inside upstream's model picker (old Loom's `SelectorPresetStrip`): needs a
  seam in `ModelPickerContent.tsx`, which does not know the thread; a footer block needs
  none.
- D: making Claude's `AskUserQuestion` non-blocking inside the adapter: a provider seam in
  a busy upstream file, and it would change the meaning of Claude's own tool. The MCP tool
  is additive.
- D: refusing the tool on Codex threads: rejected by Kyle; every provider gets it.
