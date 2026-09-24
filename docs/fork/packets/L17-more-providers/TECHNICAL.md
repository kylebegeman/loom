# L17 technical design

Citations are to this fork at upstream v0.0.42, checked against
`v0.0.43-nightly.20260923.2173`. RESEARCH.md explains why there is no fork agent loop.

## Overview

Two independent parts.

```
Part A: model endpoints (no driver)
  web dialog ── loom.more-providers.endpointProbe ──> server probes the endpoint (HttpClient)
     │                                                    returns models, never stores the key
     └── loom.more-providers.endpointPrepareFolder ──> creates the config folder (0700) and,
            for cloud presets, the skills symlink
     └── upstream settings update: providerInstances[id] = Claude instance
            (own CLAUDE_CONFIG_DIR, endpoint env vars, customModels)
     └── loom.more-providers.endpointRecord ──> fork_more_providers_endpoints (no secrets)
     └── loom.more-providers.endpointSetSkillsLink ──> per-instance switch, later

Part B: ACP agents (fork drivers through ext-providers)
  FORK_PROVIDER_DRIVERS = [loomAcp, loomCopilot]   (loomCopilot added last, phase C)
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
    shareSkillsDefault: true, // cloud endpoint
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://localhost:11434",
    modelsUrl: "http://localhost:11434/api/tags",
    modelsFormat: "ollama",
    keyRequired: false,
    placeholderToken: "ollama", // Ollama requires a token and ignores it
    folderSuffix: "ollama",
    shareSkillsDefault: false, // local model
  },
  lmstudio: {
    label: "LM Studio",
    baseUrl: "http://localhost:1234",
    modelsUrl: "http://localhost:1234/v1/models",
    modelsFormat: "openai",
    keyRequired: false,
    placeholderToken: "lmstudio",
    folderSuffix: "lmstudio",
    shareSkillsDefault: false, // local model
  },
  other: {
    label: "Other Anthropic-compatible endpoint",
    baseUrl: "",
    modelsUrl: null, // derived: `${baseUrl}/v1/models`, falls back to manual entry
    modelsFormat: "openai",
    keyRequired: false,
    placeholderToken: null,
    folderSuffix: "endpoint",
    shareSkillsDefault: true, // treated as a cloud endpoint; the switch is right there
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
  endpointPrepareFolder: "loom.more-providers.endpointPrepareFolder",
  endpointSetSkillsLink: "loom.more-providers.endpointSetSkillsLink",
} as const;

export const SkillsLinkState = Schema.Literals([
  "linked", // <folder>/skills is Loom's symlink to the main Claude skills folder
  "none", // no <folder>/skills
  "own-folder", // a real directory or a symlink elsewhere: Loom never touches it
  "no-source", // the main Claude skills folder does not exist
]);

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
/** endpointList rows: the record plus the live skills state (read from disk, not stored). */
export const EndpointListItem = Schema.Struct({
  ...EndpointRecord.fields,
  skills: SkillsLinkState,
});
// endpointProbe EndpointProbeInput -> EndpointProbeResult           (terminal:operate)
// endpointSuggest { preset } -> { folder, instanceId, displayName }  (orchestration:read)
// endpointRecord EndpointRecord minus createdAt -> EndpointRecord   (orchestration:operate)
// endpointList {} -> { endpoints: EndpointListItem[] }              (orchestration:read)
// endpointForget { instanceId } -> {}                               (orchestration:operate)
// endpointRefreshModels { instanceId } -> EndpointProbeResult       (terminal:operate)
// endpointPrepareFolder { folder, shareSkills } -> { folder, skills } (orchestration:operate)
// endpointSetSkillsLink { instanceId, enabled } -> { skills }        (orchestration:operate)
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
- `SkillsLink.ts` (pure decisions plus small IO, tested in a temp directory):
  - Source: the main Claude skills folder is `<home>/skills` where `<home>` is the
    `homePath` of the default Claude instance (`defaultInstanceIdForDriver("claudeAgent")`,
    `packages/contracts/src/providerInstance.ts:148`), expanded with `expandHomePath`, or
    `~/.claude` when that is empty. This matches Kyle's layout
    (`~/.claude_1/skills -> ~/.claude/skills`).
  - `readSkillsLink(folder)`: `lstat(<folder>/skills)`; a symlink whose target resolves to
    the source is `linked`; absent is `none` (or `no-source` when the source is missing);
    anything else is `own-folder`.
  - Link: only from `none`; create an absolute symlink `<folder>/skills` ->
    source. Unlink: only from `linked`; remove the symlink itself (`unlink`, never a
    recursive remove). `own-folder` and `no-source` refuse with the PRODUCT.md messages.
- `endpointPrepareFolder`: expand `~`, require an absolute path inside the user's home
  directory, refuse an existing non-empty directory, create it with mode `0700`, then link
  skills when `shareSkills` is true. Claude Code fills the rest of the folder on first run.
- `endpointSetSkillsLink`: only for recorded endpoint instances; reads the instance's
  `homePath` from settings, then links or unlinks as above. Claude Code reads the skills
  folder when a session starts, so the change applies to the next session; no instance
  rebuild is needed.

### Web

- `apps/web/src/fork/more-providers/EndpointDialog.tsx`: three steps (preset, connection,
  models; the last one also holds the "Share my Claude skills" switch, defaulting to the
  preset's `shareSkillsDefault`). On create: `endpointSuggest` returns a free folder
  (`~/.claude_<suffix>`, with a number appended when the path exists on disk or is any
  instance's home), an unused instance id and a display name; `endpointPrepareFolder`
  creates it (and the link); then one upstream settings update writes
  `providerInstances[<id>] = { driver: "claudeAgent", displayName, accentColor, enabled: true,
environment: buildEndpointEnvironment(...), config: { homePath: folder, customModels } }`
  the way `AddProviderInstanceDialog.tsx:195-208` does; then `endpointRecord`.
- `settings.tsx`: the "Model endpoints" section: list from `endpointList` joined with live
  provider snapshots (status, model count), **Add endpoint**, per row **Refresh models**,
  a "Share Claude skills" switch (`endpointSetSkillsLink`; disabled with its message for
  `own-folder` and `no-source`) and **Open in Providers** (navigates to
  `/settings/providers` with `instanceId`).
- `palette.ts`: "Add model endpoint".

Claude Code creates its config directory contents on first run; Loom only creates the empty
folder and, when sharing, the `skills` link. It is a separate `CLAUDE_CONFIG_DIR` so the
endpoint key never mixes with a cached Anthropic login (`docs/user/providers-claude.md`,
"OpenRouter"). If L16 is present, its sign-in decorator skips these instances because they
set `ANTHROPIC_BASE_URL`.

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
// LoomAcpSettings: command (required, text; description names the Gemini CLI example,
//   PRODUCT.md), args (textarea, one per line), displayHint (text, e.g. "Gemini CLI"),
//   customModels (hidden).
```

