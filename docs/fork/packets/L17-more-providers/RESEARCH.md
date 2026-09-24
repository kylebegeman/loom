# L17 research: which harness for which target

T3 Code providers are agent harnesses. A provider instance runs an agent that owns the tool
loop (read, edit, run commands), approvals, streaming, resume and compaction; T3 only
adapts its protocol (`docs/internals/providers.md`). A raw model API (chat completions,
Messages) has none of that. So the question for every target is: which existing harness can
already drive this model, and how much fork code does connecting it take?

## Summary

| Target                        | Recommended path                                                                     | Fork code                     | Confidence                       |
| ----------------------------- | ------------------------------------------------------------------------------------ | ----------------------------- | -------------------------------- |
| DeepSeek (native API)         | Claude Code instance with `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`    | Preset dialog only            | High (vendor doc)                |
| Ollama                        | Claude Code instance with `ANTHROPIC_BASE_URL=http://localhost:11434` (Ollama 0.14+) | Preset dialog only            | High (vendor doc), one known bug |
| LM Studio                     | Same, if its Anthropic-compatible endpoint works; else OpenCode                      | Preset dialog only            | Medium: verify                   |
| Other Anthropic-compatible    | Same, "Other" preset                                                                 | Preset dialog only            | High                             |
| OpenAI-compatible only        | Upstream OpenCode driver (configures OpenAI-compatible providers natively)           | None (docs link)              | High                             |
| GitHub Copilot CLI            | Fork ACP driver `loomCopilot` (`copilot --acp`)                                      | Generic ACP adapter + profile | Medium: verify flags and auth    |
| Gemini CLI                    | Fork ACP driver `loomGemini` (`gemini --acp`), low priority                          | Profile on the same adapter   | Medium                           |
| Any ACP agent                 | Fork ACP driver `loomAcp` with a user-supplied command                               | Profile on the same adapter   | Medium                           |
| Raw model API with no harness | Not supported                                                                        | None                          | Decision                         |

## DeepSeek

