# L17 product

## Problem

Kyle wants to use models beyond his Codex and Claude subscriptions: DeepSeek on its own API,
local models through Ollama or LM Studio, GitHub Copilot, and agents that speak the Agent
Client Protocol. Upstream T3 Code can already reach some of these (OpenCode, Claude routers),
but only after hand-editing environment variables and custom model ids per instance, and it
has no Copilot or generic ACP provider. Old Loom had Gemini, Copilot, ACP registry and
OpenAI-endpoint drivers; its endpoint drivers were chat-only and could not edit files.

## What the user can do

- Add a model endpoint from a preset (DeepSeek, Ollama, LM Studio, Other Anthropic-compatible):
  enter a key if the endpoint needs one, test it, pick models, and get a provider instance
  that behaves like Claude but runs those models, with files, commands and approvals as usual.
- Refresh an endpoint instance's model list later.
- Add GitHub Copilot CLI as a provider and chat with it in any project.
- Add Gemini CLI as a provider (for Code Assist Standard or Enterprise accounts).
- Add any ACP agent by giving its command, arguments and environment variables.
- Pick these providers in the model picker, see their status, approve their tool calls,
  interrupt them, and continue their threads after a restart when the agent supports it.

## Entry points

| Where                                    | What                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Settings > Loom > Model endpoints        | List of endpoint instances (derived from provider instances this packet created) and **Add endpoint**.                     |
| Settings > Providers > Add provider      | "GitHub Copilot CLI", "Gemini CLI" and "ACP agent" appear after upstream's drivers (via `ext-providers`).                  |
| Settings > Providers, an instance editor | The generic settings form for the fork drivers; for endpoint instances, the usual Claude form plus a "Refresh models" row. |
| Model picker in the composer             | The new instances, like any provider.                                                                                      |
| Command palette                          | "Add model endpoint", "Add GitHub Copilot provider", "Add ACP agent".                                                      |
| Keybinding                               | None.                                                                                                                      |

Ways out: an endpoint instance is removed or disabled in the provider editor like any
instance (Model endpoints lists it with **Open in Providers**). ACP instances are removed the
same way. Model list refresh can be repeated. The endpoint test can be rerun from the editor.

## Flows

### Add a model endpoint

1. Settings > Loom > Model endpoints > **Add endpoint**, or the palette.
2. Step 1, preset: DeepSeek, Ollama, LM Studio, Other. Each shows a one-line description:
   - DeepSeek: "DeepSeek's own API through Claude Code. Needs a DeepSeek API key."
   - Ollama: "Local models served by Ollama 0.14 or later on this environment."
   - LM Studio: "Local models served by LM Studio on this environment."
   - Other: "Any endpoint that speaks Anthropic's Messages API."
3. Step 2, connection: base URL (prefilled: `https://api.deepseek.com/anthropic`,
   `http://localhost:11434`, `http://localhost:1234`), API key (required for DeepSeek and Other
   when the endpoint needs one; Ollama and LM Studio use a placeholder token), and **Test
   connection**. The test runs on the environment: "Connected. 14 models available." or the
   error ("The endpoint did not answer within 15 seconds.", "The key was rejected (401).").
4. Step 3, models: checklist of the endpoint's models, with a default model and a "small
   model" (used by Claude Code for background work). Name (default "DeepSeek") and color.
5. **Create**: Loom creates a Claude instance with its own config folder
   (`~/.claude_deepseek`), sets the environment variables, adds the chosen models as custom
   models, and opens it in the model picker's list. A toast: "DeepSeek is ready. Pick it in
   the model picker."

### Add GitHub Copilot, Gemini CLI or an ACP agent

Through upstream's **Add provider** dialog. Copilot and Gemini forms have Binary path and
Launch arguments (defaults shown as placeholders); ACP agent has Command, Arguments (one per
line), Working directory policy (project folder), and the usual Environment variables. After
saving, the status row shows one of:

- "Ready" with the agent's reported name and version.
- "Not signed in. Sign in with the Copilot CLI on this environment, then refresh." (or the
  Gemini or generic equivalent, taken from the agent's advertised auth methods).
- "Copilot CLI not found. Install it on this environment or set its path."

### Use it in a thread

Same as any provider: pick the instance in the model picker, send. Tool calls appear in the
work log, approvals in the approval panel, plans in the plan panel when the agent sends ACP
plan updates. Model selection lists the models the agent advertises (ACP session models or a
"model" config option); when it advertises none, the picker shows a single "Agent default".

## States

- Endpoint dialog: idle, testing ("Testing connection."), test failed (message and **Try
  again**), creating, done.
- Model endpoints section: empty ("No model endpoints yet. Add one to use DeepSeek, Ollama or
  LM Studio models."), list, error loading settings, upstream server ("Needs a Loom server").
- ACP driver status: pending ("Checking Copilot CLI."), ready, not installed, not signed in,
  error (agent crashed during initialize, with the first stderr line when it has no secrets).
- In a thread: agent without `session/load` support: after a server restart the next message
  starts a new agent session, and the thread's work log shows "This agent cannot resume its
  earlier session; it starts fresh." Replaying history into a fresh session is out of scope.

## Surfaces and connection modes

Web and desktop supported. No mobile UI; threads on these providers still work from the
upstream mobile app. Remote works in every mode because endpoint calls and agents run on the
environment. On an upstream server the Model endpoints section explains itself and the fork
drivers are absent (their settings entries appear as unavailable providers there, and come
back when Loom runs again).

## Decisions and open questions

Decisions:

- No fork-owned agent loop. Endpoints ride Claude Code; agents ride ACP (RESEARCH.md).
- Fork driver kinds are `loomCopilot`, `loomGemini` and `loomAcp`, not upstream's reserved
  "coming soon" kinds (`githubCopilot`, `gemini`, `acpRegistry`), so a future upstream driver
  cannot misread a fork instance's config.
- Endpoint instances are ordinary Claude instances. They survive rollbacks to upstream and are
  editable in the normal provider editor. The fork only remembers which instances it created
  (for the Model endpoints list) in a fork table.
- Gemini CLI is last in priority: Google moved individual users to Antigravity, which upstream
  supports.

Open questions for Kyle:

1. Is a Claude-based DeepSeek instance acceptable as "DeepSeek native", or do you want a
   second path through OpenCode as a preset too (it would write OpenCode's own config file)?
2. Should endpoint instances share your main Claude skills folder (symlink, like your
   `~/.claude_N` accounts) or start with none?
3. Copilot: do you use Copilot CLI's own login or a token? That decides whether the status
   row suggests `copilot` login or a `GH_TOKEN` environment variable.
4. Keep Gemini CLI at all, given the Antigravity transition?
