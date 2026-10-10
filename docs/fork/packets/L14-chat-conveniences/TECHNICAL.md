# L14 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`); search for the quoted code
when lines drift. Each part is independent; shared glue is only the settings section and
the palette source.

Parts A (find in thread) and B (Mermaid diagrams) were retired on 2026-10-09 because
upstream ships both (README, "Retired parts"). The remaining parts keep their letters.

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

## E. Auto preset (Jev)

### Constraints found

- Effort is the model's first select option descriptor (`primarySelectDescriptor` in
  `apps/web/src/components/chat/TraitsPicker.tsx:167`), whose id differs per provider
  (`effort` for Claude, `reasoningEffort` for Codex and Grok; `ClaudeModelCatalog.ts:196`,
  `CodexProvider.ts:180`). Its `options` are assumed to be listed lowest to highest (true
  of the providers read for this packet; verify per provider during implementation, and
  exclude prompt-injected values such as Claude's `ultrathink`, `promptInjectedValues` on
  the descriptor). Descriptors come from `getProviderOptionDescriptors`
  (`packages/shared/src/model.ts:141`).
- ext-decide (EXTENSION-POINTS.md section 18, "Decisions with Jev") owns the Jev client
  (`apps/server/src/fork/decide/JevClient.ts`), the key (in `ServerSecretStore`), the 1 s
  timeout, feature modes, the per-project switch, redaction and budget (`decide` always runs
  `redactState` and `fitBudget` on what it sends), the threshold, and the `fork_decide_decisions`
  log. This part only registers a feature, builds a request and maps the result. Create
  ext-decide if missing, exactly as section 18 specifies (its existence check is there).
