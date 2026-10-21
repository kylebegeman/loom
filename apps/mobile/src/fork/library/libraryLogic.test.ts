import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryBinding,
  libraryFeatureState,
  libraryListState,
  libraryResourceDraft,
} from "./libraryLogic";
const host = EnvironmentId.make("travel");
const project: LibraryProject = {
  id: "durable",
  title: "AspectAvy",
  brief: "Shared work",
  revision: 2,
  archived: false,
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
  resources: [
    libraryResourceDraft({
      id: "web",
      title: "Web",
      relativePath: "web",
      remoteUrl: "https://github.com/aspect/web",
    }),
    libraryResourceDraft({
      id: "ios",
      title: "iOS",
      relativePath: "ios",
      remoteUrl: "https://github.com/aspect/ios",
    }),
  ],
};
const copy: LibraryWorkingCopy = {
  id: "copy",
  projectId: project.id,
  projectRevision: project.revision,
  environmentId: host,
  rootPath: "/Projects/AspectAvy",
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
describe("durable library execution selection", () => {
  it("does not interpret missing, refreshing, or failed copy catalogs as permission to prepare another copy", () => {
    const settled = {
      data: [] as readonly LibraryWorkingCopy[],
      error: null,
      isPending: false,
      isSuccess: true,
    };
    expect(libraryListState(settled)).toBe("empty");
    expect(libraryListState({ ...settled, data: [copy] })).toBe("ready");
    expect(libraryListState({ ...settled, data: null, isSuccess: false })).toBe("loading");
    expect(libraryListState({ ...settled, isPending: true })).toBe("loading");
    expect(libraryListState({ ...settled, data: [copy], isPending: true })).toBe("loading");
    expect(libraryListState({ ...settled, error: "Library unavailable", isSuccess: false })).toBe(
      "error",
    );
    expect(
      libraryListState({ ...settled, data: [copy], error: "Refresh failed", isSuccess: false }),
    ).toBe("error");
    expect(libraryListState({ ...settled, error: "Refresh failed", isPending: true })).toBe(
      "loading",
    );
  });
  it("binds only a copy that covers the selected components", () => {
    const scoped = {
      ...copy,
      repositories: [
        {
          resourceId: "ios",
          path: "/Projects/AspectAvy/ios",
          localProjectId: "compat" as LibraryWorkingCopy["repositories"][number]["localProjectId"],
          head: null,
          branch: null,
        },
      ],
    };
    expect(libraryBinding(project, scoped, ["ios"])).toMatchObject({
      projectId: "durable",
      projectRevision: 2,
      environmentId: host,
      resourceIds: ["ios"],
    });
    expect(() => libraryBinding(project, scoped, ["web"])).toThrow("every selected component");
    expect(() => libraryBinding(project, { ...scoped, state: "released" }, ["ios"])).toThrow(
      "every selected component",
    );
  });
  it("reuses a compatible earlier superset while pinning the reviewed project revision", () => {
    const earlierCopy: LibraryWorkingCopy = {
      ...copy,
      projectRevision: 1,
      repositories: ["web", "ios", "retired"].map((id) => ({
        resourceId: id,
        path: `${copy.rootPath}/${id}`,
        localProjectId:
          `local-${id}` as LibraryWorkingCopy["repositories"][number]["localProjectId"],
        head: null,
        branch: null,
      })),
    };
    const current = { ...project, resources: [project.resources[1]!] };
    expect(libraryBinding(current, earlierCopy, ["ios"])).toMatchObject({
      projectRevision: 2,
      resourceIds: ["ios"],
    });
    const moved = {
      ...current,
      resources: [{ ...current.resources[0]!, relativePath: "apps/ios" }],
    };
    expect(() => libraryBinding(moved, earlierCopy, ["ios"])).toThrow("every selected component");
  });
  it("permits repository-free discussions without inheriting removed repository scope", () => {
    const discussion = { ...project, resources: [] };
    expect(libraryBinding(discussion, copy, [])).toMatchObject({ resourceIds: [] });
    expect(() => libraryBinding(project, copy, [])).toThrow("every selected component");
  });
  it("protects parent folder boundaries and allows independent repository URLs", () => {
    for (const relativePath of ["../web", "/web", "C:/web", "a/../../web", "web\\ios"])
      expect(() =>
        libraryResourceDraft({ id: "r", title: "Web", relativePath, remoteUrl: "" }),
      ).toThrow("parent folder");
    expect(
      libraryResourceDraft({
        id: "root",
        title: "Existing repository",
        relativePath: ".",
        remoteUrl: "",
      }),
    ).toMatchObject({ relativePath: "." });
    expect(
      libraryResourceDraft({
        id: "r",
        title: " iOS ",
        relativePath: "apps/ios",
        remoteUrl: "git@github.com:aspect/ios.git",
      }),
    ).toMatchObject({
      title: "iOS",
      relativePath: "apps/ios",
      remoteUrl: "git@github.com:aspect/ios.git",
    });
  });
});

describe("library feature state", () => {
  const selected = { loaded: true, environmentId: "library", connected: true };
  const withFeature = { repositoryIdentity: false, loomFeatures: ["library-timeline"] };
  const withoutFeature = { repositoryIdentity: false, loomFeatures: [] };

  it("asks for an update only when a connected Library's config lacks the feature", () => {
    expect(libraryFeatureState(selected, withoutFeature, "library-timeline")).toBe("unsupported");
    expect(libraryFeatureState(selected, withFeature, "library-timeline")).toBe("supported");
  });

  it("does not mistake unknown capabilities for a missing feature", () => {
    expect(libraryFeatureState(selected, undefined, "library-timeline")).toBe("loading");
    expect(
      libraryFeatureState({ ...selected, connected: false }, undefined, "library-timeline"),
    ).toBe("offline");
    // A config cached before the Library was updated cannot prove the feature is missing.
    expect(
      libraryFeatureState({ ...selected, connected: false }, withoutFeature, "library-timeline"),
    ).toBe("offline");
  });

  it("keeps a supported feature usable from a cached config while offline", () => {
    expect(
      libraryFeatureState({ ...selected, connected: false }, withFeature, "library-timeline"),
    ).toBe("supported");
  });

  it("separates an unchosen Library from preferences still loading", () => {
    expect(
      libraryFeatureState({ ...selected, environmentId: null }, undefined, "library-timeline"),
    ).toBe("unselected");
    expect(
      libraryFeatureState(
        { loaded: false, environmentId: null, connected: false },
        undefined,
        "library-timeline",
      ),
    ).toBe("loading");
  });
});
