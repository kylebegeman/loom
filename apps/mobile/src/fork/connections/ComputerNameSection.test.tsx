// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult } from "effect/reactivity";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  config: {
    environment: {
      label: "Dorothy",
      capabilities: { repositoryIdentity: false, loomFeatures: ["computer-naming"] },
    },
  },
  allowed: true,
  query: {
    data: { name: null as string | null, label: "Dorothy", defaultLabel: "Dorothy" },
    error: null as string | null,
    refresh: vi.fn(),
  },
  rename: vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: "config" | "permission") =>
    atom === "config" ? harness.config : harness.allowed,
}));
vi.mock("@t3tools/client-runtime/fork", () => ({
  createComputerNamingAtoms: () => ({
    get: () => "query",
    rename: { permissionAtom: () => "permission" },
  }),
  supportsLoomFeature: () => true,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { configValueAtom: () => "config" },
}));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => harness.query }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.rename }));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("../../components/ui/ListActionRow", () => ({
  ListActionRow: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../features/connection/ConnectionFormField", () => ({
  ConnectionFormField: ({
    label,
    value,
    onChangeText,
    editable,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      readOnly={!editable}
      onInput={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
}));

import { ComputerNameSection } from "./ComputerNameSection";

let root: Root | null = null;
let container: HTMLDivElement;
const environmentId = EnvironmentId.make("mac");

function render(connected = true) {
  act(() =>
    root!.render(<ComputerNameSection environmentId={environmentId} connected={connected} />),
  );
}
function field() {
  return container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
}
function button(label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  );
  if (!result) throw new Error(`Missing action: ${label}`);
  return result;
}
function streamName(label: string) {
  harness.config = { ...harness.config, environment: { ...harness.config.environment, label } };
  render();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.config.environment.label = "Dorothy";
  harness.allowed = true;
  harness.query.data = { name: null, label: "Dorothy", defaultLabel: "Dorothy" };
  harness.query.error = null;
  harness.query.refresh.mockClear();
  harness.rename.mockReset();
  harness.rename.mockResolvedValue(
    AsyncResult.success({ name: "My draft", label: "My draft", defaultLabel: "Dorothy" }),
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("live computer name editing", () => {
  it("shows another client's streamed rename immediately and refreshes reset metadata", () => {
    render();
    expect(field().value).toBe("Dorothy");
    expect(button("Use computer's system name").disabled).toBe(true);
    streamName("Rack Mac");
    expect(field().value).toBe("Rack Mac");
    expect(harness.query.refresh).toHaveBeenCalledOnce();
    harness.query.data = { name: "Rack Mac", label: "Rack Mac", defaultLabel: "Dorothy" };
    render();
    expect(button("Use computer's system name").disabled).toBe(false);
    streamName("Dorothy");
    expect(field().value).toBe("Dorothy");
    expect(harness.query.refresh).toHaveBeenCalledTimes(2);
    harness.query.data = { name: null, label: "Dorothy", defaultLabel: "Dorothy" };
    render();
    expect(button("Use computer's system name").disabled).toBe(true);
  });

  it("preserves an unfinished draft while another client renames and saves the draft explicitly", async () => {
    render();
    act(() => {
      const input = field();
      input.value = "My draft";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    streamName("Rack Mac");
    expect(field().value).toBe("My draft");
    await act(async () => button("Save name").click());
    expect(harness.rename).toHaveBeenCalledWith({ environmentId, input: { name: "My draft" } });
  });

  it("does not refresh repeatedly when provider configuration changes without a rename", () => {
    render();
    render();
    harness.config = { ...harness.config, environment: { ...harness.config.environment } };
    render();
    expect(harness.query.refresh).not.toHaveBeenCalled();
  });

  it("refreshes a pending rename after permissions return and retains permission and query errors", () => {
    render();
    harness.allowed = false;
    streamName("Rack Mac");
    expect(field().value).toBe("Rack Mac");
    expect(field().readOnly).toBe(true);
    expect(container.textContent).toContain("Settings permission is required");
    expect(harness.query.refresh).not.toHaveBeenCalled();
    harness.allowed = true;
    harness.query.error = "Could not load naming metadata";
    render();
    expect(harness.query.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Could not load naming metadata");
  });
});
