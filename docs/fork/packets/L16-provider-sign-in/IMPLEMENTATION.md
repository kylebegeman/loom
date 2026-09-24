# L16 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Commit after each numbered
step with `feat(fork-provider-sign-in): ...` (extension points use their own
`feat(fork): add the ... extension point` commits).

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and every
  file in this folder.
- Never sign in, out, or run `codex app-server` against Kyle's real homes (`~/.codex*`,
  `~/.claude*`) while developing. Use scratch homes under the worktree's `.t3/` (for example
  `.t3/scratch/codex-home`, `.t3/scratch/codex-shadow`, `.t3/scratch/claude-config`) and point
  test provider instances at them. Real sign-in happens only in the manual check, with Kyle.
- Seed the worktree's `.t3` with `VACUUM INTO` (AGENTS.md, "Test data") if you want real
  threads in the UI. Do not copy `secrets` unless a test needs them.

## File layout

```
packages/contracts/src/fork/provider-sign-in.ts
packages/contracts/src/fork/provider-sign-in.test.ts
packages/client-runtime/src/fork/provider-sign-in.ts
apps/server/src/fork/provider-sign-in/
  decorator.ts            decorateSnapshot + providerSignInDecorator
  decorator.test.ts
  managers.ts             SignInManager, WeakMap registry
  CodexSignIn.ts          CodexSignIn.test.ts
  ClaudeSignIn.ts         ClaudeSignIn.test.ts
  claudeAuthUrl.ts        claudeAuthUrl.test.ts
  callbackForward.ts      callbackForward.test.ts
  accountFolders.ts       accountFolders.test.ts
  codexTools.ts           codexTools.test.ts (normalizers, credential-store parsing)
  ProviderSignInService.ts
  migrations.ts
  rpc.ts
apps/web/src/fork/provider-sign-in/
  providerSetup.tsx       the ForkProviderSetupSection
  AccountSection.tsx
  AddAccountDialog.tsx    RemoveAccountDialog.tsx
  CodexToolsDialog.tsx    ImportDialog.tsx
  settings.tsx            "Accounts" section
  palette.ts
  state.ts                atoms bound to the web connection runtime
  signIn.logic.ts         signIn.logic.test.ts
docs/fork/user/provider-sign-in.md
```

## Steps

