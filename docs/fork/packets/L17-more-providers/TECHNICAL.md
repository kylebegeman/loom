# L17 technical design

Citations are to this fork at upstream v0.0.42, checked against
`v0.0.43-nightly.20260923.2173`. RESEARCH.md explains why there is no fork agent loop.

## Overview

Two independent parts.

```
Part A: model endpoints (no driver)
  web dialog ── loom.more-providers.endpointProbe ──> server probes the endpoint (HttpClient)
     │                                                    returns models, never stores the key
     └── upstream settings update: providerInstances[id] = Claude instance
            (own CLAUDE_CONFIG_DIR, endpoint env vars, customModels)
     └── loom.more-providers.endpointRecord ──> fork_more_providers_endpoints (no secrets)

Part B: ACP agents (fork drivers through ext-providers)
  FORK_PROVIDER_DRIVERS = [loomCopilot, loomGemini, loomAcp]
     each = makeAcpAgentDriver(profile)
        snapshot: initialize-only probe (no session, no MCP, no auth side effects)
        adapter:  makeAcpAgentAdapter(profile) on upstream AcpSessionRuntime
        textGeneration: unsupported (supportsTextGeneration: false)
```

## Part A: model endpoints

### Presets (`packages/contracts/src/fork/more-providers.ts`)

```ts
export const ENDPOINT_PRESETS = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    modelsUrl: "https://api.deepseek.com/models", // OpenAI-style list; verify
    modelsFormat: "openai",
    keyRequired: true,
    placeholderToken: null,
    folderSuffix: "deepseek",
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://localhost:11434",
    modelsUrl: "http://localhost:11434/api/tags",
    modelsFormat: "ollama",
    keyRequired: false,
    placeholderToken: "ollama", // Ollama requires a token and ignores it
    folderSuffix: "ollama",
  },
  lmstudio: {
    label: "LM Studio",
    baseUrl: "http://localhost:1234",
    modelsUrl: "http://localhost:1234/v1/models",
    modelsFormat: "openai",
    keyRequired: false,
    placeholderToken: "lmstudio",
    folderSuffix: "lmstudio",
  },
  other: {
    label: "Other Anthropic-compatible endpoint",
    baseUrl: "",
    modelsUrl: null, // derived: `${baseUrl}/v1/models`, falls back to manual entry
    modelsFormat: "openai",
    keyRequired: false,
    placeholderToken: null,
    folderSuffix: "endpoint",
  },
} as const;
export type EndpointPresetId = keyof typeof ENDPOINT_PRESETS;
```

The environment variables written for an endpoint instance (`buildEndpointEnvironment` in
the same file, pure and tested):

