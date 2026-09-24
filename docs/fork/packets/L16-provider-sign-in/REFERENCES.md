# L16 references

## Old Loom

Selection F5 in [selections.md](../../selections.md). Old Loom is `bagelvault/loom` at
`a79ec506` (release 0.13.10). Links are to the private repository.

| File                                                                                                                                                                                                                                                                                                                   | LOC | Keep / adapt / drop                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/server/src/provider/Layers/CodexLoginSessions.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/CodexLoginSessions.ts)                                                                                                                                                        | 426 | Adapt. The settle discipline, the watchdogs and the `account/login/*` calls carry over. Replace its wait/replay RPCs with a streamed state, and its `connectCodexAppServer` with upstream's `withCodexAppServerClient`. |
| [apps/server/src/provider/Layers/ClaudeLoginSessions.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/ClaudeLoginSessions.ts)                                                                                                                                                      | 472 | Adapt. Keep `extractClaudeAuthorizationUrl`, the 32 KB output buffer, the 20 s URL wait, the stdin code path and code hashing; add `--console` and loopback URL forwarding.                                             |
| [apps/server/src/provider/Layers/CodexLoginSessions.test.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/CodexLoginSessions.test.ts), [ClaudeLoginSessions.test.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/ClaudeLoginSessions.test.ts) |     | Adapt the settle-path cases.                                                                                                                                                                                            |
| [apps/web/src/components/settings/CodexSignInDialog.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/settings/CodexSignInDialog.tsx)                                                                                                                                                      | 497 | Adapt copy and layout (method descriptions, QR, copy-link hints). Drop the dialog shape: this packet renders inline in the provider editor.                                                                             |
| [apps/web/src/components/settings/ExternalCliSignInDialog.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/settings/ExternalCliSignInDialog.tsx)                                                                                                                                          | 392 | Adapt the Claude code-paste copy.                                                                                                                                                                                       |
| [apps/web/src/components/settings/codexSignIn.logic.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/settings/codexSignIn.logic.ts)                                                                                                                                                        | 260 | Keep `defaultCodexLoginMethod` and `findSameAccountLabel`. Drop the reducer (server state replaces it).                                                                                                                 |
| [apps/web/src/components/settings/CodexToolsSettings.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/settings/CodexToolsSettings.tsx)                                                                                                                                                    | 945 | Adapt a smaller version (MCP servers and skills). Drop ChatGPT Apps, hooks and config editing.                                                                                                                          |
| [apps/server/src/codexTooling/CodexTooling.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/codexTooling/CodexTooling.ts)                                                                                                                                                                          | 980 | Adapt the paged `mcpServerStatus/list` request and the normalizers. Drop hooks, permission profiles and `config/batchWrite` editing.                                                                                    |
| [apps/server/src/externalAgentConfig/ExternalAgentConfig.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/externalAgentConfig/ExternalAgentConfig.ts)                                                                                                                                              | 246 | Keep the detect/import flow and the item normalization.                                                                                                                                                                 |
| [apps/web/src/components/settings/ExternalConfigImportSettings.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/settings/ExternalConfigImportSettings.tsx)                                                                                                                                | 388 | Adapt as a dialog.                                                                                                                                                                                                      |
| [apps/node/src/providerProfileCreation.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/node/src/providerProfileCreation.ts), [providerProfileRemoval.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/node/src/providerProfileRemoval.ts)                                                           | 301 | Keep the safety rules (refuse existing homes, refuse symlinks and shared homes, record what Loom created). Drop the Runner, receipts and recursive deletion: this packet never deletes.                                 |

Ledger entries:

- [0003 Codex in-app account login](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0003-codex-in-app-login.md):
  sign-in writes into the instance's effective home; the shadow home symlink farm never links
  `auth.json`; the app-server owns the OAuth callback, so it stays alive for the round trip;
  no new push channel, state rides provider snapshots; desktop defaults to browser, other
  clients to device code; the deleted "Codex account" dialog must not come back.
- [0053 External config import](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0053-external-config-import.md):
  import routes through the selected instance's effective `CODEX_HOME`; one-shot, not sync;
  filter empty or malformed items; refresh the provider afterwards.
