# L16 testing

Focused tests only, no repo-wide checks, no sleeps (use `TestClock` for the 10 minute and
20 second limits, and `Deferred`s for process events). No test spawns a real `codex` or
`claude`.

## Automated tests

| File                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/provider-sign-in.test.ts`                | Tags start with `loom.provider-sign-in.`; `SignInState` round-trips; submit values over 16,384 characters and API keys over 512 are rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/provider-sign-in/claudeAuthUrl.test.ts`         | Accepts a real-shaped authorize URL on each allowlisted host; rejects other hosts, ports, credentials, missing `state` or `code_challenge`; handles a URL cut by an ANSI escape and a URL split across two chunks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/provider-sign-in/callbackForward.test.ts`       | Accepts only the pending redirect's origin and path with matching `state` and a `code`; rejects `https`, other hosts, other ports, fragments, credentials, two `state` params. Forwarding hits a local test server once and never follows a redirect.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/server/src/fork/provider-sign-in/decorator.test.ts`             | `decorateSnapshot` sets `setup.canAuthenticate` only when installed, keeps `canInstall`, rewrites only upstream's exact Codex message; the decorator leaves other drivers identical (reference equality), returns disabled instances and Claude instances with `ANTHROPIC_BASE_URL` untouched with no manager, keeps `instanceId`, `driverKind`, `adapter`, `textGeneration`, and registers a manager otherwise.                                                                                                                                                                                                                                                                                          |
| `apps/server/src/fork/provider-sign-in/CodexSignIn.test.ts`           | With a fake `connect`: browser start returns `waiting` with the URL; device code returns code and verification URL; API key settles success without keeping a process; `account/login/completed` success and failure; cancel; a second start replaces the first; timeout via `TestClock`; app-server exit; instance scope close; sign-out during a flow; `onAuthChanged` runs once per success; the shadow layout is materialized before connecting.                                                                                                                                                                                                                                                      |
| `apps/server/src/fork/provider-sign-in/ClaudeSignIn.test.ts`          | With a fake `runCommand`: `--claudeai` vs `--console` args; URL found in streamed output; no URL within 20 s fails and kills the process; a code is written to stdin once; a pasted URL is forwarded, not written; exit 0 succeeds, non-zero fails with a safe message; `CLAUDE_CONFIG_DIR` set only for a custom home, `HOME` never changed, `BROWSER` set; `auth status --json` signed-out shape maps to `signedOut`.                                                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/provider-sign-in/accountFolders.test.ts`        | Suggestion skips numbers used on disk or in settings; ids stay unique; prepare refuses non-empty, outside-home, symlinked and in-use paths; creates `0700`; Claude skills symlink only when the source exists; release refuses unrecorded or in-use folders and moves, never deletes. Uses a temp dir and `SqlitePersistenceMemory`.                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/server/src/fork/provider-sign-in/codexTools.test.ts`            | `inspectCredentialStore` for a missing file, unset, `"file"`, `"keyring"`, `"auto"`, a key inside a table (ignored), comments, and `editable: false` for a quoted key, a dotted key, a multi-line value and a duplicate. `setCredentialStoreFile`: replaces only the matched line (every other byte equal, checked by comparing the rest of the text), keeps `\r\n`, keeps a missing final newline, keeps a trailing comment line, inserts at the top when absent. IO with a temp dir: the backup exists with the original bytes before the file changes; a changed sha256 refuses without writing; the file mode is kept. MCP and skill normalizers drop malformed entries; import items get stable ids. |
| `apps/server/src/fork/provider-sign-in/ProviderSignInService.test.ts` | `subscribe` switches to the new manager after a registry change and yields `supported: false` with `unsupportedReason` `disabled`, `driver` or `custom-endpoint` as appropriate; `signOut` stops sessions for the instance (fake `ProviderService` and `ProviderSessionDirectory`) before calling the manager.                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/fork/provider-sign-in/signIn.logic.test.ts`             | Default method by client location; phase labels; `findSameAccountLabel` (case-insensitive email, same driver only, ignores signed-out); `withClaudeApiKey` replaces all `ANTHROPIC_API_KEY` entries with one sensitive entry without `valueRedacted`, removes them for `null`, leaves other variables in order; `claudeApiKeyState` for none, saved (sensitive and redacted) and plain; `credentialStoreBadge` for file, unset, keyring, auto, unknown.                                                                                                                                                                                                                                                   |

Registry invariants come from the extension point tests (`ext-core` authorization test,
`ext-providers` driver and registry tests, settings and palette registry tests).

## Commands

```sh
vp test run packages/contracts/src/fork/provider-sign-in.test.ts \
  apps/server/src/fork/provider-sign-in \
  apps/server/src/fork/providers/drivers.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/web/src/fork/provider-sign-in/signIn.logic.test.ts \
  apps/web/src/fork/providers/registry.test.ts

