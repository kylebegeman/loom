// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SidebarProjectGroupMember } from "~/sidebarProjectGrouping";

const state = vi.hoisted(() => ({
  copies: [] as LibraryWorkingCopy[],
  query: vi.fn(),
  refresh: vi.fn(),
  authorityId: "authority" as string | null,
  connected: true,
  pending: false,
}));
vi.mock("./state", () => ({
  projectLibrary: { copies: (input: unknown) => state.query(input) },
  useLibraryAuthority: () => ({ authorityId: state.authorityId, connected: state.connected }),
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({
    data: state.copies,
    isPending: state.pending,
    refresh: state.refresh,
  }),
}));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("./ImportProjectDialog", () => ({
  ImportProjectDialog: ({
    onClose,
    onSaved,
  }: {
    onClose: () => void;
    onSaved: (project: LibraryProject) => void;
  }) => (
    <dialog>
      <button onClick={onClose}>Cancel adding</button>
      <button onClick={() => onSaved(importedProject)}>Finish adding</button>
    </dialog>
  ),
}));

import { FolderProjectSettings, libraryProjectForFolderSettings } from "./FolderProjectSettings";

const importedProject: LibraryProject = {
  id: "added-project",
  title: "Project",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
const environmentId = EnvironmentId.make("computer");
const otherEnvironmentId = EnvironmentId.make("other-computer");
const localId = ProjectId.make("local-root");
const componentId = ProjectId.make("component");
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "shared-project",
  projectRevision: 1,
  environmentId,
  rootPath: "/work/project",
  rootLocalProjectId: localId,
  repositories: [
    {
      resourceId: "component",
      path: "/work/project/component",
      localProjectId: componentId,
      head: null,
      branch: null,
    },
  ],
  ownership: "managed",
  state: "ready",
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
const member: SidebarProjectGroupMember = {
  id: localId,
  environmentId,
  physicalProjectKey: `${environmentId}:${localId}`,
  environmentLabel: "Computer",
  title: "Project",
  workspaceRoot: copy.rootPath,
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: copy.createdAt,
  updatedAt: copy.updatedAt,
};
const root = { environmentId, id: localId };
const component = { environmentId, id: componentId };
const other = { environmentId: otherEnvironmentId, id: localId };
const matches = (members: readonly { environmentId: string; id: string }[], copies = [copy]) =>
  libraryProjectForFolderSettings(members, copies);

let renderer: ReactTestRenderer | undefined;
function FolderSettingsProbe() {
  const [name, setName] = useState("Folder name");
  return (
    <input
      aria-label="Folder name"
      value={name}
      onChange={(event) => setName(event.target.value)}
    />
  );
}
async function mount(explicitFolder = false, members = [member]) {
  const rootRoute = createRootRoute();
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/projects",
    component: () => (
      <FolderProjectSettings explicitFolder={explicitFolder} members={members}>
        <FolderSettingsProbe />
      </FolderProjectSettings>
    ),
  });
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/library/$projectId",
    validateSearch: (search: Record<string, unknown>) => ({ view: search.view }),
    component: () => <p>Shared project settings</p>,
  });
  const history = createMemoryHistory({ initialEntries: ["/settings/projects"] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute, libraryRoute]),
    history,
    isServer: false,
  });
  await router.load();
  await act(() => {
    renderer = create(<RouterProvider router={router} />);
  });
  return router;
}
function button(label: string) {
  const match = renderer!.root
    .findAllByType("button")
    .find((node) => node.children.includes(label));
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  state.copies = [];
  state.authorityId = "authority";
  state.connected = true;
  state.pending = false;
  state.query.mockReset();
  state.refresh.mockReset();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("folder settings project identity", () => {
  it("maps the root and component IDs only in their own environment", () => {
    expect(matches([root])).toBe(copy.projectId);
    expect(matches([component])).toBe(copy.projectId);
    expect(matches([root, component])).toBe(copy.projectId);
    expect(matches([other])).toBeNull();
    expect(matches([{ ...root, id: `${localId}-similar` }])).toBeNull();
  });

  it("retains exact identities after files are released or unregistered", () => {
    expect(matches([root], [{ ...copy, state: "released" }])).toBe(copy.projectId);
    expect(matches([component], [{ ...copy, registered: false }])).toBe(copy.projectId);
  });

  it("does not infer membership from a path or project name", () => {
    expect(matches([root], [{ ...copy, rootLocalProjectId: null, repositories: [] }])).toBeNull();
  });

  it("accepts repeated copies belonging to the same shared project", () => {
    expect(matches([root], [copy, { ...copy, id: "older-files", state: "released" }])).toBe(
      copy.projectId,
    );
  });

  it("requires every member of a group to resolve to the same shared project", () => {
    expect(matches([root, other], [copy, { ...copy, environmentId: otherEnvironmentId }])).toBe(
      copy.projectId,
    );
    expect(matches([root, other])).toBeNull();
    expect(
      matches(
        [root, other],
        [copy, { ...copy, environmentId: otherEnvironmentId, projectId: "another-project" }],
      ),
    ).toBeNull();
  });

  it("refuses ambiguous local identities even when a released copy is the conflicting match", () => {
    expect(
      matches(
        [root],
        [copy, { ...copy, id: "old-files", projectId: "another-project", state: "released" }],
      ),
    ).toBeNull();
    expect(
      matches(
        [root, component],
        [
          copy,
          {
            ...copy,
            id: "component-files",
            projectId: "another-project",
            rootLocalProjectId: componentId,
            repositories: [],
          },
        ],
      ),
    ).toBeNull();
  });

  it("does not redirect an empty group", () => {
    expect(matches([])).toBeNull();
  });
});

describe("folder settings routing", () => {
  it("redirects ordinary settings to the shared project, including after file release", async () => {
    state.copies = [{ ...copy, state: "released" }];
    const router = await mount();
    expect(state.query).toHaveBeenCalledWith({
      environmentId: "authority",
      input: { includeReleased: true },
    });
    expect(router.state.location.pathname).toBe(`/library/${copy.projectId}`);
    expect(router.state.location.search).toEqual({ view: "setup" });
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
  });

  it("keeps explicit computer folder settings editable instead of redirecting", async () => {
    state.copies = [copy];
    const router = await mount(true);
    const input = renderer!.root.findByType("input");
    await act(() => input.props.onChange({ target: { value: "Renamed local folder" } }));
    expect(renderer!.root.findByType("input").props.value).toBe("Renamed local folder");
    expect(router.state.location.pathname).toBe("/settings/projects");
  });

  it("preserves local settings for a partially matched group", async () => {
    state.copies = [copy];
    const router = await mount(false, [
      member,
      { ...member, environmentId: otherEnvironmentId, physicalProjectKey: "other" },
    ]);
    expect(router.state.location.pathname).toBe("/settings/projects");
    expect(renderer!.root.findByType("input").props.value).toBe("Folder name");
  });

  it("allows adding an unmapped folder, canceling, and navigating only after a successful import", async () => {
    const router = await mount();
    await act(() => button("Add folder to Projects").props.onClick());
    await act(() => button("Cancel adding").props.onClick());
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
    expect(state.refresh).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/settings/projects");
    await act(() => button("Add folder to Projects").props.onClick());
    await act(() => button("Finish adding").props.onClick());
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe("/library/added-project");
    expect(router.state.location.search).toEqual({ view: "setup" });
  });

  it("keeps local settings available when no library authority is configured", async () => {
    state.authorityId = null;
    const router = await mount();
    expect(state.query).not.toHaveBeenCalled();
    expect(renderer!.root.findByType("input").props.value).toBe("Folder name");
    expect(router.state.location.pathname).toBe("/settings/projects");
  });
});