DeepSeek serves an Anthropic-compatible API at `https://api.deepseek.com/anthropic` and
documents using Claude Code with it (`ANTHROPIC_BASE_URL` plus the DeepSeek key). Claude Code
then drives DeepSeek models with its full tool loop, and Loom already runs Claude Code with
per-instance config directories and environment variables. Upstream's own Claude doc shows the
same arrangement for OpenRouter (`docs/user/providers-claude.md`, "OpenRouter" and "Other
routers"): separate config dir, endpoint variables, and "Add custom model" for model ids.

So "DeepSeek native" means a first-class preset that does the setup right: new config
directory (so a cached Anthropic login cannot collide with the key), `ANTHROPIC_BASE_URL`,
`ANTHROPIC_AUTH_TOKEN` (sensitive) and an explicitly empty `ANTHROPIC_API_KEY` (upstream's
OpenRouter recipe), the model list fetched from the endpoint, and Claude Code's alias
variables (`ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`,
`ANTHROPIC_DEFAULT_OPUS_MODEL`) set to endpoint models so background work Claude Code does
with its small model also goes to DeepSeek. The alias variable names come from upstream's
Claude doc; confirm the exact set against Claude Code's documentation during implementation.

Caveats: compatibility is partial (DeepSeek documents which request fields it supports);
images and some thinking options may not work; usage limits and account info from Claude
Code's SDK probe will not mean anything. The instance's status may read "warning" rather
than "ready"; that is acceptable if turns work.

Alternative: OpenCode supports DeepSeek natively. Upstream supports OpenCode, so a user can
choose it today; the preset is simply the faster path for Kyle, who already runs Claude Code.

## Ollama and LM Studio

Ollama 0.14.0 and later implement Anthropic's Messages API. Its documentation and blog show
Claude Code with `ANTHROPIC_BASE_URL=http://localhost:11434`, `ANTHROPIC_AUTH_TOKEN=ollama`
(ignored) and an empty `ANTHROPIC_API_KEY`, and recommend models with at least 32K context.
A reported issue (ollama/ollama#13949) says Ollama could hang on
`/v1/messages/count_tokens`; the preset's endpoint test sends a tiny Messages request and
warns when the server does not answer within 15 seconds.

Model list: Ollama's `/api/tags` (native) and `/v1/models` (OpenAI-compatible). LM Studio
exposes `/v1/models`. LM Studio's Anthropic-compatible endpoint is reported by community
guides but was not verified for this packet; the preset's test decides at runtime and
suggests OpenCode when the Messages call fails.

Remote: the endpoint is reached from the environment's machine. An Ollama running on Kyle's
Mac serves threads Kyle drives from his phone.

## GitHub Copilot CLI

Copilot CLI 1.0.88 (installed locally) lists `--acp` ("Start as Agent Client Protocol
server"). Old Loom launched it as `copilot --acp --stdio`; the local help does not list
`--stdio`, so the driver starts with `--acp` and the implementing agent checks whether stdio
is the default. Authentication belongs to the CLI (its own login, or a GitHub token in the
environment); the driver reports "Sign in with the Copilot CLI on this environment" when ACP
`initialize` or `session/new` asks for authentication. Copilot also supports custom model
providers ("BYOK") and DeepSeek documents a Copilot CLI integration, so Copilot is a second
route to endpoint models for users who prefer it.

## Gemini CLI

Google stopped serving Gemini CLI for individual accounts (free, Google AI Pro and Ultra) on
June 18, 2026, in favor of Antigravity CLI, which upstream T3 already supports with in-app
sign-in. Gemini CLI still serves Gemini Code Assist Standard and Enterprise licenses and
keeps `--acp` (Gemini CLI 0.46.0 installed locally). The `loomGemini` profile costs little on
the shared ACP adapter, so it stays in scope but last in order, and its settings copy points
individual users to Antigravity.

## Generic ACP agents and the registry

ACP's public registry (`agentclientprotocol/registry`, `FORMAT.md`) describes each agent with
`id`, `name`, `version`, `description`, `repository`, `license`, `icon` and a `distribution`
object: `binary` (per platform `darwin-aarch64`, `linux-x86_64`, ... with `archive`,
`sha256`, `cmd`, `args`, `env`), `npx` (`package`, `args`, `env`) or `uvx`. The aggregated
`registry.json` location was not confirmed. Old Loom downloaded and checksum-verified
binaries into its home; that is a lot of supply-chain surface for a first version. The
`loomAcp` driver instead runs a command the user supplies (which may be `npx <package>`), and
a registry browser that pre-fills the command is a follow-up.

## Building our own agent loop (rejected for now)

- **withastro/flue** (Apache-2.0) is a TypeScript agent framework on
  `@earendil-works/pi-agent-core` and `pi-ai`, with built-in `read`, `write`, `edit`, `bash`,
  `grep` and `glob` tools (`packages/runtime/src/agent.ts:102-584`), sessions, compaction,
  MCP and many model providers. It is a framework for authoring and deploying agents, with
  its own runtime, sandbox and persistence. Embedding it as a T3 provider would mean mapping
  its session model to T3's runtime events, building approvals, resume and rollback on top,
  and taking a large new dependency tree into the server. That is a new product, not an
  adapter.
- **block/buzz `buzz-agent`** (Apache-2.0) is an ACP agent over Anthropic or
  OpenAI-compatible APIs, but by its own README "Non-streaming. No persistence.", it
  advertises `loadSession: false`, and it has no built-in file tools: all tools come from MCP
  servers (`crates/buzz-agent/README.md`). It could still run under `loomAcp` as a custom
  command for experiments.
- **Old Loom's `OpenAiResponsesAdapter` and `ModelEndpointDriver`** were chat-only: they kept
  a message array and streamed text, with no tool loop.

Revisit only if Kyle needs a model that has neither an Anthropic-compatible endpoint nor
OpenCode support. The likely answer then is running pi's own coding agent over ACP under
`loomAcp`, not a fork-owned loop.
