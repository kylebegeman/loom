// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  outcome: vi.fn(),
  identity: { issuer: "https://id.test", subject: "kyle" },
  workflows: true,
  access: null as { readonly message: string } | null,
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => (command === "outcome" ? state.outcome : state.create),
}));
vi.mock("~/state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/session")>()),
  useEnvironmentSessionState: () => ({ data: { identity: state.identity } }),
}));
vi.mock("./state", () => ({
  projectLibrary: { createProject: {}, operationOutcome: "outcome" },
  useLibraryPermission: () => true,
  useLibraryAccessBlock: () => state.access,
  useLibraryProjects: () => ({
    query: { data: [] },
    environment: {
      serverConfig: {
        environment: {
          capabilities: { loomFeatures: state.workflows ? ["project-workflows"] : [] },
        },
      },
    },
  }),
}));
vi.mock("./LibraryAccessNotice", () => ({
  LibraryAccessRepairNotice: () => null,
  LibraryAccessNotice: ({ block }: { block: { message: string } | null }) => (
    <p role="status">{block?.message}</p>
  ),
}));
vi.mock("./LibraryPalette", () => ({
  LibraryPaletteDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LibraryPaletteView: (
    props: ComponentProps<typeof import("./LibraryPalette").LibraryPaletteView>,
  ) => (
    <>
      <input
        aria-label="Palette input"
        value={props.query}
        readOnly={props.readOnly}
        onChange={(event) => props.onQueryChange(event.target.value)}
      />
      {props.onBack ? <button onClick={props.onBack}>Back</button> : null}
      <p role="alert">{props.error}</p>
      {props.children}
      {props.items.map((item) => (
        <button key={item.id} disabled={props.busy || item.disabled} onClick={item.select}>
          {item.title}
        </button>
      ))}
    </>
  ),
}));
import { newProjectDraftKey } from "./newProjectChoices";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { readLibraryAttempt, saveLibraryAttempt } from "./attempts";

const legacyKey = "loom:library:editor:library:new";
const editorKey = `${legacyKey}:${newProjectDraftKey({ step: "create", page: "name", repository: "", title: "Coast" })}`;
let root: Root;
let container: HTMLDivElement;
const onSaved = vi.fn();
const createdProject = {
  id: "new-project",
  title: "Coast",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: "2026-11-11T12:00:00.000Z",
  updatedAt: "2026-11-11T12:00:00.000Z",
};
const input = () => container.querySelector("input")!;
const button = (title: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === title)!;
async function choose(title: string) {
  expect(button(title).disabled).toBe(false);
  await act(() => button(title).click());
}
async function type(value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saveLibraryAttempt(editorKey, null, localStorage);
  saveLibraryAttempt(legacyKey, null, localStorage);
  state.create.mockReset();
  state.outcome.mockReset().mockResolvedValue(AsyncResult.success(null));
  state.identity = { issuer: "https://id.test", subject: "kyle" };
  state.workflows = true;
  state.access = null;
  onSaved.mockClear();
  state.create.mockResolvedValue(AsyncResult.success(createdProject));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("creates from a name immediately with no mandatory setup pages", async () => {
  expect(input().value).toBe("Coast");
  expect(state.create).not.toHaveBeenCalled();
  await choose("Create project");
  expect(state.create).toHaveBeenCalledExactlyOnceWith({
    environmentId: "library",
    input: expect.objectContaining({ title: "Coast", resources: [], brief: "" }),
  });
  expect(onSaved).toHaveBeenCalledOnce();
});
it("preserves drafts on Back, rejects duplicate repositories and keeps color selection", async () => {
  await choose("Add a repository or link");
  await type("github.com/example/coast");
  await choose("Back");
  expect(input().value).toBe("Coast");
  await choose("Add a repository or link");
  expect(input().value).toBe("github.com/example/coast");
  await choose("Add coast");
  await choose("Project color");
  await choose("Blue");
  await choose("Add a repository or link");
  await type("github.com/example/coast");
  expect(button("Add coast").disabled).toBe(true);
  expect(container.textContent).toContain("already in this project");
  await choose("Back");
  expect(state.create).not.toHaveBeenCalled();
  await choose("Create project");
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        color: "blue",
        resources: [expect.objectContaining({ remoteUrl: "https://github.com/example/coast" })],
      }),
    }),
  );
});
it("waits for explicit resume after reopening without replacing another project's draft", async () => {
  state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Response lost"))));
  await choose("Create project");
  expect(container.textContent).toContain("Response lost");
  expect(input().readOnly).toBe(true);
  const coastRequest = state.create.mock.calls[0];

  await act(() => root.render(null));
  state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Still offline"))));
  state.access = { message: "Sign in to the Library again." };
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(input().value).toBe("Coast");
  expect(input().readOnly).toBe(true);
  expect(state.create).toHaveBeenCalledOnce();
  state.access = null;
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(state.create).toHaveBeenCalledOnce();
  await choose("Resume creation");
  expect(state.create.mock.calls[1]).toEqual(coastRequest);

  await act(() => root.render(null));
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="desk"
        initialResource="https://github.com/kylebegeman/desk.git"
        continueTo="clone"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(input().value).toBe("desk");
  expect(input().readOnly).toBe(false);
  await choose("Create project");
  expect(state.create.mock.calls[2]?.[0].input).toEqual(
    expect.objectContaining({
      title: "desk",
      resources: [
        expect.objectContaining({ remoteUrl: "https://github.com/kylebegeman/desk.git" }),
      ],
    }),
  );
  expect(state.create.mock.calls[2]?.[0].input.requestId).not.toBe(
    coastRequest?.[0].input.requestId,
  );
  expect(onSaved).toHaveBeenCalledOnce();
  expect(JSON.parse(readLibraryAttempt(editorKey, localStorage)!)).toEqual(
    expect.objectContaining(coastRequest?.[0].input),
  );
});

