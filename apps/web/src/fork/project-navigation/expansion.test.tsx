// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useUiStateStore } from "~/uiStateStore";
import { useProjectNavigationExpansion } from "./expansion";

const rows = new Map<string, ReturnType<typeof useProjectNavigationExpansion>>();
let renderer: ReactTestRenderer | null = null;
const initialExpansion = useUiStateStore.getState().projectExpandedById;

function Row({ projectKey, open = false }: { projectKey: string; open?: boolean }) {
  const expansion = useProjectNavigationExpansion(projectKey, open);
  useLayoutEffect(() => {
    rows.set(projectKey, expansion);
  });
  return null;
}

async function showProjects() {
  await act(async () => {
    const library = (
      <>
        <Row projectKey="logical-a" />
        <Row projectKey="logical-b" />
      </>
    );
    if (renderer) renderer.update(library);
    else renderer = create(library);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useUiStateStore.setState({ projectExpandedById: {} });
  rows.clear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  useUiStateStore.setState({ projectExpandedById: initialExpansion });
  vi.unstubAllGlobals();
});

it("keeps a section's state when switching views or reopening the sidebar", async () => {
  await showProjects();
  expect(rows.get("logical-a")?.[0]).toBe(false);
  await act(async () => rows.get("logical-a")?.[1]());
  expect(rows.get("logical-a")?.[0]).toBe(true);
  expect(rows.get("logical-b")?.[0]).toBe(false);
  await act(async () => renderer?.update(<></>));
  await showProjects();
  expect(rows.get("logical-a")?.[0]).toBe(true);
  expect(rows.get("logical-b")?.[0]).toBe(false);
  await act(async () => renderer?.unmount());
  renderer = null;
  await showProjects();
  expect(rows.get("logical-a")?.[0]).toBe(true);
  await act(async () => rows.get("logical-a")?.[1]());
  expect(rows.get("logical-a")?.[0]).toBe(false);
});

it("keeps Projects view state independent from upstream project section preferences", async () => {
  useUiStateStore.setState({ projectExpandedById: { "logical-a": true } });
  await showProjects();
  expect(rows.get("logical-a")?.[0]).toBe(false);
  await act(async () => rows.get("logical-a")?.[1]());
  expect(useUiStateStore.getState().projectExpandedById["logical-a"]).toBe(true);
  expect(rows.get("logical-a")?.[0]).toBe(true);
});

it("starts open when asked and remembers closing", async () => {
  await act(async () => {
    renderer = create(<Row projectKey="group" open />);
  });
  expect(rows.get("group")?.[0]).toBe(true);
  await act(async () => rows.get("group")?.[1]());
  expect(rows.get("group")?.[0]).toBe(false);
  expect(useUiStateStore.getState().projectExpandedById["loom:sidebar-projects:group"]).toBe(false);
});
