import { describe, expect, it } from "@effect/vitest";
import { EnvironmentAuthorizationError, EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  LIBRARY_WS_METHODS as L,
  PROJECT_WORKFLOW_WS_METHODS as W,
  type LibraryManagementDelegation,
  type LibraryManagementEnrollment,
  type LibraryCreateProjectRequest,
  type LibraryProject,
  type LibraryThreadArchive,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { RpcClientError } from "effect/rpc";
import * as Socket from "effect/socket/Socket";
import { vi } from "vite-plus/test";
import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type * as RpcSession from "../rpc/session.ts";
import { v2Projection } from "../state/orchestrationV2TestFixtures.ts";
import { createProjectLibraryAtoms, squashLibraryCommandFailure } from "./project-library.ts";

vi.mock("../state/commandPermissions.ts", async () => {
  const { Atom } = await import("effect/reactivity");
  const Effect = await import("effect/Effect");
  return {
    createCommandPermissions: () => ({
      authorize: () => Effect.void,
      permissionAtom: () => Atom.make(true),
      requiredScopes: () => [],
    }),
  };
});

const environmentId = EnvironmentId.make("central-library");
const now = "2026-10-15T12:00:00Z";
const project: LibraryProject = {
  id: "project",
  title: "Project",
  brief: "Shared work",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: now,
  updatedAt: now,
};
const copy: LibraryWorkingCopy = {
  id: "new-copy",
  projectId: project.id,
  projectRevision: 1,
  environmentId,
  rootPath: "/workspace/project",
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: now,
  updatedAt: now,
};
const archive: LibraryThreadArchive = {
  summary: {
    id: "saved-thread",
    projectId: project.id,
    environmentId,
    threadId: v2Projection.thread.id,
    localProjectId: v2Projection.thread.projectId,
    workingCopyId: null,
    resourceIds: [],
    title: "Conversation",
    status: "idle",
    archived: false,
    createdAt: now,
    updatedAt: now,
    syncedAt: now,
    sequence: 1,
  },
  projection: v2Projection,
};

describe("Library cross-client freshness", () => {
  it.effect(
    "refreshes mounted catalogs on another client's change without downloading full history",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const revision = yield* SubscriptionRef.make(0);
          const catalogTags = [
            L.projects,
            L.project,
            L.copies,
            L.threads,
            W.blueprint,
            W.preservation,
          ] as const;
          const makeClient = Effect.fnUntraced(function* () {
            const updated = new Map<string, Deferred.Deferred<void>>();
            for (const tag of catalogTags) updated.set(tag, yield* Deferred.make<void>());
            let historyReads = 0;
            const response = <A>(tag: string, value: (revision: number) => A) =>
              Effect.gen(function* () {
                const current = yield* SubscriptionRef.get(revision);
                if (tag === L.history) historyReads++;
                const milestone = updated.get(tag);
                if (current > 0 && milestone) yield* Deferred.succeed(milestone, undefined);
                return value(current);
              });
            const session = {
              client: {
                [L.subscribeRefreshes]: () => SubscriptionRef.changes(revision),
                [W.changes]: () => Stream.never,
                [W.blueprint]: () =>
                  response(W.blueprint, () => ({
                    format: "loom-project",
                    version: 1,
                    title: project.title,
                    brief: project.brief,
                    resources: [],
                    connections: [],
                  })),
                [W.preservation]: () => response(W.preservation, () => []),
                [L.projects]: () => response(L.projects, () => [project]),
                [L.project]: () => response(L.project, () => project),
                [L.copies]: () => response(L.copies, (current) => (current > 0 ? [copy] : [])),
                [L.threads]: () => response(L.threads, () => [archive.summary]),
                [L.history]: () => response(L.history, () => archive),
              },
            } as unknown as RpcSession.RpcSession;
            const target = new PrimaryConnectionTarget({
              environmentId,
              label: "Library",
              httpBaseUrl: "https://library.example.test",
              wsBaseUrl: "wss://library.example.test",
            });
            const state = yield* SubscriptionRef.make<SupervisorConnectionState>({
              ...AVAILABLE_CONNECTION_STATE,
              desired: true,
              network: "online",
              phase: "connected",
              attempt: 1,
              generation: 1,
            });
            const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
              target,
              state,
              session: yield* SubscriptionRef.make(Option.some(session)),
              prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
                Option.none(),
              ),
              connect: Effect.void,
              disconnect: Effect.void,
              retryNow: Effect.void,
            });
            const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_id, effect) =>
              Effect.provideService(
                effect,
                EnvironmentSupervisor.EnvironmentSupervisor,
                supervisor,
              );
            const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] =
              (_id, stream) =>
                Stream.provideService(
                  stream,
                  EnvironmentSupervisor.EnvironmentSupervisor,
                  supervisor,
                );
            const service = EnvironmentRegistry.EnvironmentRegistry.of({
              run,
              followStream,
              stateChanges: () => SubscriptionRef.changes(state),
            } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
            const atoms = createProjectLibraryAtoms(
              Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, service)),
            );
            const registry = AtomRegistry.make();
            yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
            const catalog = {
              projects: atoms.projects({ environmentId, input: {} }),
              project: atoms.project({ environmentId, input: { projectId: project.id } }),
              copies: atoms.copies({ environmentId, input: { projectId: project.id } }),
              threads: atoms.threads({ environmentId, input: { projectId: project.id } }),
              blueprint: atoms.blueprint({ environmentId, input: { projectId: project.id } }),
              preservation: atoms.preservation({ environmentId, input: {} }),
              history: atoms.history({ environmentId, input: { id: archive.summary.id } }),
            };
            const mounted: readonly Atom.Atom<unknown>[] = Object.values(catalog);
            for (const atom of mounted) registry.mount(atom);
            yield* Effect.all([
              AtomRegistry.getResult(registry, catalog.projects, { suspendOnWaiting: true }),
              AtomRegistry.getResult(registry, catalog.project, { suspendOnWaiting: true }),
              AtomRegistry.getResult(registry, catalog.threads, { suspendOnWaiting: true }),
              AtomRegistry.getResult(registry, catalog.history, { suspendOnWaiting: true }),
              AtomRegistry.getResult(registry, catalog.blueprint, { suspendOnWaiting: true }),
              AtomRegistry.getResult(registry, catalog.preservation, { suspendOnWaiting: true }),
            ]);
            expect(
              yield* AtomRegistry.getResult(registry, catalog.copies, { suspendOnWaiting: true }),
            ).toEqual([]);
            return { registry, copies: catalog.copies, updated, historyReads: () => historyReads };
          });
          const first = yield* makeClient();
          const second = yield* makeClient();
          yield* SubscriptionRef.set(revision, 1);
          for (const client of [first, second]) {
            for (const milestone of client.updated.values()) yield* Deferred.await(milestone);
            expect(
              (yield* AtomRegistry.getResult(client.registry, client.copies, {
                suspendOnWaiting: true,
              })).map((value) => value.id),
            ).toEqual([copy.id]);
            expect(client.historyReads()).toBe(1);
          }
        }),
      ),
  );
});

