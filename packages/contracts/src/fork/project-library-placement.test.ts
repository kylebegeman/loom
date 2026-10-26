import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  LibraryPlacement,
  LibraryPlacementRequest,
  LibraryPrepareCopyRequest,
} from "./project-library.ts";
import { LibraryOperationInput } from "./project-workflows.ts";

const project = {
  id: "project-1",
  title: "Loom",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
};
const prepare = { requestId: "request-1", project, strategy: "clone" };
const decodePrepare = Schema.decodeUnknownSync(LibraryPrepareCopyRequest);
const decodeOperation = Schema.decodeUnknownSync(LibraryOperationInput);
const decodePlacement = Schema.decodeUnknownSync(LibraryPlacement);

describe("preparing a Library copy across Loom versions", () => {
  it("still decodes a client that chooses the folder", () => {
    const request = { ...prepare, rootPath: "/home/loom/Projects/loom" };
    expect(decodePrepare(request)).toEqual(request);
    expect(decodeOperation({ kind: "prepare", input: request })).toEqual({
      kind: "prepare",
      input: request,
    });
  });

  it("leaves the folder to the computer when a client omits it", () => {
    expect(decodePrepare(prepare)).not.toHaveProperty("rootPath");
    expect(decodeOperation({ kind: "prepare", input: prepare }).input).not.toHaveProperty(
      "rootPath",
    );
  });
});

describe("a Library placement", () => {
  it("asks by project and optional resources", () => {
    const decode = Schema.decodeUnknownSync(LibraryPlacementRequest);
    expect(decode({ projectId: "project-1" })).toEqual({ projectId: "project-1" });
    expect(decode({ projectId: "project-1", resourceIds: ["app"] })).toEqual({
      projectId: "project-1",
      resourceIds: ["app"],
    });
  });

  it("names a borrowed checkout without a copy, or a managed copy with one", () => {
    const borrowed = {
      action: "reuse-existing",
      rootPath: "/home/loom/Developer/loom",
      ownership: "borrowed",
      localProjectId: "local-1",
      reason: "This computer already has a checkout of the repository.",
    };
    expect(decodePlacement(borrowed)).toEqual(borrowed);
    const reopened = {
      action: "reopen",
      rootPath: "/home/loom/Projects/loom",
      ownership: "managed",
      copyId: "copy-1",
      reason: "The Library copy on this computer was released.",
    };
    expect(decodePlacement(reopened)).toEqual(reopened);
  });

  it("refuses an action it does not know", () => {
    expect(() =>
      decodePlacement({ action: "move", rootPath: "/x", ownership: "managed", reason: "" }),
    ).toThrow();
  });
});
