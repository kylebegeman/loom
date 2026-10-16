import { describe, expect, it } from "vite-plus/test";
import type { LibraryProject } from "@t3tools/contracts/fork";
import { libraryRouteParams, resolveLibrarySelection } from "./library-selection.ts";
const project: LibraryProject = {
  id: "new-project",
  title: "New project",
  brief: "Metadata first",
  revision: 1,
  archived: false,
  resources: [],
  createdAt: "2026-10-15T12:00:00Z",
  updatedAt: "2026-10-15T12:00:00Z",
};
describe("Library selection across create and route changes", () => {
  it("selects the new project while the catalog still contains earlier projects", () => {
    const earlier = { ...project, id: "earlier" };
    const selection = resolveLibrarySelection({
      routeProjectId: project.id,
      savedProjectId: earlier.id,
      catalog: [earlier],
      detail: project,
    });
    expect(selection.project).toBe(project);
    expect(selection.projects).toEqual([earlier, project]);
  });
  it("keeps the current route authoritative over a previous saved choice", () => {
    expect(
      resolveLibrarySelection({
        routeProjectId: "unavailable",
        savedProjectId: project.id,
        catalog: [project],
        detail: project,
      }).project,
    ).toBeNull();
  });
  it("shows a saved rename before the catalog query refreshes", () => {
    const renamed = { ...project, revision: 2, title: "Renamed project" };
    const selection = resolveLibrarySelection({
      routeProjectId: project.id,
      savedProjectId: project.id,
      catalog: [project],
      detail: renamed,
    });
    expect(selection.project).toBe(renamed);
    expect(selection.projects).toEqual([renamed]);
  });
  it("does not duplicate a selected project already in the catalog", () => {
    const catalog = [project];
    expect(
      resolveLibrarySelection({ savedProjectId: project.id, catalog, detail: project }).projects,
    ).toBe(catalog);
  });
  it("retains host and thread identities outside a leaf route context", () => {
    expect(
      libraryRouteParams({ environmentId: "dorothy", threadId: "conversation", unrelated: true }),
    ).toEqual({
      environmentId: "dorothy",
      threadId: "conversation",
      projectId: undefined,
      conversationId: undefined,
    });
    expect(libraryRouteParams(null).projectId).toBeUndefined();
  });
});