| Variable                                                         | Value                                           | Sensitive |
| ---------------------------------------------------------------- | ----------------------------------------------- | --------- |
| `ANTHROPIC_BASE_URL`                                             | the base URL                                    | no        |
| `ANTHROPIC_AUTH_TOKEN`                                           | the key, or the preset's placeholder token      | yes       |
| `ANTHROPIC_API_KEY`                                              | explicitly empty (upstream's OpenRouter recipe) | no        |
| `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` | the chosen default model                        | no        |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`                                  | the chosen small model                          | no        |

The alias variables are named in `docs/user/providers-claude.md` ("OpenRouter"); confirm the
full set in Claude Code's documentation during implementation and drop any that do not exist.

### RPC

```ts
export const MORE_PROVIDERS_WS_METHODS = {
  endpointProbe: "loom.more-providers.endpointProbe",
  endpointSuggest: "loom.more-providers.endpointSuggest",
  endpointRecord: "loom.more-providers.endpointRecord",
  endpointList: "loom.more-providers.endpointList",
  endpointForget: "loom.more-providers.endpointForget",
  endpointRefreshModels: "loom.more-providers.endpointRefreshModels",
} as const;

export const EndpointProbeInput = Schema.Struct({
  preset: Schema.Literals(["deepseek", "ollama", "lmstudio", "other"]),
  baseUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  /** Sent once for the probe; the server never stores it. */
  apiKey: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
});
export const EndpointModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  contextLength: Schema.NullOr(Schema.Number),
});
export const EndpointProbeResult = Schema.Struct({
  models: Schema.Array(EndpointModel),
  /** Result of a one-token Messages call to the first model, or null when skipped. */
  messages: Schema.NullOr(
    Schema.Struct({
      ok: Schema.Boolean,
      status: Schema.NullOr(Schema.Number),
      detail: Schema.String,
    }),
  ),
  warnings: Schema.Array(Schema.String), // e.g. small context length
});
export const EndpointRecord = Schema.Struct({
  instanceId: ProviderInstanceId,
  preset: Schema.Literals(["deepseek", "ollama", "lmstudio", "other"]),
  baseUrl: Schema.String,
  createdAt: IsoDateTime,
});
// endpointProbe EndpointProbeInput -> EndpointProbeResult           (terminal:operate)
// endpointSuggest { preset } -> { folder, instanceId, displayName }  (orchestration:read)
// endpointRecord EndpointRecord minus createdAt -> EndpointRecord   (orchestration:operate)
// endpointList {} -> { endpoints: EndpointRecord[] }                (orchestration:read)
// endpointForget { instanceId } -> {}                               (orchestration:operate)
// endpointRefreshModels { instanceId } -> EndpointProbeResult       (terminal:operate)
```

`endpointProbe` and `endpointRefreshModels` make the environment issue HTTP requests to a
user-chosen URL, which is terminal-level power, hence `terminal:operate`. Errors are
`LoomMoreProvidersError { operation, detail }` plus `EnvironmentAuthorizationError`.

### Server (`apps/server/src/fork/more-providers/endpoints/`)

- `EndpointProbe.ts`: with upstream's `HttpClient`:
  1. GET the models URL with `Authorization: Bearer <key>` and `x-api-key: <key>` when a key
     is given, 10 s limit. Decode `{ data: [{ id }] }` (OpenAI format) or
     `{ models: [{ name, details }] }` (Ollama). Unknown shapes return no models and a warning
     "Could not list models; enter model ids by hand."
  2. POST `${baseUrl}/v1/messages` with `{ model, max_tokens: 1, messages: [{ role: "user",
content: "ping" }] }`, headers `anthropic-version: 2023-06-01`, `x-api-key` and
     `Authorization`, 15 s limit. Report status and a short, key-free detail.
  3. Never log headers or bodies. Strip any query string from URLs in error text.
- `endpointRefreshModels`: read the instance from `ServerSettingsService.getSettings`. The
  server's view has materialized secrets (`serverSettings.ts:655-690`; verify that
  `getSettings` returns them), so the key does not travel again. Probe and return models; the
  client writes `customModels` (the client's settings copy is redacted, and upstream's update
  keeps redacted values, `serverSettings.ts:751-808`).
- `EndpointStore.ts` over `fork_more_providers_endpoints`. A fork reactor is not needed:
  `endpointList` filters out records whose instance no longer exists in settings and deletes
  them lazily.

### Web

- `apps/web/src/fork/more-providers/EndpointDialog.tsx`: three steps (preset, connection,
  models). On create: `endpointSuggest` returns a free folder (`~/.claude_<suffix>`, with a
  number appended when the path exists on disk or is any instance's home), an unused instance
  id and a display name; then one upstream settings update writes
  `providerInstances[<id>] = { driver: "claudeAgent", displayName, accentColor, enabled: true,
environment: buildEndpointEnvironment(...), config: { homePath: folder, customModels } }`
  the way `AddProviderInstanceDialog.tsx:195-208` does; then `endpointRecord`.
- `settings.tsx`: the "Model endpoints" section: list from `endpointList` joined with live
  provider snapshots (status, model count), **Add endpoint**, per row **Refresh models** and
  **Open in Providers** (navigates to `/settings/providers` with `instanceId`).
- `palette.ts`: "Add model endpoint".

Claude Code creates its config directory contents on first run; the folder does not need
preparing. It is a separate `CLAUDE_CONFIG_DIR` so the endpoint key never mixes with a
cached Anthropic login (`docs/user/providers-claude.md`, "OpenRouter").

## Part B: ACP agents

### Settings schemas (`packages/contracts/src/fork/more-providers.ts`)

Built like upstream's (`packages/contracts/src/settings.ts:543-555` is not exported; the fork
file repeats its three lines: `Schema.Struct(fields)` annotated with
`providerSettingsFormSchema: { order }`). Field annotations use the same
`providerSettingsForm` keys, so upstream's generic form renders them.

```ts
export const LoomCopilotSettings = forkProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)), hidden),
    binaryPath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Copilot CLI. Leave empty to use `copilot` from PATH.",
        providerSettingsForm: { placeholder: "copilot", clearWhenEmpty: "omit" },
      }),
    ),
    launchArgs: TrimmedString.pipe(/* "Additional arguments after --acp" */),
    customModels: Schema.Array(CustomModelSetting).pipe(/* hidden, default [] */),
  },
  { order: ["binaryPath", "launchArgs"] },
);
// LoomGeminiSettings: same shape, placeholder "gemini".
// LoomAcpSettings: command (required, text), args (textarea, one per line),
//   displayHint (text, e.g. "Goose"), customModels (hidden).
```

Every fork driver defaults to `enabled: false` in its schema, like upstream's opt-in drivers,
and the Add dialog enables the instance it creates.

### Driver factory (`apps/server/src/fork/more-providers/acp/`)

```ts
export interface AcpAgentProfile<Settings> {
  readonly driverKind: ProviderDriverKind; // "loomCopilot" | "loomGemini" | "loomAcp"
  readonly displayName: string;
  readonly settingsSchema: Schema.Codec<Settings, unknown>;
  readonly spawn: (settings: Settings, cwd: string, env: NodeJS.ProcessEnv) => AcpSpawnInput;
  /** Preferred ACP auth method ids, in order; the first one the agent advertises is used. */
  readonly authMethodPreference: ReadonlyArray<string>;
  readonly messages: {
    readonly notInstalled: string;
    readonly signedOut: string; // e.g. "Sign in with the Copilot CLI on this environment, then refresh."
  };
}

