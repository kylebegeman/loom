import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import type { ProjectResource } from "@t3tools/contracts/fork";
import { PROJECT_RESOURCES_LIMIT } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectResources from "./ProjectResources.ts";

const projectId = ProjectId.make("resources-project");
const otherProjectId = ProjectId.make("other-project");
const repository: ProjectResource = {
  id: "repository-one",
  kind: "repository",
  title: "Main repository",
  url: "https://github.com/Example/Product.git/",
};
const link: ProjectResource = {
  id: "design-guide",
  kind: "link",
  title: "Design guide",
  url: "https://example.test/guide?edition=current#overview",
};
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const parent = yield* fs.makeTempDirectoryScoped();
  const configuration = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(parent, `${parent}/environment`)),
  );
  const row: ProjectStore.ProjectRow = {
    projectId,
    title: "Resources project",
    workspaceRoot: `${parent}/checkout`,
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    deletedAt: null,
  };
  yield* fs.makeDirectory(row.workspaceRoot);
  yield* fs.writeFileString(`${row.workspaceRoot}/keep.txt`, "Working files");
  const rows = new Map([
    [projectId, row],
    [otherProjectId, { ...row, projectId: otherProjectId }],
  ]);
  const serviceLayer = ProjectResources.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: (id) => Effect.succeed(Option.fromUndefinedOr(rows.get(id))),
      }),
    ),
    Layer.provide(Layer.succeed(ServerConfig.ServerConfig, configuration)),
  );
  const restart = ProjectResources.ProjectResources.pipe(Effect.provide(serviceLayer));
  const service = yield* restart;
  const savedPath = `${configuration.stateDir}/fork/project-resources/project-${Buffer.from(projectId).toString("base64url")}.json`;
  return {
    fs,
    parent,
    row,
    rows,
    service,
    restart,
    savedPath,
    add: (resource = repository, expectedRevision = 0, target = projectId) =>
      service.upsert({ projectId: target, expectedRevision, resource }),
  };
});
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("durable project resources", () => {
  it.live("preserves resources across restarts and working-copy removal", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        expect(yield* f.service.get({ projectId })).toEqual({
          projectId,
          revision: 0,
          resources: [],
        });
        const saved = yield* f.add();
        expect(saved.revision).toBe(1);
        expect(saved.resources[0]?.url).toBe("https://github.com/Example/Product.git");
        yield* f.fs.remove(f.row.workspaceRoot, { recursive: true });
        const restarted = yield* f.restart;
        expect(yield* restarted.get({ projectId })).toEqual(saved);
        const updated = yield* restarted.upsert({ projectId, expectedRevision: 1, resource: link });
        expect(updated.resources).toHaveLength(2);
        expect(yield* f.fs.exists(f.row.workspaceRoot)).toBe(false);
      }),
    ),
  );
  it.live("updates and removes metadata without touching the working files", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.add(link);
        const updated = yield* f.add({ ...link, title: "Updated design guide" }, 1);
        expect(updated.resources).toEqual([{ ...link, title: "Updated design guide" }]);
        expect(updated.revision).toBe(2);
        expect(yield* f.add({ ...link, title: " Updated design guide " }, 2)).toEqual(updated);
        const removed = yield* f.service.remove({
          projectId,
          expectedRevision: 2,
          resourceId: link.id,
        });
        expect(removed).toEqual({ projectId, revision: 3, resources: [] });
        expect(
          yield* f.service.remove({ projectId, expectedRevision: 3, resourceId: link.id }),
        ).toEqual(removed);
        expect(yield* f.fs.readFileString(`${f.row.workspaceRoot}/keep.txt`)).toBe("Working files");
        expect(yield* (yield* f.restart).get({ projectId })).toEqual(removed);
      }),
    ),
  );
  it.live("deduplicates repository URL protocols and keeps projects independent", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const saved = yield* f.add();
        const duplicate = yield* f
          .add({ ...repository, id: "duplicate", url: "git@github.com:example/product.git" }, 1)
          .pipe(Effect.flip);
        expect(duplicate.reason).toBe("duplicate-resource");
        expect(yield* f.service.get({ projectId })).toEqual(saved);
        const other = yield* f.add(
          { ...repository, url: "ssh://git@github.com/example/product.git" },
          0,
          otherProjectId,
        );
        expect(other.projectId).toBe(otherProjectId);
        expect(other.resources[0]?.url).toBe("ssh://git@github.com/example/product.git");
        expect(yield* f.service.get({ projectId })).toEqual(saved);
      }),
    ),
  );
  it.live("rejects conflicting writes and stale removals without losing resources", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const writes = yield* Effect.all(
          [f.add(repository).pipe(Effect.result), f.add(link).pipe(Effect.result)],
          { concurrency: "unbounded" },
        );
        expect(writes.filter((result) => result._tag === "Success")).toHaveLength(1);
        const failure = writes.find((result) => result._tag === "Failure");
        expect(failure?._tag === "Failure" ? failure.failure.reason : undefined).toBe(
          "stale-revision",
        );
        const saved = yield* f.service.get({ projectId });
        expect(saved.revision).toBe(1);
        expect(saved.resources).toHaveLength(1);
        const stale = yield* f.service
          .remove({ projectId, expectedRevision: 0, resourceId: saved.resources[0]!.id })
          .pipe(Effect.flip);
        expect(stale.reason).toBe("stale-revision");
        expect(yield* f.service.get({ projectId })).toEqual(saved);
      }),
    ),
  );
  it.live.each([
    ["repository", "https://name:secret@github.com/team/repo.git"],
    ["repository", "https://name@github.com/team/repo.git"],
    ["repository", "https://github.com/team/repo.git?token=secret"],
    ["repository", "https://github.com/team/repo.git#branch"],
    ["repository", "https://github.com/team/repo/issues/1"],
    ["repository", "file:///tmp/team/repo"],
    ["repository", "git://github.com/team/repo"],
    ["repository", "https://localhost/team/repo"],
    ["repository", "https://127.1/team/repo"],
    ["repository", "ssh://git@127.1/team/repo"],
    ["repository", "ssh://git@2130706433/team/repo"],
    ["repository", "ssh://git@0x7f000001/team/repo"],
    ["repository", "git@127.1:team/repo"],
    ["repository", "git@2130706433:team/repo"],
    ["repository", "git@0x7f000001:team/repo"],
    ["repository", "ssh://git:secret@github.com/team/repo"],
    ["repository", "https://github.com/team/%0Arepo"],
    ["repository", "https://github.com/team/repo\n"],
    ["link", "javascript:alert(1)"],
    ["link", "https://name:secret@example.test/page"],
    ["link", "https://example.test/%0Dpage"],
  ] as const)("rejects unsafe %s resource URLs (%s)", ([kind, url]) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const failure = yield* f.add({ ...repository, kind, url }).pipe(Effect.flip);
        expect(failure.reason).toBe("invalid-resource");
        expect(yield* f.service.get({ projectId })).toEqual({
          projectId,
          revision: 0,
          resources: [],
        });
        expect(yield* f.fs.exists(f.savedPath)).toBe(false);
      }),
    ),
  );
  it.live.each([
    { ...repository, id: "../not-an-id" },
    { ...repository, title: " " },
    { ...repository, title: "Title\n" },
    { ...repository, title: "x".repeat(201) },
    { ...repository, url: `https://example.test/${"x".repeat(2048)}` },
  ])("rejects invalid resource fields", (resource) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        expect((yield* f.add(resource).pipe(Effect.flip)).reason).toBe("invalid-resource");
        expect(yield* f.fs.exists(f.savedPath)).toBe(false);
      }),
    ),
  );
  it.live("requires an existing active project for every operation", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const missing = yield* f.service
          .get({ projectId: ProjectId.make("missing") })
          .pipe(Effect.flip);
        expect(missing.reason).toBe("not-found");
        yield* f.add();
        f.rows.set(projectId, { ...f.row, deletedAt: "2026-10-15T01:00:00.000Z" });
        expect((yield* f.service.get({ projectId }).pipe(Effect.flip)).reason).toBe("not-found");
        expect((yield* f.add(link, 1).pipe(Effect.flip)).reason).toBe("not-found");
        expect(
          (yield* f.service
            .remove({ projectId, expectedRevision: 1, resourceId: repository.id })
            .pipe(Effect.flip)).reason,
        ).toBe("not-found");
      }),
    ),
  );
  it.live("limits resource counts while allowing updates and removing one to add another", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        for (let index = 0; index < PROJECT_RESOURCES_LIMIT; index++)
          yield* f.add(
            { ...link, id: `resource-${index}`, url: `https://example.test/page/${index}` },
            index,
          );
        expect((yield* f.add(repository, PROJECT_RESOURCES_LIMIT).pipe(Effect.flip)).reason).toBe(
          "limit",
        );
        const updated = yield* f.add(
          { ...link, id: "resource-0", url: "https://example.test/updated" },
          PROJECT_RESOURCES_LIMIT,
        );
        expect(updated.resources).toHaveLength(PROJECT_RESOURCES_LIMIT);
        const removed = yield* f.service.remove({
          projectId,
          expectedRevision: updated.revision,
          resourceId: "resource-0",
        });
        expect((yield* f.add(repository, removed.revision)).resources).toHaveLength(
          PROJECT_RESOURCES_LIMIT,
        );
      }),
    ),
  );
  it.live("refuses to overwrite unreadable resource metadata", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.add();
        yield* f.fs.writeFileString(f.savedPath, "invalid resource metadata");
        expect((yield* f.service.get({ projectId }).pipe(Effect.flip)).reason).toBe("io");
        expect((yield* f.add(link, 1).pipe(Effect.flip)).reason).toBe("io");
        expect(yield* f.fs.readFileString(f.savedPath)).toBe("invalid resource metadata");
      }),
    ),
  );
});
