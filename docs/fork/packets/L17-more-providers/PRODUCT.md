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
- Choose whether an endpoint instance shares your Claude skills (on for cloud endpoints, off
  for local models), and change it later per instance.
- Refresh an endpoint instance's model list later.
- Add any ACP agent by giving its command, arguments and environment variables. Gemini CLI
  (for Code Assist Standard or Enterprise accounts) is one: command `gemini`, argument
  `--acp`.
- Add GitHub Copilot CLI as a provider and chat with it in any project.
- Pick these providers in the model picker, see their status, approve their tool calls,
  interrupt them, and continue their threads after a restart when the agent supports it.

## Entry points

| Where                                    | What                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings > Loom > Model endpoints        | List of endpoint instances (derived from provider instances this packet created) with a "Share Claude skills" switch each, and **Add endpoint**. |
| Settings > Providers > Add provider      | "ACP agent" and "GitHub Copilot CLI" appear after upstream's drivers (via `ext-providers`).                                                      |
| Settings > Providers, an instance editor | The generic settings form for the fork drivers; for endpoint instances, the usual Claude form plus a "Refresh models" row.                       |
| Model picker in the composer             | The new instances, like any provider.                                                                                                            |
| Command palette                          | "Add model endpoint", "Add ACP agent", "Add GitHub Copilot provider".                                                                            |
| Keybinding                               | None.                                                                                                                                            |

Ways out: an endpoint instance is removed or disabled in the provider editor like any
instance (Model endpoints lists it with **Open in Providers**). ACP instances are removed the
same way. Model list refresh can be repeated. The endpoint test can be rerun from the editor.
The skills switch turns sharing on and off again (off removes only Loom's symlink, never a
real folder).

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
   Switch "Share my Claude skills": on for DeepSeek and Other, off for Ollama and LM Studio.
   Description: "Links this endpoint's skills folder to your main Claude skills. Local
   models often handle long skill lists poorly."
5. **Create**: Loom creates a Claude instance with its own config folder
   (`~/.claude_deepseek`), links its `skills` folder when the switch is on, sets the
   environment variables, adds the chosen models as custom models, and opens it in the model
   picker's list. A toast: "DeepSeek is ready. Pick it in the model picker."

### Add an ACP agent (for example Gemini CLI) or GitHub Copilot

Through upstream's **Add provider** dialog. ACP agent has Command, Arguments (one per line),
Display hint (for example "Gemini CLI"), and the usual Environment variables; it runs in the
project folder. Its Command description reads: "The agent's command on this environment, for
example `gemini` with the argument `--acp` for Gemini CLI." The Copilot form has Binary path
and Launch arguments (defaults shown as placeholders). After saving, the status row shows
one of:

- "Ready" with the agent's reported name and version.
- Copilot signed out: "Not signed in. Run `copilot` on this environment and sign in with its
  login command, then refresh. Or add a `GH_TOKEN` environment variable to this provider."
- Custom agent signed out: "Not signed in. Sign in with this agent's own command on this
  environment, then refresh." plus the agent's advertised auth method names when it sends
  them.
- "Copilot CLI not found. Install it on this environment or set its path." (custom agent:
  "`<command>` was not found on this environment.")

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
- Endpoint skills switch: linked, not linked, "This endpoint has its own skills folder; Loom
  leaves it alone." (a real folder exists), "Your main Claude skills folder was not found."
  (nothing to link).
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

## Decisions

- No fork-owned agent loop. Endpoints ride Claude Code; agents ride ACP (RESEARCH.md).
- DeepSeek is a Claude-based instance only (DeepSeek's Anthropic-compatible API); there is no
  OpenCode preset. It stays a documented, tested preset; Kyle is not setting it up now.
- Endpoint skills: cloud endpoints (DeepSeek, Other) share the main Claude skills folder
  through a `skills` symlink, like Kyle's `~/.claude_N` accounts; local models (Ollama,
  LM Studio) start with none. Each endpoint instance has its own switch.
- Fork driver kinds are `loomAcp` and `loomCopilot`, not upstream's reserved "coming soon"
  kinds (`githubCopilot`, `acpRegistry`), so a future upstream driver cannot misread a fork
  instance's config.
- No dedicated Gemini driver. Google stopped serving Gemini CLI to individual accounts on
  2026-06-18 and upstream supports Antigravity; Gemini CLI is reachable through the generic
  custom ACP agent option (`gemini --acp`).
- Copilot is built last (Kyle does not use it). Its signed-out status suggests the Copilot
  CLI's own login first, with `GH_TOKEN` as the alternative.
- Endpoint instances are ordinary Claude instances. They survive rollbacks to upstream and are
  editable in the normal provider editor. The fork only remembers which instances it created
  (for the Model endpoints list) in a fork table.