- [0054 Codex tools settings](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0054-codex-tools-settings.md):
  tooling routes through the effective home; refresh after reload or skill writes; MCP OAuth
  login was a follow-up (included here).
- [0623 Stabilize Claude provider auth](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0623-stabilize-claude-provider-auth.md):
  `claude auth status` is the reliable signed-in signal; SDK initialization alone reported
  "authenticated" while turns failed.
- [2777 Provider account lifecycle audit](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/2777-provider-account-lifecycle-audit.md):
  deletion left stale references and "unverified authentication broke the recovery path";
  never recursively delete shared or symlinked homes.

## Upstream T3 Code

- `apps/server/src/provider/ProviderDriver.ts:67-90` (`ProviderInstance`, including the
  optional `auth` controller this packet does not use).
- `apps/server/src/provider/Services/ProviderAuthService.ts`,
  `apps/server/src/provider/Layers/ProviderAuthService.ts:33-107` (session stopping and
  subscription switching patterns reused here).
- `packages/contracts/src/providerSetup.ts:13-28` (`ProviderAuthState`, too narrow for this
  packet).
- `apps/server/src/provider/Layers/CodexProvider.ts:362-410` (`withCodexAppServerClient`),
  `426-560` (account read and the "Run `codex login`" message).
- `apps/server/src/provider/Drivers/CodexHomeLayout.ts` (shadow homes: shared directories,
  private `auth.json` and `models_cache.json`).
- `apps/server/src/provider/Drivers/ClaudeHome.ts:20-38` (`CLAUDE_CONFIG_DIR`, not `HOME`),
  `58-70` (signed-out message).
- `apps/server/src/provider/antigravityCallback.ts` (loopback callback validation and
  forwarding).
- `apps/server/src/provider/AntigravityAuth.ts` and `docs/internals/providers.md` ("Setup
  must not happen as a health-check side effect"; sign-in belongs to the initiating session).
- `apps/web/src/components/settings/ProviderSetupSection.tsx` (row layout, open/copy link,
  paste box).
- `apps/web/src/components/chat/ProviderStatusBanner.tsx:34-60` (`hasProviderSetup` and its
  messages).
- `apps/server/src/serverSettings.ts:153-165` (sensitive environment values redacted for
  clients), `740-830` (write path: sensitive values go to the secret store; removed ones are
  deleted from it); `packages/contracts/src/providerInstance.ts:104-109`
  (`ProviderInstanceEnvironmentVariable` with `sensitive` and `valueRedacted`).
- `apps/server/src/provider/ProviderInstanceEnvironment.ts:5` (`mergeProviderInstanceEnvironment`,
  used for the custom-endpoint check).
- `packages/effect-codex-app-server/src/_generated/schema.gen.ts`: `V2LoginAccountParams`
  (38927), `V2LoginAccountResponse` (38996), `V2AccountLoginCompletedNotification` (37014),
  `V2ConfigValueWriteParams` (37743, considered for the credential store and not used),
  `V2McpServerOauthLoginParams` (39131),
  `V2SkillsConfigWriteParams` (39928), `V2ExternalAgentConfigDetectParams` (37972),
  `V2ExternalAgentConfigImportParams` (38042).
- `docs/user/providers-codex.md` ("Use multiple accounts") and
  `docs/user/providers-claude.md` ("Separate accounts or configurations").

## External

- OpenAI, Codex authentication and credential storage:
  https://developers.openai.com/codex/auth (`cli_auth_credentials_store` is `file`,
  `keyring` or `auto`; default `file`).
- Claude Code CLI: `claude auth login --help` (verified locally, Claude Code 2.1.280:
  `--claudeai`, `--console`, `--email`, `--sso`) and `claude auth status --json` (signed-out
  output verified with an empty `CLAUDE_CONFIG_DIR`). Signed-in fields and the macOS keychain
  entry naming per `CLAUDE_CONFIG_DIR` are unverified.
- Codex CLI 0.156.1 was installed at writing time; the app-server schema in
  `packages/effect-codex-app-server` is generated from upstream protocol ref
  `678157acaa819d5510adfe359abb5d0392cfe461` (`meta.gen.ts:2`).
