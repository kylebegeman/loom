import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  PreviewLinksError,
  type PreviewLink,
  type PreviewLinksSnapshot,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, Tool } from "effect/ai";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { PreviewLinksService, type PreviewLinkActor } from "./PreviewLinksService.ts";
import { PreviewLinksToolkit, previewLinksHandlers } from "./mcp.ts";

const caller = ThreadId.make("preview-caller");
const other = ThreadId.make("preview-other");

const linkFor = (id: string, port: number, threadId: ThreadId | null): PreviewLink => ({
  id,
  kind: "port",
  port,
  host: `${port}-abc123-dorothy.bagels.top`,
  url: `https://${port}-abc123-dorothy.bagels.top/`,
  createdBy: threadId === null ? "owner" : "agent",
  threadId,
  laneId: null,
  state: "open",
  lifetime: "12h",
  createdAt: "2026-10-18T00:00:00.000Z",
  expiresAt: "2026-10-18T12:00:00.000Z",
  endedAt: null,
  restorableUntil: null,
});

const snapshot = (links: ReadonlyArray<PreviewLink>): PreviewLinksSnapshot => ({
  setup: {
    settings: {
      enabled: true,
      suffix: "bagels.top",
      machine: "dorothy",
      defaultLifetime: "12h",
      gatewayPort: 3779,
    },
    tokenStored: true,
    ready: true,
    tunnel: { state: "connected", message: null },
    gateway: { state: "listening", message: null },
  },
  links,
});

/** Fails the test on any service call the agent tools must never make, such as `open`. */
const makeService = () => {
  const links = new Map<string, PreviewLink>([
    ["mine", linkFor("mine", 41000, caller)],
    ["theirs", linkFor("theirs", 41020, other)],
    ["owners", linkFor("owners", 5173, null)],
  ]);
  const calls = { share: [] as Array<PreviewLinkActor>, revoke: [] as Array<PreviewLinkActor> };
  const fields: Partial<PreviewLinksService["Service"]> = {
    snapshot: Effect.sync(() => snapshot([...links.values()])),
    listForThread: (threadId) =>
      Effect.sync(() => [...links.values()].filter((link) => link.threadId === threadId)),
    share: (input, actor) =>
      Effect.sync(() => {
        calls.share.push(actor);
        const link = linkFor("shared", input.port, actor._tag === "Agent" ? actor.threadId : null);
        links.set(link.id, link);
        return link;
      }),
    revoke: (linkId, actor) =>
      Effect.suspend(() => {
        calls.revoke.push(actor);
        const link = links.get(linkId);
        if (link === undefined || (actor._tag === "Agent" && link.threadId !== actor.threadId)) {
          return Effect.fail(
            new PreviewLinksError({
              reason: "not-found",
              message: "That preview link was not found in this thread.",
            }),
          );
        }
        const ended: PreviewLink = { ...link, state: "revoked" };
        links.set(linkId, ended);
        return Effect.succeed(ended);
      }),
  };
  const service = new Proxy(fields as PreviewLinksService["Service"], {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Agent tools must not call PreviewLinksService.${String(key)}`);
    },
  });
  return { service, calls, links };
};

const decodeToolJson = Schema.decodeUnknownEffect(McpSchema.ToolJson);

const threadScope: McpInvocationScope = {
  environmentId: EnvironmentId.make("preview-host"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  requestNamespace: "preview-links-test",
  thread: {
    threadId: caller,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
};

const harness = (service: PreviewLinksService["Service"]) =>
  Effect.gen(function* () {
    const toolkit = yield* PreviewLinksToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(previewLinksHandlers).pipe(
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(PreviewLinksService, service) as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    const invoke = <Name extends keyof typeof PreviewLinksToolkit.tools>(
      name: Name,
      input: Tool.ParametersEncoded<(typeof PreviewLinksToolkit.tools)[Name]>,
      scope: McpInvocationScope = threadScope,
    ) =>
      toolkit.handle(name, input).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.map((results) => results[0]?.result),
        Effect.provideService(McpInvocationContext, scope),
        Effect.provide(
          Layer.mock(ThreadManagementService)({
            getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
          }),
        ),
      );
    return invoke;
  });

it.effect("declares object input schemas under unique loom_ names", () =>
  Effect.gen(function* () {
    const names = Object.keys(PreviewLinksToolkit.tools);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith("loom_preview_link"))).toBe(true);
    for (const tool of Object.values(PreviewLinksToolkit.tools)) {
      const schema = yield* decodeToolJson(Tool.getJsonSchema(tool));
      expect(schema.type).toBe("object");
    }
  }),
);

it.effect("shares as the calling thread and returns only the canonical link", () =>
  Effect.gen(function* () {
    const { service, calls } = makeService();
    const invoke = yield* harness(service);
    const link = yield* invoke("loom_preview_link_share", { port: 41001, lifetime: "1h" });
    expect(calls.share).toEqual([{ _tag: "Agent", threadId: caller }]);
    expect(link).toMatchObject({
      port: 41001,
      threadId: caller,
      createdBy: "agent",
      url: "https://41001-abc123-dorothy.bagels.top/",
    });
    expect(JSON.stringify(link)).not.toContain("__loom/enter");
  }),
);

it.effect("lists only the calling thread's links with the setup readiness", () =>
  Effect.gen(function* () {
    const { service } = makeService();
    const invoke = yield* harness(service);
    const listed = yield* invoke("loom_preview_links_list", {});
    expect(listed).toEqual({
      ready: true,
      tunnel: "connected",
      links: [linkFor("mine", 41000, caller)],
    });
  }),
);

it.effect("revokes the caller's own link and refuses another thread's or the owner's", () =>
  Effect.gen(function* () {
    const { service, calls, links } = makeService();
    const invoke = yield* harness(service);
    for (const linkId of ["theirs", "owners"]) {
      const refused = yield* invoke("loom_preview_link_revoke", { linkId }).pipe(Effect.flip);
      expect(refused).toMatchObject({ _tag: "PreviewLinksError", reason: "not-found" });
      expect(links.get(linkId)?.state).toBe("open");
    }
    const ended = yield* invoke("loom_preview_link_revoke", { linkId: "mine" });
    expect(ended).toMatchObject({ id: "mine", state: "revoked" });
    expect(calls.revoke.every((actor) => actor._tag === "Agent" && actor.threadId === caller)).toBe(
      true,
    );
  }),
);

it.effect("refuses the act tools to clients outside a live thread before the service runs", () =>
  Effect.gen(function* () {
    const { service, calls } = makeService();
    const invoke = yield* harness(service);
    const readOnly: McpInvocationScope = {
      ...threadScope,
      thread: undefined,
      client: { sessionId: "reader", label: "Read only", access: "read-only" },
    };
    const outside = yield* invoke("loom_preview_link_share", { port: 41001 }, readOnly).pipe(
      Effect.flip,
    );
    expect(outside).toMatchObject({ code: "thread_credential_required" });
    const readOnlyThread = yield* invoke(
      "loom_preview_link_revoke",
      { linkId: "mine" },
      { ...threadScope, client: readOnly.client },
    ).pipe(Effect.flip);
    expect(readOnlyThread).toMatchObject({ code: "capability_denied" });
    expect(calls.share).toEqual([]);
    expect(calls.revoke).toEqual([]);
  }),
);
