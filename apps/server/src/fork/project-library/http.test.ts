import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthLibraryRecoveryReadScope,
  AuthOrchestrationOperateScope,
  AuthSessionId,
} from "@t3tools/contracts";
import {
  LibraryIngestHistoryRequest,
  type LibraryBriefProposalSource,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { HttpClientRequest } from "effect/http";
import { libraryJsonBody } from "./transfer.ts";
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
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const fixture = Effect.gen(function* () {
  const calls = yield* Ref.make(0);
  const proposed = yield* Ref.make<LibraryBriefProposalSource | null>(null);
  const session = yield* Ref.make<EnvironmentAuth.AuthenticatedSession>({
    sessionId: AuthSessionId.make("session"),
    subject: `loom-host:${source}`,
    method: "bearer-access-token",
    scopes: [AuthLibraryPublishScope],
  });
  const library = yield* Library.LibraryService.pipe(
    Effect.provide(
      Layer.mock(Library.LibraryService)({
        publishDocuments: () =>
          Ref.update(calls, (count) => count + 1).pipe(Effect.as({ published: 1, removed: 0 })),
        decisions: () => Ref.update(calls, (count) => count + 1).pipe(Effect.as({ hits: [] })),
        info: Effect.succeed({
          environmentId: source,
          authorityId: "authority",
          authorityEpoch: 1,
          assets: "local",
        }),
        registerComputer: (input) =>
          Ref.update(calls, (count) => count + 1).pipe(
            Effect.as({
              ...input.computer,
              enrolledAt: "2026-10-15T00:00:00.000Z",
              lastSeenAt: "2026-10-15T00:00:00.000Z",
            }),
          ),
        proposeBrief: (input, proposalSource) =>
          Ref.set(proposed, proposalSource).pipe(
            Effect.as({ id: "proposal", projectId: input.projectId } as never),
          ),
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
  const request = (path: string, body?: string | ArrayBuffer, headers?: Record<string, string>) =>
    Effect.promise(() =>
      web.handler(
        new Request(`http://localhost/api/loom/library/${path}`, {
          method: body === undefined ? "GET" : "POST",
          ...(body === undefined ? {} : { body }),
          headers: { "content-type": "application/json", ...headers },
        }),
      ),
    );
  return { calls, proposed, session, input, request };
});
const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);
describe("Library host HTTP publishing boundaries", () => {
  it.effect(
    "authenticates document publication against the enrolled source and authority fence",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const input = {
            computerId: source,
            projectId: "project",
            resourceId: "api",
            commit: "a".repeat(40),
            documents: [],
            removed: [],
            authorityId: "authority",
            authorityEpoch: 1,
          };
          expect((yield* f.request("documents/publish", yield* encodeJson(input))).status).toBe(
            200,
          );
          expect(
            (yield* f.request(
              "documents/publish",
              yield* encodeJson({ ...input, computerId: "other" }),
            )).status,
          ).toBe(403);
          const { authorityId: _id, ...unfenced } = input;
          expect((yield* f.request("documents/publish", yield* encodeJson(unfenced))).status).toBe(
            400,
          );
          yield* Ref.update(f.session, (session) => ({
            ...session,
            subject: "operator",
            scopes: [AuthOrchestrationOperateScope],
          }));
          expect((yield* f.request("documents/publish", yield* encodeJson(input))).status).toBe(
            403,
          );
          expect(yield* Ref.get(f.calls)).toBe(1);
        }),
      ),
  );
  it.effect(
    "allows authenticated decision reads and bounds the request before calling the service",
    () =>
      run((f) =>
        Effect.gen(function* () {
          expect(
            (yield* f.request(
              "documents/search",
              yield* encodeJson({ query: "owner recovery", projectId: "project" }),
            )).status,
          ).toBe(200);
          expect(
            (yield* f.request("documents/publish", "{}", {
              "content-length": String(25 * 1024 * 1024),
            })).status,
          ).toBe(413);
          yield* Ref.update(f.session, (session) => ({
            ...session,
            subject: "mcp-client",
            scopes: [AuthLibraryPublishScope],
          }));
          expect(
            (yield* f.request("documents/search", yield* encodeJson({ query: "owner recovery" })))
              .status,
          ).toBe(403);
          expect(yield* Ref.get(f.calls)).toBe(1);
        }),
      ),
  );

  it.effect("allows a saved-file grant to identify the Library without publishing history", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.session, (session) => ({
          ...session,
          subject: "loom-library-recovery:fixture",
          scopes: [AuthLibraryRecoveryReadScope],
        }));
        expect((yield* f.request("info")).status).toBe(200);
        expect((yield* f.request("history/ingest", yield* encodeIngest(f.input))).status).toBe(403);
        expect(yield* Ref.get(f.calls)).toBe(0);
      }),
    ),
  );

  it.effect("records a forwarded proposal as the sending computer's conversation", () =>
    run((f) =>
      Effect.gen(function* () {
        const body = yield* encodeJson({
          requestId: "suggest",
          projectId: "project",
          baseRevision: 1,
          proposedBrief: "Ship the viewer. Export as STEP.",
          summary: "Record the export decision.",
          threadId: "thread-1",
        });
        expect((yield* f.request("brief/propose", body)).status).toBe(200);
        expect(yield* Ref.get(f.proposed)).toEqual({
          kind: "conversation",
          environmentId: source,
          threadId: "thread-1",
        });

        // An operator session names no computer, so it cannot propose as a conversation.
        yield* Ref.set(f.proposed, null);
        yield* Ref.update(f.session, (session) => ({
          ...session,
          subject: "operator",
          scopes: [AuthOrchestrationOperateScope],
        }));
        expect((yield* f.request("brief/propose", body)).status).toBe(403);
        expect(yield* Ref.get(f.proposed)).toBeNull();
      }),
    ),
  );
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
  it.effect(
    "accepts compressed complete history and rejects corrupt compressed input before writing",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const thread = f.input.entries[0]!.thread;
          const request = {
            ...f.input,
            entries: [
              {
                sequence: 1,
                thread: {
                  ...thread,
                  projection: {
                    ...thread.projection,
                    messages: [
                      { ...thread.projection.messages[0]!, text: "x".repeat(2 * 1024 * 1024) },
                    ],
                  },
                },
              },
            ],
          };
          const body = yield* libraryJsonBody(
            HttpClientRequest.post("https://library.test"),
            yield* encodeIngest(request),
          );
          expect(body.headers["content-encoding"]).toBe("gzip");
          if (body.body._tag !== "Uint8Array") throw new Error("Expected compressed body");
          expect(
            (yield* f.request("history/ingest", new Uint8Array(body.body.body).buffer, {
              "content-encoding": "gzip",
            })).status,
          ).toBe(200);
          expect(
            (yield* f.request("history/ingest", new Uint8Array([1, 2, 3]).buffer, {
              "content-encoding": "gzip",
            })).status,
          ).toBe(400);
          expect(yield* Ref.get(f.calls)).toBe(1);
        }),
      ),
  );
  it.effect("fences computer directory updates to the enrolled source identity", () =>
    run((f) =>
      Effect.gen(function* () {
        const payload = yield* encodeJson({
          authorityId: "authority",
          authorityEpoch: 1,
          computer: {
            environmentId: source,
            label: "Dorothy",
            platform: { os: "darwin", arch: "arm64" },
            appVersion: "0.0.58",
            supportsExecution: true,
            endpoints: [],
          },
        });
        expect((yield* f.request("computers/register", payload)).status).toBe(200);
        yield* Ref.update(f.session, (session) => ({ ...session, subject: "loom-host:other" }));
        expect((yield* f.request("computers/register", payload)).status).toBe(403);
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
            "content-length": String(512 * 1024 * 1024 + 1),
          })).status,
        ).toBe(413);
        expect((yield* f.request("history/ingest", "{}")).status).toBe(400);
        expect(yield* Ref.get(f.calls)).toBe(0);
      }),
    ),
  );
});