Every fork driver defaults to `enabled: false` in its schema, like upstream's opt-in drivers,
and the Add dialog enables the instance it creates.

### Driver factory (`apps/server/src/fork/more-providers/acp/`)

```ts
export interface AcpAgentProfile<Settings> {
  readonly driverKind: ProviderDriverKind; // "loomAcp" | "loomCopilot"
  readonly displayName: string;
  readonly settingsSchema: Schema.Codec<Settings, unknown>;
  readonly spawn: (settings: Settings, cwd: string, env: NodeJS.ProcessEnv) => AcpSpawnInput;
  /** Preferred ACP auth method ids, in order; the first one the agent advertises is used. */
  readonly authMethodPreference: ReadonlyArray<string>;
  readonly messages: {
    readonly notInstalled: (settings: Settings) => string;
    /** Receives the agent's advertised auth method names, possibly empty. */
    readonly signedOut: (authMethodNames: ReadonlyArray<string>) => string;
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

Build order: `loomAcp` first (phase B), `loomCopilot` last (phase C).

| Driver kind   | Spawn                                                        | Auth preference                     | Signed-out message                                                                                                                                                                | Notes                                                                                                                              |
| ------------- | ------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `loomAcp`     | `<command> <args...>` exactly as configured, `cwd` = project | the agent's first advertised method | "Not signed in. Sign in with this agent's own command on this environment, then refresh." plus the advertised method names                                                        | The user owns the command; Loom never downloads it. Gemini CLI runs here as `gemini` + `--acp`; sign in with the Gemini CLI first. |
| `loomCopilot` | `<binaryPath or "copilot"> --acp <launchArgs>`               | the agent's advertised login method | "Not signed in. Run `copilot` on this environment and sign in with its login command, then refresh. Or add a `GH_TOKEN` environment variable to this provider." (CLI login first) | Built last. Verify whether `--stdio` is needed (old Loom passed it; 1.0.88's help lists only `--acp`) and the exact login command. |

`GH_TOKEN` as a Copilot CLI credential (a token with Copilot access) is from GitHub's
Copilot CLI documentation as remembered at writing time and was not re-verified; phase C's
first step checks it with `copilot --help` and GitHub's docs, and adjusts the message if the
variable name differs (for example `GITHUB_TOKEN`).

### Web (`apps/web/src/fork/more-providers/`)

- `clientDefinitions.ts`: two `ProviderClientDefinition`s appended through
  `FORK_PROVIDER_CLIENT_DEFINITIONS`: `{ value: "loomAcp", label: "ACP agent", icon:
ACPRegistryIcon, settingsSchema: LoomAcpSettings, badgeLabel: "Loom" }` (phase B) and
  `{ value: "loomCopilot", label: "GitHub Copilot CLI", icon: GithubCopilotIcon, ... }`
  (phase C). The icons already exist in upstream's `apps/web/src/components/Icons.tsx`
  (`GithubCopilotIcon` and `ACPRegistryIcon`; line numbers drift, search for the names).
- `icons.ts`: the same two in `FORK_PROVIDER_ICONS`.
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

| Driver                    | Decision                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Claude                    | Endpoint instances are plain Claude instances. No Claude code changes.               |
| Codex                     | Not used for endpoints (its custom providers speak the Responses API; out of scope). |
| OpenCode                  | Documented as the route for OpenAI-compatible-only endpoints; no code.               |
| Cursor, Grok, Antigravity | Untouched.                                                                           |
| `loomAcp`, `loomCopilot`  | New, on the generic ACP adapter; `loomCopilot` built last.                           |
| Gemini CLI                | No driver of its own; runs as a `loomAcp` instance (`gemini --acp`).                 |
| Antigravity               | Upstream's; the recommended Google route for individual accounts.                    |

## Agent-facing tools

None.

## Performance

- The skills link is one `lstat` per endpoint row when the Model endpoints section loads.
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
  model picker. Copilot keeps its own kind for its icon and messages; everything else,
  Gemini CLI included, uses `loomAcp`.
- **A dedicated `loomGemini` driver**: dropped by Kyle. Individual Gemini CLI accounts
  stopped working on 2026-06-18 and upstream supports Antigravity; the generic option
  covers Code Assist users.
- **An OpenCode preset for DeepSeek**: declined by Kyle; the Claude-based preset is enough.
- **Reusing upstream's reserved kinds** (`githubCopilot`, `gemini`, `acpRegistry`): a future
  upstream driver would decode fork configs with its own schema. Rejected.
- **ACP registry download**: out of scope (supply-chain surface, platform archives); a
  registry browser that fills in `npx`/`uvx` commands is a follow-up.
