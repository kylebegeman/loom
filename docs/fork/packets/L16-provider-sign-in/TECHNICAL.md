# L16 technical design

Citations are to this fork at upstream v0.0.42 and were checked against
`v0.0.43-nightly.20260923.2173`.

## Overview

```
Settings > Providers editor ──ForkProviderSetupSlot (ext-providers)──> AccountSection (web)
Settings > Loom > Accounts (ext-settings)                                   │
Command palette (ext-palette)                                               │ loom.provider-sign-in.* RPC
                                                                            ▼
                                   ProviderSignInService (ForkLayer, ext-core)
                                     │ resolves instance via ProviderInstanceRegistry
                                     │ looks up the instance's manager (WeakMap)
                                     ▼
   decorator (ext-providers) ── wraps CodexDriver.create / ClaudeDriver.create
     ├─ builds CodexSignIn or ClaudeSignIn in the instance scope
     └─ fills ServerProvider.setup.canAuthenticate and a clearer signed-out message
```

The sign-in managers must live in the instance's scope: that is where the effective home
(shadow home, config dir), the merged environment variables and the instance lifecycle are
known, and an instance rebuild (any settings change) must cancel a pending flow. Driver
`create` cannot reach fork services (its requirements are limited to `BuiltInDriversEnv`),
so the decorator builds the manager and publishes it in a module-level
`WeakMap<ProviderInstance, SignInManager>`. The fork service, which runs in `ForkLayer`, looks
instances up in upstream's `ProviderInstanceRegistry` and reads the map. Everything else
(folders, Codex tools, import) is plain service code.

## Contracts (`packages/contracts/src/fork/provider-sign-in.ts`)

