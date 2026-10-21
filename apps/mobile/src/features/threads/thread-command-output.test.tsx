import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  configs: null as Atom.Writable<ReadonlyMap<EnvironmentId, ServerConfig>> | null,
}));

vi.mock("react-native", () => ({ ScrollView: "div", View: "div" }));
vi.mock("../../components/ui/AppText", () => ({ AppText: "span" }));
vi.mock("../../components/ui/Button", () => ({ Button: "button" }));
vi.mock("../../state/orchestration", () => ({ orchestrationEnvironment: {} }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: vi.fn() }));
vi.mock("../../state/entities", () => ({
  useServerConfigs: () => useAtomValue(harness.configs!),
}));
vi.mock("../../state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    serverEnvironment: {
      configValueAtom: Atom.family((environmentId: EnvironmentId) =>
        Atom.make((get) => get(harness.configs!).get(environmentId) ?? null),
      ),
    },
  };
});

import { useCommandOutputStreaming } from "./thread-command-output";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
let registry: AtomRegistry.AtomRegistry;
let root: Root | null = null;
let renders: boolean[] = [];

function config(streaming: boolean): ServerConfig {
  // Only the capability read by work-log rows is relevant to this subscription test.
  return {
    environment: { capabilities: { commandOutputStreaming: streaming } },
  } as ServerConfig;
}

function Probe() {
  const streamsOutput = useCommandOutputStreaming(local);
  useEffect(() => {
    renders.push(streamsOutput);
  });
  return null;
}

function mountRows() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
  act(() =>
    root!.render(
      <RegistryContext.Provider value={registry}>
        {Array.from({ length: 40 }, (_, index) => (
          <Probe key={index} />
        ))}
      </RegistryContext.Provider>,
    ),
  );
}

function updateConfig(environmentId: EnvironmentId, streaming: boolean) {
  act(() =>
    registry.update(harness.configs!, (current) =>
      new Map(current).set(environmentId, config(streaming)),
    ),
  );
}

beforeEach(() => {
  registry = AtomRegistry.make();
  harness.configs = Atom.make<ReadonlyMap<EnvironmentId, ServerConfig>>(
    new Map([
      [local, config(true)],
      [remote, config(true)],
    ]),
  ).pipe(Atom.keepAlive);
  renders = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  registry.dispose();
});

describe("command output capability subscriptions", () => {
  it("does no row renders for 50 unrelated environment config updates", () => {
    mountRows();
    const before = renders.length;
    for (let index = 0; index < 50; index += 1) updateConfig(remote, index % 2 === 0);
    expect(renders.length - before).toBe(0);
  });

  it("ignores same-environment config refreshes while reacting to capability changes", () => {
    mountRows();
    const before = renders.length;
    for (let index = 0; index < 50; index += 1) updateConfig(local, true);
    expect(renders.length - before).toBe(0);
    updateConfig(local, false);
    expect(renders.slice(before)).toEqual(Array<boolean>(40).fill(false));
    updateConfig(local, true);
    expect(renders.slice(before + 40)).toEqual(Array<boolean>(40).fill(true));
  });
});
