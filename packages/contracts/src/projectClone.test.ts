import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ProjectCloneStartInput, ProjectCloneStartResult } from "./projectClone.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
} from "./sourceControl.ts";

const start = {
  projectId: "project-1",
  title: "Loom",
  createdAt: "2026-10-26T00:00:00.000Z",
  remoteUrl: "https://github.com/loom/loom.git",
};
const clone = { remoteUrl: "https://github.com/loom/loom.git" };
const decodeStartInput = Schema.decodeUnknownSync(ProjectCloneStartInput);
const decodeCloneInput = Schema.decodeUnknownSync(SourceControlCloneRepositoryInput);
const decodeStartResult = Schema.decodeUnknownSync(ProjectCloneStartResult);
const decodeCloneResult = Schema.decodeUnknownSync(SourceControlCloneRepositoryResult);
const fromOlderServer = {
  cwd: "/home/loom/Projects/loom",
  remoteUrl: "https://github.com/loom/loom.git",
  repository: null,
};

describe("cloning across Loom versions", () => {
  it("decodes a clone with or without a destination folder", () => {
    const destinationPath = "/home/loom/Projects/loom";
    expect(decodeStartInput({ ...start, destinationPath })).toEqual({ ...start, destinationPath });
    expect(decodeStartInput(start)).toEqual(start);
    expect(decodeCloneInput({ ...clone, destinationPath })).toEqual({ ...clone, destinationPath });
    expect(decodeCloneInput(clone)).toEqual(clone);
  });

  it("reads results from servers that predate placement and from ones that report it", () => {
    const placement = { destinationPath: fromOlderServer.cwd, reused: true };
    expect(decodeCloneResult(fromOlderServer)).toEqual(fromOlderServer);
    expect(decodeCloneResult({ ...fromOlderServer, ...placement })).toEqual({
      ...fromOlderServer,
      ...placement,
    });
    const started = { ...fromOlderServer, projectId: "project-1" };
    expect(decodeStartResult(started)).toEqual(started);
    expect(decodeStartResult({ ...started, ...placement })).toEqual({ ...started, ...placement });
  });
});
