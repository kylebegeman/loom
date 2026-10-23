import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import { LibraryBlueprint, LibraryError } from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { LibraryAssetService } from "./assets/LibraryAssetService.ts";
import * as LibraryService from "./LibraryService.ts";
import * as ProjectWorkflows from "./ProjectWorkflows.ts";
import { resource, copyFor, archiveFor } from "./Library.testkit.ts";

const isBlueprint = Schema.is(LibraryBlueprint);
const catalog = LibraryService.layer.pipe(
  Layer.provide(
    Layer.succeed(LibraryAssetService, {
      mode: "local",
      find: () => Effect.fail(new LibraryError({ reason: "not-found" })),
      read: () => Effect.fail(new LibraryError({ reason: "not-found" })),
      put: () => Effect.fail(new LibraryError({ reason: "io" })),
      url: () => Effect.succeed(null),
    }),
  ),
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
  ),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("authority")),
    }),
  ),
);
const run = <A, E, R>(
  use: (
    service: ProjectWorkflows.ProjectWorkflows["Service"],
    library: LibraryService.LibraryService["Service"],
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const library = yield* LibraryService.LibraryService.pipe(Effect.provide(catalog));
    const workflows = yield* ProjectWorkflows.ProjectWorkflows.pipe(
      Effect.provide(ProjectWorkflows.layer),
      Effect.provideService(LibraryService.LibraryService, library),
    );
    return yield* use(workflows, library);
  }).pipe(Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped);

