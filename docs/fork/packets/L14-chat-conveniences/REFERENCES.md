# L14 references

## Old Loom

Selection item F8 in [selections.md](../../selections.md). Old Loom is `bagelvault/loom` at
`a79ec506` (0.13.10).

| File                                                                                                                                                                        | Lines | Keep, adapt or drop                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/components/chat/ChatFindBar.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/ChatFindBar.tsx)                               | 313   | Keep: fixed bar at the top right, Enter and Shift+Enter with wrap, "N of M", Escape. Drop: server search RPC with 180 ms debounce, `scrollIntoView` on DOM nodes that may not exist, loading up to 20 older pages automatically, no highlighting.                     |
| [apps/web/src/components/chat/ChatFindBar.logic.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/ChatFindBar.logic.ts)                     | 80    | Reference for navigation index math.                                                                                                                                                                                                                                  |
| Old keybinding `chat.find` = `mod+f` when `!terminalFocus` (`packages/shared/src/keybindings.ts:45`)                                                                        | -     | Adapt: handled by the fork directly with a setting, not as a default keybinding.                                                                                                                                                                                      |
| [apps/web/src/components/MermaidDiagram.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/MermaidDiagram.tsx)                                   | 209   | Keep: render only after streaming, `await import("mermaid")`, `securityLevel: "strict"`, serialized renders, 5 s timeout, source cap, theme from the app. Drop: sandboxed iframe with CSP and custom SVG sanitizer (an `<img>` is simpler and as safe), zoom and pan. |
| [apps/web/src/components/chat/SelectorPresetStrip.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/SelectorPresetStrip.tsx)               | 423   | Adapt: named presets of instance, model and options; unavailable reasons; replace mode when full; Undo on delete. Drop: strip inside the model picker, drag and drop (`@dnd-kit`), 5-slot limit (now 9).                                                              |
| [apps/web/src/components/chat/modelPresets.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/modelPresets.ts)                               | 194   | Adapt: `inspectPresetSelection` (141-186) checks account, model and options still exist.                                                                                                                                                                              |
| [apps/web/src/components/chat/ComposerAsyncQuestionPanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/ComposerAsyncQuestionPanel.tsx) | 416   | Drop: upstream's question panel already handles message-mode questions with dismiss.                                                                                                                                                                                  |
| Old Codex async question mapping (`apps/server/src/provider/Layers/CodexAdapter.ts:452-497,1426-1443`)                                                                      | -     | Upstream has the same mapping now (`CodexAdapter.ts:1673-1692`). The fork adds a provider-neutral source of the same activity.                                                                                                                                        |

## Upstream T3 Code

- Timeline: `apps/web/src/components/chat/MessagesTimeline.tsx` (LegendList import 73-77,
  row data attributes 1444-1449, minimap `scrollToIndex` 1088-1096, load-earlier header
  319-342); rows `MessagesTimeline.logic.ts:315-380`.
- `ChatView.tsx`: `routeThreadRef` (1458), pagination state and `loadEarlierTurns`
  (1544-1562), `legendListRef` (1750), `cancelTimelineLiveFollowForUserNavigation`
  (5226-5242), anchor retry loop (5515-5550), picker path `onProviderModelSelect`
  (8838-8905), locked provider inputs (2540-2549).
- Pagination helpers: `packages/client-runtime/src/state/threadState.ts:35`,
  `packages/client-runtime/src/state/threads.ts:115`.
- Markdown: `apps/web/src/components/ChatMarkdown.tsx` (`MarkdownCodeBlock` 910-1022,
  `pre` renderer 3179-3218, renderer context 2689).
- Composer draft store: `apps/web/src/composerDraftStore.ts` (`setModelSelection`
  573-586, `setStickyModelSelection` 2908).
- Model helpers: `apps/web/src/components/ChatView.logic.ts:1086,1114`,
  `apps/web/src/modelSelection.ts:289`.
- Message-mode questions: `packages/contracts/src/providerRuntime.ts:535-549`;
  `apps/server/src/orchestration/decider.ts` (respond 1618-1690, dismiss 1742-1784);
  `apps/server/src/orchestration/projector.ts:62-72`;
  `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` (571-586, 1823-1826,
  1965-1985); `packages/client-runtime/src/pendingRequests.ts:161-169`;
  user doc `docs/user/providers-codex.md` ("Answer questions while Codex works").
- Activity append command: `packages/contracts/src/orchestration.ts:1492-1498`;
  `OrchestrationThreadActivity` (596-605).
- Projection queries: `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts`
  (`getUserInputActivity` 81-84, `getThreadShellById` 217-219).
- MCP: `apps/server/src/mcp/McpInvocationContext.ts`, device toolkit as the pattern
  (`apps/server/src/mcp/toolkits/device/tools.ts`).
- Provider question handling: `ClaudeAdapter.ts:4266-4300`, `CursorAdapter.ts:128-170`,
  `GrokAdapter.ts:123-200` (all under `apps/server/src/provider/Layers/`).
- Default shortcut: `resolveShortcutCommand` (`apps/web/src/keybindings.ts:227`),
  `shortcutKeyFromEvent` (83); upstream defaults `packages/shared/src/keybindings.ts:21-70`
  (`mod+shift+f` taken, `mod+f` free).
- Effort options (part E): `primarySelectDescriptor`
  (`apps/web/src/components/chat/TraitsPicker.tsx:167`), `getProviderOptionDescriptors`
  (`packages/shared/src/model.ts:141`), effort descriptor ids
  (`apps/server/src/provider/ClaudeModelCatalog.ts:196`,
  `apps/server/src/provider/Layers/CodexProvider.ts:180`); draft `prompt` and `images`
  (`apps/web/src/composerDraftStore.ts:378-405`).

## External

- Mermaid, <https://github.com/mermaid-js/mermaid> (MIT). Configuration:
  `securityLevel`, `theme`, `flowchart.htmlLabels`, `suppressErrorRendering`
  (<https://mermaid.js.org/config/schema-docs/config.html>). Verify option names against
  the installed version.
- CSS Custom Highlight API: MDN (<https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API>);
  supported in Chromium 105+ (so Electron), Safari 17.2+, Firefox 140+ (verify current
  support tables before relying on it outside Electron).
- `@legendapp/list` ref API (`scrollToIndex`, `getState`), types in
  `node_modules/@legendapp/list/react.d.ts` (installed version).
- Model Context Protocol tool annotations (read-only, destructive, idempotent, open
  world): <https://modelcontextprotocol.io/specification>.
- Jev (part E), docs read 2026-09-24: API and Choice answers with `confidence`
  (<https://docs.typesafe.ai/api>, <https://docs.typesafe.ai/primitives/choice>),
  confidence semantics (<https://docs.typesafe.ai/confidence>), jaggedness of jev-1.13 (no
  math or counting, keep state small, adversarial state can steer;
  <https://docs.typesafe.ai/model-jaggedness/jev-1.13>), models and version pinning
  (<https://docs.typesafe.ai/models>). The client, key, timeout, redaction, budget,
  threshold and log are ext-decide's (EXTENSION-POINTS.md section 18: `LoomDecide.decide`,
  `DecideFeature` and `FORK_DECIDE_FEATURES` in `apps/server/src/fork/decide/registry.ts`,
  `DecideFallbackReason` and `JevQuestions` in `packages/contracts/src/fork/decide.ts`,
  `decideFeatureState` and `useDecideFeature` on the client).
