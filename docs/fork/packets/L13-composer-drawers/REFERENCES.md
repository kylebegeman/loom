# L13 references

## Old Loom

Selection items P15 and F8 (clipboard history) in [selections.md](../../selections.md).
Old Loom is `bagelvault/loom` at `a79ec506` (0.13.10).

| File                                                                                                                                                                            | Lines | Keep, adapt or drop                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/components/composer/ComposerToolDrawer.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/composer/ComposerToolDrawer.tsx)             | 202   | Adapt: one drawer above the composer with surfaces, a pending-overrides chip, collapsing while a question takes over. Drop: the "held for question" header state (ext-composer hides fork drawers during approvals).                          |
| [apps/web/src/components/composer/ComposerPerTurnOverrides.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/composer/ComposerPerTurnOverrides.tsx) | 99    | Drop: sandbox, cwd and personality fields sent as `perTurnOverrides` on `thread.turn.start` (needed upstream contract and Codex runtime changes). Keep the idea of an output schema field and its JSON validation warning.                    |
| [apps/web/src/components/composer/composerToolDrawerStore.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/composer/composerToolDrawerStore.ts)     | 96    | Keep: drawer state keyed by composer target so a typed command survives thread switches.                                                                                                                                                      |
| [apps/web/src/components/chat/ClipboardHistoryPanel.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/chat/ClipboardHistoryPanel.tsx)               | 165   | Adapt: list with preview, relative time, insert, delete, clear. Drop: pin, "copy back", the separate popover (now a drawer tab).                                                                                                              |
| [apps/web/src/clipboardHistoryStore.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/clipboardHistoryStore.ts)                                                 | 341   | Adapt: in-app copy capture on web, duplicate collapsing. Drop: IndexedDB storage, default-on setting, capture of composer pastes.                                                                                                             |
| [apps/desktop/src/clipboard/ClipboardHistory.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/desktop/src/clipboard/ClipboardHistory.ts)                               | 346   | Deferred: main-process polling every 1.5 s with macOS concealed-type detection, 500 entries, 72 h, JSONL on disk under the server state directory. The fork keeps history on the client, smaller (30 entries, 24 h) and in memory by default. |
| [.ledger/entries/1293-implement-i08-clipboard-history.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/1293-implement-i08-clipboard-history.md)             | 103   | Keep the invariants: local only; bounded by count, age and size; consecutive duplicates collapse; restored entries go through the normal composer path.                                                                                       |
| Old Loom shell command (`ChatView.tsx:1970-1997`, `codexTooling.shellCommand`, Codex `thread/shellCommand`)                                                                     | -     | Drop: Codex-only and recorded inside Codex's thread. Replaced by a provider-neutral fork RPC whose output the user attaches explicitly.                                                                                                       |

## Upstream T3 Code

- Composer handle: `ChatComposerHandle` (`apps/web/src/components/chat/ChatComposer.tsx:1216-1273`);
  context `apps/web/src/composerHandleContext.ts`; provider
  `apps/web/src/components/CommandPalette.tsx:542`.
- Stash drawer, the pattern for a drawer above the composer:
  `apps/web/src/components/chat/ComposerStashMenu.tsx`.
- Composer draft store: `ComposerThreadDraftState` (`apps/web/src/composerDraftStore.ts:378-405`),
  store state with sticky fields (482-489), `getComposerDraft` (491), setters (570-612).
- Model change rules upstream applies in the picker path: `ChatView.tsx:8838-8905`
  (`onProviderModelSelect`), `deriveLockedProvider` and
  `getStartedThreadModelChangeBlockReason` (`apps/web/src/components/ChatView.logic.ts:1086,1114`).
  Once relies on these by letting the user use upstream's pickers.
- Thread settings persisted before a send: `persistThreadSettingsForNextTurn`
  (`ChatView.tsx:5129-5200`); command atoms at `ChatView.tsx:1481-1490`.
- Turn start uses the thread's stored runtime mode, not the command's
  (`apps/server/src/orchestration/decider.ts:1357-1445`, `runtimeMode: targetThread.runtimeMode`);
  async answers start turns with `thread.runtimeMode` (around 1683).
- Thread shell fields: `packages/contracts/src/orchestration.ts:815-852`
  (`latestUserMessageAt`, `latestTurn`, `modelSelection`, `runtimeMode`);
  `OrchestrationLatestTurn` (616-625).
- Process runner: `apps/server/src/processRunner.ts` (input 20-36, output 38-47, service
  140-145, per-stream output limit 356 and 367); default shell resolution
  `apps/server/src/terminal/Manager.ts:468-472`.
- RPC client session: `packages/client-runtime/src/rpc/session.ts:45` (socket-open timeout;
  no per-request timeout found).
- Large paste threshold: `packages/client-runtime/src/textPaste.ts:1`.
- Runtime modes: `packages/contracts/src/orchestration.ts:128-135`.

## External

- Clipboard API, `readText` and permissions: MDN, "Clipboard: readText() method"
  (<https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/readText>).
- Electron session permission handling (default grants when no handler is set):
  <https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler>.
  Verify against the Electron version in `apps/desktop/package.json` during implementation.
- macOS concealed pasteboard convention (`org.nspasteboard.ConcealedType`):
  <http://nspasteboard.org/> (for the deferred desktop polling follow-up).
- JSON Schema: <https://json-schema.org/understanding-json-schema/>.
- Codex app server `turn/start` `outputSchema` (for the native follow-up): OpenAI Codex
  repository, `codex-rs/app-server-protocol` (not verified at a specific version). Claude
  structured output support in the Agent SDK is unverified; checking both is the first step
  of that follow-up.
