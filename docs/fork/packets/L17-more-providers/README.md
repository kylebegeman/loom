# L17: More providers

Status: Ready to build.

Bring more models and agents into Loom without building a coding agent of our own. Two
parts. **Model endpoints** turns DeepSeek, Ollama, LM Studio and any other
Anthropic-compatible endpoint into a ready-to-use Claude provider instance in one dialog:
Claude Code stays the agent (tools, approvals, resume, compaction) and only the model behind
it changes. **ACP agents** adds provider drivers for agents that speak the Agent Client
Protocol: any custom ACP command (Gemini CLI included, as `gemini --acp`) and, last in the
build order, GitHub Copilot CLI, both on one fork-owned generic ACP adapter built on
upstream's ACP runtime.

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
    DeepSeek is a documented, tested preset; Kyle is not setting it up now.
  - Skills for endpoint instances: cloud presets (DeepSeek, Other) share the main Claude
    skills folder through a `skills` symlink, like Kyle's `~/.claude_N` accounts; local
    presets (Ollama, LM Studio) start with none. A per-instance switch in Model endpoints
    changes it later.
  - A fork ACP driver factory and two drivers on it: `loomAcp` (custom command, arguments
    and environment; also the route for Gemini CLI with `gemini --acp`) and, last,
    `loomCopilot` (`copilot --acp`). Streaming, tool calls, approvals, plan updates, model
    selection when the agent offers it, session resume when the agent supports
    `session/load`, the `t3-code` MCP server, and interrupt.
  - Settings forms, icons and provider status for the two drivers, through the
    `ext-providers` extension point. Copilot's signed-out status suggests the Copilot CLI's
    own login first and a `GH_TOKEN` environment variable as the alternative.
- Out:
  - A fork-owned agent loop over raw chat-completions APIs (withastro/flue, pi-agent-core, or
    old Loom's `OpenAiResponsesAdapter`). Rejected for now; RESEARCH.md says when to revisit.
  - OpenAI-compatible endpoints that have no Anthropic-compatible API. Use upstream's OpenCode
    driver, which configures such providers natively; this packet's docs link to it.
  - A dedicated Gemini CLI driver (`loomGemini`): dropped. Google stopped serving Gemini CLI
    to individual accounts on 2026-06-18 and upstream supports Antigravity; Gemini CLI stays
    reachable as a custom ACP agent (`gemini --acp`).
  - An OpenCode preset for DeepSeek: declined by Kyle; DeepSeek is a Claude-based preset
    only.
  - Follow-up: an ACP registry browser that fills in `npx`/`uvx` commands. Downloading
    agent binaries from the registry stays out (supply-chain surface); the custom driver
    runs a command the user already has.
  - Text generation (titles, commit messages) with the ACP drivers: they report
    `supportsTextGeneration: false` in v1.
  - In-app sign-in for Copilot or custom ACP agents (their CLIs own login; the
    `ext-providers` setup slot could host it later).
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
- `ext-providers` ([EXTENSION-POINTS.md, section 15](../EXTENSION-POINTS.md#15-provider-drivers-ext-providers)): the two drivers, their settings forms and icons.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): the "Model endpoints" section.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): "Add model endpoint", "Add ACP agent", "Add GitHub Copilot provider".

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L16 is present, its decorator leaves endpoint instances alone (it skips every Claude
  instance that sets `ANTHROPIC_BASE_URL`), so they show no sign-in. L17 could later register
  a Copilot sign-in section in the same setup slot.
- If L22 (instruction modes) is present, its per-turn instructions reach these drivers too,
  because they go through upstream's `ProviderService.sendTurn`.

## Size estimate

Large: about 3,400 to 4,300 lines including tests. Model endpoints about 1,000 (server probe,
model listing and skills link 400, web dialog and section 500, tests 100+). Generic ACP
adapter about 1,600, two driver profiles 200, snapshots and settings 450, tests 750.

Phase A (model endpoints) ships alone and delivers the "DeepSeek native" goal. Phase B (the
generic ACP driver `loomAcp`) is independent of phase A. Phase C (Copilot) comes last and
only adds a profile, a client definition and a palette item on top of phase B.

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
