// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.create }));
vi.mock("./state", () => ({
  projectLibrary: { createProject: {} },
  useLibraryPermission: () => true,
  useLibraryProjects: () => ({ query: { data: [] } }),
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
      {props.items.map((item) => (
        <button key={item.id} disabled={props.busy || item.disabled} onClick={item.select}>
          {item.title}
        </button>
      ))}
    </>
  ),
}));
import { ProjectEditorDialog } from "./ProjectEditorDialog";

let root: Root;
let container: HTMLDivElement;
const onSaved = vi.fn();
const input = () => container.querySelector("input")!;
const button = (title: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent === title)!;
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
  state.create.mockReset();
  onSaved.mockClear();
  state.create.mockResolvedValue(AsyncResult.success({ id: "new-project" }));
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
  await choose("Create “Coast”");
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
  await choose("Create “Coast”");
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        color: "blue",
        resources: [expect.objectContaining({ remoteUrl: "https://github.com/example/coast" })],
      }),
    }),
  );
});
it("retries an uncertain create with the same receipt and locked draft", async () => {
  state.create.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Response lost"))));
  await choose("Create “Coast”");
  expect(container.textContent).toContain("Response lost");
  expect(input().readOnly).toBe(true);
  await choose("Retry project creation");
  expect(state.create.mock.calls[1]).toEqual(state.create.mock.calls[0]);
  expect(onSaved).toHaveBeenCalledOnce();
});