const makeCreationHarness = Effect.fn("TestProjectLibrary.creationHarness")(function* (
  create: (
    input: LibraryCreateProjectRequest,
  ) => Effect.Effect<
    LibraryProject,
    LibraryError | EnvironmentAuthorizationError | RpcClientError.RpcClientError
  >,
) {
  const session = { client: { [L.createProject]: create } } as unknown as RpcSession.RpcSession;
  const activeSession = yield* SubscriptionRef.make(Option.some(session));
  const state = yield* SubscriptionRef.make<SupervisorConnectionState>({
    ...AVAILABLE_CONNECTION_STATE,
    desired: true,
    network: "online",
    phase: "connected",
  });
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: new PrimaryConnectionTarget({
      environmentId,
      label: "Library",
      httpBaseUrl: "https://library.example.test",
      wsBaseUrl: "wss://library.example.test",
    }),
    state,
    session: activeSession,
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const service = EnvironmentRegistry.EnvironmentRegistry.of({
    run: (_id, effect) =>
      Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
  } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
  const atoms = createProjectLibraryAtoms(
    Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, service)),
  );
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  return { activeSession, state, atoms, registry };
});

describe("Library project creation recovery", () => {
  it.effect(
    "returns an uncertain create outcome without replaying it after the session reconnects",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const received = yield* Deferred.make<void>();
          const requests: unknown[] = [];
          const input = { requestId: "create-desk", title: "desk", resources: [] };
          const h = yield* makeCreationHarness((request) => {
            requests.push(request);
            return Deferred.succeed(received, undefined).pipe(
              Effect.andThen(
                Effect.fail(
                  new RpcClientError.RpcClientError({
                    reason: new Socket.SocketCloseError({ code: 1006 }),
                  }),
                ),
              ),
            );
          });
          const command = yield* Effect.promise(() =>
            h.atoms.createProject.run(h.registry, { environmentId, input }),
          ).pipe(Effect.forkChild);
          yield* Deferred.await(received);
          yield* SubscriptionRef.set(h.activeSession, Option.none());
          yield* SubscriptionRef.update(h.state, (state) => ({
            ...state,
            phase: "backoff" as const,
          }));
          expect(requests).toEqual([input]);
          const replacement = {
            client: {
              [L.createProject]: (request: typeof input) => {
                requests.push(request);
                return Effect.succeed(project);
              },
            },
          } as unknown as RpcSession.RpcSession;
          yield* SubscriptionRef.set(h.activeSession, Option.some(replacement));
          yield* SubscriptionRef.update(h.state, (state) => ({
            ...state,
            phase: "connected" as const,
          }));
          const result = yield* Fiber.join(command);
          expect(AsyncResult.isFailure(result)).toBe(true);
          if (AsyncResult.isFailure(result))
            expect(Cause.squash(result.cause)).toMatchObject({ _tag: "RpcClientError" });
          expect(requests).toEqual([input]);
        }),
      ),
  );

  it.effect("preserves an uncertain creation outcome when reconnect is blocked", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const received = yield* Deferred.make<void>();
        let calls = 0;
        const h = yield* makeCreationHarness(() => {
          calls++;
          return Deferred.succeed(received, undefined).pipe(
            Effect.andThen(
              Effect.fail(
                new RpcClientError.RpcClientError({
                  reason: new Socket.SocketCloseError({ code: 1006 }),
                }),
              ),
            ),
          );
        });
        const command = yield* Effect.promise(() =>
          h.atoms.createProject.run(h.registry, {
            environmentId,
            input: { requestId: "blocked-create", title: "desk" },
          }),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(received);
        yield* SubscriptionRef.set(h.activeSession, Option.none());
        yield* SubscriptionRef.update(h.state, (state) => ({
          ...state,
          phase: "blocked" as const,
          lastFailure: new ConnectionBlockedError({
            reason: "authentication",
            detail: "Sign in to the Library again.",
          }),
        }));
        const result = yield* Fiber.join(command);
        expect(AsyncResult.isFailure(result)).toBe(true);
        if (AsyncResult.isFailure(result))
          expect(Cause.squash(result.cause)).toMatchObject({
            _tag: "RpcClientError",
          });
        expect(calls).toBe(1);
      }),
    ),
  );

  it.effect.each([
    new LibraryError({ reason: "invalid", detail: "Give the project a name." }),
    new EnvironmentAuthorizationError({
      requiredScope: "settings:write",
      requiredPermission: "settings:write",
      message: "This connection requires settings:write.",
    }),
    new RpcClientError.RpcClientError({
      reason: new RpcClientError.RpcClientDefect({
        message: "Invalid response schema",
        cause: new Error("schema mismatch"),
      }),
    }),
  ])("surfaces non-transport failure without retrying: %s", (error) =>
    Effect.scoped(
      Effect.gen(function* () {
        let calls = 0;
        const h = yield* makeCreationHarness(() => {
          calls++;
          return Effect.fail(error);
        });
        const result = yield* Effect.promise(() =>
          h.atoms.createProject.run(h.registry, {
            environmentId,
            input: { requestId: "invalid-create", title: "desk" },
          }),
        );
        expect(AsyncResult.isFailure(result)).toBe(true);
        if (AsyncResult.isFailure(result)) expect(Cause.squash(result.cause)).toBe(error);
        expect(calls).toBe(1);
      }),
    ),
  );
});

