// @vitest-environment jsdom
import { act, useInsertionEffect, useLayoutEffect, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useProjectNavigationScroll } from "./scroll";
import type { ProjectNavigationView } from "./preference";

let renderer: ReactTestRenderer | null = null;
let navigation: ReturnType<typeof useProjectNavigationScroll>;
let viewport: HTMLDivElement;
let content: HTMLDivElement;
let maximum = 1000;
let position = 0;

function Navigator() {
  const [view, setView] = useState<ProjectNavigationView>("threads");
  // Simulate the browser clamping during a commit that replaces the long thread list.
  useInsertionEffect(() => {
    maximum = view === "threads" ? 1000 : 50;
    position = Math.min(maximum, position);
  }, [view]);
  const { contentRef, changeView } = useProjectNavigationScroll(view, setView);
  useLayoutEffect(() => {
    navigation = { contentRef, changeView };
  });
  return <div ref={contentRef} />;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  viewport = document.createElement("div");
  viewport.dataset.slot = "scroll-area-viewport";
  content = document.createElement("div");
  viewport.append(content);
  maximum = 1000;
  position = 0;
  Object.defineProperty(viewport, "scrollTop", {
    get: () => position,
    set: (next: number) => {
      position = Math.min(maximum, Math.max(0, next));
    },
  });
  await act(async () => {
    renderer = create(<Navigator />, { createNodeMock: () => content });
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it("preserves independent view positions before shorter project lists clamp the viewport", async () => {
  viewport.scrollTop = 700;
  // A view switch must also capture a recent scroll whose event has not fired yet.
  await act(async () => navigation.changeView("projects"));
  expect(viewport.scrollTop).toBe(0);
  viewport.scrollTop = 20;
  viewport.dispatchEvent(new Event("scroll"));
  await act(async () => navigation.changeView("threads"));
  expect(viewport.scrollTop).toBe(700);
  await act(async () => navigation.changeView("projects"));
  expect(viewport.scrollTop).toBe(20);
});

it("starts at the top when View threads changes the selected project scope", async () => {
  viewport.scrollTop = 800;
  await act(async () => navigation.changeView("projects"));
  await act(async () => navigation.changeView("threads", { resetScroll: true }));
  expect(viewport.scrollTop).toBe(0);
  viewport.scrollTop = 100;
  await act(async () => navigation.changeView("threads", { resetScroll: true }));
  expect(viewport.scrollTop).toBe(0);
});
