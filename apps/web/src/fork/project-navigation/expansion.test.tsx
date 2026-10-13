// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useUiStateStore } from "~/uiStateStore";
import { useProjectLibraryExpansion } from "./expansion";

const rows = new Map<string, ReturnType<typeof useProjectLibraryExpansion>>();
let renderer: ReactTestRenderer | null = null;
const initialExpansion = useUiStateStore.getState().projectExpandedById;

function Row({ projectKey }: { projectKey: string }) {
  const expansion = useProjectLibraryExpansion(projectKey);
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

it("keeps expanded project previews when switching views or reopening the sidebar", async () => {
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

it("keeps library expansion independent from upstream project section preferences", async () => {
  useUiStateStore.setState({ projectExpandedById: { "logical-a": true } });
  await showProjects();
  expect(rows.get("logical-a")?.[0]).toBe(false);
  await act(async () => rows.get("logical-a")?.[1]());
  expect(useUiStateStore.getState().projectExpandedById["logical-a"]).toBe(true);
  expect(rows.get("logical-a")?.[0]).toBe(true);
});