```ts
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { IsoDateTime, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "../providerInstance.ts";

export const PROVIDER_SIGN_IN_WS_METHODS = {
  subscribe: "loom.provider-sign-in.subscribe",
  start: "loom.provider-sign-in.start",
  submit: "loom.provider-sign-in.submit",
  cancel: "loom.provider-sign-in.cancel",
  signOut: "loom.provider-sign-in.signOut",
  suggestAccount: "loom.provider-sign-in.suggestAccount",
  prepareAccountFolder: "loom.provider-sign-in.prepareAccountFolder",
  releaseAccountFolder: "loom.provider-sign-in.releaseAccountFolder",
  codexCredentialStore: "loom.provider-sign-in.codexCredentialStore",
  codexUseFileCredentials: "loom.provider-sign-in.codexUseFileCredentials",
  codexToolsList: "loom.provider-sign-in.codexToolsList",
  codexMcpReload: "loom.provider-sign-in.codexMcpReload",
  codexMcpSignIn: "loom.provider-sign-in.codexMcpSignIn",
  codexSkillSetEnabled: "loom.provider-sign-in.codexSkillSetEnabled",
  importDetect: "loom.provider-sign-in.importDetect",
  importApply: "loom.provider-sign-in.importApply",
} as const;

export const SignInMethod = Schema.Literals([
  "chatgpt", // Codex, browser OAuth
  "chatgptDeviceCode", // Codex
  "apiKey", // Codex (Claude API keys go to settings, not here)
  "claudeai", // Claude subscription: claude auth login --claudeai
  "console", // Anthropic Console: claude auth login --console
]);
export type SignInMethod = typeof SignInMethod.Type;

export const SignInAccount = Schema.Struct({
  status: Schema.Literals(["signedIn", "signedOut", "unknown"]),
  email: Schema.NullOr(TrimmedNonEmptyString),
  /** "Plus", "Pro", "Max", "API key", ... as the provider reports it. */
  plan: Schema.NullOr(TrimmedNonEmptyString),
  checkedAt: Schema.NullOr(IsoDateTime),
});

export const SignInState = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  supported: Schema.Boolean, // false: disabled instance or unsupported driver
  flowId: Schema.NullOr(TrimmedNonEmptyString),
  method: Schema.NullOr(SignInMethod),
  phase: Schema.Literals([
    "idle",
    "starting",
    "waiting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  /** Browser page to open (Codex chatgpt, Claude). */
  authorizationUrl: Schema.NullOr(Schema.String),
  /** Codex device code. */
  userCode: Schema.NullOr(TrimmedNonEmptyString),
  verificationUrl: Schema.NullOr(Schema.String),
  /** The paste box accepts the final loopback URL of the browser flow. */
  acceptsCallbackUrl: Schema.Boolean,
  /** The paste box accepts a code shown by the provider (Claude). */
  acceptsCode: Schema.Boolean,
  expiresAt: Schema.NullOr(IsoDateTime),
  /** Safe, user-facing text. Never tokens, codes or URLs with secrets. */
  message: Schema.NullOr(Schema.String),
  account: SignInAccount,
});
export type SignInState = typeof SignInState.Type;

export class ProviderSignInError extends Schema.TaggedError<ProviderSignInError>()(
  "LoomProviderSignInError",
  {
    instanceId: Schema.NullOr(ProviderInstanceId),
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message() {
    return this.detail;
  }
}
const Errors = Schema.Union([ProviderSignInError, EnvironmentAuthorizationError]);

const Target = Schema.Struct({ instanceId: ProviderInstanceId });

export const SignInStartInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  method: SignInMethod,
  /** Only with method "apiKey". Never logged, never stored by Loom. */
  apiKey: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
});
export const SignInSubmitInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: TrimmedNonEmptyString,
  /** A loopback callback URL or a provider code. The server decides which by shape. */
  value: TrimmedNonEmptyString.check(Schema.isMaxLength(16_384)),
});
export const SignInCancelInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  flowId: TrimmedNonEmptyString,
});

export const AccountDriver = Schema.Literals(["codex", "claudeAgent"]);
export const AccountSuggestion = Schema.Struct({
  driver: AccountDriver,
  /** e.g. "Codex 4". */
  displayName: TrimmedNonEmptyString,
  /** e.g. "codex_4"; unique among configured instances. */
  instanceId: ProviderInstanceId,
  /** e.g. "~/.codex_4"; does not exist yet. Written to settings in this form. */
  folder: TrimmedNonEmptyString,
  /** Codex only: the CODEX_HOME the default Codex instance uses ("" for ~/.codex). */
  sharedHomePath: Schema.NullOr(Schema.String),
});
export const PrepareAccountFolderInput = Schema.Struct({
  driver: AccountDriver,
  instanceId: ProviderInstanceId,
  folder: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
  /** Claude only: symlink <folder>/skills to <default config dir>/skills. */
  shareClaudeSkills: Schema.optional(Schema.Boolean),
});
export const ReleaseAccountFolderInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** false: only forget the record. true: also move the folder aside. */
  moveAside: Schema.Boolean,
});

export const CodexCredentialStore = Schema.Struct({
  sharedConfigPath: Schema.String,
  /** "unset" means Codex's default, which is "file". */
  store: Schema.Literals(["file", "keyring", "auto", "unset", "unknown"]),
  needsFileStore: Schema.Boolean, // true only for shadow-home instances with keyring/auto
});

export const CodexMcpServer = Schema.Struct({
  name: Schema.String,
  authStatus: Schema.String, // Codex McpAuthStatus, passed through
  toolCount: Schema.Number,
  resourceCount: Schema.Number,
  serverName: Schema.NullOr(Schema.String),
});
export const CodexSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  path: Schema.String,
  scope: Schema.String, // user | repo | system | admin
  enabled: Schema.Boolean,
});
export const CodexToolsListResult = Schema.Struct({
  mcpServers: Schema.Array(CodexMcpServer),
  skills: Schema.Array(CodexSkill),
  truncated: Schema.Boolean,
});

export const ImportItem = Schema.Struct({
  /** Opaque, round-tripped to importApply. */
  id: Schema.String,
  itemType: Schema.String, // AGENTS_MD | CONFIG | SKILLS | PLUGINS | MCP_SERVER_CONFIG | ...
  description: Schema.String,
  cwd: Schema.NullOr(Schema.String),
});

// Rpc.make(...) for each tag; `subscribe` has `stream: true`. Payloads:
// subscribe Target -> SignInState (stream); start SignInStartInput -> SignInState;
// submit SignInSubmitInput -> SignInState; cancel SignInCancelInput -> SignInState;
// signOut Target -> SignInState; suggestAccount { driver } -> AccountSuggestion;
// prepareAccountFolder PrepareAccountFolderInput -> { folder: string };
// releaseAccountFolder ReleaseAccountFolderInput -> { movedTo: string | null };
// codexCredentialStore Target -> CodexCredentialStore;
// codexUseFileCredentials Target -> CodexCredentialStore;
// codexToolsList Target & { cwd?: string } -> CodexToolsListResult;
// codexMcpReload Target -> {}; codexMcpSignIn Target & { name } -> { authorizationUrl };
// codexSkillSetEnabled Target & { path, enabled } -> { effectiveEnabled: boolean };
// importDetect Target & { cwds: string[] } -> { items: ImportItem[] };
// importApply Target & { itemIds: string[] } -> { importedCount: number }.
export const ProviderSignInRpcGroup = RpcGroup.make(/* the 16 Rpc.make values */);
```

