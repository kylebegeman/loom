# L01 references

Treat external repositories as references, not code to copy.

## Old Loom

Selection items P1 and F1 in [selections.md](../../selections.md). Old Loom is
`bagelvault/loom` at `a79ec506` (release 0.13.10; private, Kyle can read it).

| File                                                                                                                                                                                                                                                          | Lines | Keep, adapt or drop                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [packages/contracts/src/snippet.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/snippet.ts)                                                                                                                                       | 202   | Adapt: field limits (title 120, body 24,000, alias 64) informed the new, smaller limits. Drop `scopes` (`composer`, `thread-start`, `review-start`, `command`, `manual`), `enabled` and `sortOrder`.                                 |
| [packages/shared/src/snippets.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/shared/src/snippets.ts)                                                                                                                                           | 364   | Adapt: `rankSnippets` (83-162, field weights and match classes), alias normalization (164-177), `{{ }}` regexes (34-48, used only by the import converter), `{{cursor}}` handling. Drop composition (315-347).                       |
| [apps/server/src/snippets/Layers/Snippets.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/snippets/Layers/Snippets.ts)                                                                                                                   | 568   | Adapt: revision append and restore-as-new-head (370-442, 537-555). Drop: revision on unchanged save, alias check outside the transaction (392-404), delete that removes history (444-461), double `list()` per expansion (476, 496). |
| [apps/server/src/snippets/Services/Snippets.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/snippets/Services/Snippets.ts)                                                                                                               | 34    | Reference for the operation list.                                                                                                                                                                                                    |
| [apps/server/src/persistence/Migrations/035_Snippets.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/persistence/Migrations/035_Snippets.ts)                                                                                             | 41    | Adapt: alias table with a composite key. Drop the duplicated `snippet_json` column.                                                                                                                                                  |
| [apps/server/src/persistence/Migrations/226_SnippetRevisions.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/persistence/Migrations/226_SnippetRevisions.ts)                                                                             | 22    | Keep the shape: `(snippet_id, revision)` unique, snapshot JSON.                                                                                                                                                                      |
| [apps/web/src/snippetArtifacts.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/snippetArtifacts.ts)                                                                                                                                         | 159   | Keep the `.loom-snippet.md` format (97-159): fenced `loom-snippet` or `json` JSON blocks. The reader must accept old files unchanged.                                                                                                |
| [apps/web/src/components/SnippetsSidebar.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/SnippetsSidebar.tsx)                                                                                                                   | 1247  | Adapt the view split (library, detail, history, editor). Drop the separate Pinned and Recent tabs (filters instead) and the second editor in settings.                                                                               |
| [apps/web/src/components/snippets/useSnippetExpansionFlow.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/snippets/useSnippetExpansionFlow.tsx)                                                                                 | 197   | Adapt: fill-in step. Drop: the modal (now a composer drawer), the empty-value block, the server round trip.                                                                                                                          |
| [apps/web/src/snippetUsageStore.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/snippetUsageStore.ts)                                                                                                                                       | 62    | Drop: usage in localStorage; moved to the server.                                                                                                                                                                                    |
| [apps/web/src/terminal/terminalCommandCompose.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/terminal/terminalCommandCompose.ts)                                                                                                           | -     | Adapt: bracketed paste and never adding Enter. Drop: the destructive-command confirmation and the third placeholder syntax. Old snippets never reached the terminal (`ThreadTerminalDrawer.tsx:1717-1721` passed none).              |
| [docs/project/loom-platform/initiatives/panel-evolution/panels/snippets/DECISIONS.md](https://github.com/bagelvault/loom/blob/a79ec506/docs/project/loom-platform/initiatives/panel-evolution/panels/snippets/DECISIONS.md)                                   | 29    | Keep: snippets are deterministic text and never run anything (SNIP-D003); restore creates a new head (D009); pins and usage not device-local (D012). Drop: server-side expansion authority (D007) and MCP parity (D013).             |
| [.ledger/entries/0051-snippets-sidebar.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0051-snippets-sidebar.md)                                                                                                                         | -     | History of the sidebar.                                                                                                                                                                                                              |
| [.ledger/entries/2371-api-studio-round-seven-variable-tokens-name-with-dual-read-and-the-token-cue.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/2371-api-studio-round-seven-variable-tokens-name-with-dual-read-and-the-token-cue.md) | -     | Source of the `[[name]]` syntax and its leading-letter rule (API Studio's grammar, `packages/shared/src/apiStudio/variableTokens.ts:39-45`), and of reading legacy `{{ }}` then rewriting on import.                                 |
| [.ledger/entries/2532-register-snippets-studio-and-canonical-library.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/2532-register-snippets-studio-and-canonical-library.md)                                                             | -     | The unbuilt "Snippets Studio" plan (SNIP-01 to 08). Deliberately not rebuilt.                                                                                                                                                        |

## Upstream T3 Code

- Prompt stash: `apps/web/src/components/chat/ComposerStashMenu.tsx` and
  `apps/web/src/promptStashStore.ts` (untouched by this packet).
- Prompt recall: `apps/web/src/components/chat/composerPromptHistory.ts` (ArrowUp; the `;`
  menu only activates on a `;` token, so recall is unaffected).
- Trigger detection: `apps/web/src/composer-logic.ts:209-256` (`detectComposerTrigger`),
  token rule `tokenStartForCursor`.
- Composer key handling: `apps/web/src/components/chat/ChatComposer.tsx:3921-3964`
  (`onComposerCommandKey`); replacement `applyPromptReplacement` (3410); snapshot
  `resolveActiveComposerTrigger` (3501).
- Composer handle: `ChatComposerHandle` (`ChatComposer.tsx:1216-1272`: `insertTextAtEnd`,
  `readSnapshot`, `focusAt`); context `apps/web/src/composerHandleContext.ts`, provided in
  `apps/web/src/components/CommandPalette.tsx:542`.
- Subscription with a full snapshot: `apps/server/src/device/DeviceService.ts:1026-1035`;
  client atoms `packages/client-runtime/src/state/device.ts:11-50`; web read
  `apps/web/src/state/device.ts:32-40`.
- Terminal write: `WS_METHODS.terminalWrite` (`packages/contracts/src/rpc.ts:329`),
  `TerminalWriteInput` (`packages/contracts/src/terminal.ts:63-66`); terminal UI state
  `apps/web/src/terminalUiStateStore.ts`.
- Command UI primitives: `apps/web/src/components/ui/command.tsx`.
- Repository pattern: `apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts:16-90`.

## External

- PromptBranch, <https://github.com/PromptBranch/promptbranch> (MIT, reviewed at
  `35ce555`): `packages/core/src/variables.ts` (single-pass rendering, values never
  re-parsed, unknown tokens left as is, limits of 100 variables); quick palette
  (`apps/desktop/src/main/quick-palette.ts`, `QuickPalette.tsx`: empty query shows starred
  then recent, variable fields with a live preview). Ideas only; no code copied.
- Bracketed paste mode: xterm control sequences `CSI 200 ~` and `CSI 201 ~`
  (<https://invisible-island.net/xterm/ctlseqs/ctlseqs.html>, "Bracketed Paste Mode").
- Unicode property escapes in JavaScript regular expressions (`\p{L}`, `\p{N}`, `u` flag):
  MDN, "Unicode character class escape".