1. **Extension points.** Run the existence checks for `ext-core`, `ext-providers`
   ([EXTENSION-POINTS.md, section 15](../EXTENSION-POINTS.md#15-provider-drivers-ext-providers)), `ext-settings` and `ext-palette`. Create each
   missing one exactly as specified, one commit each, with its FORK.md rows. For
   `ext-providers`, also add its tests (`drivers.test.ts`, `registry.test.ts`). Typecheck `t3`
   and `@t3tools/web`.

2. **Contracts.** Write `provider-sign-in.ts` as in TECHNICAL.md: schemas, the error, the 16
   `Rpc.make` values and `ProviderSignInRpcGroup`. Register it in `fork/rpc.ts` and
   `fork/index.ts`; add the subscribe tag to `ForkSubscriptionRpcTag`. Test: every tag starts
   with `loom.provider-sign-in.`; `SignInState` round-trips; `SignInSubmitInput` rejects values
   over 16,384 characters.

3. **Pure server helpers, test first.**
   - `claudeAuthUrl.ts`: port `extractClaudeAuthorizationUrl` from old Loom (allowlisted
     hosts, `/oauth/authorize`, `state` and `code_challenge` required, no port or
     credentials, tolerant of URLs ending in an ANSI escape).
   - `callbackForward.ts`: `validateLoopbackCallback(pending, pasted)` generalizing
     `validateAntigravityCallbackUrl` (`apps/server/src/provider/antigravityCallback.ts:13`)
     to `localhost` and `127.0.0.1`; `forwardLoopbackCallback(url)` with `node:http`, 10 s
     limit, no redirects. Copy the code; do not import the Antigravity module's internals.
   - `decorator.ts`: `decorateSnapshot` (setup flag, Codex message rewrite).
   - `codexTools.ts`: `parseCredentialStore(configTomlText)` and the MCP/skill normalizers.
   - `accountFolders.ts`: `suggestAccountFolder(settings, existingPaths)` as a pure function
     over settings plus a set of existing paths.

4. **Managers.** `managers.ts`, then `CodexSignIn.ts` and `ClaudeSignIn.ts`.
   - Make the process boundary injectable: `CodexSignIn` takes a `connect` function that
     defaults to `withCodexAppServerClient`; `ClaudeSignIn` takes a `runCommand` function that
     defaults to the real spawner. Tests use fakes (old Loom's tests did the same).
   - Implement the shared settle discipline described in TECHNICAL.md. Write the settle-path
     tests before the code: completed, failed notification, cancel, replace by a new start,
     timeout (with `TestClock`), process exit, instance scope closed, sign-out during a flow.

5. **Decorator and registration.** `providerSignInDecorator` wraps `create` for `codex` and
   `claudeAgent`, builds the manager in the instance scope, decorates the snapshot shape and
   `snapshotForCwd`, registers the manager. Append it to `FORK_PROVIDER_DRIVER_DECORATORS`.
   Test with a fake driver whose `create` returns a minimal instance: the decorated instance
   has the same `instanceId`, `driverKind`, `adapter` and `textGeneration`; the snapshot has
   `setup.canAuthenticate`; a disabled instance is returned untouched.

6. **Storage and service.** `migrations.ts` (set `provider-sign-in`, table
   `fork_provider_sign_in_account_folders`), `ProviderSignInService.ts`, `accountFolders.ts`
   IO, `codexTools.ts` IO. Add the service to `ForkServicesLive` and `ForkServices`, the
   migration set to `FORK_MIGRATION_SETS`, `"provider-sign-in"` to `LOOM_SERVER_FEATURES`.
   Tests on `SqlitePersistenceMemory` and a temp directory: prepare refuses a non-empty
   folder, a path outside home, and a path another instance uses; release moves only recorded
   folders and never deletes; stopSessions runs before sign-out (fake ProviderService).

7. **RPC handlers.** `rpc.ts` with `makeProviderSignInRpcHandlers(auth)`, each handler
   `auth.effect(TAG, withForkRuntime(...))` (`subscribe` uses `auth.stream`). Spread into
   `ForkRpcGroup.of`, add scopes to `FORK_RPC_REQUIRED_SCOPES`. Run the `ext-core`
   authorization test.

8. **Client runtime.** `packages/client-runtime/src/fork/provider-sign-in.ts` with the atom
   families and commands; export it. Web `state.ts` binds them to `connectionAtomRuntime`
   the way `apps/web/src/state/device.ts:18` does.

9. **Web setup section.** `providerSetup.tsx` and `AccountSection.tsx`: status line, method
   menu (default from `defaultCodexMethod`), waiting states with Open, Copy, QR code and
   Cancel, the paste box, Sign out with confirmation (text in PRODUCT.md), the credential-store
   notice, "Same account as" warning, Claude API key form writing a sensitive
   `ANTHROPIC_API_KEY` environment variable through `useUpdateEnvironmentSettings`. Register
   in `FORK_PROVIDER_SETUP_SECTIONS`. Use upstream primitives only; match
   `ProviderSetupSection.tsx`'s row layout.

10. **Codex tools and import dialogs.** `CodexToolsDialog.tsx` (two tabs) and
    `ImportDialog.tsx`, opened from rows in the setup section.

11. **Accounts section and account lifecycle.** `settings.tsx` ("Accounts" in the Loom
    settings page, scope-gated like General), `AddAccountDialog.tsx`,
    `RemoveAccountDialog.tsx`. The client writes `providerInstances` exactly as
    `AddProviderInstanceDialog.tsx` does and removes an instance the way the provider editor's
    delete action does (`ProviderSettingsPanel.tsx:817`, `deleteProviderInstance`).

12. **Palette.** `palette.ts` with items `action:loom:provider-sign-in:sign-in:<instanceId>`,
    `action:loom:provider-sign-in:add-codex`, `...:add-claude`,
    `...:codex-tools:<instanceId>`. Sign-in items navigate to
    `/settings/providers` with `{ environmentId, instanceId }` search params, as upstream's
    `openProviderSetup` does (`apps/web/src/components/ChatView.tsx:4468-4476`).

13. **Docs and status.** `docs/fork/user/provider-sign-in.md` (how to sign in, add an
    account, what the credential-storage notice means, remote sign-in tips). Update the packet
    index Status. Fill SEAMS.md "Extension points created" and "Merge check".

## Pitfalls

- **Scope and fibers.** The login app-server must outlive the RPC that started it. Build it
  in a child scope added to the instance scope, never in the RPC handler's scope. Settle from
  watchdogs with a detached fork (old Loom's `settleDetached`).
- **Instance rebuilds.** Saving any provider setting rebuilds the instance and cancels a
  pending flow. The web section must show "Sign-in was cancelled because the provider
  settings changed." rather than an error, and it re-subscribes to the new manager through
  the service's `switchMap`.
- **Shadow homes.** Always run `materializeCodexShadowHome` before a Codex login; never
  symlink `auth.json` (upstream refuses a symlinked private auth file,
  `CodexHomeLayout.ts:295-318`). Keep both instances on the same `CODEX_HOME` path so threads
  can continue across accounts (docs/user/providers-codex.md).
- **Claude environment.** Only `CLAUDE_CONFIG_DIR` changes per account. Never set `HOME`.
- **Secrets.** The API key arrives in one RPC payload. Do not put RPC payloads in span
  attributes for these methods, do not log them, and redact `apiKey` in error causes.
- **Codex API key login with a shadow home** writes `auth.json` into the shadow home. That is
  the intended per-account behavior; say so in the user doc.
- **Upstream clients against a Loom server** see "Open provider setup" (the decorated
  snapshot) but no sign-in UI. The rewritten message keeps the terminal command, so nothing
  gets worse for them.
- **Tests never spawn real CLIs.** All process boundaries are injected.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A Codex shadow-home instance created with "Add Codex account" can sign in with device
  code from a second device and then continue a thread started on another Codex instance
  with the same `CODEX_HOME`.
- A Claude instance created with "Add Claude account" signs in, reports its email, and signs
  out, with the default Claude instance unaffected.
- Every waiting state has a working Cancel, and a server restart during a flow leaves the
  instance idle with no stray `codex app-server` or `claude` process (check with
  `ps -o pid,command -p <pid>` on the PIDs the test recorded, never by pattern).
