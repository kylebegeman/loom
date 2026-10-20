import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentId,
} from "@t3tools/contracts";
import { LibraryPageReplies, PREVIEW_PAGE_MAX_BYTES, PreviewPage } from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { PageLibraryHttpRoutes } from "./libraryHttp.ts";
import { PreviewPagesMigrations } from "./libraryMigrations.ts";
import * as PageLibrary from "./PageLibraryService.ts";

const ROUTE = "http://library.example.test/api/loom/library/pages";
const COMPUTER = "loom-host:environment-dorothy";
const ENV = { LOOM_LIBRARY_AUTHORITY: "true", LOOM_PAGES_ORIGIN: "https://pages.example.test" };

const decodePage = Schema.decodeUnknownEffect(PreviewPage);
const decodeReplies = Schema.decodeUnknownEffect(LibraryPageReplies);
const decodeList = Schema.decodeUnknownEffect(Schema.Struct({ pages: Schema.Array(PreviewPage) }));

const sessionFor = (
  subject: string,
  scopes: EnvironmentAuth.AuthenticatedSession["scopes"],
): EnvironmentAuth.AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${subject}`),
  subject,
  method: "bearer-access-token",
  scopes,
});

const publishBody = {
  projectId: "project-loom",
  threadId: "thread-plan",
  title: "Release plan",
  kind: "html",
  html: "<h1>Plan</h1>",
};

const fixture = (env: Record<string, string>) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(PreviewPagesMigrations);
    const context = yield* Layer.build(
      PageLibrary.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
    );
    const pages = Context.get(context, PageLibrary.PageLibraryService);
    const caller = yield* Ref.make<EnvironmentAuth.AuthenticatedSession | null>(
      sessionFor(COMPUTER, [AuthLibraryPublishScope]),
    );
    const app = PageLibraryHttpRoutes.pipe(
      Layer.provide(
        Layer.succeed(ForkRuntime, context as unknown as Context.Context<ForkServices>),
      ),
      HttpRouter.provideRequest(
        Layer.mergeAll(
          NodeHttpPlatform.layer,
          // The fork runtime already carries the page service; naming it here keeps the handler's
          // type free of it whether or not ForkServices lists it.
          Layer.succeedContext(context),
          Layer.mock(EnvironmentAuth.EnvironmentAuth)({
            authenticateHttpRequest: () =>
              Ref.get(caller).pipe(
                Effect.filterOrFail(
                  (session): session is EnvironmentAuth.AuthenticatedSession => session !== null,
                  () => new EnvironmentAuth.ServerAuthMissingCredentialError(),
                ),
              ),
          }),
        ),
      ),
      Layer.provide(NodeServices.layer),
    );
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    const call = (
      path: string,
      init: { readonly body?: string; readonly headers?: Record<string, string> } = {},
    ) =>
      Effect.promise(() =>
        web.handler(
          new Request(`${ROUTE}${path}`, {
            method: init.body === undefined ? "GET" : "POST",
            ...(init.body === undefined ? {} : { body: init.body }),
            headers: { "content-type": "application/json", ...init.headers },
          }),
        ),
      );
    const post = (path: string, body: unknown) => call(path, { body: JSON.stringify(body) });
    return { pages, caller, call, post };
  });

const run = <A, E>(
  env: Record<string, string>,
  use: (f: Effect.Success<ReturnType<typeof fixture>>) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  fixture(env).pipe(
    Effect.flatMap(use),
    Effect.scoped,
    Effect.provide(SqlitePersistenceMemory.pipe(Layer.provideMerge(NodeServices.layer))),
  );

const bodyOf = (response: Response) => Effect.promise(() => response.json());

describe("Library page routes", () => {
  it.effect("serve only a computer's own publisher session", () =>
    run(ENV, (f) =>
      Effect.gen(function* () {
        yield* Ref.set(f.caller, null);
        const anonymous = yield* f.call("");
        expect(anonymous.status).toBe(401);
        expect(anonymous.headers.get("cache-control")).toBe("no-store");

        for (const session of [
          sessionFor("owner", [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]),
          sessionFor("mcp-client", [AuthLibraryPublishScope]),
          sessionFor(COMPUTER, [AuthOrchestrationReadScope]),
          sessionFor("loom-host:", [AuthLibraryPublishScope]),
        ]) {
          yield* Ref.set(f.caller, session);
          const denied = yield* f.post("/publish", publishBody);
          expect(denied.status).toBe(403);
          expect(denied.headers.get("cache-control")).toBe("no-store");
        }
        // None of the refused calls published anything.
        const computer = {
          subject: COMPUTER,
          environmentId: EnvironmentId.make("environment-dorothy"),
        };
        expect(yield* f.pages.list(computer)).toEqual([]);
      }),
    ),
  );

  it.effect("answers 404 before reading the body when this Library does not serve pages", () =>
    run({ LOOM_LIBRARY_AUTHORITY: "true" }, (f) =>
      Effect.gen(function* () {
        const listed = yield* f.call("");
        expect(listed.status).toBe(404);
        expect(yield* bodyOf(listed)).toEqual({ reason: "unavailable" });
        const oversized = yield* f.call("/publish", {
          body: "{}",
          headers: { "content-length": String(4 * PREVIEW_PAGE_MAX_BYTES) },
        });
        expect(oversized.status).toBe(404);
        expect(oversized.headers.get("cache-control")).toBe("no-store");
        // A computer reads this as a Library whose pages browsers it need not sign out.
        expect((yield* f.post("/sign-out", {})).status).toBe(404);
      }),
    ),
  );

  it.effect("sign every pages browser out for a computer's publisher session only", () =>
    run(ENV, (f) =>
      Effect.gen(function* () {
        yield* Ref.set(f.caller, sessionFor("owner", [AuthOrchestrationOperateScope]));
        expect((yield* f.post("/sign-out", {})).status).toBe(403);
        expect(yield* f.pages.readersSignedOutAt).toBe(0);

        yield* Ref.set(f.caller, sessionFor(COMPUTER, [AuthLibraryPublishScope]));
        const signedOut = yield* f.post("/sign-out", {});
        expect(signedOut.status).toBe(204);
        expect(signedOut.headers.get("cache-control")).toBe("no-store");
        // The handler runs on its own runtime's live clock, so only the change is certain.
        expect(yield* f.pages.readersSignedOutAt).toBeGreaterThan(0);
      }),
    ),
  );

  it.effect("publish, list, update and settle replies for the calling computer", () =>
    run(ENV, (f) =>
      Effect.gen(function* () {
        const published = yield* f.post("/publish", publishBody);
        expect(published.status).toBe(200);
        expect(published.headers.get("cache-control")).toBe("no-store");
        const page = yield* decodePage(yield* bodyOf(published));
        expect(page).toMatchObject({ title: "Release plan", state: "open", kept: false });
        expect(page.url).toBe(`https://pages.example.test/p/${page.id}`);

        const listed = yield* decodeList(yield* bodyOf(yield* f.call("")));
        expect(listed.pages.map((entry) => entry.id)).toEqual([page.id]);

        const kept = yield* decodePage(
          yield* bodyOf(yield* f.post("/update", { pageId: page.id, action: "keep" })),
        );
        expect(kept).toMatchObject({ kept: true, expiresAt: null });

        yield* f.pages.addReply({
          pageId: page.id,
          replyId: "reply-000001",
          text: "Ship it",
          viewer: "owner",
        });
        const next = yield* f.post("/replies/next", { waitMs: 0 });
        expect(next.status).toBe(200);
        const { replies } = yield* decodeReplies(yield* bodyOf(next));
        expect(replies.map((reply) => [reply.replyId, reply.text])).toEqual([
          ["reply-000001", "Ship it"],
        ]);

        const acked = yield* f.post("/replies/ack", {
          replyId: "reply-000001",
          outcome: "delivered",
        });
        expect(acked.status).toBe(204);
        expect(acked.headers.get("cache-control")).toBe("no-store");
      }),
    ),
  );

  // Computers show the message as is, so it has to survive the trip.
  it.effect("map page errors to 409 with their reason and message", () =>
    run(ENV, (f) =>
      Effect.gen(function* () {
        const missing = yield* f.post("/update", { pageId: "missing", action: "end" });
        expect(missing.status).toBe(409);
        expect(missing.headers.get("cache-control")).toBe("no-store");
        expect(yield* bodyOf(missing)).toEqual({
          reason: "not-found",
          message: "This page does not exist.",
        });

        const blank = yield* f.post("/publish", { ...publishBody, title: "   " });
        expect([blank.status, yield* bodyOf(blank)]).toEqual([
          409,
          { reason: "invalid", message: "A page title needs between 1 and 200 characters." },
        ]);

        const malformed = yield* f.call("/update", { body: "{not json" });
        expect([malformed.status, yield* bodyOf(malformed)]).toEqual([
          409,
          { reason: "invalid", message: "The request is malformed." },
        ]);

        const page = yield* decodePage(yield* bodyOf(yield* f.post("/publish", publishBody)));
        const reopened = yield* f.post("/update", { pageId: page.id, action: "restore" });
        expect([reopened.status, yield* bodyOf(reopened)]).toEqual([
          409,
          { reason: "invalid", message: "This page is already open." },
        ]);

        const wrongOutcome = yield* f.post("/replies/ack", { replyId: "r", outcome: "maybe" });
        expect(wrongOutcome.status).toBe(409);
        expect(yield* bodyOf(wrongOutcome)).toMatchObject({ reason: "invalid" });
      }),
    ),
  );

  // The Node server also stops an undeclared body at the cap while reading; the web handler used
  // here does not, so only the declared length is exercised.
  it.effect("refuse bodies declared over the route's cap", () =>
    run(ENV, (f) =>
      Effect.gen(function* () {
        const declared = yield* f.call("/publish", {
          body: JSON.stringify(publishBody),
          headers: { "content-length": String(2 * PREVIEW_PAGE_MAX_BYTES + 64 * 1024 + 1) },
        });
        expect(declared.status).toBe(413);
        expect(declared.headers.get("cache-control")).toBe("no-store");
        expect(yield* bodyOf(declared)).toEqual({ reason: "too-large" });

        const small = yield* f.call("/update", {
          body: "{}",
          headers: { "content-length": String(16 * 1024 + 1) },
        });
        expect(small.status).toBe(413);

        const malformedLength = yield* f.call("/update", {
          body: "{}",
          headers: { "content-length": "12abc" },
        });
        expect(malformedLength.status).toBe(413);
      }),
    ),
  );
});
