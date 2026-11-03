import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  VaultConnectionError,
  VaultError,
  VaultGitHubError,
  VaultSshError,
  VaultWorkloadError,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpSchema, McpServer, Toolkit } from "effect/ai";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { layerInProcessMcpServer, toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { VaultSshToolkit } from "./ssh-mcp.ts";
import { VaultGitHubToolkit } from "./github-mcp.ts";
import { decodeVaultTerminalError } from "./terminal-errors.ts";

const toolkit = Toolkit.make(
  VaultSshToolkit.tools.loom_vault_ssh_agent_open,
  VaultGitHubToolkit.tools.loom_vault_github_exec,
);
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "vault-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vault-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

// The in-process server needs a caller; these tools only read, so its access is unused.
const invocation = McpInvocationContext.of({
  environmentId: EnvironmentId.make("vault-test"),
  capabilities: new Set(),
  issuedAt: 0,
  requestNamespace: "test",
  thread: undefined,
  client: { sessionId: "test", label: "Test", access: "full-access" },
});

it.effect.each([
  new VaultConnectionError({ state: "ambiguous", choices: [], repair: "select-connection" }),
  new VaultWorkloadError({ reason: "not-configured" }),
  new VaultSshError({ reason: "untrusted-host" }),
  new VaultError({ reason: "locked" }),
  new VaultError({ reason: "denied", detail: "workload-inactive" }),
])("retains %s through production MCP serialization and terminal decoding", (failure) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "loom_vault_ssh_agent_open",
        arguments: { connection: { resource: "personal-vps" } },
      })
      .pipe(
        Effect.provideService(McpSchema.McpServerClient, client),
        Effect.provideService(McpInvocationContext, invocation),
      );
    expect(result.isError).toBe(true);
    // Agents read the text, so it carries the cause and repair, not only the tags.
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: "text", text: expect.stringContaining(failure.message) }),
    );
    const decoded = decodeVaultTerminalError(result);
    expect(Option.isSome(decoded)).toBe(true);
    if (Option.isSome(decoded)) expect(decoded.value).toEqual(failure);
  }).pipe(
    Effect.provide(
      toolkitRegistration(
        toolkit,
        McpToolAccess.toLayer(toolkit, {
          loom_vault_ssh_agent_open: McpToolAccess.reads(() => Effect.fail(failure)),
          loom_vault_github_exec: McpToolAccess.reads(() =>
            Effect.fail(new VaultGitHubError({ reason: "unauthorized" })),
          ),
        }),
      ).pipe(
        Layer.provideMerge(layerInProcessMcpServer),
        Layer.provide(NodeCrypto.layer),
        Layer.provide(Layer.mock(ThreadManagementService)({})),
      ),
    ),
    Effect.scoped,
  ),
);

it.effect("distinguishes upstream GitHub refusal through production MCP serialization", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "loom_vault_github_exec",
        arguments: {
          connection: { resource: "loom/example" },
          repository: "loom/example",
          command: { tool: "gh", argv: ["repo", "view"] },
        },
      })
      .pipe(
        Effect.provideService(McpSchema.McpServerClient, client),
        Effect.provideService(McpInvocationContext, invocation),
      );
    expect(result.isError).toBe(true);
    const decoded = decodeVaultTerminalError(result);
    expect(Option.isSome(decoded)).toBe(true);
    if (Option.isSome(decoded))
      expect(decoded.value).toEqual(new VaultGitHubError({ reason: "unauthorized" }));
  }).pipe(
    Effect.provide(
      toolkitRegistration(
        toolkit,
        McpToolAccess.toLayer(toolkit, {
          loom_vault_ssh_agent_open: McpToolAccess.reads(() =>
            Effect.fail(new VaultError({ reason: "denied" })),
          ),
          loom_vault_github_exec: McpToolAccess.reads(() =>
            Effect.fail(new VaultGitHubError({ reason: "unauthorized" })),
          ),
        }),
      ).pipe(
        Layer.provideMerge(layerInProcessMcpServer),
        Layer.provide(NodeCrypto.layer),
        Layer.provide(Layer.mock(ThreadManagementService)({})),
      ),
    ),
    Effect.scoped,
  ),
);
