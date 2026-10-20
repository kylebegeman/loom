// @effect-diagnostics nodeBuiltinImport:off -- Isolated loopback servers verify that MCP bearer credentials never follow redirects.
import * as NodeHttp from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
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
    expect((yield* client.open(selection).pipe(Effect.flip)).reason).toBe("connection");
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
      expect(error.reason).toBe("connection");
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
    expect((yield* client.open(selection).pipe(Effect.flip)).reason).toBe("connection");
    expect(cancelled).toBe(true);
  }),
);
