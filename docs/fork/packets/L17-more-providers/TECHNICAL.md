# L17 technical design

Citations are to this fork at upstream v0.0.42, checked against
`v0.0.43-nightly.20260923.2173`. RESEARCH.md explains why there is no fork agent loop.

## Overview

One part remains: model endpoints. Parts B (ACP agents) and C (GitHub Copilot) were retired
on 2026-10-09 because upstream's ACP Registry covers them (README, "Retired parts"); this
packet adds no provider driver.

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

### Gating

The "Add model endpoint" palette item and the Model endpoints section check
`supportsLoomFeature(caps, "more-providers")`; on an upstream server the section says "Needs a
Loom server".

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
| ACP agents, Copilot       | Retired here; upstream's ACP Registry covers them.                                   |

## Agent-facing tools

None.

## Performance

- The skills link is one `lstat` per endpoint row when the Model endpoints section loads.
- The endpoint probe runs only on user action.

## Alternatives considered

- **A fork agent loop** (flue, buzz-agent, old Loom's chat adapters): rejected in RESEARCH.md.
- **Endpoint instances through Codex custom model providers**: Codex speaks the Responses
  API to providers; DeepSeek and Ollama document Anthropic compatibility and Claude Code
  usage, so Claude is the surer path.
- **An OpenCode preset for DeepSeek**: declined by Kyle; the Claude-based preset is enough.
- **Fork ACP and Copilot drivers**: designed here, then retired by Kyle on 2026-10-09 in
  favor of upstream's ACP Registry.
