// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useUiStateStore } from "~/uiStateStore";
import { onProjectThreadView, requestProjectThreadView } from "./threadView";
const originalScope = useUiStateStore.getState().sidebarProjectScopeKeys;
afterEach(() => {
  useUiStateStore.setState({ sidebarProjectScopeKeys: originalScope });
});
it("scopes the existing thread navigator without opening a new draft or changing the project route", () => {
  const selected = vi.fn();
  const unsubscribe = onProjectThreadView(selected);
  const location = window.location.href;
  requestProjectThreadView("logical-project");
  expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["logical-project"]);
  expect(selected).toHaveBeenCalledWith("logical-project");
  expect(window.location.href).toBe(location);
  unsubscribe();
  requestProjectThreadView("other-project");
  expect(selected).toHaveBeenCalledTimes(1);
});