vp lint packages/contracts/src/fork apps/server/src/fork apps/web/src/fork packages/client-runtime/src/fork \
  apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts \
  apps/web/src/components/settings/providerDriverMeta.ts \
  apps/web/src/components/chat/providerIconUtils.ts \
  apps/web/src/components/settings/ProviderSettingsPanel.tsx

vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck   # after regenerating the route tree if ext-settings was just created
vp run --filter @t3tools/mobile typecheck # contracts changed
```

## Manual check

Needs Kyle's permission for the dev server and browser (AGENTS.md). Use a worktree `.t3` and
scratch homes, then real accounts only at the steps marked "with Kyle".

1. Start `vp run dev` in the worktree. In Settings > Providers add a Codex instance with
   `CODEX_HOME` = `.t3/scratch/codex-home` and a Claude instance with `CLAUDE_CONFIG_DIR` =
   `.t3/scratch/claude-config`. Their editors show the Account section, "Not signed in".
2. Codex device code (with Kyle): start, approve on a phone, see "Signed in as ...". Sign
   out. Start again and Cancel; the row returns to idle with "Sign-in cancelled."
3. Codex browser from a second device (with Kyle): share the dev server over the tailnet
   (`vp run dev --share`), start browser sign-in on the laptop, let the last page fail, paste
   the `localhost` URL, see success.
4. Claude (with Kyle): start subscription sign-in, open the link, paste the code Claude shows,
   see the email. This is the step that proves `claude auth login` accepts a piped code; if
   it does not, switch to the pseudo-terminal fallback before going further.
5. Add account: Accounts > Add Codex account with the scratch shared home; confirm the
   suggested folder, create, sign in; start a thread on the first instance and continue it on
   the new one from the model picker.
6. Credential store: set `cli_auth_credentials_store = "keyring"` in the scratch shared
   `config.toml` (with a few other keys, comments and a table); the notice appears for the
   shadow instance; **Use file storage** shows the exact old and new line and the backup
   path; confirm; `diff` the backup against the file: exactly one line differs. Set it back
   to `file`: the Accounts row and the Account section show the green check. Edit the file
   while the confirmation is open, then confirm: Loom refuses and shows it again.
   6b. Claude API key: on the scratch Claude instance save a fake key; the row says "An API
   key is saved"; the settings JSON sent to the browser (network panel) has an empty value
   with `valueRedacted: true`; Replace and Remove work; there is no reveal or copy.
   6c. Add a Claude instance with `ANTHROPIC_BASE_URL` set: its Account section shows the
   custom-endpoint message and no sign-in, and the chat banner offers no "Open provider
   setup" for it.
7. Codex tools: list MCP servers (add a dummy stdio server to the scratch config), reload,
   toggle a skill and see the `$` menu change after refresh.
8. Import: put a `.mcp.json` and a skill in a scratch project, scan, import into the scratch
   Codex, see the imported items in Codex tools.
9. Remove account with "move aside"; the folder is under `.t3/userdata/fork/provider-sign-in/removed/`.
10. Upstream server case: point the client at an upstream T3 server; the section shows "Account
    management needs a Loom server." and palette items are hidden.
11. Chat entry: sign the scratch Codex out, open a thread on it, confirm the banner offers
    "Open provider setup" and lands in the Account section.

## Acceptance criteria

- Every flow in PRODUCT.md works on web and desktop, locally and through a remote client.
- No secret (API key, device code, OAuth code, callback URL) appears in server logs or traces
  during the manual run (`grep` the worktree's `.t3/userdata/logs`).
- A saved Claude API key never reaches a client.
- The credential-store edit changes one line and always leaves a backup.
- A server restart during a pending flow leaves no `codex app-server` or `claude` child
  process (checked by the PIDs the service logged at spawn, never by pattern).

## Merge safety

Run the merge preview from CONVENTIONS.md on the packet branch and record the result in
SEAMS.md. Conflicts may only appear on `fork: ext-*` lines. After Kyle merges to `main`, run
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`.
