import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as LibraryLocalCatalog from "./LibraryLocalCatalog.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";
import { copyFor, source, resource } from "./Library.testkit.ts";

const project: LibraryProject = {
  id: "offline-project",
  title: "Offline work",
  brief: "Pinned context",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const receipt = (
  copy: LibraryWorkingCopy,
  pinned = project,
): LibraryWorkspaceStore.WorkspaceReceipt => ({
  requestId: copy.id,
  fingerprint: copy.id,
  project: pinned,
  copy,
  rootLocalProjectId: null,
  rootCheckpointRepository: true,
  legacyThreadIds: [],
  rootIdentity: null,
  releaseRequestId: null,
  releaseReviewToken: null,
  removalPath: null,
  archivePath: null,
  archiveDigest: null,
});
const rows = [
  receipt(copyFor(project)),
  receipt(
    { ...copyFor(project), id: "newer", projectRevision: 2 },
    { ...project, revision: 2, brief: "Latest local context" },
  ),
  receipt({ ...copyFor(project), id: "removed", registered: false }),
  receipt({ ...copyFor(project), id: "released", state: "released" }),
  receipt({ ...copyFor(project), id: "foreign", environmentId: EnvironmentId.make("other") }),
];
const layer = LibraryLocalCatalog.layer.pipe(
  // Provide the catalog's dependency directly so the test never reads a host filesystem.
  Layer.provide(
    Layer.mock(LibraryWorkspaceStore.LibraryWorkspaceStore)({ receipts: Effect.succeed(rows) }),
  ),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
  ),
);

describe("execution computer's offline catalog", () => {
  it.effect(
    "lists registered local files and their latest pinned context without an authority",
    () =>
      Effect.gen(function* () {
        const catalog = yield* LibraryLocalCatalog.LibraryLocalCatalog;
        expect((yield* catalog.copies({})).map((copy) => copy.id)).toEqual(["copy", "newer"]);
        expect(yield* catalog.copies({ projectId: "elsewhere" })).toEqual([]);
        expect((yield* catalog.copies({ includeReleased: true })).map((copy) => copy.id)).toEqual([
          "copy",
          "newer",
          "removed",
          "released",
        ]);
        expect(yield* catalog.projects({})).toEqual([
          { ...project, revision: 2, brief: "Latest local context" },
        ]);
        expect(yield* catalog.project({ projectId: project.id })).toMatchObject({ revision: 2 });
        expect(yield* catalog.project({ projectId: "missing" }).pipe(Effect.flip)).toMatchObject({
          reason: "not-found",
        });
      }).pipe(Effect.provide(layer)),
  );
});
