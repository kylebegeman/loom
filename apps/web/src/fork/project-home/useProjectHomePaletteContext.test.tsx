import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useProjectHomePaletteContext } from "./useProjectHomePaletteContext";
const state = vi.hoisted(() => ({ projectKey: "atlas", search: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: { projectKey?: string }) => unknown }) =>
    select(state.projectKey ? { projectKey: state.projectKey } : {}),
  useLocation: ({
    select,
  }: {
    select: (location: { search: Record<string, unknown> }) => unknown;
  }) => select({ search: state.search }),
}));
vi.mock("./useProjectHomeGroup", () => ({
  useProjectHomeGroup: (projectKey: string) => ({
    group: projectKey
      ? { projectKey, environmentId: "mac", id: `${projectKey}-mac`, displayName: projectKey }
      : null,
    settingsProjectKey: projectKey ? `${projectKey}-settings` : null,
  }),
}));
let renderer: ReactTestRenderer | null = null;
let context: ReturnType<typeof useProjectHomePaletteContext>;
function Palette() {
  const value = useProjectHomePaletteContext();
  useLayoutEffect(() => {
    context = value;
  });
  return null;
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
it("keeps palette actions on the displayed home and exact prepared checkout, then yields to ordinary thread context", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => {
    renderer = create(<Palette />);
  });
  expect(context?.group.projectKey).toBe("atlas");
  expect(context?.settingsProjectKey).toBe("atlas-settings");
  expect(context?.projectRef).toEqual({ environmentId: "mac", projectId: "atlas-mac" });
  state.search = { computer: EnvironmentId.make("pi"), checkoutId: ProjectId.make("atlas-pi") };
  await act(async () => renderer?.update(<Palette />));
  expect(context?.projectRef).toEqual({ environmentId: "pi", projectId: "atlas-pi" });
  state.projectKey = "loom";
  state.search = {};
  await act(async () => renderer?.update(<Palette />));
  expect(context?.group.projectKey).toBe("loom");
  expect(context?.projectRef.projectId).toBe("loom-mac");
  state.projectKey = "";
  await act(async () => renderer?.update(<Palette />));
  expect(context).toBeNull();
});
