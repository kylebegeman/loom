# L17 implementation plan

Two phases that ship separately. Each step leaves the tree compiling. Commits:
`feat(fork-more-providers): ...`; extension points in their own `feat(fork): ...` commits.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder (RESEARCH.md first).
- No real API keys in tests or fixtures. For manual endpoint checks use a local Ollama or LM
  Studio; a DeepSeek key is Kyle's to enter in the running app.
- Subagents do not start dev servers; ask before starting one yourself (AGENTS.md).

## File layout

```
packages/contracts/src/fork/more-providers.ts          presets, env builder, schemas, RPC group
packages/contracts/src/fork/more-providers.test.ts
packages/client-runtime/src/fork/more-providers.ts
apps/server/src/fork/more-providers/
  endpoints/EndpointProbe.ts        EndpointProbe.test.ts
  endpoints/EndpointStore.ts        EndpointStore.test.ts
  endpoints/MoreProvidersEndpoints.ts   (service in ForkLayer)
  acp/AcpAgentProfile.ts
  acp/makeAcpAgentDriver.ts         makeAcpAgentDriver.test.ts
  acp/makeAcpAgentAdapter.ts        makeAcpAgentAdapter.test.ts
  acp/acpAgentProbe.ts              acpAgentProbe.test.ts
  acp/unsupportedTextGeneration.ts
  profiles/copilot.ts  profiles/gemini.ts  profiles/customAcp.ts
  drivers.ts                        (exports MoreProvidersDrivers)
  migrations.ts  rpc.ts
apps/web/src/fork/more-providers/
  EndpointDialog.tsx  endpointDialog.logic.ts  endpointDialog.logic.test.ts
  settings.tsx  palette.ts  clientDefinitions.ts  icons.ts  state.ts
docs/fork/user/more-providers.md
```

## Phase A: model endpoints

1. **Extension points.** Existence checks for `ext-core`, `ext-settings`, `ext-palette`;
   create missing ones exactly as specified, one commit each. (`ext-providers` is not needed
   for phase A.)
2. **Contracts.** `ENDPOINT_PRESETS`, `buildEndpointEnvironment(preset, { baseUrl, apiKey,
defaultModel, smallModel })` (pure), the endpoint schemas and the `endpoint*` RPCs in
   `MoreProvidersRpcGroup`. Tests: env builder output per preset (sensitive flags, empty
   `ANTHROPIC_API_KEY`, placeholder tokens), tags prefixed `loom.more-providers.`.
3. **Server.** `EndpointProbe.ts` with injected `HttpClient` (tests use a fake client:
   OpenAI and Ollama model shapes, 401, timeout, unknown shape, messages failure).
   `EndpointStore.ts` and the migration set `more-providers`. `MoreProvidersEndpoints` service
   (`suggest`, `probe`, `record`, `list`, `forget`, `refreshModels`) with `refreshModels`
   reading the instance's materialized environment from `ServerSettingsService.getSettings`.
   Register the service, migrations, feature slug, handlers and scopes.
4. **Client and web.** Atoms, `EndpointDialog.tsx` (logic in `endpointDialog.logic.ts`:
   step validation, default model choice, instance entry construction), the "Model endpoints"
   settings section, the palette item. The instance write copies
   `AddProviderInstanceDialog.tsx:195-208`.
5. **Docs.** `docs/fork/user/more-providers.md` "Model endpoints" section: presets, what the
   test does, where the key is stored, the Ollama context-length advice, and "for
   OpenAI-compatible-only endpoints use OpenCode" with a link to upstream's
   `docs/user/providers-opencode.md`.

## Phase B: ACP agents

6. **`ext-providers`.** Existence check; create it from EXTENSION-POINTS.md, section 15, if
   missing (own commit, with its tests and FORK.md rows).
7. **Settings schemas.** `LoomCopilotSettings`, `LoomGeminiSettings`, `LoomAcpSettings` in
   `more-providers.ts` with a local `forkProviderSettingsSchema` helper replicating upstream's
   unexported `makeProviderSettingsSchema` (`packages/contracts/src/settings.ts:543-555`).
   Test that each decodes `{}` with `enabled: false`.
8. **Probe.** `acpAgentProbe.ts`: spawn, `initialize`, read `agentInfo`,
   `agentCapabilities`, `authMethods`, close; 10 s limit; map to a `ServerProviderDraft` with
   `buildServerProvider` (`apps/server/src/provider/providerSnapshot.ts`). Tests with a fake
   ACP peer (upstream's ACP tests have peers to copy from, for example
   `apps/server/src/provider/acp/AcpJsonRpcConnection.test.ts`).
9. **Adapter.** Copy `CursorAdapter.ts` into `makeAcpAgentAdapter.ts` and strip the Cursor
   specifics listed in TECHNICAL.md, replacing them with profile hooks. Keep upstream's event
   builders and runtime; do not fork `AcpSessionRuntime`. Tests with the fake peer: a turn
   streams text and a tool call; a permission request round-trips; full-access mode answers
   `allow_once`; interrupt sends `session/cancel`; resume uses `session/load` only when
   advertised, else emits one `runtime.warning`; MCP server passed only when `http` is
   advertised.
10. **Driver factory and profiles.** `makeAcpAgentDriver(profile)` following
    `GrokDriver.ts:59-157`; `unsupportedTextGeneration.ts`; the three profiles; export
    `MoreProvidersDrivers` and register in `FORK_PROVIDER_DRIVERS`. Test with fakes: snapshot
    states (not installed, ready, signed out), `supportsTextGeneration: false`,
    `refreshModels` updates models.
11. **Web.** `clientDefinitions.ts` and `icons.ts` registered in the `ext-providers` web
    registry; palette items "Add GitHub Copilot provider" and "Add ACP agent" that open
    Settings > Providers (the Add dialog opens from there).
12. **Verify Copilot.** With Kyle's permission, run `copilot --acp` by hand once (not in a
    test) to confirm stdio is the default transport and see the advertised auth methods; set
    the profile's args accordingly and note the result in REFERENCES.md.
13. **Docs and status.** Add "ACP agents" to the user doc (Copilot sign-in happens in the
    Copilot CLI; Gemini CLI for Code Assist accounts, Antigravity for everyone else; custom
    commands). Update the packet index Status and SEAMS.md.

## Pitfalls

- **Driver requirements.** A fork driver's `R` must stay within `BuiltInDriversEnv`; no
  fork services are reachable from `create`. Anything that needs SQL stays in phase A's
  service.
- **Health checks.** Never call `session/new`, `authenticate`, or pass MCP servers in the
  probe. Model lists come from real sessions or the explicit `refreshModels`.
- **Driver kinds are forever.** `loomCopilot`, `loomGemini`, `loomAcp` are persisted in
  settings and thread bindings. Do not rename them later.
- **Endpoint keys.** The probe receives the key in its payload; keep it out of spans, logs
  and error causes. Store it only through the upstream settings update as a sensitive
  variable.
- **Remote localhost.** Ollama's `http://localhost:11434` means the environment's machine.
  Say so in the dialog.
- **Claude Code probes on endpoint instances** may report `warning` or odd account data;
  do not "fix" upstream's Claude probe from this packet.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A DeepSeek endpoint created through the dialog edits a file in a scratch project with an
  approval, from web and from a remote client.
- An Ollama endpoint with a tool-capable model does the same locally.
- A `loomAcp` instance running a known ACP agent completes a turn with a tool call, and a
  `loomCopilot` instance does too when Copilot CLI is signed in.
- Removing any of these instances in Settings > Providers leaves no fork UI referring to it.