export const makeAcpAgentDriver = <Settings>(
  profile: AcpAgentProfile<Settings>,
): ForkProviderDriver => ({
  driverKind: profile.driverKind,
  metadata: { displayName: profile.displayName, supportsMultipleInstances: true },
  configSchema: profile.settingsSchema,
  defaultConfig: () => Schema.decodeSync(profile.settingsSchema)({}),
  create: (input) =>
    Effect.gen(function* () {
      /* see below */
    }),
});
```

`create` follows `GrokDriver.ts` (`apps/server/src/provider/Drivers/GrokDriver.ts:59-157`),
the smallest upstream ACP driver:

- `processEnv = mergeProviderInstanceEnvironment(input.environment)`;
  `continuationIdentity = defaultProviderContinuationIdentity({ driverKind, instanceId })`;
  `stampIdentity = withInstanceIdentity(...)` (`Drivers/instanceIdentity.ts`).
- `adapter = yield* makeAcpAgentAdapter(profile, effectiveSettings, { instanceId,
environment: processEnv, nativeEventLogger })`.
- `snapshot = yield* makeManagedServerProvider({ ... checkProvider })` where
  `checkProvider` spawns the agent, sends ACP `initialize` only, reads
  `agentInfo`, `agentCapabilities` and `authMethods`, and closes. No `session/new`, no
  `authenticate`, no MCP servers: upstream's rule is that a health check must not create
  sessions or trigger sign-in (`docs/internals/providers.md`, "Setup must not happen as a
  health-check side effect"). Status mapping: spawn failure with "not found" -> not installed;
  initialize succeeded -> ready (auth unknown); initialize error mentioning authentication, or
  a later session failure with an ACP auth-required error recorded by the adapter -> auth
  unauthenticated with `messages.signedOut`.
- Maintenance: `makeManualOnlyProviderMaintenanceCapabilities({ provider, packageName: null })`
  (as `GrokDriver.ts:39-42`).
- Models: the snapshot lists custom models plus the models the adapter last observed from a
  real session (`session/new` or `session/load` returns `models.availableModels` and a model
  config option; `AcpRuntimeModel.extractModelConfigId`, `AcpRuntimeModel.ts:138`). Until
  then a single "Agent default" model with slug `default`. `refreshModels` (a
  `ProviderInstance` field upstream already calls for explicit model refresh) opens one
  throwaway session in the server's `cwd` without MCP servers to read the list.
- `textGeneration`: a stub whose operations fail with upstream's `TextGenerationError`
  "Text generation is not available for this provider."; the snapshot sets
  `supportsTextGeneration: false` so clients do not offer it.

### Adapter (`makeAcpAgentAdapter`)

Derived from `apps/server/src/provider/Layers/CursorAdapter.ts` (1,256 lines), the plainest
upstream ACP adapter. Copy its structure into the fork and remove Cursor-specific parts
(parameterized model picker capabilities, `CursorAcpExtension`, Cursor transport-failure
handling, Cursor permission launch arguments). What remains and is generic:

| Concern      | Implementation                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime      | `AcpSessionRuntime.layer({ spawn, cwd, clientInfo, authMethodId, mcpServers, resumeSessionId, clientCapabilities })` (`acp/AcpSessionRuntime.ts:80-113,1085`).                                                                                                                                         |
| Auth method  | After `initialize`, the first id in `profile.authMethodPreference` that the agent advertises; otherwise the agent's first advertised method.                                                                                                                                                           |
| MCP          | The `t3-code` HTTP MCP server from `McpProviderSession.readMcpProviderSession(threadId)`, exactly as `CursorAdapter.ts:543-575`, only when the agent advertises `mcpCapabilities.http`.                                                                                                                |
| Events       | `AcpCoreRuntimeEvents` builders (`acp/AcpCoreRuntimeEvents.ts:68-234`) for tool calls, plan updates, content deltas, assistant items, requests.                                                                                                                                                        |
| Approvals    | ACP `session/request_permission` -> T3 approval request; replies with `acpPermissionOutcome` (`acp/AcpAdapterSupport.ts:46`). In full-access runtime mode, auto-reply with the agent's `allow_once` option, never `allow_always` (same reasoning as OpenCode's `once`, `docs/internals/providers.md`). |
| Models       | `session/set_model` or the model config option, as `applyCursorAcpModelSelection` does but without Cursor's parameterized picker.                                                                                                                                                                      |
| Plan mode    | Only when the agent advertises a session mode with id `plan`; otherwise `showInteractionModeToggle: false`.                                                                                                                                                                                            |
| Resume       | `resumeCursor = { sessionId }`; `resumeMethod: "load"` only when `agentCapabilities.loadSession` is true. Otherwise start fresh and emit one `runtime.warning` "This agent cannot resume its earlier session; it starts fresh."                                                                        |
| Images       | Sent only when `promptCapabilities.image` is true; otherwise the attachment path is in the text (ProviderService already appends paths).                                                                                                                                                               |
| Interrupt    | ACP `session/cancel` (`cancelBehavior: "interrupt"`).                                                                                                                                                                                                                                                  |
| Rollback     | Unsupported (`supportsConversationRollback: false`), like Cursor.                                                                                                                                                                                                                                      |
| Capabilities | `{ sessionModelSwitch: "in-session", supportsConversationRollback: false }`.                                                                                                                                                                                                                           |
| Logging      | `ProviderEventLoggers.native` as Cursor does; stderr through `onStderr` with secret redaction.                                                                                                                                                                                                         |

### Profiles

| Driver kind   | Spawn                                                        | Auth preference                                                                                                             | Notes                                                                                      |
| ------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `loomCopilot` | `<binaryPath or "copilot"> --acp <launchArgs>`               | the agent's advertised login method                                                                                         | Verify whether `--stdio` is needed (old Loom passed it; 1.0.88's help lists only `--acp`). |
| `loomGemini`  | `<binaryPath or "gemini"> --acp <launchArgs>`                | `gemini-api-key` when `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set, else `oauth-personal` (old Loom's `GeminiAcpSupport.ts`) | Settings copy points individual users to Antigravity.                                      |
| `loomAcp`     | `<command> <args...>` exactly as configured, `cwd` = project | the agent's first advertised method                                                                                         | The user owns the command; Loom never downloads it.                                        |

### Web (`apps/web/src/fork/more-providers/`)

- `clientDefinitions.ts`: three `ProviderClientDefinition`s appended through
  `FORK_PROVIDER_CLIENT_DEFINITIONS`: `{ value: "loomCopilot", label: "GitHub Copilot CLI",
icon: GithubCopilotIcon, settingsSchema: LoomCopilotSettings, badgeLabel: "Loom" }`,
  `{ value: "loomGemini", label: "Gemini CLI", icon: Gemini, ... }`,
  `{ value: "loomAcp", label: "ACP agent", icon: ACPRegistryIcon, ... }`. The icons already
  exist in upstream's `apps/web/src/components/Icons.tsx:568,738,749`.
- `icons.ts`: the same three in `FORK_PROVIDER_ICONS`.
- The generic settings form, model picker, status banner and provider cards need nothing
  else: they are driven by the definition and the snapshot.

### Gating

The fork driver definitions are compiled into the web bundle, but a Loom client talking to an
upstream server must not offer them in the Add dialog. `FORK_PROVIDER_CLIENT_DEFINITIONS` is
static, so gating happens in the server: an upstream server simply has no such driver, and an
instance added anyway shows as unavailable. To avoid that trap, the "Add ACP agent" palette
item and the Model endpoints section check `supportsLoomFeature(caps, "more-providers")`.
The Add dialog itself cannot be gated without a seam; this is recorded as a known limit.

## Storage

Migration set `more-providers`, tracking table `fork_migrations_more_providers`:

```sql
-- 1_Endpoints
CREATE TABLE IF NOT EXISTS fork_more_providers_endpoints (
  instance_id TEXT PRIMARY KEY,
  preset TEXT NOT NULL,            -- deepseek | ollama | lmstudio | other
  base_url TEXT NOT NULL,          -- no credentials, no query string
  created_at TEXT NOT NULL
);
```

No secrets in fork storage. Keys live in upstream's secret store through the instance's
sensitive environment variables.

## Provider-by-provider decisions

| Driver                                 | Decision                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Claude                                 | Endpoint instances are plain Claude instances. No Claude code changes.               |
| Codex                                  | Not used for endpoints (its custom providers speak the Responses API; out of scope). |
| OpenCode                               | Documented as the route for OpenAI-compatible-only endpoints; no code.               |
| Cursor, Grok, Antigravity              | Untouched.                                                                           |
| `loomCopilot`, `loomGemini`, `loomAcp` | New, on the generic ACP adapter.                                                     |

## Agent-facing tools

None.

## Performance

- Probes run on instance creation and settings changes (upstream's managed snapshot cadence),
  each an `initialize` round trip with a 10 s limit. No sessions in probes.
- Each ACP thread owns one agent process, as Cursor and Grok do.
- The endpoint probe runs only on user action.
- Event mapping reuses upstream's `decideToolCallUpdateEmission`
  (`AcpRuntimeModel.ts:645`) so chatty agents do not flood the WebSocket.

## Alternatives considered

- **A fork agent loop** (flue, buzz-agent, old Loom's chat adapters): rejected in RESEARCH.md.
- **Endpoint instances through Codex custom model providers**: Codex speaks the Responses
  API to providers; DeepSeek and Ollama document Anthropic compatibility and Claude Code
  usage, so Claude is the surer path.
- **One ACP driver kind with presets**: a single kind would share one icon and label in the
  model picker. Three kinds cost three small profiles.
- **Reusing upstream's reserved kinds** (`githubCopilot`, `gemini`, `acpRegistry`): a future
  upstream driver would decode fork configs with its own schema. Rejected.
- **ACP registry download**: deferred (supply-chain surface, platform archives).
