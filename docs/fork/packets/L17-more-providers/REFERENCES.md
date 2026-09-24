# L17 references

## Old Loom

Selection F6 in [selections.md](../../selections.md). `bagelvault/loom` at `a79ec506`.

| File                                                                                                                                                                                                                                                                                                                | LOC        | Keep / adapt / drop                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/server/src/provider/acp/GeminiAcpSupport.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/acp/GeminiAcpSupport.ts)                                                                                                                                                               | 103        | Reference only: there is no Gemini driver. Useful if `gemini --acp` under `loomAcp` needs a hint about auth method choice or model ids.                                                             |
| [apps/server/src/provider/acp/GitHubCopilotAcpSupport.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/acp/GitHubCopilotAcpSupport.ts)                                                                                                                                                 | 100        | Adapt: spawn shape (`--acp --stdio` then; verify), auth method `copilot-login`.                                                                                                                     |
| [apps/server/src/provider/Layers/GeminiAdapter.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/GeminiAdapter.ts), [GitHubCopilotAdapter.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/GitHubCopilotAdapter.ts)                          | 982 each   | Drop: two near-identical adapters are what the generic adapter replaces.                                                                                                                            |
| [apps/server/src/provider/Drivers/AcpRegistryDriver.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Drivers/AcpRegistryDriver.ts), [acp/AcpRegistryCatalog.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/acp/AcpRegistryCatalog.ts)                   | 220, 603   | Drop for v1 (binary download and checksum cache). Its schema predates the public registry format; use the registry's `FORMAT.md` when the browser follow-up happens.                                |
| [apps/server/src/provider/Layers/OpenAiResponsesAdapter.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Layers/OpenAiResponsesAdapter.ts), [Drivers/ModelEndpointDriver.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/provider/Drivers/ModelEndpointDriver.ts) | 384, 1,486 | Drop: chat-only (a message array and streamed text, no tool loop).                                                                                                                                  |
| [.ledger/entries/0955-complete-p36-gemini-copilot-provider-drivers.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0955-complete-p36-gemini-copilot-provider-drivers.md)                                                                                                                       |            | Keep the invariants: opt-in, disabled by default, shared ACP translators, text generation with no filesystem or terminal capability. Its note: Copilot was never run for real.                      |
| [.ledger/entries/0183-ph13-model-endpoint-chat-routing.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0183-ph13-model-endpoint-chat-routing.md)                                                                                                                                               |            | Keep the idea (endpoint records projected into provider instances, secrets only server-side). Drop the Model Lab and Secret Vault machinery; upstream's sensitive environment variables replace it. |

## Upstream T3 Code

- `apps/server/src/provider/ProviderDriver.ts:67-173` (driver SPI), `builtInDrivers.ts`.
- `apps/server/src/provider/Drivers/GrokDriver.ts:59-157` (smallest ACP driver to follow).
- `apps/server/src/provider/Layers/CursorAdapter.ts` (1,256 lines; the adapter to derive from),
  `:543-575` (MCP server wiring).
- `apps/server/src/provider/acp/AcpSessionRuntime.ts:72-113,1085`,
  `AcpCoreRuntimeEvents.ts:68-234`, `AcpAdapterSupport.ts:17,46`,
  `AcpRuntimeModel.ts:138,645`, `CursorAcpSupport.ts:49-104`.
- `apps/server/src/provider/providerSnapshot.ts:200` (`buildServerProvider`),
  `providerMaintenance.ts:189`, `makeManagedServerProvider.ts:39`.
- `apps/server/src/mcp/McpProviderSession.ts:21-47`.
- `apps/server/src/serverSettings.ts:153-165` (client redaction), `655-690` (server-side
  secret materialization), `751-808` (update keeps redacted values).
- `packages/contracts/src/providerInstance.ts` (open driver kinds, opaque config),
  `packages/contracts/src/settings.ts:497-555` (settings form annotations).
- `apps/web/src/components/settings/providerDriverMeta.ts`,
  `AddProviderInstanceDialog.tsx:65,73-94,195-208`, `apps/web/src/components/Icons.tsx:738,749`.
- `docs/internals/providers.md` (instances, health checks without side effects, `once`
  approvals), `docs/user/providers-claude.md` ("OpenRouter", "Other routers"),
  `docs/user/providers-opencode.md`.

## External

- DeepSeek, Anthropic API: https://api-docs.deepseek.com/guides/anthropic_api/ (base URL
  `https://api.deepseek.com/anthropic`, Claude Code setup). DeepSeek also documents Copilot
  CLI: https://api-docs.deepseek.com/quick_start/agent_integrations/copilot_cli/
- Ollama, Anthropic compatibility: https://docs.ollama.com/api/anthropic-compatibility and
  https://ollama.com/blog/claude (0.14.0+, `ANTHROPIC_BASE_URL=http://localhost:11434`,
  32K+ context advised); known hang on `count_tokens`: https://github.com/ollama/ollama/issues/13949
- LM Studio Anthropic compatibility: reported in community guides
  (https://gist.github.com/renezander030/39249215616a095d74fe6c66b0348641); unverified.
- Google, Gemini CLI to Antigravity CLI transition:
  https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
- ACP registry format: https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md
  (Apache-2.0 repository; format only, no code reused).
- withastro/flue, https://github.com/withastro/flue, Apache-2.0: agent framework on
  pi-agent-core with read/write/edit/bash/grep/glob tools (`packages/runtime/src/agent.ts`).
  Not used.
- block/buzz, https://github.com/block/buzz, Apache-2.0: `crates/buzz-agent/README.md`
  ("Non-streaming. No persistence."), `loadSession: false`, tools only via MCP. Not used.
- Local CLI checks at writing time: Copilot CLI 1.0.88 (`copilot --help` lists `--acp`),
  Gemini CLI 0.46.0 (`--acp`; `--experimental-acp` deprecated).
