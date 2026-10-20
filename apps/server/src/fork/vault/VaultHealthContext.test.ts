import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, RunId, type OrchestrationProjectShell } from "@t3tools/contracts";
import {
  VaultError,
  type VaultGrant,
  type VaultProfile,
  type VaultProfilePinPage,
  VaultHealthContextPage,
  VaultHealthRetainedPage,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as VaultHealthContext from "./VaultHealthContext.ts";
const isContextPage = Schema.is(VaultHealthContextPage);
const isRetainedPage = Schema.is(VaultHealthRetainedPage);
const itemId = "a".repeat(32),
  otherId = "b".repeat(32);
const project = (index: number): OrchestrationProjectShell => ({
  id: ProjectId.make(`project-${index.toString().padStart(2, "0")}`),
  title: `QA project ${index}`,
  workspaceRoot: `/synthetic/${index}`,
  repositoryIdentity: null,
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const grant = (id: string, kind: "project" | "thread", principalId: string): VaultGrant => ({
  definition: {
    id,
    label: `Grant ${kind}`,
    principal: { kind, id: principalId },
    itemIds: [itemId],
    actions: ["use"],
    projectId: null,
    destination: null,
    notBefore: 0,
    expiresAt: null,
    parentId: null,
  },
  state: "suspended",
  revision: 1,
  createdBy: "test",
  updatedBy: "test",
});
const fixture = Effect.sync(() => {
  const projects = Array.from({ length: 12 }, (_, i) => project(i));
  const profile: VaultProfile = {
    id: "c".repeat(32),
    label: "Staging",
    version: 1,
    state: "active",
    bindings: [
      { name: "deploy", kind: "ssh", itemId, repository: null },
      { name: "checkout", kind: "git", itemId, repository: "git@github.com:owner/repo.git" },
      { name: "unrelated", kind: "ssh", itemId: otherId, repository: null },
    ],
  };
  const state = {
    exists: true,
    projects,
    grants: [
      grant("d".repeat(32), "project", project(1).id),
      grant("e".repeat(32), "thread", "qa-thread"),
    ],
    threads: new Map([
      ["qa-thread", { ...liveThreadShell(ThreadId.make("qa-thread")), projectId: project(2).id }],
    ]),
    fail: false,
    profiles: [profile] as ReadonlyArray<VaultProfile>,
    pins: { items: [], nextCursor: null } as VaultProfilePinPage,
  };
  const pinReads: Array<{ projectId: ProjectId; cursor: string | null }> = [];
  const reads: string[] = [];
  const layer = VaultHealthContext.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(VaultCore.VaultCore)({
          inspect: () =>
            Effect.succeed(
              state.exists
                ? {
                    id: itemId,
                    label: "Development SSH",
                    kind: "ssh-key",
                    state: "active",
                    version: 1,
                    createdAt: "2026-01-01T00:00:00Z",
                    updatedAt: "2026-01-01T00:00:00Z",
                  }
                : null,
            ),
        }),
        Layer.mock(ProjectStoreV2)({ listShells: () => Effect.sync(() => state.projects) }),
        Layer.mock(VaultProfiles.VaultProfiles)({
          pins: (input) =>
            Effect.suspend(() => {
              pinReads.push(input);
              return state.fail
                ? Effect.fail(new VaultError({ reason: "unavailable" }))
                : Effect.succeed(state.pins);
            }),
          list: (id) =>
            Effect.suspend(() => {
              reads.push(id);
              return state.fail
                ? Effect.fail(new VaultError({ reason: "unavailable" }))
                : Effect.succeed({
                    projectId: id,
                    revision: 1,
                    activeProfileId: profile.id,
                    profiles: id === project(0).id || id === project(11).id ? state.profiles : [],
                  });
            }),
        }),
        Layer.mock(VaultAccess.VaultAccess)({
          snapshot: Effect.sync(() => ({
            environmentId: "test",
            revision: 1,
            audit: [],
            omittedAuditEvents: 0,
            grants: state.grants,
          })),
        }),
        Layer.mock(ThreadManagementService)({
          getThreadShell: (id) => Effect.sync(() => state.threads.get(id) ?? null),
        }),
      ),
    ),
  );
  return { state, reads, pinReads, layer };
});
it.effect(
  "pages profile and project/thread grant references without treating references as usable access",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultHealthContext.VaultHealthContext;
        const first = yield* service.inspect({ itemId, cursor: null });
        expect(first.inspectedProjects).toBe(10);
        expect(first.scannedProjects).toHaveLength(10);
        expect(first.scannedProjects?.[8]?.id).toBe(project(8).id);
        expect(f.reads).toHaveLength(10);
        expect(first.nextCursor).toBe(project(9).id);
        expect(first.projects.map((p) => p.id)).toEqual([
          project(0).id,
          project(1).id,
          project(2).id,
        ]);
        expect(first.projects[0]?.profiles[0]?.requirements).toEqual(["deploy", "checkout"]);
        expect(first.projects[0]?.profiles[0]?.isDefault).toBe(true);
        expect(first.projects[1]?.grants[0]?.state).toBe("suspended");
        expect(first.projects[2]?.grants[0]?.principalKind).toBe("thread");
        const next = yield* service.inspect({ itemId, cursor: first.nextCursor });
        expect(next.inspectedProjects).toBe(2);
        expect(next.projects.map((p) => p.id)).toEqual([project(11).id]);
        expect(next.nextCursor).toBeNull();
        f.state.profiles = [];
        expect(
          (yield* service.inspect({ itemId, cursor: null })).projects.some(
            (p) => p.id === project(0).id,
          ),
        ).toBe(false);
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "missing items and unavailable registries fail explicitly instead of showing a healthy empty result",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultHealthContext.VaultHealthContext;
        f.state.exists = false;
        expect((yield* service.inspect({ itemId, cursor: null }).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
        expect(f.reads).toHaveLength(0);
        f.state.exists = true;
        f.state.fail = true;
        expect((yield* service.inspect({ itemId, cursor: null }).pipe(Effect.flip)).reason).toBe(
          "unavailable",
        );
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "finds retained item versions after current bindings change, preserves pagination and makes retired attribution unknown",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const pin = {
        id: "d".repeat(64),
        projectId: project(8).id,
        threadId: ThreadId.make("old-thread"),
        runId: RunId.make("old-run"),
        version: 1,
        createdAt: null,
        retiredAt: null,
        runState: "completed",
        canRetire: true,
        resolution: {
          projectId: project(8).id,
          profileId: "e".repeat(32),
          label: "Previous staging",
          profileVersion: 3,
          bindings: [
            {
              name: "deploy",
              kind: "ssh" as const,
              itemId,
              version: 4,
              destination: "ssh://qa.example:22",
              repository: null,
            },
          ],
        },
      };
      f.state.profiles = [];
      f.state.pins = {
        items: [
          pin,
          {
            ...pin,
            id: "e".repeat(64),
            resolution: null,
            retiredAt: "2026-01-01T00:00:00Z",
            canRetire: false,
          },
          {
            ...pin,
            id: "f".repeat(64),
            resolution: {
              ...pin.resolution,
              bindings: [{ ...pin.resolution.bindings[0]!, itemId: otherId }],
            },
          },
        ],
        nextCursor: "f".repeat(64),
      };
      yield* Effect.gen(function* () {
        const service = yield* VaultHealthContext.VaultHealthContext;
        expect(
          (yield* service.inspect({ itemId, cursor: null })).projects.some(
            (p) => p.id === project(8).id,
          ),
        ).toBe(false);
        const page = yield* service.retained({ itemId, projectId: project(8).id, cursor: null });
        expect(page.inspectedSelections).toBe(3);
        expect(page.unattributableSelections).toBe(1);
        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.bindings).toEqual([{ name: "deploy", itemVersion: 4 }]);
        expect(page.items[0]?.profileVersion).toBe(3);
        expect(page.items[0]?.canRetire).toBe(true);
        expect(page.nextCursor).toBe("f".repeat(64));
        f.state.pins = { items: [], nextCursor: null };
        const next = yield* service.retained({
          itemId,
          projectId: project(8).id,
          cursor: page.nextCursor,
        });
        expect(next.items).toEqual([]);
        expect(f.pinReads).toEqual([
          { projectId: project(8).id, cursor: null },
          { projectId: project(8).id, cursor: "f".repeat(64) },
        ]);
        f.state.fail = true;
        expect(
          (yield* service
            .retained({ itemId, projectId: project(8).id, cursor: null })
            .pipe(Effect.flip)).reason,
        ).toBe("unavailable");
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "reports unattributed grants across the environment without counting valid later-page references",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.grants.push(
        grant("1".repeat(32), "project", project(11).id),
        grant("2".repeat(32), "project", "removed-project"),
        grant("3".repeat(32), "thread", "missing-thread"),
        grant("4".repeat(32), "thread", "deleted-thread"),
        grant("5".repeat(32), "thread", "removed-project-thread"),
        {
          ...grant("6".repeat(32), "thread", "unrelated-thread"),
          definition: {
            ...grant("6".repeat(32), "thread", "unrelated-thread").definition,
            itemIds: [otherId],
          },
        },
      );
      f.state.threads.set("deleted-thread", {
        ...liveThreadShell(ThreadId.make("deleted-thread")),
        projectId: project(3).id,
        deletedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
      });
      f.state.threads.set("removed-project-thread", {
        ...liveThreadShell(ThreadId.make("removed-project-thread")),
        projectId: ProjectId.make("removed-project"),
      });
      yield* Effect.gen(function* () {
        const service = yield* VaultHealthContext.VaultHealthContext;
        const first = yield* service.inspect({ itemId, cursor: null });
        expect(first.coverage).toEqual({
          scope: "project-page",
          externalConsumers: "not-discovered",
          providerCopies: "unknown",
          authorization: "not-evaluated",
          unattributedGrants: 4,
        });
        expect(isContextPage(first)).toBe(true);
        const last = yield* service.inspect({ itemId, cursor: first.nextCursor });
        expect(last.coverage).toEqual(first.coverage);
        expect(last.projects[0]?.grants[0]?.id).toBe("1".repeat(32));
        const empty = yield* service.inspect({ itemId, cursor: project(11).id });
        expect(empty.projects).toEqual([]);
        expect(empty.nextCursor).toBeNull();
        expect(empty.coverage).toEqual(first.coverage);
        f.state.projects = [];
        const removed = yield* service.inspect({ itemId, cursor: null });
        expect(removed.inspectedProjects).toBe(0);
        expect(removed.coverage?.unattributedGrants).toBe(7);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "retains discovery limits on empty retained pages and accepts older response contracts",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultHealthContext.VaultHealthContext;
        const retained = yield* service.retained({
          itemId,
          projectId: project(0).id,
          cursor: null,
        });
        expect(retained.items).toEqual([]);
        expect(retained.nextCursor).toBeNull();
        expect(retained.coverage).toEqual({
          scope: "retained-page",
          externalConsumers: "not-discovered",
          providerCopies: "unknown",
          authorization: "not-evaluated",
        });
        expect(isRetainedPage(retained)).toBe(true);
        const { coverage: _retainedCoverage, ...olderRetained } = retained;
        expect(isRetainedPage(olderRetained)).toBe(true);
        const context = yield* service.inspect({ itemId, cursor: null });
        const { coverage: _contextCoverage, ...olderContext } = context;
        expect(isContextPage(olderContext)).toBe(true);
      }).pipe(Effect.provide(f.layer));
    }),
);
