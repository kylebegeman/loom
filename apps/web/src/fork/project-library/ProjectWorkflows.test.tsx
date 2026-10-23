// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  save: vi.fn(),
  apply: vi.fn(),
  refresh: vi.fn(),
  read: vi.fn(),
  register: vi.fn(),
  allowed: true,
  entries: [] as unknown[],
}));
vi.mock("./state", () => ({
  projectLibrary: {
    workstreams: () => "workstreams",
    preservation: () => "preservation",
    blueprint: () => "blueprint",
    applyBlueprint: "apply",
    saveWorkstream: "save",
    refreshCopyHealth: "refresh",
    readCopyStatus: "read",
    registerCopy: "register",
  },
  useLibraryPermission: () => state.allowed,
  useLibraryAuthority: () => ({
    environments: [{ environmentId: "computer", connection: { phase: "connected" } }],
  }),
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (query: string) => ({
    data:
      query === "preservation"
        ? state.entries
        : query === "blueprint"
          ? {
              format: "loom-project",
              version: 1,
              title: "App",
              brief: "",
              resources: [],
              connections: [],
            }
          : [],
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: "save" | "apply" | "refresh" | "read" | "register") =>
    state[command] ?? vi.fn(),
}));
vi.mock("./ProjectOperations", () => ({ ProjectOperationHistory: () => null }));
vi.mock("./ReleaseCopyDialog", () => ({ ReleaseCopyDialog: () => null }));
vi.mock("./LibraryControls", () => ({
  LibraryDialog: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
    <div>
      {children}
      {actions}
    </div>
  ),
  LibraryErrorNotice: ({ error }: { error: string | null }) =>
    error ? <p role="alert">{error}</p> : null,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("~/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("~/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("~/components/ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));

import { ProjectBlueprint } from "./ProjectBlueprint";
import { ProjectWorkstreams } from "./ProjectWorkstreams";
import { ProjectPreservationCenter } from "./ProjectPreservation";
const now = "2026-10-23T12:00:00.000Z";
const project: LibraryProject = {
  id: "project",
  title: "App",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: now,
  updatedAt: now,
};
const copy: LibraryWorkingCopy = {
  id: "copy",
  projectId: project.id,
  projectRevision: 1,
  environmentId: EnvironmentId.make("computer"),
  rootPath: "/work/app",
  repositories: [],
  ownership: "managed",
  state: "ready",
  keepOnComputer: false,
  createdAt: now,
  updatedAt: now,
};
let container: HTMLDivElement, root: Root;
const button = (name: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === name,
  )!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.allowed = true;
  state.entries = [{ project, copy, blockers: [], restore: "unverified", checkedAt: null }];
  state.refresh.mockResolvedValue(
    AsyncResult.success({
      copyId: copy.id,
      environmentId: copy.environmentId,
      checkedAt: "2026-10-23T13:00:00.000Z",
      repositories: [],
    }),
  );
  state.read.mockResolvedValue(
    AsyncResult.success({ copy: { ...copy, keepOnComputer: true }, reviewToken: "review" }),
  );
  state.register.mockResolvedValue(AsyncResult.success(copy));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("retries a new workstream with the same identity and receipt after a lost response", async () => {
  state.save
    .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Lost response"))))
    .mockResolvedValueOnce(AsyncResult.success({}));
  await act(async () =>
    root.render(
      <ProjectWorkstreams
        project={project}
        authorityId={EnvironmentId.make("library")}
        copies={[]}
        threads={[]}
      />,
    ),
  );
  await act(async () => button("New workstream").click());
  const input = container.querySelector<HTMLInputElement>('[aria-label="Workstream title"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Ship");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Save active").click());
  expect(container.textContent).toContain("Lost response");
  await act(async () => button("Save active").click());
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.save.mock.calls[1]![0]).toEqual(state.save.mock.calls[0]![0]);
});
it("publishes refreshed health against current copy metadata without advancing its lifecycle timestamp", async () => {
  await act(async () =>
    root.render(
      <ProjectPreservationCenter
        authorityId={EnvironmentId.make("library")}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    ),
  );
  await act(async () => button("Check files and remotes").click());
  expect(state.register.mock.calls[0]![0].input.copy).toMatchObject({
    keepOnComputer: true,
    updatedAt: now,
    health: { checkedAt: "2026-10-23T13:00:00.000Z" },
  });
});
it("does not republish a copy released while its health was being checked", async () => {
  state.read.mockResolvedValue(AsyncResult.success({ copy: { ...copy, state: "released" } }));
  await act(async () =>
    root.render(
      <ProjectPreservationCenter
        authorityId={EnvironmentId.make("library")}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    ),
  );
  await act(async () => button("Check files and remotes").click());
  expect(state.register).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Refresh the Library");
});
it("disables preservation mutations when destination permissions are unavailable", async () => {
  state.allowed = false;
  await act(async () =>
    root.render(
      <ProjectPreservationCenter
        authorityId={EnvironmentId.make("library")}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    ),
  );
  expect(button("Check files and remotes").disabled).toBe(true);
  expect(button("Save recovery archive").disabled).toBe(true);
  expect(button("Review file removal").disabled).toBe(true);
});

it("retries a reviewed blueprint with the same request after a lost response", async () => {
  state.apply
    .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Lost blueprint response"))))
    .mockResolvedValueOnce(AsyncResult.success(project));
  await act(async () =>
    root.render(
      <ProjectBlueprint
        project={project}
        authorityId={EnvironmentId.make("library")}
        onChanged={vi.fn()}
      />,
    ),
  );
  await act(async () => button("Import or edit blueprint").click());
  await act(async () => button("Apply reviewed blueprint").click());
  expect(container.textContent).toContain("Lost blueprint response");
  await act(async () => button("Apply reviewed blueprint").click());
  expect(state.apply).toHaveBeenCalledTimes(2);
  expect(state.apply.mock.calls[1]![0]).toEqual(state.apply.mock.calls[0]![0]);
});

it("offers repository resources for workstreams without turning ordinary links or the placeholder into references", async () => {
  state.save.mockResolvedValue(AsyncResult.success({}));
  const resource = { remoteUrl: null, relativePath: "", defaultBranch: null };
  await act(async () =>
    root.render(
      <ProjectWorkstreams
        project={{
          ...project,
          resources: [
            {
              ...resource,
              id: "docs",
              title: "Documentation",
              kind: "link",
              url: "https://example.com/docs",
            },
            { ...resource, id: "repo", title: "Source repository", kind: "repository" },
          ],
        }}
        authorityId={EnvironmentId.make("library")}
        copies={[]}
        threads={[]}
      />,
    ),
  );
  await act(async () => button("New workstream").click());
  const input = container.querySelector<HTMLInputElement>('[aria-label="Workstream title"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Ship");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Link existing work"]')!;
  expect(select.textContent).not.toContain("Documentation");
  await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => button("Save active").click());
  expect(state.save.mock.calls[0]![0].input.references).toEqual([]);
});
