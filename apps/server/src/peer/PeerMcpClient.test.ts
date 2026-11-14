import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestrationV2LinkedSender,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as PeerLinks from "./PeerLinks.ts";
import * as PeerMcpClient from "./PeerMcpClient.ts";
import { descriptorOf, layerLinkingEnvironment, linkTo, servePeer } from "./PeerLinks.testkit.ts";

const Result = Schema.Struct({ modes: Schema.String });
const toolkit = Toolkit.make(
  Tool.make("probe", {
    description: "Returns this request's mode limits.",
    success: Result,
    dependencies: [McpInvocationContext.McpInvocationContext],
  }),
  Tool.make("hold", {
    description: "Holds a tool request open.",
    success: Result,
    dependencies: [McpInvocationContext.McpInvocationContext],
  }),
  Tool.make("refuse", {
    description: "Refuses the call.",
    success: Result,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
  }),
);

const refusal = new OrchestratorMcpFailure({
  code: "thread_not_found",
  message: "Thread thread-gone was not found.",
});

const senderToolkit = Toolkit.make(
  Tool.make("sender", {
    description: "Returns the thread this request is made for.",
    success: Schema.Struct({ senderThread: Schema.NullOr(OrchestrationV2LinkedSender) }),
    dependencies: [McpInvocationContext.McpInvocationContext],
  }),
);

