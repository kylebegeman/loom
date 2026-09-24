# L17 implementation plan

Three phases that ship separately: A (model endpoints), B (the generic ACP driver) and C
(Copilot, last because Kyle does not use it). Each step leaves the tree compiling. Commits:
`feat(fork-more-providers): ...`; extension points in their own `feat(fork): ...` commits.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder (RESEARCH.md first).
- No real API keys in tests or fixtures. For manual endpoint checks use a local Ollama or LM
  Studio. Kyle is not setting DeepSeek up now: its preset is covered by unit tests and the
  generic endpoint path, and a live DeepSeek check is optional (Kyle enters the key if he
  wants one).
- Subagents do not start dev servers; ask before starting one yourself (AGENTS.md).

## File layout

```
packages/contracts/src/fork/more-providers.ts          presets, env builder, schemas, RPC group
packages/contracts/src/fork/more-providers.test.ts
packages/client-runtime/src/fork/more-providers.ts
apps/server/src/fork/more-providers/
  endpoints/EndpointProbe.ts        EndpointProbe.test.ts
  endpoints/EndpointStore.ts        EndpointStore.test.ts
  endpoints/SkillsLink.ts           SkillsLink.test.ts
  endpoints/MoreProvidersEndpoints.ts   (service in ForkLayer)
  acp/AcpAgentProfile.ts
  acp/makeAcpAgentDriver.ts         makeAcpAgentDriver.test.ts
  acp/makeAcpAgentAdapter.ts        makeAcpAgentAdapter.test.ts
  acp/acpAgentProbe.ts              acpAgentProbe.test.ts
  acp/unsupportedTextGeneration.ts
  profiles/customAcp.ts  profiles/copilot.ts (phase C)
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
2. **Contracts.** `ENDPOINT_PRESETS` (with `shareSkillsDefault`),
   `buildEndpointEnvironment(preset, { baseUrl, apiKey, defaultModel, smallModel })` (pure),
   `SkillsLinkState`, the endpoint schemas and the eight `endpoint*` RPCs in
   `MoreProvidersRpcGroup`. Tests: env builder output per preset (sensitive flags, empty
   `ANTHROPIC_API_KEY`, placeholder tokens), skills defaults per preset, tags prefixed
   `loom.more-providers.`.
3. **Server.** `EndpointProbe.ts` with injected `HttpClient` (tests use a fake client:
   OpenAI and Ollama model shapes, 401, timeout, unknown shape, messages failure).
   `EndpointStore.ts` and the migration set `more-providers`. `SkillsLink.ts` with its temp
   directory tests (write the refuse cases first: real folder, foreign symlink, missing
   source, unlink never recursive). `MoreProvidersEndpoints` service (`suggest`, `probe`,
   `prepareFolder`, `record`, `list` with the skills state, `forget`, `refreshModels`,
   `setSkillsLink`) with `refreshModels` reading the instance's materialized environment
   from `ServerSettingsService.getSettings`. Register the service, migrations, feature slug,
   handlers and scopes.
4. **Client and web.** Atoms, `EndpointDialog.tsx` (logic in `endpointDialog.logic.ts`:
   step validation, default model choice, the skills switch default per preset, instance
   entry construction), the "Model endpoints" settings section with the per-row skills
   switch, the palette item. The instance write copies
   `AddProviderInstanceDialog.tsx:195-208`; `endpointPrepareFolder` runs before it.
5. **Docs.** `docs/fork/user/more-providers.md` "Model endpoints" section: presets
   (DeepSeek documented as Claude-based only), what the test does, where the key is stored,
   the skills switch and its defaults, the Ollama context-length advice, and "for
   OpenAI-compatible-only endpoints use OpenCode" with a link to upstream's
   `docs/user/providers-opencode.md`.

## Phase B: the generic ACP driver (`loomAcp`)

6. **`ext-providers`.** Existence check; create it from EXTENSION-POINTS.md, section 15, if
   missing (own commit, with its tests and FORK.md rows).
7. **Settings schema.** `LoomAcpSettings` in `more-providers.ts` with a local
   `forkProviderSettingsSchema` helper replicating upstream's unexported
   `makeProviderSettingsSchema` (`packages/contracts/src/settings.ts:543-555`). Test that it
   decodes `{}` with `enabled: false`.
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
10. **Driver factory and the custom profile.** `makeAcpAgentDriver(profile)` following
    `GrokDriver.ts:59-157`; `unsupportedTextGeneration.ts`; `profiles/customAcp.ts`; export
    `MoreProvidersDrivers` (`loomAcp` only for now) and register it in
    `FORK_PROVIDER_DRIVERS`. Test with fakes: snapshot states (not installed, ready, signed
    out with the advertised method names), `supportsTextGeneration: false`, `refreshModels`
    updates models.
11. **Web.** The `loomAcp` client definition and icon in `clientDefinitions.ts` and
    `icons.ts`, registered in the `ext-providers` web registry; palette item "Add ACP agent"
    that opens Settings > Providers (the Add dialog opens from there).
12. **Docs.** Add "ACP agents" to the user doc: custom commands, and the Gemini CLI recipe
    (command `gemini`, argument `--acp`, sign in with the Gemini CLI first; Gemini CLI serves
    Code Assist Standard and Enterprise accounts, Antigravity is upstream's route for
    everyone else).

## Phase C: GitHub Copilot (last)

13. **Verify Copilot.** With Kyle's permission, run `copilot --acp` by hand once (not in a
    test) to confirm stdio is the default transport, see the advertised auth methods, and
    confirm the CLI's login command and that `GH_TOKEN` is accepted; set the profile's args
    and message accordingly and note the result in REFERENCES.md.
14. **Profile and client.** `LoomCopilotSettings`, `profiles/copilot.ts` (signed-out message
    suggests the CLI login first, `GH_TOKEN` second), add it to `MoreProvidersDrivers`, the
    client definition and icon, palette item "Add GitHub Copilot provider". Tests: settings
    decode with `enabled: false`; the signed-out message; the driver kind.
15. **Docs and status.** Copilot section in the user doc (sign in with the CLI, or set
    `GH_TOKEN`). Update the packet index Status and SEAMS.md.

## Pitfalls

- **Driver requirements.** A fork driver's `R` must stay within `BuiltInDriversEnv`; no
  fork services are reachable from `create`. Anything that needs SQL stays in phase A's
  service.
- **Health checks.** Never call `session/new`, `authenticate`, or pass MCP servers in the
  probe. Model lists come from real sessions or the explicit `refreshModels`.
- **Driver kinds are forever.** `loomAcp` and `loomCopilot` are persisted in settings and
  thread bindings. Do not rename them later, and do not add `loomGemini`.
- **Endpoint keys.** The probe receives the key in its payload; keep it out of spans, logs
  and error causes. Store it only through the upstream settings update as a sensitive
  variable.
- **Remote localhost.** Ollama's `http://localhost:11434` means the environment's machine.
  Say so in the dialog.
- **Claude Code probes on endpoint instances** may report `warning` or odd account data;
  do not "fix" upstream's Claude probe from this packet.
- **Skills link safety.** Only ever create or remove the one symlink Loom made; never
  follow it for deletion, never touch a real `skills` folder, never write into the main
  skills folder.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- An Ollama (or LM Studio) endpoint with a tool-capable model, created through the dialog,
  edits a file in a scratch project with an approval, locally and from a remote client, and
  starts with no skills folder; turning its switch on links the main skills.
- The DeepSeek preset's environment, folder and skills defaults are proven by tests; a live
  DeepSeek run is optional (Kyle is not setting it up now).
- A `loomAcp` instance running a known ACP agent (for example `gemini --acp` when a Code
  Assist account is available, or any other ACP agent on the machine) completes a turn with
  a tool call; after phase C, a `loomCopilot` instance does too when Copilot CLI is signed
  in.
- Removing any of these instances in Settings > Providers leaves no fork UI referring to it.
