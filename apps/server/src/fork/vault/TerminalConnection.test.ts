// @effect-diagnostics nodeBuiltinImport:off -- A synthetic loopback endpoint and real CLI child verify inherited terminal connection paths.
import * as NodeHttp from "node:http";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeProcess from "node:process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import { vaultTerminalEnvironment } from "@t3tools/provider-core/server/mcpSession";
import { readTerminalConnection } from "./TerminalConnection.ts";
const config = {
  environmentId: EnvironmentId.make("test"),
  threadId: ThreadId.make("test"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: "test-session",
  endpoint: "http://127.0.0.1:12345/mcp",
  authorizationHeader: "Bearer synthetic-only",
  browserToolsAvailable: false,
};
it.effect(
  "creates a private terminal connection, rotates it, and removes it on clear and shutdown",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let last = "";
      yield* Effect.gen(function* () {
        const sessions = yield* McpProviderSessions.McpProviderSessions;
        yield* sessions.set(config);
        const first = (yield* sessions.read(config.threadId))!;
        expect(first.terminalConnectionFile).toBeTruthy();
        const env = vaultTerminalEnvironment(first);
        expect(JSON.stringify(env)).not.toContain("synthetic-only");
        expect((yield* fs.stat(first.terminalConnectionFile!)).mode & 0o077).toBe(0);
        expect(yield* readTerminalConnection(env)).toEqual({
          endpoint: config.endpoint,
          authorization: config.authorizationHeader,
        });
        yield* sessions.set({ ...config, authorizationHeader: "Bearer rotated-only" });
        expect(yield* fs.exists(first.terminalConnectionFile!)).toBe(false);
        const second = (yield* sessions.read(config.threadId))!;
        expect(
          (yield* readTerminalConnection(vaultTerminalEnvironment(second))).authorization,
        ).toBe("Bearer rotated-only");
        yield* sessions.clear(config.threadId);
        expect(yield* fs.exists(second.terminalConnectionFile!)).toBe(false);
        yield* sessions.set(config);
        last = (yield* sessions.read(config.threadId))!.terminalConnectionFile!;
      }).pipe(Effect.provide(McpProviderSessions.layer), Effect.scoped);
      expect(yield* fs.exists(last)).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
);
it.effect(
  "rejects permissive, malformed, missing and linked connection files without using another credential",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const real = yield* fs.realPath(root),
        file = `${real}/connection`;
      const fallback = {
        LOOM_MCP_ENDPOINT: config.endpoint,
        LOOM_MCP_AUTHORIZATION: config.authorizationHeader,
      };
      const env = { ...fallback, LOOM_MCP_CONNECTION_FILE: file };
      expect(yield* readTerminalConnection(env).pipe(Effect.flip)).toMatchObject({
        _tag: "TerminalConnectionError",
      });
      yield* fs.writeFileString(
        file,
        JSON.stringify({
          protocol: 1,
          endpoint: config.endpoint,
          authorization: config.authorizationHeader,
        }),
        { mode: 0o644 },
      );
      expect(yield* readTerminalConnection(env).pipe(Effect.flip)).toMatchObject({
        _tag: "TerminalConnectionError",
      });
      yield* fs.chmod(file, 0o600);
      yield* fs.symlink(file, `${real}/link`);
      expect(
        yield* readTerminalConnection({ ...env, LOOM_MCP_CONNECTION_FILE: `${real}/link` }).pipe(
          Effect.flip,
        ),
      ).toMatchObject({ _tag: "TerminalConnectionError" });
      yield* fs.writeFileString(file, "invalid");
      expect(JSON.stringify(yield* readTerminalConnection(env).pipe(Effect.flip))).not.toContain(
        "synthetic-only",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect(
  "keeps connection families intact and clears inherited authority for a session without terminal setup",
  () =>
    Effect.gen(function* () {
      expect(
        yield* readTerminalConnection({
          LOOM_MCP_ENDPOINT: config.endpoint,
          T3_ACP_MCP_AUTHORIZATION: config.authorizationHeader,
        }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "TerminalConnectionError" });
      expect(
        yield* readTerminalConnection(vaultTerminalEnvironment(undefined)).pipe(Effect.flip),
      ).toMatchObject({ _tag: "TerminalConnectionError" });
      expect(
        yield* readTerminalConnection({
          T3_MCP_URL: config.endpoint,
          T3_MCP_BEARER_TOKEN: "synthetic-pi",
        }),
      ).toEqual({ endpoint: config.endpoint, authorization: "Bearer synthetic-pi" });
    }),
);

it.live(
  "a launched terminal calls the Vault CLI using only its session file, and fails after cleanup",
  () =>
    Effect.gen(function* () {
      let calls = 0;
      const http = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const server = NodeHttp.createServer(async (request, response) => {
            if (request.headers.authorization !== config.authorizationHeader) {
              response.writeHead(401).end();
              return;
            }
            let body = "";
            for await (const part of request) body += part;
            const message = JSON.parse(body);
            if (message.method === "notifications/initialized") {
              response.writeHead(202).end();
              return;
            }
            if (message.method === "tools/call") {
              expect(message.params.name).toBe("loom_vault_terminal_readiness");
              calls++;
            }
            response.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: message.id,
                result:
                  message.method === "initialize"
                    ? {
                        protocolVersion: "2025-06-18",
                        capabilities: {},
                        serverInfo: { name: "test", version: "1" },
                      }
                    : {
                        structuredContent: {
                          activeRun: true,
                          credentialUse: "requires-selection-and-current-grant",
                        },
                      },
              }),
            );
          });
          await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
          return server;
        }),
        (server) =>
          Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
      const address = http.address();
      if (!address || typeof address === "string") return yield* Effect.die("Missing fixture port");
      const sessions = yield* McpProviderSessions.McpProviderSessions;
      yield* sessions.set({ ...config, endpoint: `http://127.0.0.1:${address.port}/mcp` });
      const session = (yield* sessions.read(config.threadId))!;
      const env = vaultTerminalEnvironment(session);
      const entrypoint = NodeURL.fileURLToPath(new URL("../../bin.ts", import.meta.url));
      const run = () =>
        Effect.promise(
          () =>
            new Promise<{ code: number | null; stdout: string; stderr: string }>(
              (resolve, reject) => {
                const child = NodeChildProcess.spawn(
                  NodeProcess.execPath,
                  [entrypoint, "vault", "terminal-readiness"],
                  {
                    env: { PATH: "/usr/bin:/bin", NO_COLOR: "1", ...env },
                    stdio: ["ignore", "pipe", "pipe"],
                    timeout: 30000,
                  },
                );
                let stdout = "",
                  stderr = "";
                child.stdout.on("data", (part) => {
                  stdout += part;
                });
                child.stderr.on("data", (part) => {
                  stderr += part;
                });
                child.once("error", reject);
                child.once("close", (code) => resolve({ code, stdout, stderr }));
              },
            ),
        );
      const result = yield* run();
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('"activeRun":true');
      expect(result.stdout + result.stderr).not.toContain("synthetic-only");
      expect(calls).toBe(1);
      yield* sessions.clear(config.threadId);
      expect((yield* run()).code).not.toBe(0);
      expect(calls).toBe(1);
    }).pipe(
      Effect.scoped,
      Effect.provide(McpProviderSessions.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ),
);