it.effect("tells the peer which thread a call is made for", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const handlers = McpToolAccess.toLayer(senderToolkit, {
        sender: McpToolAccess.reads(() =>
          McpInvocationContext.McpInvocationContext.pipe(
            Effect.map((scope) => ({ senderThread: scope.client?.senderThread ?? null })),
          ),
        ),
      });
      const box = descriptorOf("environment-box", "Box");
      const b = yield* servePeer(box, McpHttpServer.toolkitRegistration(senderToolkit, handlers));
      const context = yield* Layer.build(
        layerLinkingEnvironment(descriptorOf("environment-a", "A")),
      );
      const links = Context.get(context, PeerLinks.PeerLinks);
      const client = Context.get(context, PeerMcpClient.PeerMcpClient);
      yield* linkTo(links, b);
      // A thread id may hold any character; it arrives as sent.
      const sender = {
        environmentId: EnvironmentId.make("environment-a"),
        threadId: ThreadId.make("import:claude/orc lead"),
        title: "orc lead / opus → fable",
      };
      const call = (input: { readonly sender?: typeof sender }) =>
        client.call({
          environmentId: box.environmentId,
          tool: "sender",
          arguments: {},
          limits: { runtimeMode: "full-access", interactionMode: "default" },
          ...input,
          success: Schema.Struct({ senderThread: Schema.NullOr(OrchestrationV2LinkedSender) }),
        });
      expect(yield* call({ sender })).toEqual({ senderThread: sender });
      expect(yield* call({})).toEqual({ senderThread: null });
      // A long title is cut to whole characters rather than breaking the call.
      const long = yield* call({ sender: { ...sender, title: "🧵".repeat(5000) } });
      expect(long.senderThread?.title).toBe("🧵".repeat(200));
      // A title holding an unpaired surrogate still lets the call through.
      const broken = yield* call({ sender: { ...sender, title: "Review \ud800" } });
      expect(broken.senderThread?.title).toBe("Review \ufffd");
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect.each([false, true])(
  "reuses an initialized session before its first call finishes (cancelled: %s)",
  (cancelFirst) =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const modes = McpInvocationContext.McpInvocationContext.pipe(
          Effect.map((scope) => {
            const ceiling = McpInvocationContext.clientModeCeiling(scope.client);
            return { modes: `${ceiling.runtimeMode}/${ceiling.interactionMode}` };
          }),
        );
        const handlers = McpToolAccess.toLayer(toolkit, {
          probe: McpToolAccess.reads(() => modes),
          refuse: McpToolAccess.reads(() => Effect.fail(refusal)),
          hold: McpToolAccess.reads(() =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(modes),
            ),
          ),
        });
        const box = descriptorOf("environment-box", "Box");
        const b = yield* servePeer(box, McpHttpServer.toolkitRegistration(toolkit, handlers));
        const context = yield* Layer.build(
          layerLinkingEnvironment(descriptorOf("environment-a", "A")),
        );
        const links = Context.get(context, PeerLinks.PeerLinks);
        const client = Context.get(context, PeerMcpClient.PeerMcpClient);
        yield* linkTo(links, b);
        const held = yield* client
          .call({
            environmentId: box.environmentId,
            tool: "hold",
            arguments: {},
            limits: { runtimeMode: "full-access", interactionMode: "default" },
            success: Result,
          })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        if (cancelFirst) yield* Fiber.interrupt(held);
        const before = (yield* Ref.get(b.bearers)).length;
        expect(
          yield* client.call({
            environmentId: box.environmentId,
            tool: "probe",
            arguments: {},
            limits: { runtimeMode: "approval-required", interactionMode: "plan" },
            success: Result,
          }),
        ).toEqual({ modes: "approval-required/plan" });
        // One tool POST; no second initialize or initialized notification.
        expect((yield* Ref.get(b.bearers)).length - before).toBe(1);
        yield* Deferred.succeed(release, undefined);
        if (!cancelFirst) expect(yield* Fiber.join(held)).toEqual({ modes: "auto/default" });
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("keeps a link healthy when the peer refuses a call", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const handlers = McpToolAccess.toLayer(toolkit, {
        probe: McpToolAccess.reads(() => Effect.succeed({ modes: "" })),
        hold: McpToolAccess.reads(() => Effect.succeed({ modes: "" })),
        refuse: McpToolAccess.reads(() => Effect.fail(refusal)),
      });
      const box = descriptorOf("environment-box", "Box");
      const b = yield* servePeer(box, McpHttpServer.toolkitRegistration(toolkit, handlers));
      const context = yield* Layer.build(
        layerLinkingEnvironment(descriptorOf("environment-a", "A")),
      );
      const links = Context.get(context, PeerLinks.PeerLinks);
      const client = Context.get(context, PeerMcpClient.PeerMcpClient);
      yield* linkTo(links, b);
      yield* links.recordOutcome(box.environmentId, { error: "earlier outage" });
      const refused = yield* client
        .call({
          environmentId: box.environmentId,
          tool: "refuse",
          arguments: {},
          limits: { runtimeMode: "full-access", interactionMode: "default" },
          success: Result,
        })
        .pipe(Effect.flip);
      // The agent hears the peer's own refusal; the link answered, so it is not failing.
      expect(refused).toMatchObject({ code: refusal.code, message: refusal.message });
      const link = yield* links.get(box.environmentId);
      expect(link._tag === "Some" ? link.value.lastError : "missing").toBeNull();
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

const stubPeer = descriptorOf("environment-box", "Box");

/** A client whose one link goes to `http`, recording each call's outcome for the link. */
const clientOver = (http: HttpClient.HttpClient, outcomes: Array<string | null>) =>
  Layer.build(
    PeerMcpClient.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HttpClient.HttpClient, http),
          Layer.mock(PeerLinks.PeerLinks)({
            resolve: () =>
              Effect.succeed({
                link: {
                  environmentId: stubPeer.environmentId,
                  label: stubPeer.label,
                  urls: ["https://peer.example"],
                  access: "auto",
                  linkedAt: DateTime.makeUnsafe(0),
                  expiresAt: DateTime.makeUnsafe(1),
                  lastReachedAt: null,
                  lastError: null,
                },
                url: "https://peer.example",
                token: "fixture",
              }),
            recordOutcome: (_, outcome) => Effect.sync(() => outcomes.push(outcome.error)),
          }),
        ),
      ),
    ),
  ).pipe(Effect.map((context) => Context.get(context, PeerMcpClient.PeerMcpClient)));