Registration (`ext-core`): add `ProviderSignInRpcGroup` to `ForkRpcGroup`, and
`typeof PROVIDER_SIGN_IN_WS_METHODS.subscribe` to `ForkSubscriptionRpcTag` (resubscribed on
reconnect). Scopes in `FORK_RPC_REQUIRED_SCOPES`: `suggestAccount`, `codexCredentialStore`,
`codexToolsList` and `importDetect` use `orchestration:read`; everything else, including
`subscribe` (the state carries device codes, as upstream's `provider.auth.subscribe` does),
uses `orchestration:operate`.

`importDetect` returns items with an `id` the server derives by hashing the normalized item;
the server keeps the detected raw items for 10 minutes per instance so `importApply` sends
Codex exactly what it detected (old Loom's lesson: generated detail records can be empty or
malformed and must be filtered before they reach the browser).

## Server (`apps/server/src/fork/provider-sign-in/`)

| File                       | Role                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `decorator.ts`             | `ForkProviderDriverDecorator` for `codex` and `claudeAgent`: wraps `create`, builds the manager, decorates the snapshot.                  |
| `managers.ts`              | `SignInManager` interface and the `WeakMap<ProviderInstance, SignInManager>` with `registerManager` / `managerFor`.                       |
| `CodexSignIn.ts`           | Per-instance Codex manager over `codex app-server`.                                                                                       |
| `ClaudeSignIn.ts`          | Per-instance Claude manager over `claude auth login                                                                                       | logout | status`. |
| `callbackForward.ts`       | Validates a pasted loopback URL against the pending redirect and forwards it with `node:http` (adapted from upstream's Antigravity code). |
| `claudeAuthUrl.ts`         | `extractClaudeAuthorizationUrl` (allowlisted hosts, PKCE params), from old Loom.                                                          |
| `accountFolders.ts`        | Suggest, create, record and move aside account folders.                                                                                   |
| `codexTools.ts`            | MCP status, reload, MCP OAuth, skills, credential store, import, all through `withCodexAppServerClient`.                                  |
| `ProviderSignInService.ts` | `Context.Service` in `ForkLayer`; ties the above to the registry and settings.                                                            |
| `migrations.ts`, `rpc.ts`  | Storage and handlers.                                                                                                                     |

### Decorator

```ts
export const providerSignInDecorator: ForkProviderDriverDecorator = {
  id: "provider-sign-in",
  decorate: (driver) =>
    driver.driverKind !== "codex" && driver.driverKind !== "claudeAgent"
      ? driver
      : {
          ...driver,
          create: (input) =>
            Effect.gen(function* () {
              const instance = yield* driver.create(input);
              if (!input.enabled) return instance; // disabled: no manager, snapshot untouched
              const manager =
                driver.driverKind === "codex"
                  ? yield* makeCodexSignIn({ input, onAuthChanged: instance.snapshot.refresh })
                  : yield* makeClaudeSignIn({ input, onAuthChanged: instance.snapshot.refresh });
              const decorated: ProviderInstance = {
                ...instance,
                snapshot: decorateSnapshotShape(instance.snapshot, driver.driverKind),
                ...(instance.snapshotForCwd
                  ? {
                      snapshotForCwd: (cwd) =>
                        instance.snapshotForCwd!(cwd).pipe(
                          Effect.map((s) => decorateSnapshot(s, driver.driverKind)),
                        ),
                    }
                  : {}),
              };
              registerManager(decorated, manager);
              return decorated;
            }),
        },
};
```

`decorateSnapshot` is pure and tested:

- Adds `setup: { canAuthenticate: true, canInstall: snapshot.setup?.canInstall ?? false }`
  when `installed` is true. That turns on upstream's "Open provider setup" affordances
  (`apps/web/src/components/chat/ProviderStatusBanner.tsx:34-40`,
  `ChatComposer.tsx:1853`, `ModelPickerContent.tsx:108`).
- Replaces upstream's exact Codex message "Codex CLI is not authenticated. Run `codex login`
  and try again." (`CodexProvider.ts:554`) with "Codex is not signed in on this environment.
  Open provider setup to sign in, or run `codex login` on this machine." Any other message is
  left alone.

`decorateSnapshotShape` maps `getSnapshot`, `refresh` and `streamChanges` through
`decorateSnapshot` and passes `resolveMaintenance` and `applyUsageLimits` through unchanged.

The wrapped `create` reuses upstream helpers rather than re-deriving anything:
`resolveCodexHomeLayout` and `materializeCodexShadowHome`
(`apps/server/src/provider/Drivers/CodexHomeLayout.ts:44,320`), `makeClaudeEnvironment`
(`apps/server/src/provider/Drivers/ClaudeHome.ts:20`), `mergeProviderInstanceEnvironment`
(`apps/server/src/provider/ProviderInstanceEnvironment.ts`) and `expandHomePath`
(`apps/server/src/pathExpansion.ts`), all of which take the typed config the registry already
decoded (`input.config`).

### SignInManager

```ts
export interface SignInManager {
  readonly driver: "codex" | "claudeAgent";
  readonly state: SubscriptionRef.SubscriptionRef<SignInState>;
  readonly refreshAccount: Effect.Effect<void>; // bounded, cached 30 s
  readonly start: (
    method: SignInMethod,
    apiKey?: string,
  ) => Effect.Effect<SignInState, ProviderSignInError>;
  readonly submit: (
    flowId: string,
    value: string,
  ) => Effect.Effect<SignInState, ProviderSignInError>;
  readonly cancel: (flowId: string) => Effect.Effect<SignInState>;
  /** The service stops routed sessions first, as upstream's ProviderAuthService does. */
  readonly signOut: Effect.Effect<SignInState, ProviderSignInError>;
}
```

Shared rules for both managers (from old Loom's `CodexLoginSessions.ts`, which its ledger
0003 records as enforced by tests):

- At most one flow per instance; `start` replaces a pending flow (settled as cancelled).
- Every settle path (completed, failed, cancelled, timed out after 10 minutes, process exit,
  instance scope closed) goes through one idempotent `settle` guarded by a `Deferred`.
  Cleanup that closes the flow's child scope is forked detached, so a watchdog fiber inside
  that scope never interrupts itself.
- A successful sign-in or sign-out runs `onAuthChanged` (the instance's `snapshot.refresh`)
  detached, then `refreshAccount`. State reaches clients through the existing provider
  snapshot stream and this packet's `subscribe` stream. No other push channel.
- `succeeded`, `failed` and `cancelled` stay visible until the next `start`, then reset.
- Secrets never enter spans, logs or `message`: no API key, no code, no callback URL.

### CodexSignIn

- `start("chatgpt" | "chatgptDeviceCode" | "apiKey")`:
  1. `materializeCodexShadowHome(layout)` (idempotent; recreates the shadow layout if the
     folder was deleted).
  2. Open a child scope registered on the instance scope and, inside it,
     `withCodexAppServerClient({ binaryPath, homePath: effectiveHomePath, launchArgs, cwd:
process.cwd(), environment })` (`apps/server/src/provider/Layers/CodexProvider.ts:362`).
     The app-server process owns the OAuth loopback listener, so it stays alive until settle.
  3. Register `client.handleServerNotification("account/login/completed", ...)` before
     sending the request, so a fast completion is not missed.
  4. `client.request("account/login/start", params)` with `{ type: "chatgpt" }`,
     `{ type: "chatgptDeviceCode" }` or `{ type: "apiKey", apiKey }`
     (`packages/effect-codex-app-server/src/_generated/schema.gen.ts:38927`).
  5. Response `apiKey`: close the scope, settle success. `chatgpt`: state `waiting` with
     `authorizationUrl`, `acceptsCallbackUrl: true`, and the pending redirect parsed from the
     URL's `redirect_uri` parameter (Codex listens on `http://localhost:1455/auth/callback` in
     current releases; always use the parsed value). `chatgptDeviceCode`: state `waiting` with
     `userCode` and `verificationUrl`.
  6. Watchdogs in the child scope: the 10 minute timeout (best-effort
     `account/login/cancel` with a 2 s limit, then settle timed out), and the app-server exit
     (settle failed: "Codex stopped before sign-in finished.").
- `submit(flowId, url)`: only for `chatgpt`. Validate like upstream's
  `validateAntigravityCallbackUrl` (`apps/server/src/provider/antigravityCallback.ts:13`):
  `http:`, hostname `localhost` or `127.0.0.1`, same port and path as the pending redirect,
  no credentials or fragment, exactly one `state` equal to the authorization URL's `state`,
  a `code` present. Then GET it with `node:http` (no proxy, no redirects, 10 s limit) and set
  phase `verifying`. Completion still comes only from `account/login/completed`: a 200 from
  the callback is not proof of sign-in.
- `cancel`: best-effort `account/login/cancel`, settle cancelled.
- `signOut`: settle any flow, then a one-shot `withCodexAppServerClient` scope with
  `client.request("account/logout", undefined)` and a 10 s limit.
- `refreshAccount`: one-shot client, `account/read`, mapping `account.email` and the plan
  label the same way upstream's probe does (`CodexProvider.ts:426-545`). Signed-out when
  `account` is null and `requiresOpenaiAuth` is true.

### ClaudeSignIn

- Environment: `makeClaudeEnvironment(config, mergeProviderInstanceEnvironment(env))`, which
  sets `CLAUDE_CONFIG_DIR` only for a non-empty home path and leaves `HOME` alone (the macOS
  keychain lookup depends on it; comment at `ClaudeHome.ts:29-35`). Add `BROWSER` set to a
  no-op command so the CLI never opens a browser on the environment's machine; the client
  opens the link. Spawn with `resolveSpawnCommand` from `@t3tools/shared/shell` as
  `ClaudeProvider.ts` does.
- `start("claudeai" | "console")`: spawn `claude auth login --claudeai` or `--console`
  (flags verified against Claude Code 2.1.280: `claude auth login --help`) with stdin piped,
  stdout and stderr merged into a 32 KB rolling buffer. Wait up to 20 s for
  `extractClaudeAuthorizationUrl(buffer)`: an `https` URL on `claude.ai`, `claude.com`,
  `console.anthropic.com` or `platform.claude.com` whose path ends in `/oauth/authorize` and
  that carries `state` and `code_challenge`, with no credentials or port. No URL in 20 s, or
  the process exits first: fail with "Claude could not start sign-in. Check that Claude Code
  is installed on this environment." Found: state `waiting`, `acceptsCode: true`, and
  `acceptsCallbackUrl: true` when the URL's `redirect_uri` is a loopback URL.
- `submit(flowId, value)`: a value that parses as a URL goes through `callbackForward`
  against the pending `redirect_uri`; anything else must match `^[\x21-\x7e]{1,4096}$` and is
  written to stdin followed by a newline, once per distinct value (hash kept in memory).
- Completion: exit code 0 settles success; non-zero settles failed with the CLI's last
  non-empty stderr line when it contains no URL, else a generic message.
- `signOut`: `claude auth logout` with a 20 s limit.
- `refreshAccount`: `claude auth status --json` with a 10 s limit. Verified signed-out output
  (Claude Code 2.1.280, empty `CLAUDE_CONFIG_DIR`):
  `{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty",...}`. The signed-in
  fields (`email`, `subscriptionType`, `orgName`) are expected but unverified; decode with
  optional fields and treat anything unreadable as `unknown`.
- API keys never go through this manager. The web section writes `ANTHROPIC_API_KEY` as a
  sensitive instance environment variable with the same settings update the provider form
  uses; the instance rebuilds and the snapshot reflects it.

Known risk: `claude auth login` might require a TTY for the code prompt. Old Loom ran it with
a plain pipe (`ClaudeLoginSessions.ts` in REFERENCES), but verify with the installed CLI first
(TESTING.md, manual step 4). Fallback if a pipe does not work: run it under a pseudo-terminal
with the `node-pty` binding upstream already uses for terminals
(`apps/server/src/terminal/NodePtyAdapter.ts`), still inside this packet.

### ProviderSignInService

```ts
export class ProviderSignInService extends Context.Service<
  ProviderSignInService,
  {
    readonly subscribe: (
      instanceId: ProviderInstanceId,
    ) => Stream.Stream<SignInState, ProviderSignInError>;
    readonly start: (input: SignInStartInput) => Effect.Effect<SignInState, ProviderSignInError>;
    // submit, cancel, signOut, suggestAccount, prepareAccountFolder, releaseAccountFolder,
    // codexCredentialStore, codexUseFileCredentials, codexToolsList, codexMcpReload,
    // codexMcpSignIn, codexSkillSetEnabled, importDetect, importApply
  }
>()("loom/provider-sign-in/ProviderSignInService") {}
```

Dependencies (all available to `ForkLayer`, EXTENSION-POINTS.md "What ForkLayer can use"):
`ProviderInstanceRegistry`, `ProviderService`, `ProviderSessionDirectory`,
`ServerSettingsService`, `ProjectionSnapshotQuery` (for the current project's workspace root
in import detection), `ServerConfig`, `SqlClient`, `FileSystem`, `Path`,
`ChildProcessSpawner`.

- `subscribe` mirrors upstream's `ProviderAuthService.subscribe`
  (`apps/server/src/provider/Layers/ProviderAuthService.ts:93-107`): take
  `registry.subscribeChanges`, re-resolve the instance on each change, `changesWith` on the
  manager identity, then `switchMap` to `SubscriptionRef.changes(manager.state)`. A missing
  manager (disabled instance, other driver) yields one `supported: false` state. The first
  subscription for an instance triggers `refreshAccount`.
- `signOut` stops the instance's sessions first, exactly as upstream's `stopSessions`
  (`ProviderAuthService.ts:33-76`): bindings from `ProviderSessionDirectory` plus live
  `ProviderService.listSessions()`, then `stopSession` for each.
- Settings are never written by the server except `codexUseFileCredentials`, which writes
  Codex's own `config.toml` through Codex. Provider instances are added and removed by the
  client with upstream's settings update, which already handles sensitive values.

### Account folders

- `suggestAccount(driver)`: read settings; for Codex the shared home is the default Codex
  instance's `homePath` (`""` means `~/.codex`); the next folder is the lowest free
  `~/.codex_<n>` (or `~/.claude_<n>`) with `n >= 1` that neither exists on disk nor appears in
  any instance's `homePath` / `shadowHomePath`. `instanceId` is `codex_<n>` / `claude_<n>`,
  bumped until unused; `displayName` is "Codex <n>" / "Claude <n>".
- `prepareAccountFolder`: expand `~`, require an absolute path inside the user's home
  directory, refuse a path that exists and is not an empty directory, refuse any path that is
  or equals another instance's home, shadow home, or the shared Codex home. Create it with
  mode `0700`. For Codex, run `materializeCodexShadowHome` against the future layout so the
  first sign-in finds the shared links. For Claude with `shareClaudeSkills`, create
  `<folder>/skills` as a symlink to `<default config dir>/skills` when that directory exists
  (Kyle's current layout: `~/.claude_1/skills -> ~/.claude/skills`). Record
  `(path, driver, instance_id, created_at)` in `fork_provider_sign_in_account_folders`.
- `releaseAccountFolder`: only for a recorded folder. With `moveAside`, refuse when another
  configured instance still uses the path, when the path is a symlink, or when its realpath
  changed; then rename it to `<stateDir>/fork/provider-sign-in/removed/<ISO time>-<basename>`
  on the same volume (fall back to "left in place" with a message when rename fails across
  volumes). Nothing is ever deleted.

### Codex tools, credential store, import

All through a one-shot `withCodexAppServerClient` scope on the instance's effective home and
environment, bounded by 20 s (import: 120 s).

- `codexCredentialStore`: read `<sharedHomePath>/config.toml` as text and take the top-level
  `cli_auth_credentials_store = "<value>"` before the first `[table]` header (Codex's default
  is `"file"`; see REFERENCES). `needsFileStore` is true only when the instance's layout mode
  is `authOverlay` and the value is `keyring` or `auto`.
- `codexUseFileCredentials`: `config/value/write` with
  `{ keyPath: "cli_auth_credentials_store", value: "file", mergeStrategy: "replace" }` on an
  app-server started with the shared home (`schema.gen.ts:37743`), then re-read.
- `codexToolsList`: `mcpServerStatus/list` paged with `cursor` (stop after 200 servers,
  `truncated: true`), and `skills/list` with `{ cwds: [cwd], forceReload: true }` where `cwd`
  is the active project's root or `process.cwd()`.
- `codexMcpReload`: `config/mcpServer/reload`, then `snapshot.refresh`.
- `codexMcpSignIn`: `mcpServer/oauth/login` with `{ name }` returns `{ authorizationUrl }`
  (`schema.gen.ts:39131-39143`). The client opens it. Completion is visible on the next list.
  Remote clients get the same loopback caveat as Codex sign-in; the dialog says so.
- `codexSkillSetEnabled`: `skills/config/write` with `{ path, enabled }`
  (`schema.gen.ts:39928`), then `snapshot.refresh`.
- `importDetect` / `importApply`: `externalAgentConfig/detect` with `{ includeHome: true,
cwds }` and `externalAgentConfig/import` with the stored raw items, awaiting
  `externalAgentConfig/import/completed` (old Loom's `ExternalAgentConfig.ts`), then
  `snapshot.refresh`.

## Storage

Migration set `provider-sign-in`, tracking table `fork_migrations_provider_sign_in`:

```sql
-- 1_AccountFolders
CREATE TABLE IF NOT EXISTS fork_provider_sign_in_account_folders (
  path TEXT PRIMARY KEY,          -- absolute, expanded
  driver TEXT NOT NULL,           -- 'codex' | 'claudeAgent'
  instance_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  released_at TEXT,               -- set by releaseAccountFolder
  moved_to TEXT
);
CREATE INDEX IF NOT EXISTS fork_provider_sign_in_account_folders_instance
  ON fork_provider_sign_in_account_folders (instance_id);
```

Files: `<stateDir>/fork/provider-sign-in/removed/` for moved folders. Sign-in state is
in memory only; a server restart returns every instance to idle, which is correct because the
login processes died with it.

## Clients

- `packages/client-runtime/src/fork/provider-sign-in.ts`: a subscription atom family keyed by
  `{ environmentId, instanceId }` (`createEnvironmentRpcSubscriptionAtomFamily`, label
  `loom:provider-sign-in:state`), query families for `suggestAccount`,
  `codexCredentialStore`, `codexToolsList`, `importDetect`, and commands for the rest.
- `apps/web/src/fork/provider-sign-in/`:
  - `providerSetup.tsx`: the `ForkProviderSetupSection` (`appliesTo`: driver `codex` or
    `claudeAgent`). Renders `AccountSection`, plus for Codex the "Codex tools" and "Import
    from Claude Code" rows. Built from upstream layout primitives (`SettingsRow`,
    `Button`, `Input`, `QRCode` from `~/components/ui/qr-code`), styled like upstream's
    `ProviderSetupSection.tsx`.
  - `AccountSection.tsx`, `CodexToolsDialog.tsx`, `ImportDialog.tsx`,
    `AddAccountDialog.tsx`, `RemoveAccountDialog.tsx`.
  - `signIn.logic.ts`: pure helpers: `defaultCodexMethod({ clientOnEnvironmentMachine })`,
    `phaseLabel(state)`, `findSameAccountLabel(instanceId, driver, providers)` (from old
    Loom's `codexSignIn.logic.ts`), `isClientOnEnvironmentMachine(...)` (true for the
    primary local environment when running in the desktop app or on a loopback hostname).
  - `settings.tsx`: the "Accounts" `ForkSettingsSection`.
  - `palette.ts`: the palette source.
- Opening links: `ensureLocalApi().shell.openExternal(url)` as upstream's
  `ProviderSetupSection.tsx` does, with copy as the fallback.
- Add account (client side): `suggestAccount` -> dialog -> `prepareAccountFolder` -> write
  `providerInstances[instanceId] = { driver, displayName, accentColor, enabled: true,
config: codex ? { homePath: sharedHomePath, shadowHomePath: folder } : { homePath: folder } }`
  with `useUpdateEnvironmentSettings(environmentId)` the way
  `AddProviderInstanceDialog.tsx:125-208` does -> wait until the instance's sign-in state is
  `supported` -> `start`.
- Remove account: confirm -> `signOut` (ignore "not signed in") -> remove the instance with
  the same settings update the provider editor's delete uses -> `releaseAccountFolder`.
- Gating: every entry checks
  `supportsLoomFeature(serverConfig?.environment.capabilities, "provider-sign-in")`. Missing:
  the setup section renders one row "Account management needs a Loom server.", the Accounts
  section shows the same, and palette items are hidden.

## Provider-by-provider decisions

| Driver      | Decision                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Codex       | Supported: browser, device code, API key; tools page; import.                                            |
| Claude      | Supported: subscription and Console through the CLI; API key through instance environment variables.     |
| Antigravity | Not decorated. Upstream already has in-app Google sign-in.                                               |
| Cursor      | Not supported: `cursor-agent login` is interactive and upstream reports its status; revisit on request.  |
| Grok        | Not supported: upstream deliberately avoids auth side effects in probes (`docs/internals/providers.md`). |
| OpenCode    | Not supported: OpenCode owns many provider logins (`opencode auth`); out of scope.                       |
| L17 drivers | Their packet decides. The setup slot is available to them.                                               |

## Agent-facing tools

None.

## Performance

- No polling. Account checks run on first subscription, after sign-in and sign-out, and on
  the explicit refresh button, each at most once per 30 s per instance.
- The state stream carries one small struct per change.
- Each sign-in holds one `codex app-server` or `claude` process for at most 10 minutes.
- Codex tools lists are fetched on dialog open, paged and capped.

## Alternatives considered

- **Attach upstream's `ProviderAuthController` (`instance.auth`) and reuse
  `provider.auth.*` RPCs.** No new contract, but upstream's `ProviderAuthState`
  (`packages/contracts/src/providerSetup.ts:13-28`) has no device code, no method choice and
  no code paste, and upstream's `ProviderSetupSection.tsx` is Antigravity-specific. Rejected;
  fork RPCs carry the richer state.
- **Edit `CodexDriver.ts` and `ClaudeDriver.ts` directly** (old Loom's way, ledger 0003).
  Two busy upstream files with deep seams. Rejected for the one-line decorator seam in
  `ext-providers`.
- **Run `codex login` in a terminal panel.** Works for browser sign-in only, leaves the
  flow invisible, and has no completion signal.
- **Server writes provider instances.** Would duplicate upstream's settings update and its
  sensitive-value handling. The client does it.
