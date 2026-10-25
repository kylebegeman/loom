import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";

const state = vi.hoisted(() => ({ load: vi.fn(), open: vi.fn() }));
vi.mock("./state", () => ({
  readLibraryAuthorityId: () => "library",
  projectLibrary: { copies: {} },
}));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () => ({ entry: { enabled: true }, connection: { phase: "connected" } }),
  },
}));
vi.mock("~/state/presentation", () => ({
  environmentPresentations: { presentationAtom: (id: string) => id },
}));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.load }));
vi.mock("./actions", () => ({ openLibraryAction: state.open }));
vi.mock("~/state/environments", () => ({}));
vi.mock("~/state/entities", () => ({}));
vi.mock("~/uiStateStore", () => ({}));
import {
  libraryStartForLocalProject,
  useLibraryLocalProjectStart,
} from "./libraryLocalProjectStart";

const host = EnvironmentId.make("host");
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "project",
  projectRevision: 1,
  environmentId: host,
  rootPath: "/project",
  rootLocalProjectId: ProjectId.make("root"),
  repositories: [
    {
      resourceId: "web",
      path: "/project/web",
      localProjectId: ProjectId.make("web"),
      head: null,
      branch: null,
    },
  ],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
const ref = (projectId: string, environmentId = host) => ({
  environmentId,
  projectId: ProjectId.make(projectId),
});

describe("starting in a local project that is a Library project's folder", () => {
  it("leaves a plain local project to start a thread as before", () => {
    expect(libraryStartForLocalProject(ref("scratch"), [copy])).toBeNull();
    expect(
      libraryStartForLocalProject(ref("root", EnvironmentId.make("other")), [copy]),
    ).toBeNull();
    // Released files no longer make the folder part of the project.
    expect(libraryStartForLocalProject(ref("root"), [{ ...copy, state: "released" }])).toBeNull();
  });

  it("opens the project's settings on the folder that was picked", () => {
    expect(libraryStartForLocalProject(ref("root"), [copy])).toEqual({
      projectId: "project",
      defaults: { environmentId: host, workingCopyId: "files" },
    });
    expect(libraryStartForLocalProject(ref("web"), [copy])).toEqual({
      projectId: "project",
      defaults: { environmentId: host, workingCopyId: "files", resourceId: "web" },
    });
  });

  it("asks which project when the folder belongs to more than one, instead of starting it bare", () => {
    expect(
      libraryStartForLocalProject(ref("root"), [
        copy,
        { ...copy, id: "other", projectId: "other" },
      ]),
    ).toEqual({});
  });
});

it("waits for a live folder lookup and opens the bound form once its identity arrives", async () => {
  let complete: (result: {
    _tag: "Success";
    value: readonly LibraryWorkingCopy[];
  }) => void = () => {};
  state.open.mockClear();
  state.load.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const pending = useLibraryLocalProjectStart()(ref("root"));
  expect(state.open).not.toHaveBeenCalled();
  complete({ _tag: "Success", value: [copy] });
  expect(await pending).toBe(true);
  expect(state.open).toHaveBeenCalledExactlyOnceWith("new-conversation", "project", {
    environmentId: host,
    workingCopyId: "files",
  });
});

it("does not treat a failed lookup as permission to create an unbound conversation", async () => {
  state.open.mockClear();
  state.load.mockResolvedValue({ _tag: "Failure" });
  expect(await useLibraryLocalProjectStart()(ref("root"))).toBe(true);
  expect(state.open).toHaveBeenCalledExactlyOnceWith("new-conversation");
});
