# L17 product

## Problem

Kyle wants to use models beyond his Codex and Claude subscriptions: DeepSeek on its own API
and local models through Ollama or LM Studio. Upstream T3 Code can already reach these
(OpenCode, Claude routers), but only after hand-editing environment variables and custom
model ids per instance. Old Loom had OpenAI-endpoint drivers, but they were chat-only and
could not edit files.

GitHub Copilot and other Agent Client Protocol agents were part of this packet until Kyle
approved retiring them on 2026-10-09: upstream's ACP Registry covers them (README, "Retired
parts").

## What the user can do

- Add a model endpoint from a preset (DeepSeek, Ollama, LM Studio, Other Anthropic-compatible):
  enter a key if the endpoint needs one, test it, pick models, and get a provider instance
  that behaves like Claude but runs those models, with files, commands and approvals as usual.
- Choose whether an endpoint instance shares your Claude skills (on for cloud endpoints, off
  for local models), and change it later per instance.
- Refresh an endpoint instance's model list later.
- Pick endpoint instances in the model picker and use them like any Claude instance.

## Entry points

| Where                                    | What                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings > Loom > Model endpoints        | List of endpoint instances (derived from provider instances this packet created) with **Refresh models** and a "Share Claude skills" switch each, and **Add endpoint**. |
| Settings > Providers, an instance editor | Endpoint instances use the usual Claude form (refresh models from Settings > Loom > Model endpoints).                                                                   |
| Model picker in the composer             | The new instances, like any provider.                                                                                                                                   |
| Command palette                          | "Add model endpoint".                                                                                                                                                   |
| Keybinding                               | None.                                                                                                                                                                   |

Ways out: an endpoint instance is removed or disabled in the provider editor like any
instance (Model endpoints lists it with **Open in Providers**). Model list refresh can be
repeated. The endpoint test reruns with **Refresh models** on its Model endpoints row. The
skills switch turns sharing on and off again (off removes only Loom's symlink, never a real
folder).

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

### Use it in a thread

Same as any Claude instance: pick the endpoint instance in the model picker, send. Tool
calls, approvals and plans work as they do for Claude, because Claude Code is the agent.

## States

- Endpoint dialog: idle, testing ("Testing connection."), test failed (message and **Try
  again**), creating, done.
- Model endpoints section: empty ("No model endpoints yet. Add one to use DeepSeek, Ollama or
  LM Studio models."), list, error loading settings, upstream server ("Needs a Loom server").
- Endpoint skills switch: linked, not linked, "This endpoint has its own skills folder; Loom
  leaves it alone." (a real folder exists), "Your main Claude skills folder was not found."
  (nothing to link).

## Surfaces and connection modes

Web and desktop supported. No mobile UI; threads on endpoint instances still work from the
upstream mobile app. Remote works in every mode because endpoint calls run on the
environment. On an upstream server the Model endpoints section explains itself, and endpoint
instances keep working because they are plain Claude instances.

## Decisions

- No fork-owned agent loop. Endpoints ride Claude Code (RESEARCH.md).
- DeepSeek is a Claude-based instance only (DeepSeek's Anthropic-compatible API); there is no
  OpenCode preset. It stays a documented, tested preset; Kyle is not setting it up now.
- Endpoint skills: cloud endpoints (DeepSeek, Other) share the main Claude skills folder
  through a `skills` symlink, like Kyle's `~/.claude_N` accounts; local models (Ollama,
  LM Studio) start with none. Each endpoint instance has its own switch.
- ACP agents (Gemini CLI among them) and GitHub Copilot: retired by Kyle on 2026-10-09.
  Upstream's ACP Registry includes Copilot and Gemini and accepts custom ACP commands.
- Endpoint instances are ordinary Claude instances. They survive rollbacks to upstream and are
  editable in the normal provider editor. The fork only remembers which instances it created
  (for the Model endpoints list) in a fork table.
