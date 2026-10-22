// @effect-diagnostics nodeBuiltinImport:off -- Local MCP fixture verifies terminal output and exit-status propagation without GitHub access.
import * as NodeHttp from "node:http";
import { expect, it } from "@effect/vitest";
import {
  VaultConnectionError,
  VaultError,
  VaultGitHubError,
  type VaultConnectionChoice,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";
import { runGitHubTerminalCli } from "./terminal-cli.ts";
const server = (result: unknown) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const calls: unknown[] = [];
      const http = NodeHttp.createServer(async (request, response) => {
        expect(request.headers.authorization).toBe("Bearer synthetic-only");
        let body = "";
        for await (const chunk of request) body += chunk;
        const message = JSON.parse(body);
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        if (message.method === "tools/call") calls.push(message.params);
        response
          .writeHead(200, { "content-type": "application/json", "mcp-session-id": "synthetic" })
          .end(
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
                  : result,
            }),
          );
      });
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const address = http.address();
      if (!address || typeof address === "string") throw new Error("Missing test port");
      return {
        http,
        calls,
        environment: {
          LOOM_MCP_ENDPOINT: `http://127.0.0.1:${address.port}/mcp`,
          LOOM_MCP_AUTHORIZATION: "Bearer synthetic-only",
        },
      };
    }),
    ({ http }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => http.close((e) => (e ? reject(e) : resolve()))),
      ),
  );
const args = {
  id: "a".repeat(32),
  expectedVersion: 1,
  repository: "owner/repo",
  command: { tool: "git", argv: ["fetch", "origin"] },
};
it.effect.each([true, false])(
  "forwards exact child streams and its nonzero exit code (structured=%s)",
  (structured) =>
    Effect.gen(function* () {
      const result = {
        account: "bot",
        repository: "owner/repo",
        exitCode: 7,
        stdout: "normal output\n",
        stderr: "safe command failure\n",
      };
      const f = yield* server(
        structured
          ? { structuredContent: result }
          : { content: [{ type: "text", text: JSON.stringify(result) }] },
      );
      let stdout = "",
        stderr = "";
      const failure = yield* runGitHubTerminalCli(JSON.stringify(args), f.environment, {
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
      }).pipe(Effect.flip);
      expect(stdout).toBe(result.stdout);
      expect(stderr).toBe(result.stderr);
      expect(Runtime.getErrorExitCode(failure)).toBe(7);
      expect(Runtime.getErrorReported(failure)).toBe(false);
      expect(f.calls).toEqual([{ name: "loom_vault_github_exec", arguments: args }]);
    }).pipe(Effect.scoped),
);
it.effect("does not print tool errors or malformed responses as successful child output", () =>
  Effect.gen(function* () {
    const f = yield* server({ isError: true, content: [{ type: "text", text: "denied" }] });
    let output = "";
    const failure = yield* runGitHubTerminalCli(JSON.stringify(args), f.environment, {
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        output += text;
      },
    }).pipe(Effect.flip);
    expect(failure).toMatchObject({ reason: "tool" });
    expect(output).toBe("");
    const malformed = yield* server({ structuredContent: { stdout: "incomplete" } });
    expect(
      yield* runGitHubTerminalCli(JSON.stringify(args), malformed.environment).pipe(Effect.flip),
    ).toMatchObject({ reason: "response" });
    expect(yield* runGitHubTerminalCli(JSON.stringify(args), {}).pipe(Effect.flip)).toMatchObject({
      reason: "connection",
    });
  }).pipe(Effect.scoped),
);