it.effect("renews a missing peer session once and reuses its replacement", () =>
  Effect.gen(function* () {
    const sessionHeaders: Array<string | undefined> = [];
    const statuses = [200, 202, 404, 200, 202, 200, 200, 200];
    const outcomes: Array<string | null> = [];
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        const index = sessionHeaders.length;
        sessionHeaders.push(request.headers["mcp-session-id"]);
        const status = statuses[index];
        if (status === undefined) throw new Error("Unexpected retry");
        return HttpClientResponse.fromWeb(
          request,
          new Response(
            index === 7
              ? "{}"
              : index >= 5
                ? JSON.stringify({
                    result: {
                      content: [{ type: "text", text: '{"modes":"approval-required/plan"}' }],
                    },
                  })
                : "",
            {
              status,
              headers:
                index === 0
                  ? { "mcp-session-id": "old" }
                  : index === 3
                    ? { "mcp-session-id": "renewed" }
                    : {},
            },
          ),
        );
      }),
    );
    const client = yield* clientOver(http, outcomes);
    for (let call = 0; call < 2; call++) {
      expect(
        yield* client.call({
          environmentId: stubPeer.environmentId,
          tool: "probe",
          arguments: {},
          limits: { runtimeMode: "approval-required", interactionMode: "plan" },
          success: Result,
        }),
      ).toEqual({ modes: "approval-required/plan" });
    }
    // An answer with neither a result nor an error is the link's problem, not the call's.
    const empty = yield* client
      .call({
        environmentId: stubPeer.environmentId,
        tool: "probe",
        arguments: {},
        limits: { runtimeMode: "approval-required", interactionMode: "plan" },
        success: Result,
      })
      .pipe(Effect.flip);
    expect(outcomes).toEqual([null, null, empty.message]);
    expect(sessionHeaders).toEqual([
      undefined,
      "old",
      "old",
      undefined,
      "renewed",
      "renewed",
      "renewed",
      "renewed",
    ]);
  }).pipe(Effect.scoped),
);

it.effect("sends a wait or read again when its route drops it, and nothing else", () =>
  Effect.gen(function* () {
    // Each tool call in turn: dropped by the route, or answered.
    const plan = ["drop", "answer", "drop", "drop", "drop", "drop"];
    let toolCalls = 0;
    const outcomes: Array<string | null> = [];
    const socket = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
    const http = HttpClient.make((request) => {
      const body = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
      const method = JSON.parse(new TextDecoder().decode(body)).method;
      if (method !== "tools/call") {
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("", { status: 200, headers: { "mcp-session-id": "session" } }),
          ),
        );
      }
      if (plan[toolCalls++] === "drop") {
        const cause = new TypeError("fetch failed", { cause: socket });
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
        );
      }
      const result = { content: [{ type: "text", text: '{"modes":"auto/default"}' }] };
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ result }))),
      );
    });
    const client = yield* clientOver(http, outcomes);
    const call = (repeatable: boolean) =>
      client.call({
        environmentId: stubPeer.environmentId,
        tool: "probe",
        arguments: {},
        limits: { runtimeMode: "auto", interactionMode: "default" },
        repeatable,
        success: Result,
      });

    expect(yield* call(true)).toEqual({ modes: "auto/default" });
    const once = yield* call(false).pipe(Effect.flip);
    const gaveUp = yield* call(true).pipe(Effect.flip);

    expect(once.message).toBe("The linked environment stopped answering.");
    expect(gaveUp.message).toBe("The linked environment stopped answering.");
    // Dropped and sent again; dropped once; then every try a repeatable call gets.
    expect(toolCalls).toBe(2 + 1 + (1 + PeerMcpClient.DROPPED_ROUTE_RETRIES));
    // A drop sent again and answered leaves the link healthy; the others say what the socket said.
    const dropped =
      "Transport error (POST https://peer.example/mcp): other side closed (UND_ERR_SOCKET)";
    expect(outcomes).toEqual([null, dropped, dropped]);
  }).pipe(Effect.scoped),
);
