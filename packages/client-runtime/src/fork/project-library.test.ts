import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_WS_METHODS as L,
  PROJECT_WORKFLOW_WS_METHODS as W,
  type LibraryProject,
  type LibraryThreadArchive,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type * as RpcSession from "../rpc/session.ts";
import { v2Projection } from "../state/orchestrationV2TestFixtures.ts";
import { createProjectLibraryAtoms } from "./project-library.ts";

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