- Jev jaggedness (https://docs.typesafe.ai/model-jaggedness/jev-1.13): no numbers, ranges
  or counting in questions; small, relevant state; one judgment per question.

### Data (client, `apps/web/src/fork/chat-conveniences/presets/autoPreset.ts`)

```ts
export interface LoomAutoChoice {
  readonly id: string; // crypto.randomUUID()
  readonly label: string; // 1..60, unique case-insensitively; default: model display name
  readonly description: string; // 1..300, user text
  readonly selection: ModelSelection; // instanceId, model, other options as saved
  /** null when the model has no effort descriptor. Option ids of that descriptor. */
  readonly effort: {
    readonly descriptorId: string;
    readonly lowest: string;
    readonly highest: string;
  } | null;
}
export interface LoomAutoPreset {
  readonly choices: ReadonlyArray<LoomAutoChoice>; // 2..6
  readonly updatedAt: string;
}
// localStorage `loom:chat-conveniences:auto-preset:v1`; one Auto preset per client.
// Auto on/off per thread: in-memory store keyed by scopedThreadKey (not persisted).
```

Decoding follows part C: invalid choices are dropped; fewer than two valid choices means
"not set up".

Pure helpers (tested):

- `resolveAutoSelection(choice, level, descriptors)`: the options of `descriptors`' entry
  with id `effort.descriptorId`, cut to the `lowest`..`highest` span in descriptor order;
  `light` takes the first, `deep` the last, `standard` the middle (lower middle for an even
  count). Returns `choice.selection` with that option set (replacing only the effort
  option). With `effort: null`, or a descriptor or bound that no longer exists, it returns
  `choice.selection` unchanged and marks the effort "as saved".
- `shouldRequestSuggestion({ autoOn, suggestWhileTyping, text, lastRequestedText, idleMs, sinceLastRequestMs, inFlight })`:
  true when Auto is on, typing suggestions are on, the trimmed text has at least 12
  characters and differs from the last requested text, the user has been idle 800 ms,
  at least 3 s passed since the last request for this thread, and nothing is in flight.
- `autoChipState(...)`: maps the RPC result and the current selection to the chip's copy
  (PRODUCT.md), including "current model fits" when the resolved selection equals the
  current one, "can't use" when part C's `inspectPreset` rejects the resolved selection, and
  the "leaned to" wording when a `low-confidence` fallback carries `leaning` (no **Use**).

### Contracts (`packages/contracts/src/fork/chat-conveniences.ts`)

Part D's file gains an RPC group (part D itself needs none):

```ts
export const CHAT_CONVENIENCES_WS_METHODS = {
  autoSuggest: "loom.chat-conveniences.autoSuggest",
} as const;

export const LoomAutoCandidate = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(60)),
  description: TrimmedNonEmptyString.check(Schema.isMaxLength(300)),
});
export const LoomAutoEffortLevel = Schema.Literals(["light", "standard", "deep"]);
export const LoomAutoSuggestInput = Schema.Struct({
  threadId: Schema.optionalKey(ThreadId), // absent for a draft thread
  projectId: Schema.optionalKey(ProjectId),
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(8_000)),
  imageCount: NonNegativeInt,
  candidates: Schema.Array(LoomAutoCandidate).check(Schema.isMinLength(2), Schema.isMaxLength(6)),
  origin: Schema.Literals(["user", "auto"]),
});
export const LoomAutoSuggestResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("suggested"),
    candidateId: Schema.String,
    effortLevel: LoomAutoEffortLevel,
    /** The lower of the two answers' confidences, 0..1. */
    confidence: Schema.Number,
    decisionId: Schema.String,
    latencyMs: NonNegativeInt,
  }),
  Schema.Struct({
    status: Schema.Literal("fallback"),
    reason: DecideFallbackReason, // from ./decide.ts (ext-decide)
    decisionId: Schema.optionalKey(Schema.String),
    /** low-confidence only: what Jev leaned to, shown as "not sure enough", never applied. */
    leaning: Schema.optionalKey(
      Schema.Struct({ candidateId: Schema.String, effortLevel: LoomAutoEffortLevel }),
    ),
  }),
]);
export class LoomChatConveniencesError extends Schema.TaggedError<LoomChatConveniencesError>()(
  "LoomChatConveniencesError",
  { reason: Schema.Literals(["duplicate-candidates", "unknown-thread"]), message: Schema.String },
) {}
// autoSuggest: LoomAutoSuggestInput -> LoomAutoSuggestResult,
// error Union([LoomChatConveniencesError, EnvironmentAuthorizationError]).
export const ChatConveniencesRpcGroup = RpcGroup.make(/* autoSuggest */);
```

Registration (ext-core): `ChatConveniencesRpcGroup` in `fork/rpc.ts`, scope
`orchestration:operate` in `FORK_RPC_REQUIRED_SCOPES` (it spends the environment's Jev
quota), handlers in `ForkRpcGroup.of`. The model and effort details never reach the
server; it only sees labels and descriptions.

### Server (`apps/server/src/fork/chat-conveniences/`)

- `autoPresetRequest.ts` (pure, tested): `buildAutoPresetRequest(input, facts)` returns
  ext-decide's `DecideRequest` (`apps/server/src/fork/decide/LoomDecide.ts`) without a
  `threshold`, so the feature's configured threshold (L29 Tuning, else `defaultThreshold`)
  applies. `questions` is a `JevQuestions` value (`@t3tools/contracts/fork`):

  ```ts
  state = {
    message, // the typed text, at most 8,000 characters; decide redacts and fits it
    message_length, // "one line" (< 120 chars) | "short" (< 600) | "medium" (< 3,000) | "long"
    images_attached, // "yes" | "no"
    thread_stage, // "new thread" | "follow-up in an existing thread"
  };
  questions = {
    model: {
      type: "choice",
      instructions:
        "Which option should handle the user's `message`? Pick the option whose description fits `message` best.",
      criteria: Object.fromEntries(candidates.map((c) => [c.label, c.description])),
    },
    effort: {
      type: "choice",
      instructions: "How much reasoning does the user's `message` need?",
      criteria: {
        light:
          "A quick question, a lookup, a rename or a small edit. The answer is short or obvious.",
        standard:
          "A normal coding task: one focused change, a bug with a known cause, or an explanation.",
        deep: "A hard task: design decisions, a change across many files, an unclear bug, or a careful review.",
      },
    },
  };
  ```

  Buckets are computed in code (Jev does not count). Labels are the Choice keys, so they
  must be unique (case-insensitive); duplicates fail with `duplicate-candidates`. The
  answer maps back from label to candidate id. The builder does not call `redactState` or
  `fitBudget`: `decide` always runs both on the state it sends and logs exactly that. The
  8,000-character message cap keeps the state far under the 32k-token budget, so trimming
  should not happen in practice.

- `AutoPresetService.ts`: `Context.Service` depending on `LoomDecide`
  (`apps/server/src/fork/decide/LoomDecide.ts`) and `ProjectionSnapshotQuery`.
  1. With `threadId`: `getThreadShellById`; missing fails `unknown-thread`; `projectId`
     and `thread_stage` (`latestTurn !== null` means follow-up) come from the shell.
     Without it: `projectId` from the input, `thread_stage` "new thread".
  2. `buildAutoPresetRequest`.
  3. `yield* LoomDecide`, then
     `decide("chat-conveniences.auto-preset", request, { origin: input.origin, threadId, projectId })`
     (a `DecideCallContext`; default timeout 1,000 ms). `decide` never fails, so the
     service has no Jev error channel.
  4. `answered`: the threshold was already applied by `decide` to both Choice answers, so
     the result is confident by definition; do not re-check confidence. Take
     `answers.model.choice` and `answers.effort.choice`, map the label to its candidate, and
     report `confidence = Math.min(model.confidence, effort.confidence)` for display. A
     `choice` that is not a known label gives `fallback: error` (with the `decisionId`).
     Otherwise `suggested`.
  5. `fallback`: pass `reason` and `decisionId` through. For `low-confidence`, `decide`
     attaches `answers`; map them to `leaning` (candidate and level) when both labels are
     known, so the chip can say what Jev leaned to. The selection is never changed from a
     fallback. `agent-not-allowed` cannot occur (origin is never `agent`).

  It never retries and never waits beyond `decide`'s timeout; the client keeps the current
  selection meanwhile.

- Feature: `apps/server/src/fork/chat-conveniences/decide.ts` exports one `DecideFeature`
  (`apps/server/src/fork/decide/registry.ts`), appended to `FORK_DECIDE_FEATURES` there:

  ```ts
  export const chatConveniencesAutoPresetFeature: DecideFeature = {
    id: "chat-conveniences.auto-preset",
    packet: "L14",
    label: "Auto model preset",
    description:
      "Suggests a model and effort for each message from your Auto preset's choices; without Jev the current selection stays.",
    defaultMode: "manual",
    defaultThreshold: 0.5,
    agentTool: false,
  };
  ```

  `agentTool: false` because no MCP tool reaches it: the Jev section shows only its "Use
  Jev" switch, and `updateFeature` rejects `manual-agents` for it. The threshold lives in
  `defaultThreshold` (not in each call) so L29's Tuning can override it. Model: ext-decide's
  default (`JEV_DEFAULT_MODEL`, `jev-latest`) until the threshold is tuned (with L29's test
  sets if present); then pin the versioned id through L29, as the Jev docs advise
  (https://docs.typesafe.ai/models).

- Registrations: `AutoPresetService.layer` in `ForkServicesLive`, the service in
  `ForkServices`, `"chat-conveniences"` in `LOOM_SERVER_FEATURES` (shared with part D;
  whichever part lands first adds it).

### Web (`apps/web/src/fork/chat-conveniences/presets/`)

- `AutoPresetEditor.tsx`: dialog opened from the presets list ("Set up Auto" or "Edit
  Auto"). "Add current model" reads `composerHandle.getSendContext().selectedModelSelection`
  (as part C's save does) and the model's descriptors to offer the effort selects. Save
  validates (2 to 6 choices, unique labels, non-empty descriptions).
- `PresetsBlock.tsx` (part C's footer block) reads
  `useDecideFeature(environmentId, "chat-conveniences.auto-preset")`
  (`apps/web/src/fork/decide/state.ts`, over the pure `decideFeatureState` in
  `packages/client-runtime/src/fork/decide.ts`). It shows "Set up Auto" / "Auto" first in
  its list only when that state is `usable` (the `decide` capability, "Use Jev" on, a key,
  the feature not off) and the environment also has `chat-conveniences`
  (`supportsLoomFeature`); it shows nothing Auto-related when `supported` is false. It
  renders `AutoChip` next to its icon while Auto is on for the thread. If Auto is on and
  the feature stops being usable (key removed, switched off), the chip stays so the user
  can turn Auto off, and shows the matching fallback copy. No new composer block.
- `AutoChip.tsx` and `useAutoSuggestion.ts`: subscribe to the thread draft's `prompt` and
  `images` in `useComposerDraftStore` (`ComposerThreadDraftState`,
  `apps/web/src/composerDraftStore.ts:378-405`) only while Auto is on; decide with
  `shouldRequestSuggestion`; call `autoSuggest` through an environment RPC command atom
  (`packages/client-runtime/src/fork/chat-conveniences.ts`, bound in web `state.ts`);
  ignore a result whose request text no longer matches the draft. A draft longer than
  8,000 characters (the contract's `message` cap) is sent as its first 8,000 characters,
  and the "same text" and stale-result checks compare that cut text, so a long draft still
  gets a suggestion instead of failing to decode. **Use** runs
  `resolveAutoSelection`, then part C's `inspectPreset` checks and `applyPreset` path with
  the resolved selection, so locks and availability rules are identical to presets.
- Idle timer: one `setTimeout` per keystroke pause (replaced on each change), cleared on
  unmount and when Auto is off. No interval and no animation.

### Settings, palette, keybindings

- Chat conveniences section: "Auto: suggest while typing" (on), key
  `suggestWhileTyping` in `loom:chat-conveniences:settings:v1`.
- The Jev key, this feature's "Use Jev" switch (no agents switch, `agentTool: false`) and
  "Jev off for this project" are in ext-decide's "Jev" section
  (`apps/web/src/fork/decide/JevSettingsSection.tsx`); this packet adds nothing there.
- Command `loom.chat-conveniences.auto-accept` (unbound): applies the current suggestion
  when there is one. Palette items (active thread only, Auto on): "Use Auto suggestion"
  (`action:loom:chat-conveniences:auto-accept`), "Turn off Auto"
  (`action:loom:chat-conveniences:auto-off`).

### Privacy

The typed message goes to TypeSafe's API from the environment's server while Auto is on,
after `decide` runs `redactState` on it (`.env` files, private keys, tokens, password
assignments, and the user's excluded paths and literals from the Jev section).
ext-decide's `fork_decide_decisions` log keeps the sent state for 30 days unless rated or kept in
a test set. The editor says this before the first save (PRODUCT.md, Copy).

## Settings (ext-settings)

Section id `chat-conveniences`, title "Chat conveniences", client preferences in
localStorage (`loom:chat-conveniences:settings:v1`):

- "Auto: suggest while typing" (on; part E).

## Palette and keybindings summary

Commands (`FORK_KEYBINDING_COMMANDS`, all unbound): `loom.chat-conveniences.presets`,
`loom.chat-conveniences.preset-1` to `loom.chat-conveniences.preset-5`,
`loom.chat-conveniences.auto-accept`. Palette values: `action:loom:chat-conveniences:presets`,
`...:save-preset`, `...:apply-preset:<id>`, `...:auto-accept`, `...:auto-off`. The packet
has no default key.

## Agent-facing tools

`loom_chat_conveniences_ask` (part D), offered to every provider. One tool, short
description, a non-empty parameter struct (EXTENSION-POINTS.md: empty structs make some
providers drop every tool). Part E has no agent tool.

## Performance

- C: localStorage reads on popover open; nothing per keystroke.
- D: one dispatch per question; the tool's prompt cost is one short description.
- E: nothing runs unless Auto is on for the thread. Then at most one request per 3 s per
  thread, only after an 800 ms pause, each bounded by ext-decide's 1 s timeout; one small
  struct per request and response over the WebSocket.

## Alternatives considered

- C: a strip inside upstream's model picker (old Loom's `SelectorPresetStrip`): needs a
  seam in `ModelPickerContent.tsx`, which does not know the thread; a footer block needs
  none.
- D: making Claude's `AskUserQuestion` non-blocking inside the adapter: a provider seam in
  a busy upstream file, and it would change the meaning of Claude's own tool. The MCP tool
  is additive.
- D: refusing the tool on Codex threads: rejected by Kyle; every provider gets it.
- E: switching automatically: rejected by Kyle; Auto only suggests.
- E: one Choice over every model and effort pair: more options, and ranges would be
  encoded as options. Two questions (model, then a named level) keep each judgment single
  and keep the range logic in code.
- E: suggesting at send time: would delay sends or change the model after the user
  decided. Suggesting while typing keeps sends instant.
