// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useProviderUpdates } from "~/components/ProviderUpdatesAction";

const fixture = vi.hoisted(() => ({
  environments: [] as Array<{
    environmentId: string;
    label: string;
    entry: { enabled: boolean };
    connection: { phase: string };
    serverConfig: { providers: ReadonlyArray<ServerProvider> };
  }>,
  permissions: new Set<string>(),
  update: vi.fn(async () => ({ _tag: "Success", value: { providers: [] } })),
}));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({ environments: fixture.environments }),
  useEnvironmentProviders: () =>
    new Map(
      fixture.environments.map((environment) => [
        environment.environmentId,
        environment.serverConfig.providers,
      ]),
    ),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => fixture.update }));
vi.mock("~/state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    serverEnvironment: {
      updateProvider: { permissionAtom: (id: string) => Atom.make(fixture.permissions.has(id)) },
    },
  };
});
vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (value: unknown) => value,
}));

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-16T13:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
  versionAdvisory: {
    status: "behind_latest",
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    updateCommand: "npm install -g @openai/codex@latest",
    canUpdate: true,
    checkedAt: "2026-10-16T13:00:00Z",
    message: "Update available.",
  },
};
let renderer: ReactTestRenderer | null = null;
let updates: ReturnType<typeof useProviderUpdates>;
function Harness({ ids }: { ids?: ReadonlySet<EnvironmentId> }) {
  const value = useProviderUpdates(ids);
  useLayoutEffect(() => {
    updates = value;
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.update.mockClear();
  fixture.permissions = new Set(["local", "remote"]);
  fixture.environments = ["local", "remote"].map((id) => ({
    environmentId: id,
    label: id,
    entry: { enabled: true },
    connection: { phase: "connected" },
    serverConfig: { providers: [provider] },
  }));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it("sends local provider updates only to the selected local computer", async () => {
  await act(async () => {
    renderer = create(<Harness ids={new Set([EnvironmentId.make("local")])} />);
  });
  expect(updates.machines.map((machine) => machine.environmentId)).toEqual(["local"]);
  await act(async () => {
    await updates.updateAll({ quiet: true });
  });
  expect(fixture.update.mock.calls).toEqual([
    [
      {
        environmentId: "local",
        input: { provider: "codex", instanceId: "codex" },
      },
    ],
  ]);
});
it("treats an empty local scope as no updates even when remote providers are outdated", async () => {
  await act(async () => {
    renderer = create(<Harness ids={new Set()} />);
  });
  expect(updates.machines).toEqual([]);
  await updates.updateAll({ quiet: true });
  expect(fixture.update).not.toHaveBeenCalled();
});
it("keeps disabled, offline and unauthorized computers out of fleet update execution", async () => {
  fixture.environments.push(
    ...["disabled", "offline", "forbidden"].map((id) => ({
      environmentId: id,
      label: id,
      entry: { enabled: id !== "disabled" },
      connection: { phase: id === "offline" ? "offline" : "connected" },
      serverConfig: { providers: [provider] },
    })),
  );
  fixture.permissions.add("disabled");
  fixture.permissions.add("offline");
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(updates.machines.map((machine) => machine.environmentId)).toEqual(["local", "remote"]);
  await act(async () => {
    await updates.updateAll({ quiet: true });
  });
  expect(fixture.update).toHaveBeenCalledTimes(2);
});
