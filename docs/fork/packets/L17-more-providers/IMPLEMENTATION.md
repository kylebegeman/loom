# L17 implementation plan

One phase: model endpoints. Phases B (the generic ACP driver) and C (Copilot) were retired on
2026-10-09 (README, "Retired parts"). Each step leaves the tree compiling. Commits:
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
  migrations.ts  rpc.ts
apps/web/src/fork/more-providers/
  EndpointDialog.tsx  endpointDialog.logic.ts  endpointDialog.logic.test.ts
  settings.tsx  palette.ts  state.ts
docs/fork/user/more-providers.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core`, `ext-settings`, `ext-palette`;
   create missing ones exactly as specified, one commit each. (`ext-providers` is not
   needed.)
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
   `docs/user/providers-opencode.md`. Update the packet index Status and SEAMS.md.

## Pitfalls

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
- Removing an endpoint instance in Settings > Providers leaves no fork UI referring to it.
