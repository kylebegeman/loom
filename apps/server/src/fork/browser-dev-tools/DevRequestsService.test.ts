import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerConfig from "../../config.ts";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import { make } from "./DevRequestsService.ts";
import { checkoutKey } from "./servers.ts";
import { HTTP_BODY_LIMIT, HTTP_HISTORY_LIMIT } from "./requests.ts";
const target = { threadId: ThreadId.make("first") };
const request = {
  method: "POST" as const,
  url: "http://localhost/test?token=private-query&token=private-query-again&api_key=private-query-key&filter=active",
  headers: { authorization: "private-header", "content-type": "application/json" },
  body: '{"hello":"world"}',
  timeoutMs: 300,
};
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped();
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const calls: string[] = [];
  const unused = () => {
    throw new Error("Unexpected development call");
  };
  const client = HttpClient.make((req) =>
    Effect.gen(function* () {
      calls.push(req.url);
      expect(req.headers.traceparent).toBeUndefined();
      if (req.url.includes("/upload")) {
        expect(req.body._tag).toBe("Uint8Array");
        if (req.body._tag === "Uint8Array")
          expect(Array.from(req.body.body)).toEqual([0, 1, 2, 255]);
        expect(req.headers["content-type"]).toBe("application/octet-stream");
      }
      if (req.url.includes("/pending") || req.url.includes("/timeout")) {
        yield* Deferred.succeed(entered, undefined);
        if (req.url.includes("/timeout")) return yield* Effect.never;
        yield* Deferred.await(release);
      }
      const binary = req.url.includes("/binary");
      const large = req.url.includes("/large");
      const broken = req.url.includes("/broken");
      const body = broken
        ? new ReadableStream({
            start(controller) {
              controller.error(new Error("private-network-failure"));
            },
          })
        : binary
          ? new Uint8Array([0, 1, 2])
          : large
            ? "x".repeat(HTTP_BODY_LIMIT + 20)
            : '{"ok":true}';
      return HttpClientResponse.fromWeb(
        req,
        new Response(body, {
          status: req.url.includes("/redirect") ? 302 : 201,
          headers: {
            "content-type": binary ? "application/octet-stream" : "application/json",
            "set-cookie": "private-cookie",
            location: "http://elsewhere/",
          },
        }),
      );
    }),
  );
  const deps = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(DevEnvironmentService, {
      snapshot: (input) =>
        Effect.succeed({
          root: input.threadId === ThreadId.make("other") ? `${root}/other` : root,
          candidates: [],
          runs: [],
        }),
      watch: unused,
      start: unused,
      control: unused,
    }),
  );
  const service = yield* make.pipe(Effect.provide(deps));
  const config = yield* ServerConfig.ServerConfig;
  return {
    service,
    reload: make.pipe(Effect.provide(deps)),
    calls,
    entered,
    release,
    file: `${config.stateDir}/fork/browser-dev-tools/requests/${checkoutKey(root)}.json`,
  };
});
const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "dev-http-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );
it.effect(
  "persists bounded exchanges, protects retries across restart, redacts authentication and isolates checkouts",
  () =>
    Effect.gen(function* () {
      const { service, reload, calls, file } = yield* fixture;
      const input = { ...target, requestId: "saved", request };
      const response = yield* service.send(input);
      expect(response.status).toBe(201);
      expect(response.body).toBe('{"ok":true}');
      expect(response.request.headers.authorization).toBe("[redacted]");
      expect(response.request.url).not.toContain("private-query");
      expect(response.request.url).toContain("filter=active");
      expect(response.headers["set-cookie"]).toBe("[redacted]");
      const metadata = yield* service.history(target);
      expect(metadata.selected).toBeNull();
      expect(JSON.stringify(metadata)).not.toContain("world");
      expect((yield* service.history({ ...target, exchangeId: response.id })).selected).toEqual(
        response,
      );
      const restored = yield* reload;
      expect(yield* restored.send(input)).toEqual(response);
      expect(calls).toHaveLength(1);
      expect(
        (yield* restored
          .send({ ...input, request: { ...request, body: "changed" } })
          .pipe(Effect.flip)).reason,
      ).toBe("request-conflict");
      expect(
        (yield* restored.history({ threadId: ThreadId.make("second") })).exchanges,
      ).toHaveLength(1);
      expect((yield* restored.history({ threadId: ThreadId.make("other") })).exchanges).toEqual([]);
      const fs = yield* FileSystem.FileSystem;
      const saved = yield* fs.readFileString(file);
      for (const privateValue of ["private-header", "private-query", "private-cookie"])
        expect(saved).not.toContain(privateValue);
      for (let index = 0; index < HTTP_HISTORY_LIMIT; index++)
        yield* service.send({ ...input, requestId: `next-${index}` });
      expect((yield* service.history(target)).exchanges).toHaveLength(HTTP_HISTORY_LIMIT);
      expect((yield* service.send(input).pipe(Effect.flip)).reason).toBe("history-pruned");
      expect((yield* service.clear(target)).exchanges).toEqual([]);
      expect(
        (yield* service.send({ ...input, requestId: "next-49" }).pipe(Effect.flip)).reason,
      ).toBe("history-pruned");
      yield* fs.writeFileString(file, "invalid-json");
      expect(
        (yield* service.send({ ...input, requestId: "unreadable" }).pipe(Effect.flip)).reason,
      ).toBe("history-unavailable");
      expect(calls).toHaveLength(HTTP_HISTORY_LIMIT + 1);
    }).pipe(provide),
);
it.effect(
  "bounds streaming previews, summarizes binary responses, preserves redirects and normalizes failures before recording",
  () =>
    Effect.gen(function* () {
      const { service, calls, entered } = yield* fixture;
      const send = (path: string) =>
        service.send({
          ...target,
          requestId: path,
          request: { ...request, url: `http://localhost/${path}` },
        });
      const upload = yield* service.send({
        ...target,
        requestId: "upload",
        request: {
          ...request,
          url: "http://localhost/upload",
          headers: { "content-type": "application/octet-stream" },
          body: "AAEC/w==",
          bodyEncoding: "base64",
        },
      });
      expect(upload.status).toBe(201);
      const large = yield* send("large");
      expect(large.truncated).toBe(true);
      expect(large.byteLength).toBe(HTTP_BODY_LIMIT);
      expect(large.body.length).toBe(HTTP_BODY_LIMIT);
      const binary = yield* send("binary");
      expect(binary.binary).toBe(true);
      expect(binary.body).toBe("");
      expect(binary.byteLength).toBe(3);
      expect((yield* send("redirect")).status).toBe(302);
      expect((yield* send("broken")).error).toBe("network");
      const fiber = yield* send("timeout").pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      yield* TestClock.adjust("300 millis");
      expect((yield* Fiber.join(fiber)).error).toBe("timeout");
      expect(
        (yield* service
          .send({ ...target, requestId: "bad", request: { ...request, url: "file:///etc/passwd" } })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-request");
      expect(JSON.stringify(yield* service.history(target)).length).toBeLessThan(4096);
      expect(calls).toHaveLength(6);
    }).pipe(provide),
);
it.effect(
  "does not repeat an in-flight request or restore payloads cleared while it was running",
  () =>
    Effect.gen(function* () {
      const { service, reload, calls, entered, release } = yield* fixture;
      const input = {
        ...target,
        requestId: "pending",
        request: { ...request, url: "http://localhost/pending" },
      };
      const fiber = yield* service.send(input).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      expect((yield* (yield* reload).send(input).pipe(Effect.flip)).reason).toBe(
        "request-incomplete",
      );
      yield* service.clear(target);
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(fiber)).status).toBe(201);
      expect((yield* service.history(target)).exchanges).toEqual([]);
      expect((yield* service.send(input).pipe(Effect.flip)).reason).toBe("history-pruned");
      expect(calls).toHaveLength(1);
    }).pipe(provide),
);
