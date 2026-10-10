# L17: More providers

Status: Ready to build. Parts B and C are retired (see [Retired parts](#retired-parts)).

Bring more models into Loom without building a coding agent of our own. **Model endpoints**
turns DeepSeek, Ollama, LM Studio and any other Anthropic-compatible endpoint into a
ready-to-use Claude provider instance in one dialog, with a connection test: Claude Code
stays the agent (tools, approvals, resume, compaction) and only the model behind it changes.

The key question from the brief, "providers in T3 are agent harnesses; raw model APIs need an
agent loop", is answered in [RESEARCH.md](./RESEARCH.md): for every target there is an
existing harness that already speaks to it natively, so this packet adds no agent loop.

## Retired parts

Kyle approved on 2026-10-09 retiring parts B and C, because upstream T3 Code (Orchestrator
V2, now in Loom nightly) covers them:

- **Part B, ACP agents** (the generic `loomAcp` driver for custom ACP commands, Gemini CLI
  among them): upstream's ACP Registry lists ACP agents, Gemini included, and accepts custom
  ACP commands.
- **Part C, GitHub Copilot** (the `loomCopilot` driver): upstream's ACP Registry includes
  Copilot.

Their design is removed from this folder; git history keeps it. What remains is part A,
model endpoints.

## Scope

- In:
  - Settings > Loom > **Model endpoints**: presets for DeepSeek, Ollama, LM Studio and
    "Other Anthropic-compatible endpoint". The dialog tests the endpoint from the environment,
    lists its models, and creates a Claude instance with its own `CLAUDE_CONFIG_DIR`, the
    endpoint's environment variables (key stored as a sensitive variable) and the chosen
    models as custom models. Edit and remove go through the normal provider editor.
    DeepSeek is a documented, tested preset; Kyle is not setting it up now.
  - Skills for endpoint instances: cloud presets (DeepSeek, Other) share the main Claude
    skills folder through a `skills` symlink, like Kyle's `~/.claude_N` accounts; local
    presets (Ollama, LM Studio) start with none. A per-instance switch in Model endpoints
    changes it later.
- Out:
  - A fork-owned agent loop over raw chat-completions APIs (withastro/flue, pi-agent-core, or
    old Loom's `OpenAiResponsesAdapter`). Rejected for now; RESEARCH.md says when to revisit.
  - OpenAI-compatible endpoints that have no Anthropic-compatible API. Use upstream's OpenCode
    driver, which configures such providers natively; this packet's docs link to it.
  - ACP agents, Gemini CLI and GitHub Copilot: retired, see above. Use upstream's ACP
    Registry.
  - An OpenCode preset for DeepSeek: declined by Kyle; DeepSeek is a Claude-based preset
    only.
  - Mobile UI. Threads on endpoint instances still work from the upstream mobile app.

## Surfaces

- Web and desktop: supported (settings, model picker, threads).
- Mobile: no fork UI. Threads started elsewhere can be read and continued from the upstream
  mobile app because the server does the work.
- Remote: supported. Endpoint tests and model lists run on the environment's machine, so an
  Ollama on the server's `localhost` works from a phone.
- Upstream T3 server: the Model endpoints section says "Needs a Loom server". Endpoint
  instances created earlier are plain Claude instances and keep working there.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): RPC group `loom.more-providers.*`, capability `more-providers`.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): the "Model endpoints" section.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): "Add model endpoint".

`ext-providers` was needed only for the retired ACP and Copilot drivers.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L16 is present, its decorator leaves endpoint instances alone (it skips every Claude
  instance that sets `ANTHROPIC_BASE_URL`), so they show no sign-in.
- If L22 (instruction modes) is present, its per-turn instructions reach endpoint instances
  too, because they are Claude instances and go through upstream's `ProviderService.sendTurn`.

## Size estimate

Medium: about 1,000 lines including tests (server probe, model listing and skills link 400,
web dialog and section 500, tests 100+). It delivers the "DeepSeek native" goal on its own.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md, then this
folder: PRODUCT, RESEARCH, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING, REFERENCES. Do not put real API keys in tests or fixtures.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why.
- [RESEARCH.md](./RESEARCH.md): harness options per target and the recommendation.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
