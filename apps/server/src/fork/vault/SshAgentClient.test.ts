// @effect-diagnostics nodeBuiltinImport:off -- Isolated loopback servers verify that MCP bearer credentials never follow redirects.
import * as NodeHttp from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  VaultConnectionError,
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  type VaultConnectionChoice,
} from "@t3tools/contracts/fork";
import { Command } from "effect/cli";
import * as Runtime from "effect/Runtime";
import * as Clock from "effect/Clock";
import * as TestConsole from "effect/testing/TestConsole";
import { sshAgentExecCommand } from "./ssh-agent-cli.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as SshAgentClient from "./SshAgentClient.ts";
const selection = { id: "a".repeat(32), expectedVersion: 1 };
it.effect.each([
  {
    LOOM_MCP_ENDPOINT: "http://127.0.0.1:1/mcp",
    T3_ACP_MCP_AUTHORIZATION: "Bearer synthetic-other-session",
  },
  {
    LOOM_MCP_AUTHORIZATION: "Bearer synthetic-explicit-session",
    T3_MCP_URL: "http://127.0.0.1:1/mcp",
    T3_MCP_BEARER_TOKEN: "synthetic-pi-session",
  },
  { T3_ACP_MCP_ENDPOINT: "http://127.0.0.1:1/mcp", T3_MCP_BEARER_TOKEN: "synthetic-pi-session" },
])("never mixes credentials from incomplete connection families %j", (environment) =>
  Effect.gen(function* () {
    let requests = 0;
    const client = yield* SshAgentClient.SshAgentClient.pipe(
      Effect.provide(SshAgentClient.layer),
      Effect.provideService(HostProcess.Environment, environment),
      Effect.provideService(FetchHttpClient.Fetch, async () => {
        requests++;
        throw new Error("Unexpected synthetic request");
      }),
    );
    expect(yield* client.open(selection).pipe(Effect.flip)).toMatchObject({ reason: "connection" });
    expect(requests).toBe(0);
  }),
);
it.live(
  "rejects authenticated endpoint redirects without sending a credential to their destination",
  () =>
    Effect.gen(function* () {
      let redirected = 0;
      const trap = yield* NodeHttpServer.make(() => NodeHttp.createServer(), {
        host: "127.0.0.1",
        port: 0,
      });
      yield* trap.serve(
        Effect.sync(() => {
          redirected++;
          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      if (!("port" in trap.address)) return yield* Effect.die("Missing synthetic port");
      const redirect = yield* NodeHttpServer.make(() => NodeHttp.createServer(), {
        host: "127.0.0.1",
        port: 0,
      });
      yield* redirect.serve(
        Effect.succeed(
          HttpServerResponse.empty({
            status: 302,
            headers: { location: `http://127.0.0.1:${trap.address.port}/capture` },
          }),
        ),
      );
      if (!("port" in redirect.address)) return yield* Effect.die("Missing synthetic port");
      const client = yield* SshAgentClient.SshAgentClient.pipe(
        Effect.provide(SshAgentClient.layer),
        Effect.provideService(HostProcess.Environment, {
          LOOM_MCP_ENDPOINT: `http://127.0.0.1:${redirect.address.port}/mcp`,
          LOOM_MCP_AUTHORIZATION: "Bearer synthetic-private-header",
        }),
      );
      const error = yield* client.open(selection).pipe(Effect.flip);
      expect(error).toMatchObject({ reason: "connection" });
      expect(JSON.stringify(error)).not.toContain("synthetic-private-header");
      expect(redirected).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("cancels oversized MCP response bodies before buffering unbounded data", () =>
  Effect.gen(function* () {
    let cancelled = false;
    const client = yield* SshAgentClient.SshAgentClient.pipe(
      Effect.provide(SshAgentClient.layer),
      Effect.provideService(HostProcess.Environment, {
        LOOM_MCP_ENDPOINT: "http://127.0.0.1/mcp",
        LOOM_MCP_AUTHORIZATION: "Bearer synthetic-only",
      }),
      Effect.provideService(
        FetchHttpClient.Fetch,
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(65_537));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );
    expect(yield* client.open(selection).pipe(Effect.flip)).toMatchObject({ reason: "connection" });
    expect(cancelled).toBe(true);
  }),
);

const choice: VaultConnectionChoice = {
  item: {
    id: selection.id,
    label: "Development SSH",
    kind: "ssh-key",
    state: "active",
    version: 1,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
  },
  kind: "ssh",
  hostname: "example.test",
  account: "git",
  repositories: [],
};
const fixture = (result: unknown) =>
  Effect.gen(function* () {
    const calls: unknown[] = [];
    const environment = {
      LOOM_MCP_ENDPOINT: "http://127.0.0.1/mcp",
      LOOM_MCP_AUTHORIZATION: "Bearer synthetic-only",
    };
    const fetchImplementation = async (_url: string | URL | Request, init?: RequestInit) => {
      const message = JSON.parse(String(init?.body)) as {
        id?: string;
        method: string;
        params?: unknown;
      };
      if (message.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (message.method === "tools/call") calls.push(message.params);
      return new Response(
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
        { headers: { "content-type": "application/json" } },
      );
    };
    const client = yield* SshAgentClient.SshAgentClient.pipe(
      Effect.provide(SshAgentClient.layer),
      Effect.provideService(HostProcess.Environment, environment),
      Effect.provideService(FetchHttpClient.Fetch, fetchImplementation),
    );
    return { client, calls, environment, fetchImplementation };
  });
it.effect.each([
  { connection: { resource: "development-host", preferredItemIds: [selection.id] } },
  { connection: selection },
  selection,
])("forwards an SSH connection selection through the existing open tool: %j", (input) =>
  Effect.gen(function* () {
    const session = {
      sessionId: "b".repeat(32),
      id: selection.id,
      version: selection.expectedVersion,
      expiresAt: 300_000,
      destination: "ssh://git@example.test:22",
      target: {
        hostname: "example.test",
        username: "git",
        port: 22,
        hostKey: `ssh-ed25519 ${"A".repeat(68)}`,
      },
      publicKey: `ssh-ed25519 ${"A".repeat(68)}`,
    };
    const f = yield* fixture({ structuredContent: session });
    expect(yield* f.client.open(input)).toEqual(session);
    expect(f.calls).toEqual([{ name: "loom_vault_ssh_agent_open", arguments: input }]);
  }),
);
it.effect.each(["structured", "wrapped", "text"] as const)(
  "preserves typed ambiguity and choices from an MCP failure (%s)",
  (encoding) =>
    Effect.gen(function* () {
      const failure = new VaultConnectionError({
        state: "ambiguous",
        choices: [choice],
        repair: "select-connection",
      });
      const f = yield* fixture({
        isError: true,
        ...(encoding === "text"
          ? { content: [{ type: "text", text: JSON.stringify(failure) }] }
          : { structuredContent: encoding === "wrapped" ? { error: failure } : failure }),
      });
      const error = yield* f.client
        .open({ connection: { resource: "example.test" } })
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(VaultConnectionError);
      expect(error).toEqual(failure);
    }),
);
it.effect.each([
  { state: "policy-denied", repair: "repair-policy" },
  { state: "backend-locked", repair: "unlock-backend" },
  { state: "untrusted-host", repair: "trust-host" },
] as const)("preserves connection repair state %j", (report) =>
  Effect.gen(function* () {
    const failure = new VaultConnectionError({ ...report, choices: [] });
    const f = yield* fixture({ isError: true, structuredContent: failure });
    expect(yield* f.client.open(selection).pipe(Effect.flip)).toEqual(failure);
  }),
);
it.effect.each([
  { isError: true, content: [{ type: "text", text: "denied" }] },
  { isError: true, structuredContent: { _tag: "VaultConnectionError", state: "ambiguous" } },
])("keeps unknown or malformed tool failures denied: %j", (result) =>
  Effect.gen(function* () {
    const f = yield* fixture(result);
    expect(yield* f.client.open(selection).pipe(Effect.flip)).toMatchObject({ reason: "denied" });
  }),
);
it.effect.each([
  new VaultConnectionError({
    state: "ambiguous",
    choices: [choice],
    repair: "select-connection",
  }),
  new VaultWorkloadError({ reason: "not-configured" }),
])(
  "SSH CLI reports a safe named selection or execution failure before launching a child: %j",
  (failure) =>
    Effect.gen(function* () {
      const f = yield* fixture({ isError: true, structuredContent: failure });
      const connection = { resource: "example.test" };
      const error = yield* Command.runWith(sshAgentExecCommand, { version: "0.0.0" })([
        JSON.stringify({
          connection,
          command: { tool: "ssh", argv: ["git@example.test", "true"] },
          timeoutMs: 1000,
        }),
      ]).pipe(
        Effect.provide(NodeServices.layer),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Environment, f.environment),
        Effect.provideService(FetchHttpClient.Fetch, f.fetchImplementation),
        Effect.flip,
      );
      expect(Runtime.getErrorExitCode(error)).toBe(1);
      expect(yield* TestConsole.errorLines).toEqual([failure.message]);
      expect(f.calls).toEqual([{ name: "loom_vault_ssh_agent_open", arguments: { connection } }]);
    }).pipe(Effect.provide(TestConsole.layer)),
);

it.effect.each([
  { failure: new VaultWorkloadError({ reason: "not-configured" }), encoding: "structured" },
  { failure: new VaultWorkloadError({ reason: "host-offline" }), encoding: "wrapped" },
  { failure: new VaultWorkloadError({ reason: "expired" }), encoding: "text" },
  { failure: new VaultSshError({ reason: "untrusted-host" }), encoding: "structured" },
  { failure: new VaultError({ reason: "locked" }), encoding: "wrapped" },
  { failure: new VaultError({ reason: "unavailable" }), encoding: "text" },
])("preserves safe execution diagnoses through MCP: %j", ({ failure, encoding }) =>
  Effect.gen(function* () {
    const wireFailure = { ...failure, unsafeDetail: "synthetic-sensitive-detail" };
    const f = yield* fixture({
      isError: true,
      ...(encoding === "text"
        ? { content: [{ type: "text", text: JSON.stringify(wireFailure) }] }
        : { structuredContent: encoding === "wrapped" ? { error: wireFailure } : wireFailure }),
    });
    const error = yield* f.client.open(selection).pipe(Effect.flip);
    expect(error).toEqual(failure);
    expect(error.message).toBe(failure.message);
    expect(JSON.stringify(error)).not.toContain("synthetic-sensitive-detail");
  }),
);

it.live("SSH CLI preserves a real child exit code after named selection", () =>
  Effect.gen(function* () {
    const f = yield* fixture({
      structuredContent: {
        sessionId: "b".repeat(32),
        id: selection.id,
        version: selection.expectedVersion,
        expiresAt: (yield* Clock.currentTimeMillis) + 300_000,
        destination: "ssh://git@example.test:22",
        target: {
          hostname: "example.test",
          username: "git",
          port: 22,
          hostKey: `ssh-ed25519 ${"A".repeat(68)}`,
        },
        publicKey: `ssh-ed25519 ${"A".repeat(68)}`,
      },
    });
    const error = yield* Command.runWith(sshAgentExecCommand, { version: "0.0.0" })([
      JSON.stringify({
        connection: { resource: "example.test" },
        command: { tool: "git", argv: ["-c", "alias.loom-test-exit=!exit 7", "loom-test-exit"] },
        timeoutMs: 10000,
      }),
    ]).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(HostProcess.Platform, "darwin"),
      Effect.provideService(HostProcess.Environment, f.environment),
      Effect.provideService(FetchHttpClient.Fetch, f.fetchImplementation),
      Effect.flip,
    );
    expect(Runtime.getErrorExitCode(error)).toBe(7);
    expect(yield* TestConsole.errorLines).toEqual([]);
  }).pipe(Effect.provide(TestConsole.layer)),
);