it.effect.each([
  { resource: "development-github", preferredItemIds: [args.id] },
  { id: args.id, expectedVersion: args.expectedVersion },
])(
  "forwards a GitHub selector and exact repository through the existing terminal tool: %j",
  (connection) =>
    Effect.gen(function* () {
      const f = yield* server({
        structuredContent: {
          account: "bot",
          repository: args.repository,
          exitCode: 0,
          stdout: "",
          stderr: "",
        },
      });
      const input = { connection, repository: args.repository, command: args.command };
      yield* runGitHubTerminalCli(JSON.stringify(input), f.environment);
      expect(f.calls).toEqual([{ name: "loom_vault_github_exec", arguments: input }]);
    }).pipe(Effect.scoped),
);
const choice: VaultConnectionChoice = {
  item: {
    id: args.id,
    label: "Development GitHub",
    kind: "service-connection",
    state: "active",
    version: 1,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
  },
  kind: "github",
  hostname: "github.com",
  account: "bot",
  repositories: [args.repository],
};
it.effect.each(["structured", "wrapped", "text"] as const)(
  "preserves typed ambiguity and choices without printing command output (%s)",
  (encoding) =>
    Effect.gen(function* () {
      const failure = new VaultConnectionError({
        state: "ambiguous",
        choices: [choice],
        repair: "select-connection",
      });
      const f = yield* server({
        isError: true,
        ...(encoding === "text"
          ? { content: [{ type: "text", text: JSON.stringify(failure) }] }
          : { structuredContent: encoding === "wrapped" ? { error: failure } : failure }),
      });
      let output = "";
      const error = yield* runGitHubTerminalCli(
        JSON.stringify({
          connection: { resource: "github.com" },
          repository: args.repository,
          command: args.command,
        }),
        f.environment,
        {
          stdout: (text) => {
            output += text;
          },
          stderr: (text) => {
            output += text;
          },
        },
      ).pipe(Effect.flip);
      expect(error).toBeInstanceOf(VaultConnectionError);
      expect(error).toEqual(failure);
      expect(output).toBe("");
    }).pipe(Effect.scoped),
);
it.effect.each([
  { state: "policy-denied", repair: "repair-policy" },
  { state: "backend-unavailable", repair: "check-backend" },
  { state: "untrusted-host", repair: "trust-host" },
] as const)("keeps typed connection repair state %j", (report) =>
  Effect.gen(function* () {
    const failure = new VaultConnectionError({ ...report, choices: [] });
    const f = yield* server({ isError: true, structuredContent: failure });
    expect(
      yield* runGitHubTerminalCli(JSON.stringify(args), f.environment).pipe(Effect.flip),
    ).toEqual(failure);
  }).pipe(Effect.scoped),
);
it.effect("keeps malformed resolver failures on the existing tool-error path", () =>
  Effect.gen(function* () {
    const f = yield* server({
      isError: true,
      structuredContent: {
        _tag: "VaultConnectionError",
        state: "ambiguous",
      },
    });
    expect(
      yield* runGitHubTerminalCli(JSON.stringify(args), f.environment).pipe(Effect.flip),
    ).toMatchObject({ reason: "tool" });
  }).pipe(Effect.scoped),
);

it.effect.each([
  { failure: new VaultGitHubError({ reason: "cli-unavailable" }), encoding: "structured" },
  { failure: new VaultGitHubError({ reason: "unauthorized" }), encoding: "text" },
  { failure: new VaultError({ reason: "locked" }), encoding: "wrapped" },
  { failure: new VaultError({ reason: "unavailable" }), encoding: "text" },
])("preserves safe execution diagnoses without child output: %j", ({ failure, encoding }) =>
  Effect.gen(function* () {
    const wireFailure = { ...failure, unsafeDetail: "synthetic-sensitive-detail" };
    const f = yield* server({
      isError: true,
      ...(encoding === "text"
        ? { content: [{ type: "text", text: JSON.stringify(wireFailure) }] }
        : { structuredContent: encoding === "wrapped" ? { error: wireFailure } : wireFailure }),
    });
    let output = "";
    const error = yield* runGitHubTerminalCli(JSON.stringify(args), f.environment, {
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        output += text;
      },
    }).pipe(Effect.flip);
    expect(error).toEqual(failure);
    expect(error.message).toBe(failure.message);
    expect(JSON.stringify(error)).not.toContain("synthetic-sensitive-detail");
    expect(output).toBe("");
  }).pipe(Effect.scoped),
);
