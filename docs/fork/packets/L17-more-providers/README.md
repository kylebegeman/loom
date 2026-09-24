# L17: More providers

Status: Not started.

Bring more models and agents into Loom without building a coding agent of our own. Two
parts. **Model endpoints** turns DeepSeek, Ollama, LM Studio and any other
Anthropic-compatible endpoint into a ready-to-use Claude provider instance in one dialog:
Claude Code stays the agent (tools, approvals, resume, compaction) and only the model behind
it changes. **ACP agents** adds provider drivers for agents that speak the Agent Client
Protocol: GitHub Copilot CLI, Gemini CLI for the accounts Google still serves, and any custom
ACP command, all on one fork-owned generic ACP adapter built on upstream's ACP runtime.

The key question from the brief, "providers in T3 are agent harnesses; raw model APIs need an
agent loop", is answered in [RESEARCH.md](./RESEARCH.md): for every target there is an
existing harness that already speaks to it natively, so this packet adds no agent loop.

## Scope

- In:
  - Settings > Loom > **Model endpoints**: presets for DeepSeek, Ollama, LM Studio and
    "Other Anthropic-compatible endpoint". The dialog tests the endpoint from the environment,
    lists its models, and creates a Claude instance with its own `CLAUDE_CONFIG_DIR`, the
    endpoint's environment variables (key stored as a sensitive variable) and the chosen
    models as custom models. Edit and remove go through the normal provider editor.
  - A fork ACP driver factory and three drivers on it: `loomCopilot` (`copilot --acp`),
    `loomGemini` (`gemini --acp`) and `loomAcp` (custom command, arguments and environment).
    Streaming, tool calls, approvals, plan updates, model selection when the agent offers it,
    session resume when the agent supports `session/load`, the `t3-code` MCP server, and
    interrupt.
  - Settings forms, icons and provider status for the three drivers, through the
    `ext-providers` extension point.
- Out:
  - A fork-owned agent loop over raw chat-completions APIs (withastro/flue, pi-agent-core, or
    old Loom's `OpenAiResponsesAdapter`). Rejected for now; RESEARCH.md says when to revisit.
  - OpenAI-compatible endpoints that have no Anthropic-compatible API. Use upstream's OpenCode
    driver, which configures such providers natively; this packet's docs link to it.
  - Downloading agents from the ACP registry (binary archives). The custom driver runs a
    command the user already has, including `npx`/`uvx` package commands; a registry browser
    that fills in those commands is a follow-up.
  - Text generation (titles, commit messages) with the ACP drivers: they report
    `supportsTextGeneration: false` in v1.
  - In-app sign-in for Copilot or Gemini (their CLIs own login; L16's setup slot can host it
    later).
  - Mobile UI. Threads on these drivers still work from the upstream mobile app (with the
    Codex logo as their icon, see `ext-providers`, Known limits).

## Surfaces

- Web and desktop: supported (settings, model picker, threads).
- Mobile: no fork UI. Threads started elsewhere can be read and continued from the upstream
  mobile app because the server does the work.
- Remote: supported. Endpoint tests and model lists run on the environment's machine, so an
  Ollama on the server's `localhost` works from a phone.
- Upstream T3 server: the Model endpoints section says "Needs a Loom server". Fork drivers do
  not exist there; settings entries for them survive and show as unavailable providers.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): RPC group `loom.more-providers.*`, capability `more-providers`.
- `ext-providers` ([EXTENSION-POINTS.md, section 15](../EXTENSION-POINTS.md#15-provider-drivers-ext-providers)): the three drivers, their settings forms and icons.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): the "Model endpoints" section.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): "Add model endpoint", "Add Copilot provider", "Add ACP agent".

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L16 is present, nothing changes; its decorator only touches `codex` and `claudeAgent`.
  A later L16 follow-up could register a Copilot sign-in section in the same setup slot.
- If L22 (instruction modes) is present, its per-turn instructions reach these drivers too,
  because they go through upstream's `ProviderService.sendTurn`.

## Size estimate

Large: about 3,500 to 4,500 lines including tests. Model endpoints about 900 (server probe
and model listing 300, web dialog and section 500, tests 100+). Generic ACP adapter about
1,600, three driver profiles 300, snapshots and settings 500, tests 800.

Phase A (model endpoints) ships alone and delivers the "DeepSeek native" goal. Phase B (ACP
drivers) is independent of phase A.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md, then this
folder: PRODUCT, RESEARCH, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING, REFERENCES. Start with phase A. Do not put real API keys in tests or fixtures.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why.
- [RESEARCH.md](./RESEARCH.md): harness options per target and the recommendation.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
