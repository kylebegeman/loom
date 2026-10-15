// @vitest-environment jsdom
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { SwitchboardLimits } from "@t3tools/contracts/fork";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "~/providerInstances";
import type { ModelEsque } from "~/components/chat/providerIconUtils";
import { withSwitchboardEntries } from "./switchboardPicker";

const state = vi.hoisted(() => ({
  enabled: new Map<string, boolean>(),
  status: new Map<string, SwitchboardLimits>(),
  primary: null as string | null,
}));
vi.mock("~/state/environments", () => ({ usePrimaryEnvironmentId: () => state.primary }));
vi.mock("~/hooks/useSettings", () => ({
  usePrimarySettings: () => true,
  useEnvironmentSettings: (
    environmentId: string,
    selector: (settings: { switchboardEnabled: boolean }) => boolean,
  ) => selector({ switchboardEnabled: state.enabled.get(environmentId) ?? false }),
}));
vi.mock("./switchboardLimits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./switchboardLimits")>()),
  useSwitchboardStatus: (enabled: boolean, environmentId: string): SwitchboardLimits =>
    enabled
      ? (state.status.get(environmentId) ?? { limits: [], availability: "available" })
      : { limits: [], availability: "disabled" },
}));

const provider = (id: string): ServerProvider => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-10T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
});
const entries = deriveProviderInstanceEntries([provider("codex_personal"), provider("codex_work")]);
const activeInstanceId = entries[0]!.instanceId;
const props = {
  instanceEntries: entries,
  activeInstanceId,
  modelOptionsByInstance: new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>(),
};
const Picker = withSwitchboardEntries(function TestPicker(input: {
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly activeInstanceId: typeof activeInstanceId;
  readonly modelOptionsByInstance: typeof props.modelOptionsByInstance;
  readonly getModelDisabledReason?: (
    instanceId: typeof activeInstanceId,
    model: string,
  ) => string | null;
  readonly footer?: ReactNode;
}) {
  return (
    <div>
      {input.instanceEntries.map((entry) => (
        <button
          key={entry.instanceId}
          disabled={Boolean(input.getModelDisabledReason?.(entry.instanceId, "gpt-6-sol"))}
        >
          {entry.instanceId}
        </button>
      ))}
      {input.footer}
    </div>
  );
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.enabled.clear();
  state.status.clear();
  state.primary = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const buttons = () => Array.from(container.querySelectorAll("button"));

describe("Switchboard destination environment", () => {
  it("keeps separate accounts on a destination where routing is off even when the primary server enables it", () => {
    const destination = EnvironmentId.make("remote-workstation");
    state.enabled.set("primary-laptop", true);
    state.enabled.set(destination, false);
    act(() => root.render(<Picker {...props} environmentId={destination} />));
    expect(buttons().map((button) => button.textContent)).toEqual(["codex_personal", "codex_work"]);

    state.enabled.set(destination, true);
    act(() =>
      root.render(
        <Picker {...props} modelOptionsByInstance={new Map()} environmentId={destination} />,
      ),
    );
    expect(buttons().map((button) => button.textContent)).toEqual(["codex_personal"]);
  });

  it("applies only the selected destination's allowance when switching between environments", () => {
    const laptop = EnvironmentId.make("laptop");
    const workstation = EnvironmentId.make("workstation");
    state.enabled.set(laptop, true);
    state.enabled.set(workstation, true);
    state.status.set(laptop, {
      limits: [{ driver: "codex", servedModels: [], until: null }],
      availability: "available",
    });

    act(() => root.render(<Picker {...props} environmentId={laptop} />));
    expect(buttons()[0]?.disabled).toBe(true);
    act(() => root.render(<Picker {...props} environmentId={workstation} />));
    expect(buttons()[0]?.disabled).toBe(false);
    act(() => root.render(<Picker {...props} environmentId={null} />));
    expect(buttons()).toHaveLength(2);
  });

  it("follows the primary environment while the caller has none", () => {
    const primary = EnvironmentId.make("primary-laptop");
    state.primary = primary;
    state.enabled.set(primary, true);
    state.status.set(primary, {
      limits: [{ driver: "codex", servedModels: [], until: null }],
      availability: "available",
    });
    act(() => root.render(<Picker {...props} environmentId={null} />));
    expect(buttons().map((button) => button.textContent)).toEqual(["codex_personal"]);
    expect(buttons()[0]?.disabled).toBe(true);
  });

  it("keeps every model selectable and says so when availability is unknown", () => {
    const destination = EnvironmentId.make("workstation");
    state.enabled.set(destination, true);
    state.status.set(destination, { limits: [], availability: "unavailable" });
    act(() => root.render(<Picker {...props} environmentId={destination} />));
    expect(buttons()[0]?.disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Switchboard availability is unknown right now.",
    );

    state.status.set(destination, { limits: [], availability: "unconfigured" });
    act(() =>
      root.render(
        <Picker {...props} modelOptionsByInstance={new Map()} environmentId={destination} />,
      ),
    );
    expect(buttons()[0]?.disabled).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "no Switchboard controller configured",
    );

    state.status.set(destination, { limits: [], models: [], availability: "available" });
    act(() =>
      root.render(
        <Picker {...props} modelOptionsByInstance={new Map()} environmentId={destination} />,
      ),
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