describe("Project workflows", () => {
  it.effect("persists workstreams with idempotent receipts, CAS, blockers and reopen", () =>
    run((service, library) =>
      Effect.gen(function* () {
        const project = yield* library.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const input = {
          requestId: "save",
          id: "stream",
          projectId: project.id,
          expectedRevision: 0,
          title: "Ship API",
          goal: "Finish the API",
          state: "active" as const,
          references: [
            {
              kind: "verification" as const,
              id: "tests",
              label: "API tests",
              state: "open" as const,
            },
          ],
        };
        const saved = yield* service.saveWorkstream(input);
        expect(yield* service.saveWorkstream(input)).toEqual(saved);
        expect((yield* service.workstreams({ projectId: project.id }))[0]).toEqual(saved);
        expect(
          (yield* service.saveWorkstream({ ...input, requestId: "stale" }).pipe(Effect.flip))
            .reason,
        ).toBe("revision-conflict");
        expect(
          (yield* service
            .saveWorkstream({
              ...input,
              requestId: "complete",
              expectedRevision: 1,
              state: "completed",
            })
            .pipe(Effect.flip)).message,
        ).toContain("API tests: unfinished");
        const done = yield* service.saveWorkstream({
          ...input,
          requestId: "passed",
          expectedRevision: 1,
          state: "completed",
          references: [{ ...input.references[0]!, state: "passed" }],
        });
        expect(done.state).toBe("completed");
        expect(
          (yield* service.saveWorkstream({ ...input, requestId: "reopen", expectedRevision: 2 }))
            .state,
        ).toBe("active");
        expect(
          (yield* service.saveWorkstream({ ...input, title: "Different" }).pipe(Effect.flip))
            .reason,
        ).toBe("request-conflict");
      }),
    ),
  );
  it.effect("refuses cross-project copy links and unsafe URLs", () =>
    run((service, library) =>
      Effect.gen(function* () {
        const project = yield* library.createProject({ requestId: "create", title: "Project" });
        const input = {
          requestId: "save",
          id: "stream",
          projectId: project.id,
          expectedRevision: 0,
          title: "Work",
          goal: "",
          state: "active" as const,
          references: [
            { kind: "copy" as const, id: "foreign", label: "Other folder", state: "open" as const },
          ],
        };
        expect((yield* service.saveWorkstream(input).pipe(Effect.flip)).reason).toBe("invalid");
        expect(
          (yield* service
            .saveWorkstream({
              ...input,
              references: [
                {
                  kind: "pull-request",
                  id: "pr",
                  label: "PR",
                  state: "open",
                  url: "https://token@github.com/a/b",
                },
              ],
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
      }),
    ),
  );
  it.effect("validates linked computer identities and rejects ambiguous conversation IDs", () =>
    run((service, library) =>
      Effect.gen(function* () {
        const project = yield* library.createProject({
          requestId: "project",
          title: "App",
          resources: [resource],
        });
        const copy = copyFor(project);
        yield* library.registerCopy({ requestId: "copy", copy });
        const archive = yield* archiveFor(project);
        yield* library.registerThread({ requestId: "thread", thread: archive });
        yield* library.registerThread({
          requestId: "other-thread",
          thread: {
            ...archive,
            summary: {
              ...archive.summary,
              id: "other-archive",
              workingCopyId: null,
              environmentId: EnvironmentId.make("other-computer"),
            },
          },
        });
        const input = {
          requestId: "save",
          id: "work",
          projectId: project.id,
          expectedRevision: 0,
          title: "Ship",
          goal: "",
          state: "active" as const,
          references: [],
        };
        expect(
          (yield* service
            .saveWorkstream({
              ...input,
              references: [
                {
                  kind: "copy",
                  id: copy.id,
                  environmentId: EnvironmentId.make("wrong"),
                  label: "Files",
                  state: "open",
                },
              ],
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
        expect(
          (yield* service
            .saveWorkstream({
              ...input,
              references: [
                {
                  kind: "thread",
                  id: archive.summary.threadId,
                  label: "Conversation",
                  state: "open",
                },
              ],
            })
            .pipe(Effect.flip)).message,
        ).toContain("computer");
        const saved = yield* service.saveWorkstream({
          ...input,
          references: [
            { kind: "thread", id: archive.summary.id, label: "Conversation", state: "open" },
          ],
        });
        expect(saved.references[0]).toMatchObject({
          id: archive.summary.threadId,
          environmentId: archive.summary.environmentId,
        });
        expect(
          (yield* service
            .saveWorkstream({
              ...input,
              requestId: "duplicate",
              id: "duplicate",
              references: [
                { kind: "thread", id: archive.summary.id, label: "Archive", state: "open" },
                {
                  kind: "thread",
                  id: archive.summary.threadId,
                  environmentId: archive.summary.environmentId,
                  label: "Same conversation",
                  state: "open",
                },
              ],
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
      }),
    ),
  );
  it.effect(
    "refuses malformed HTTPS links and ignores inactive conversation observations at completion",
    () =>
      run((service, library) =>
        Effect.gen(function* () {
          const project = yield* library.createProject({ requestId: "project", title: "App" });
          const archive = yield* archiveFor(project);
          yield* library.registerThread({
            requestId: "thread",
            thread: {
              ...archive,
              summary: {
                ...archive.summary,
                workingCopyId: null,
                archived: true,
                status: "running",
              },
            },
          });
          const input = {
            requestId: "save",
            id: "work",
            projectId: project.id,
            expectedRevision: 0,
            title: "Ship",
            goal: "",
            state: "completed" as const,
            references: [],
          };
          expect(
            (yield* service
              .saveWorkstream({
                ...input,
                references: [
                  {
                    kind: "pull-request",
                    id: "pr",
                    label: "PR",
                    state: "completed",
                    url: "https://[invalid]/pull/1",
                  },
                ],
              })
              .pipe(Effect.flip)).reason,
          ).toBe("invalid");
          expect(
            (yield* service.saveWorkstream({
              ...input,
              references: [
                {
                  kind: "thread",
                  id: archive.summary.threadId,
                  environmentId: archive.summary.environmentId,
                  label: "Old run",
                  state: "completed",
                },
              ],
            })).state,
          ).toBe("completed");
        }),
      ),
  );
  it.effect("round trips multi-repository blueprints while keeping machine preferences local", () =>
    run((service, library) =>
      Effect.gen(function* () {
        const project = yield* library.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [
            resource,
            {
              ...resource,
              id: "web",
              title: "Web",
              relativePath: "web",
              remoteUrl: "https://github.com/example/web.git",
            },
          ],
        });
        const configured = yield* library.updateProject({
          requestId: "setup",
          projectId: project.id,
          expectedRevision: 1,
          title: project.title,
          brief: "Shared goal",
          resources: project.resources,
          profile: {
            requiredTools: [{ id: "node", minimumVersion: "22" }],
            preferredEnvironmentIds: [EnvironmentId.make("my-mac")],
            connectionNames: ["personal-vps"],
            secretNames: ["GITHUB_TOKEN"],
          },
        });
        const blueprint = yield* service.blueprint({ projectId: project.id });
        expect(blueprint.resources).toHaveLength(2);
        expect(blueprint.setup?.preferredEnvironmentIds).toBeUndefined();
        expect(blueprint.connections).toEqual(["personal-vps"]);
        const created = yield* library.createProject({
          requestId: "from-blueprint",
          title: blueprint.title,
          brief: blueprint.brief,
          resources: blueprint.resources,
          profile: { ...blueprint.setup, connectionNames: blueprint.connections },
        });
        expect(created.profile?.requiredTools).toEqual(blueprint.setup?.requiredTools);
        expect(created.profile?.connectionNames).toEqual(["personal-vps"]);
        expect(created.profile?.preferredEnvironmentIds).toBeUndefined();
        const applied = yield* service.applyBlueprint({
          requestId: "apply",
          projectId: project.id,
          expectedRevision: configured.revision,
          blueprint: { ...blueprint, brief: "Portable goal" },
        });
        expect(applied.profile?.preferredEnvironmentIds).toEqual(["my-mac"]);
        expect(applied.brief).toBe("Portable goal");
        yield* library.updateProject({
          requestId: "computer-preference",
          projectId: project.id,
          expectedRevision: applied.revision,
          title: applied.title,
          brief: applied.brief,
          resources: applied.resources,
          profile: {
            ...applied.profile,
            preferredEnvironmentIds: [EnvironmentId.make("new-computer")],
          },
        });
        expect(
          yield* service.applyBlueprint({
            requestId: "apply",
            projectId: project.id,
            expectedRevision: configured.revision,
            blueprint: { ...blueprint, brief: "Portable goal" },
          }),
        ).toEqual(applied);
        expect(
          (yield* library.project({ projectId: project.id })).profile?.preferredEnvironmentIds,
        ).toEqual(["new-computer"]);

        const unsafe = { ...blueprint, resources: [{ ...resource, relativePath: "../escape" }] };
        expect(
          (yield* service
            .applyBlueprint({
              requestId: "unsafe",
              projectId: project.id,
              expectedRevision: applied.revision,
              blueprint: unsafe,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
      }),
    ),
  );
  it.effect("keeps unknown remote and recovery state explicit in preservation review", () =>
    run((service, library) =>
      Effect.gen(function* () {
        const project = yield* library.createProject({
          requestId: "create",
          title: "Project",
          resources: [resource],
        });
        yield* library.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const entries = yield* service.preservation({});
        expect(entries).toHaveLength(1);
        expect(entries[0]?.blockers.join(" ")).toContain("local changes");
        expect(entries[0]?.blockers.join(" ")).toContain("ignored files");
        expect(entries[0]?.restore).toBe("repository");
        expect(entries[0]?.checkedAt).toBeNull();
      }),
    ),
  );
  it.effect("refuses completion for unknown, changed and unverified copy observations", () =>
    run((service, library) =>
      Effect.gen(function* () {
        const project = yield* library.createProject({
          requestId: "project",
          title: "App",
          resources: [resource],
        });
        const copy = copyFor(project);
        yield* library.registerCopy({ requestId: "copy", copy });
        const input = {
          requestId: "complete",
          id: "stream",
          projectId: project.id,
          expectedRevision: 0,
          title: "Ship",
          goal: "",
          state: "completed" as const,
          references: [
            { kind: "copy" as const, id: copy.id, label: "App files", state: "completed" as const },
          ],
        };
        expect((yield* service.saveWorkstream(input).pipe(Effect.flip)).reason).toBe("blocked");
        yield* library.registerCopy({
          requestId: "partial-report",
          copy: {
            ...copy,
            health: {
              copyId: copy.id,
              environmentId: copy.environmentId,
              checkedAt: project.updatedAt,
              repositories: [],
            },
          },
        });
        expect((yield* service.saveWorkstream(input).pipe(Effect.flip)).reason).toBe("blocked");
        const health = {
          copyId: copy.id,
          environmentId: copy.environmentId,
          checkedAt: project.updatedAt,
          repositories: [
            {
              resourceId: resource.id,
              uncommittedFiles: 1,
              unpushedCommits: 0,
              checkedAt: project.updatedAt,
              fetchedAt: project.updatedAt,
            },
          ],
        };
        yield* library.registerCopy({ requestId: "dirty", copy: { ...copy, health } });
        expect((yield* service.saveWorkstream(input).pipe(Effect.flip)).reason).toBe("blocked");
        yield* library.registerCopy({
          requestId: "unpushed",
          copy: {
            ...copy,
            health: {
              ...health,
              repositories: [
                { ...health.repositories[0]!, uncommittedFiles: 0, unpushedCommits: 2 },
              ],
            },
          },
        });
        expect((yield* service.saveWorkstream(input).pipe(Effect.flip)).reason).toBe("blocked");
        yield* library.registerCopy({
          requestId: "offline",
          copy: {
            ...copy,
            health: {
              ...health,
              repositories: [
                { ...health.repositories[0]!, uncommittedFiles: 0, fetchFailed: true },
              ],
            },
          },
        });
        expect((yield* service.saveWorkstream(input).pipe(Effect.flip)).reason).toBe("blocked");
        yield* library.registerCopy({
          requestId: "clean",
          copy: {
            ...copy,
            health: {
              ...health,
              repositories: [{ ...health.repositories[0]!, uncommittedFiles: 0 }],
            },
          },
        });
        expect((yield* service.saveWorkstream(input)).state).toBe("completed");
      }),
    ),
  );
  it.effect(
    "upgrades the existing catalog without changing projects, copies, receipts or conversation history",
    () =>
      Effect.gen(function* () {
        yield* runForkMigrationSet({
          ...ProjectLibraryMigrations,
          migrations: ProjectLibraryMigrations.migrations.filter(([id]) => id < 14),
        });
        const library = yield* LibraryService.LibraryService.pipe(Effect.provide(catalog));
        const create = {
          requestId: "existing-project",
          title: "Existing app",
          resources: [resource],
        };
        const project = yield* library.createProject(create);
        const copy = copyFor(project);
        yield* library.registerCopy({ requestId: "existing-copy", copy });
        const archive = yield* archiveFor(project);
        yield* library.registerThread({ requestId: "existing-thread", thread: archive });
        const before = yield* library.history({ id: archive.summary.id, limit: 100 });
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        expect(yield* library.project({ projectId: project.id })).toEqual(project);
        expect(yield* library.createProject(create)).toEqual(project);
        expect(yield* library.copies({ projectId: project.id })).toEqual([copy]);
        expect(yield* library.history({ id: archive.summary.id, limit: 100 })).toEqual(before);
        const sql = yield* SqlClient.SqlClient;
        expect(yield* sql`SELECT id FROM fork_library_operations`).toEqual([]);
        expect(yield* sql`SELECT id FROM fork_library_workstreams`).toEqual([]);
      }).pipe(
        Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
        Effect.scoped,
      ),
  );
  it("refuses machine-specific and secret-bearing blueprints", () => {
    const blueprint = {
      format: "loom-project",
      version: 1,
      title: "Project",
      brief: "",
      resources: [],
      connections: [],
    };
    expect(isBlueprint({ ...blueprint, setup: { preferredEnvironmentIds: ["local"] } })).toBe(
      false,
    );
    expect(isBlueprint({ ...blueprint, version: 2 })).toBe(false);
    expect(
      isBlueprint({
        ...blueprint,
        connections: ["ghp_012345678901234567890123456789"],
      }),
    ).toBe(false);
  });
});
