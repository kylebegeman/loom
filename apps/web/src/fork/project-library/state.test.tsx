// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  ready: true,
  primaryId: null as string | null,
  hosted: false,
}));
vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/fork", async (original) => ({
  ...(await original<typeof import("@t3tools/client-runtime/fork")>()),
  createProjectLibraryAtoms: () => ({}),
}));
vi.mock("~/state/presentation", () => ({
  useEnvironmentPresentation: () => ({ isReady: state.ready, presentation: null }),
}));
vi.mock("~/state/environments", () => ({
  projectEnvironmentPresentation: vi.fn(),
  usePrimaryEnvironmentId: () => state.primaryId,
  useEnvironments: () => ({ environments: [], isReady: state.ready }),
}));
vi.mock("~/state/session", () => ({
  useEnvironmentSessionState: () => ({ data: null, hasError: false, isPending: false }),
}));
vi.mock("~/hostedPairing", () => ({ isHostedStaticApp: () => state.hosted }));
vi.mock("~/localEnvironment", () => ({ isLocalEnvironmentDisabled: () => false }));

import { useLibraryAccessBlock } from "./state";

let root: Root;
let container: HTMLDivElement;
function Probe() {
  const block = useLibraryAccessBlock(EnvironmentId.make("library"), [
    { requiredScopes: () => [] },
  ]);
  return <output>{JSON.stringify(block)}</output>;
}
async function renderBlock() {
  await act(() => root.render(<Probe />));
  return JSON.parse(container.textContent ?? "null") as ReturnType<typeof useLibraryAccessBlock>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.ready = true;
  state.primaryId = null;
  state.hosted = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("does not call a saved Library removed while the primary environment is still registering", async () => {
  // The primary can be the Library itself; startup must not flash a reconnect warning.
  expect(await renderBlock()).toBeNull();
});

it("sends a saved Library that left this device to Connections once the catalog is complete", async () => {
  state.primaryId = "desk";
  expect(await renderBlock()).toEqual({
    label: "Your Library",
    message: "Your Library is not connected. Reconnect it to continue.",
    repair: "connection",
    environmentId: "library",
  });
});

it("explains a removed Library right away where no primary environment ever registers", async () => {
  state.hosted = true;
  expect(await renderBlock()).toMatchObject({ repair: "connection" });
  state.ready = false;
  expect(await renderBlock()).toBeNull();
});