it.effect.each(["ready", "missing"] as const)(
  "establishes current management authorization for a %s computer only through its enrolled Library",
  (initial) =>
    Effect.scoped(
      Effect.gen(function* () {
        const computer = EnvironmentId.make("execution-computer");
        let installed = 0;
        let issued = 0;
        const delegation: LibraryManagementDelegation = {
          token: "dedicated-signed-delegation",
          sourceEnvironmentId: computer,
          libraryEnvironmentId: environmentId,
          authorityId: "authority",
          authorityEpoch: 1,
          keyFingerprint: "a".repeat(64),
          expiresAt: 9999999999999,
        };
        const sourceClient = {
          [L.managementStatus]: () =>
            Effect.succeed({
              state: installed ? ("ready" as const) : initial,
              environmentId: computer,
              keyFingerprint: delegation.keyFingerprint,
              expiresAt: null,
            }),
          [L.info]: () =>
            Effect.succeed({ destination: { environmentId, url: "https://library.example.test" } }),
          [L.installManagementDelegation]: (input: LibraryManagementDelegation) =>
            Effect.sync(() => {
              expect(input).toEqual(delegation);
              installed++;
            }),
        };
        const authorityClient = {
          [L.issueManagementDelegation]: (input: LibraryManagementEnrollment) =>
            Effect.sync(() => {
              expect(input.environmentId).toBe(computer);
              expect(input.keyFingerprint).toBe(delegation.keyFingerprint);
              issued++;
              return delegation;
            }),
        };
        const supervisors = new Map<
          EnvironmentId,
          EnvironmentSupervisor.EnvironmentSupervisor["Service"]
        >();
        for (const [id, client] of [
          [computer, sourceClient],
          [environmentId, authorityClient],
        ] as const) {
          const session = { client } as unknown as RpcSession.RpcSession;
          supervisors.set(
            id,
            EnvironmentSupervisor.EnvironmentSupervisor.of({
              target: new PrimaryConnectionTarget({
                environmentId: id,
                label: id,
                httpBaseUrl: "https://example.test",
                wsBaseUrl: "wss://example.test",
              }),
              state: yield* SubscriptionRef.make<SupervisorConnectionState>({
                ...AVAILABLE_CONNECTION_STATE,
                desired: true,
                network: "online",
                phase: "connected",
              }),
              session: yield* SubscriptionRef.make(Option.some(session)),
              prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
                Option.none(),
              ),
              connect: Effect.void,
              disconnect: Effect.void,
              retryNow: Effect.void,
            }),
          );
        }
        const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (id, effect) =>
          Effect.provideService(
            effect,
            EnvironmentSupervisor.EnvironmentSupervisor,
            supervisors.get(id)!,
          );
        const service = EnvironmentRegistry.EnvironmentRegistry.of({
          run,
        } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
        const atoms = createProjectLibraryAtoms(
          Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, service)),
        );
        const registry = AtomRegistry.make();
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const result = yield* Effect.promise(() =>
          atoms.prepareManagement.run(registry, {
            environmentId: computer,
            input: { authorityEnvironmentId: environmentId },
          }),
        );
        expect(AsyncResult.isSuccess(result)).toBe(true);
        expect(installed).toBe(1);
        expect(issued).toBe(1);
        const wrong = yield* Effect.promise(() =>
          atoms.prepareManagement.run(registry, {
            environmentId: computer,
            input: { authorityEnvironmentId: EnvironmentId.make("another-library") },
          }),
        );
        expect(AsyncResult.isFailure(wrong)).toBe(true);
        expect(installed).toBe(1);
        expect(issued).toBe(1);
      }),
    ),
);

it("retains an interrupted Library command as an uncertain result", () => {
  const interrupted = squashLibraryCommandFailure(AsyncResult.failure(Cause.interrupt(0)));
  expect(interrupted).toBeInstanceOf(LibraryError);
  expect(interrupted).toMatchObject({ reason: "io" });
  const denied = new LibraryError({ reason: "blocked" });
  expect(squashLibraryCommandFailure(AsyncResult.failure(Cause.fail(denied)))).toBe(denied);
});
