import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
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
import { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
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

it.effect.each([
  new VaultConnectionError({ state: "ambiguous", choices: [], repair: "select-connection" }),
  new VaultWorkloadError({ reason: "not-configured" }),
  new VaultSshError({ reason: "untrusted-host" }),
  new VaultError({ reason: "locked" }),
])("retains %s through production MCP serialization and terminal decoding", (failure) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({
        name: "loom_vault_ssh_agent_open",
        arguments: { connection: { resource: "personal-vps" } },
      })
      .pipe(Effect.provideService(McpSchema.McpServerClient, client));
    expect(result.isError).toBe(true);
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
        Layer.provideMerge(McpServer.McpServer.layer),
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
      .pipe(Effect.provideService(McpSchema.McpServerClient, client));
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
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(NodeCrypto.layer),
        Layer.provide(Layer.mock(ThreadManagementService)({})),
      ),
    ),
    Effect.scoped,
  ),
);
