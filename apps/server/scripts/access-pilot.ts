#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- This isolated diagnostic owns its loopback HTTP server.
import * as NodeHttp from "node:http";
import * as NodeUtil from "node:util";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as CloudflareAccess from "../src/fork/cloudflare-access/CloudflareAccess.ts";

const args = NodeUtil.parseArgs({
  options: { port: { type: "string", default: "14443" }, help: { type: "boolean" } },
});
if (args.values.help) {
  process.stdout.write(
    "Access transport pilot. No Loom state, credentials or tasks are loaded.\n" +
      "Set LOOM_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com and LOOM_ACCESS_AUDIENCE=<app-aud>.\n" +
      "Run: vp run --filter t3 access:pilot [--port 14443]\n" +
      "GET /probe reports credential presence only; /oauth-challenge returns an origin OAuth challenge; /ws echoes frames.\n",
  );
} else {
  const port = Number(args.values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Choose a port between 1024 and 65535.");
  const routes = Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/probe",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        return HttpServerResponse.jsonUnsafe(
          {
            pilot: true,
            assertionVerified: true,
            loomCredentialPresent: request.headers.authorization?.startsWith("Bearer ") === true,
          },
          { headers: { "cache-control": "no-store" } },
        );
      }),
    ),
    HttpRouter.add(
      "GET",
      "/oauth-challenge",
      Effect.succeed(
        HttpServerResponse.empty({
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer resource_metadata="https://loom.invalid/.well-known/oauth-protected-resource"',
            "cache-control": "no-store",
          },
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const socket = yield* request.upgrade;
        const reader = yield* socket.reader;
        const writer = yield* socket.writer;
        yield* writer.write("loom-access-pilot-ready");
        yield* reader.pull.pipe(
          Effect.flatMap((frames) => writer.writeAll(frames)),
          Effect.forever,
          Effect.ignoreCause,
        );
        return HttpServerResponse.empty();
      }),
    ),
    CloudflareAccess.guardLayer,
  ).pipe(Layer.provide(CloudflareAccess.layer), Layer.provide(FetchHttpClient.layer));
  const program = Effect.gen(function* () {
    const env = yield* HostProcess.Environment;
    if (!env.LOOM_ACCESS_TEAM_DOMAIN || !env.LOOM_ACCESS_AUDIENCE) {
      return yield* new CloudflareAccess.CloudflareAccessError({ reason: "configuration" });
    }
    return yield* Layer.launch(
      HttpRouter.serve(routes, { disableLogger: true }).pipe(
        Layer.provide(NodeHttpServer.layer(NodeHttp.createServer, { host: "127.0.0.1", port })),
      ),
    );
  });
  NodeRuntime.runMain(program);
}
