import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthOrchestrationOperateScope,
  AuthSessionId,
} from "@t3tools/contracts";
import { LibraryIngestHistoryRequest } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as Library from "./LibraryService.ts";
import { LibraryHttpRoutes } from "./http.ts";
import { source, resource, archiveFor } from "./Library.testkit.ts";
const encodeIngest = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(LibraryIngestHistoryRequest)),
);
const fixture = Effect.gen(function* () {
  const calls = yield* Ref.make(0);
  const session = yield* Ref.make<EnvironmentAuth.AuthenticatedSession>({
    sessionId: AuthSessionId.make("session"),
    subject: `loom-host:${source}`,
    method: "bearer-access-token",
    scopes: [AuthLibraryPublishScope],
  });
  const library = yield* Library.LibraryService.pipe(
    Effect.provide(
      Layer.mock(Library.LibraryService)({
        info: Effect.succeed({
          environmentId: source,
          authorityId: "authority",
          authorityEpoch: 1,
          assets: "local",
        }),
        ingestHistory: (input) =>
          Ref.update(calls, (count) => count + 1).pipe(
            Effect.as({
              sourceEnvironmentId: input.sourceEnvironmentId,
              journalId: input.journalId,
              lastSequence: input.entries.at(-1)!.sequence,
              applied: input.entries.length,
            }),
          ),
      }),
    ),
  );
  // Only the Library service is used by these transport routes.
  const runtime = Context.make(Library.LibraryService, library) as Context.Context<ForkServices>;
  const app = LibraryHttpRoutes.pipe(
    Layer.provide(Layer.succeed(ForkRuntime, runtime)),
    HttpRouter.provideRequest(
      Layer.merge(
        NodeHttpPlatform.layer,
        Layer.mock(EnvironmentAuth.EnvironmentAuth)({
          authenticateHttpRequest: () => Ref.get(session),
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  const web = HttpRouter.toWebHandler(app, { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
  const archive = yield* archiveFor({
    id: "project",
    title: "AspectAvy",
    brief: "",
    revision: 1,
    resources: [resource],
    archived: false,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  });
  const input = {
    requestId: "publish",
    sourceEnvironmentId: source,
    journalId: "journal",
    fromSequence: 0,
    authorityId: "authority",
    authorityEpoch: 1,
    entries: [{ sequence: 1, thread: archive }],
  };
  const request = (path: string, body?: string, headers?: Record<string, string>) =>
    Effect.promise(() =>
      web.handler(
        new Request(`http://localhost/api/loom/library/${path}`, {
          method: body === undefined ? "GET" : "POST",
          ...(body === undefined ? {} : { body }),
          headers: { "content-type": "application/json", ...headers },
        }),
      ),
    );
  return { calls, session, input, request };
});
const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);
describe("Library host HTTP publishing boundaries", () => {
  it.effect(
    "accepts a dedicated host publisher only for its source and pinned authority tuple",
    () =>
      run((f) =>
        Effect.gen(function* () {
          expect((yield* f.request("info")).status).toBe(200);
          expect((yield* f.request("history/ingest", yield* encodeIngest(f.input))).status).toBe(
            200,
          );
          const { authorityId: _id, authorityEpoch: _epoch, ...unfenced } = f.input;
          expect((yield* f.request("history/ingest", yield* encodeIngest(unfenced))).status).toBe(
            403,
          );
          yield* Ref.update(f.session, (session) => ({ ...session, subject: "loom-host:other" }));
          expect((yield* f.request("history/ingest", yield* encodeIngest(f.input))).status).toBe(
            403,
          );
          expect(yield* Ref.get(f.calls)).toBe(1);
        }),
      ),
  );
  it.effect("keeps catalog imports operator-only and bounds request bodies", () =>
    run((f) =>
      Effect.gen(function* () {
        expect((yield* f.request("import-shadow", "{}")).status).toBe(403);
        yield* Ref.update(f.session, (session) => ({
          ...session,
          subject: "operator",
          scopes: [AuthOrchestrationOperateScope],
        }));
        expect(
          (yield* f.request("history/ingest", yield* encodeIngest(f.input), {
            "content-length": String(128 * 1024 * 1024 + 1),
          })).status,
        ).toBe(413);
        expect((yield* f.request("history/ingest", "{}")).status).toBe(400);
        expect(yield* Ref.get(f.calls)).toBe(0);
      }),
    ),
  );
});
