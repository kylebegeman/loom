// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import type { UpdateEverythingRun } from "~/components/sidebar/updateEverything.logic";
import { useUpdateEverything } from "~/components/sidebar/useUpdateEverything";
import { waitForUpdateRestart } from "~/components/sidebar/updateEverythingRun";

const fixture = vi.hoisted(() => ({
  run: null as UpdateEverythingRun | null,
  updateServer: vi.fn(async () => ({ status: "skipped" })),
  updateProviders: vi.fn(async () => []),
  settle: vi.fn(),
}));
const environments = ["local", "remote"].map((id) => ({
  environmentId: EnvironmentId.make(id),
  label: id,
  entry: {
    enabled: true,
    target:
      id === "local"
        ? new PrimaryConnectionTarget({
            environmentId: EnvironmentId.make(id),
            label: id,
            httpBaseUrl: "http://localhost:3773",
            wsBaseUrl: "ws://localhost:3773",
          })
        : new BearerConnectionTarget({
            environmentId: EnvironmentId.make(id),
            label: id,
            connectionId: id,
          }),
  },
  connection: { phase: "connected" },
  serverConfig: {
    environment: {
      environmentId: id,
      serverVersion: "0.0.40",
      platform: { os: "darwin", arch: "arm64" },
      capabilities: { serverSelfUpdate: "desktop-managed", desktopAppUpdate: true },
    },
    settings: { continueThreadsAfterServerUpdate: false },
  },
}));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/environments", () => ({ useEnvironments: () => ({ environments }) }));
// One value per environment in the newline-joined id key.
const perEnvironment = vi.hoisted(
  () => (value: unknown) => (key: string) => (key === "" ? [] : key.split("\n").map(() => value)),
);
vi.mock("~/state/server", () => ({
  environmentUpdateStatesAtom: (key: string) => Atom.make(perEnvironment({ status: "idle" })(key)),
}));
vi.mock("~/state/session", () => ({
  environmentSessionStatesAtom: (key: string) => Atom.make(perEnvironment(null)(key)),
}));
vi.mock("~/fork/connections/runtimeRelease", () => ({
  useRuntimeReleaseAssets: () => AsyncResult.success([]),
  isRuntimeArchivePublished: () => false,
}));
vi.mock("~/components/ProviderUpdatesAction", () => ({
  useProviderUpdates: () => ({ machines: [], updateAll: fixture.updateProviders }),
}));
vi.mock("~/components/ServerUpdateAction", () => ({
  canUpdateServer: () => true,
  useServerUpdate: () => fixture.updateServer,
}));
vi.mock("~/components/sidebar/updateEverythingRun", () => ({
  setUpdateEverythingRun: (
    update: (run: UpdateEverythingRun | null) => UpdateEverythingRun | null,
  ) => {
    fixture.run = update(fixture.run);
  },
  settleUpdateRunMachine: fixture.settle,
  waitForServerUpdateHandoff: async (_id: unknown, done: Promise<unknown>) => {
    await done;
  },
  clearSavedUpdateEverythingResult: vi.fn(),
  saveUpdateEverythingResult: vi.fn(),
  showUpdateEverythingResult: vi.fn(),
  waitForUpdateRestart: vi.fn(),
}));
let renderer: ReactTestRenderer | null = null;
let updates: ReturnType<typeof useUpdateEverything>;
function Harness({ scope }: { scope: "local" | "fleet" }) {
  const value = useUpdateEverything("0.0.50", scope);
  useLayoutEffect(() => {
    updates = value;
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.run = null;
  fixture.updateServer.mockClear();
  fixture.updateProviders.mockClear();
  fixture.settle.mockClear();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
it("does not advertise or run remote runtime updates in the local footer", async () => {
  await act(async () => {
    renderer = create(<Harness scope="local" />);
  });
  expect(updates.hasUpdates).toBe(false);
  expect(updates.skipped).toEqual([]);
  expect(updates.machines.map((machine) => machine.environmentId)).toEqual(["local"]);
  await updates.run({});
  expect(fixture.updateServer).not.toHaveBeenCalled();
});
it("keeps a skipped fleet update failed and retryable instead of marking it updated", async () => {
  await act(async () => {
    renderer = create(<Harness scope="fleet" />);
  });
  expect(updates.hasUpdates).toBe(true);
  await updates.run({});
  expect(fixture.updateServer).toHaveBeenCalledOnce();
  expect(fixture.settle).toHaveBeenCalledWith("remote", "Could not start the update", {
    serverUpdated: false,
    providerFailure: null,
  });
  expect(fixture.run?.scope).toBe("fleet");
});
it("does not replace an update pass that is already running", async () => {
  const existing: UpdateEverythingRun = {
    scope: "local",
    localVersion: "0.0.50",
    phase: "providers",
    restartAt: null,
    machines: [],
  };
  fixture.run = existing;
  await act(async () => {
    renderer = create(<Harness scope="fleet" />);
  });
  await updates.run({});
  expect(fixture.run).toBe(existing);
  expect(fixture.updateProviders).not.toHaveBeenCalled();
  expect(fixture.updateServer).not.toHaveBeenCalled();
});
it("hands the app install to the idle wait instead of the restart countdown", async () => {
  await act(async () => {
    renderer = create(<Harness scope="local" />);
  });
  const installLocal = vi.fn(async () => true);
  const installLocalWhenIdle = vi.fn(async () => true);
  await updates.run({ installLocal, installLocalWhenIdle });
  expect(installLocalWhenIdle).toHaveBeenCalledOnce();
  expect(installLocal).not.toHaveBeenCalled();
  expect(waitForUpdateRestart).not.toHaveBeenCalled();
  expect(fixture.run).toBeNull();
});
