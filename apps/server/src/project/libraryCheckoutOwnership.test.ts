import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";

import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts";
import { makeLibraryCheckoutOwners } from "./libraryCheckoutOwnership.ts";

const receiptAt = (rootPath: string): LibraryWorkspaceStore.WorkspaceReceipt => {
  const timestamp = "2026-06-01T12:00:00.000Z";
  return {
    requestId: "library-copy",
    fingerprint: "copy",
    project: {
      id: "library-project",
      revision: 1,
      title: "Library project",
      brief: "",
      resources: [],
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    copy: {
      id: "library-copy",
      projectId: "library-project",
      projectRevision: 1,
      environmentId: EnvironmentId.make("library-computer"),
      rootPath,
      repositories: [],
      ownership: "managed",
      state: "ready",
      keepOnComputer: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    rootLocalProjectId: ProjectId.make("project-1"),
    rootCheckpointRepository: false,
    legacyThreadIds: [],
    rootIdentity: null,
    releaseRequestId: null,
    releaseReviewToken: null,
    removalPath: null,
    archivePath: null,
    archiveDigest: null,
  };
};

it.layer(NodeServices.layer)("libraryCheckoutOwners", (it) => {
  it.effect("matches a receipt on macOS whatever case or Unicode form names its folder", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
      const receipt = receiptAt(path.join(parent, "Projects", "Café"));
      const owners = yield* makeLibraryCheckoutOwners.pipe(
        Effect.provide(
          Layer.mock(LibraryWorkspaceStore.LibraryWorkspaceStore)({
            receipts: Effect.succeed([receipt]),
          }),
        ),
        Effect.provideService(HostProcess.Platform, "darwin"),
      );
      expect(yield* owners(path.join(parent, "projects", "café", "src"))).toEqual([receipt]);
      expect(yield* owners(path.join(parent, "projects", "cafes"))).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