it("resumes a submitted creation when its response arrived while the editor was hidden", async () => {
  let complete: (result: ReturnType<typeof AsyncResult.success>) => void = () => {};
  state.create.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  await choose("Create project");
  const request = state.create.mock.calls[0];
  await act(() =>
    root.render(
      <ProjectEditorDialog
        open={false}
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  await act(() => complete(AsyncResult.success(createdProject)));
  expect(onSaved).not.toHaveBeenCalled();
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.create.mock.calls[0]).toEqual(request);
  expect(onSaved).toHaveBeenCalledOnce();
});

it("keeps one resumed request in flight across connection availability changes", async () => {
  state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Response lost"))));
  await choose("Create project");
  await act(() => root.render(null));
  let complete: (result: ReturnType<typeof AsyncResult.success>) => void = () => {};
  state.create.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const editor = () => (
    <ProjectEditorDialog
      initialTitle="Coast"
      authorityId={EnvironmentId.make("library")}
      onSaved={onSaved}
      onClose={vi.fn()}
    />
  );
  await act(() => root.render(editor()));
  expect(state.create).toHaveBeenCalledOnce();
  await choose("Resume creation");
  state.access = { message: "Connecting" };
  await act(() => root.render(editor()));
  state.access = null;
  await act(() => root.render(editor()));
  expect(state.create).toHaveBeenCalledTimes(2);
  await act(() => complete(AsyncResult.success(createdProject)));
  expect(onSaved).toHaveBeenCalledOnce();
});

it("does not clear a newer persisted creation when an older response arrives", async () => {
  let complete: (result: ReturnType<typeof AsyncResult.success>) => void = () => {};
  state.create.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  await choose("Create project");
  const newer = {
    ...state.create.mock.calls[0]?.[0].input,
    requestId: "newer-project",
    title: "desk",
  };
  await act(() => saveLibraryAttempt(editorKey, JSON.stringify(newer), localStorage));
  await act(() => complete(AsyncResult.success(createdProject)));
  expect(JSON.parse(readLibraryAttempt(editorKey, localStorage)!)).toEqual(newer);
});

it.each(["absent", "cancelled"])(
  "starts over only after confirming the original creation is %s",
  async (outcome) => {
    state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Response lost"))));
    await choose("Create project");
    if (outcome === "cancelled")
      state.outcome.mockResolvedValueOnce(
        AsyncResult.success({ state: "cancelled", result: null }),
      );
    await choose("Start over");
    expect(input().readOnly).toBe(false);
    expect(input().value).toBe("Coast");
    expect(container.textContent).not.toContain("Response lost");
    await choose("Create project");
    const [first, second] = state.create.mock.calls.map(([call]) => call.input);
    expect(second).toEqual({ ...first, requestId: expect.any(String) });
    expect(second.requestId).not.toBe(first.requestId);
  },
);

it("reconciles a lost success before resuming without submitting the project again", async () => {
  state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Response lost"))));
  await choose("Create project");
  const requestId = state.create.mock.calls[0]?.[0].input.requestId;
  state.outcome.mockResolvedValueOnce(
    AsyncResult.success({ state: "succeeded", result: createdProject }),
  );
  await choose("Resume creation");
  expect(state.outcome).toHaveBeenLastCalledWith({
    environmentId: "library",
    input: { requestId, kind: "create" },
  });
  expect(state.create).toHaveBeenCalledOnce();
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(createdProject);
});

it("keeps the original identity when a queued creation or failed status check prevents starting over", async () => {
  state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Response lost"))));
  await choose("Create project");
  const request = state.create.mock.calls[0]?.[0];
  state.outcome.mockResolvedValueOnce(AsyncResult.success({ state: "running", result: null }));
  await choose("Start over");
  expect(input().readOnly).toBe(true);
  expect(container.textContent).toContain("already in progress");
  expect(state.create).toHaveBeenCalledOnce();
  state.outcome.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Offline"))));
  await choose("Resume creation");
  expect(input().readOnly).toBe(true);
  expect(state.create).toHaveBeenCalledOnce();
  expect(JSON.parse(readLibraryAttempt(editorKey, localStorage)!)).toEqual(
    expect.objectContaining(request.input),
  );
});

it("does not resume a saved creation under a different Identity account", async () => {
  state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Response lost"))));
  await choose("Create project");
  state.identity = { ...state.identity, subject: "another-person" };
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(button("Resume creation").disabled).toBe(true);
  expect(container.textContent).toContain("account that started");
  expect(state.create).toHaveBeenCalledOnce();
});

it("keeps blueprint creation unavailable on older Library servers", async () => {
  state.workflows = false;
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(button("Use a project blueprint")).toBeUndefined();
  await choose("Create project");
  expect(state.create).toHaveBeenCalledOnce();
});

it("explains blocked Library access instead of offering a create that cannot run", async () => {
  state.access = { message: "Your sign-in to Library expired. Sign in again to continue." };
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(button("Create project").disabled).toBe(true);
  expect(container.textContent).toContain("Sign in again to continue.");
  state.access = null;
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  await choose("Create project");
  expect(state.create).toHaveBeenCalledOnce();
});

it("leaves a form opened on the blueprint from it until a blueprint fills in the name", async () => {
  const onBack = vi.fn();
  await act(() =>
    root.render(
      <ProjectEditorDialog
        key="blueprint"
        initialPage="blueprint"
        authorityId={EnvironmentId.make("library")}
        onBack={onBack}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  await choose("Back");
  expect(onBack).toHaveBeenCalledOnce();
  const blueprint = container.querySelector("textarea")!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      blueprint,
      JSON.stringify({
        format: "loom-project",
        version: 1,
        title: "Harbor",
        brief: "",
        resources: [],
        connections: [],
      }),
    );
    blueprint.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await choose("Review this blueprint");
  expect(input().value).toBe("Harbor");
  // Reviewing the imported blueprint returns to its name, not out of the form.
  await choose("Review imported blueprint");
  await choose("Back");
  expect(onBack).toHaveBeenCalledOnce();
  expect(input().value).toBe("Harbor");
});

it("migrates a matching legacy saved creation without submitting it", async () => {
  await act(() => root.render(null));
  const legacy = { requestId: "legacy-create", title: "Coast", brief: "Saved", resources: [] };
  saveLibraryAttempt(legacyKey, JSON.stringify(legacy), localStorage);
  await act(() =>
    root.render(
      <ProjectEditorDialog
        initialTitle="Coast"
        authorityId={EnvironmentId.make("library")}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(input().readOnly).toBe(true);
  expect(state.create).not.toHaveBeenCalled();
  expect(JSON.parse(readLibraryAttempt(editorKey, localStorage)!)).toEqual({
    ...legacy,
    state: "ready",
  });
  expect(readLibraryAttempt(legacyKey, localStorage)).toBeNull();
});
