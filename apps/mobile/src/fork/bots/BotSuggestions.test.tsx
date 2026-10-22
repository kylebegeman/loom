// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import { EnvironmentId } from "@t3tools/contracts";

const harness = vi.hoisted(() => ({
  connected: true,
  focused: true,
  permitted: true,
  dismiss: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
}));
const suggestion = {
  id: "suggestion",
  shape: "Review {{change}}",
  count: 3,
  threadIds: ["source-thread"],
  startedBy: "user",
  dismissedAt: null,
};
vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => harness.focused,
  useNavigation: () => ({ navigate: harness.navigate }),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => harness.permitted }));
vi.mock("./state", () => ({
  bots: {
    save: { permissionAtom: () => null },
    dismissSuggestion: { permissionAtom: () => null },
    suggestions: (input: unknown) => input,
  },
  useBotsCapabilities: () => ({ connected: harness.connected }),
  useBotsReconnect: vi.fn(),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.dismiss }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) => ({
    data: query ? { suggestions: [suggestion] } : null,
    refresh: harness.refresh,
    error: null,
  }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({
    children,
    accessibilityRole,
  }: {
    children: ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("./BotControls", () => ({
  BotNotice: ({ error }: { error?: string }) => (error ? <div role="alert">{error}</div> : null),
  BotSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BotToggle: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }) => <button onClick={() => onChange(!value)}>{label}</button>,
}));
import { BotSuggestions } from "./BotSuggestions";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.connected = true;
  harness.focused = true;
  harness.permitted = true;
  harness.navigate.mockReset();
  harness.refresh.mockReset();
  harness.dismiss.mockReset();
  harness.dismiss.mockResolvedValue({ _tag: "Success", value: {} });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
function render() {
  act(() =>
    root.render(<BotSuggestions environmentId={EnvironmentId.make("computer")} changes={null} />),
  );
}
function button(label: string) {
  const node = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  expect(node, label).toBeDefined();
  return node!;
}
it("opens the source draft on the owning computer and preserves the suggestion until save", () => {
  render();
  act(() => button("Create from suggestion").click());
  expect(harness.navigate).toHaveBeenCalledWith("BotsCreate", {
    environmentId: "computer",
    sourceThreadId: "source-thread",
    suggestionId: "suggestion",
  });
  expect(harness.dismiss).not.toHaveBeenCalled();
});
it("surfaces dismiss failures and lets the user restore dismissed suggestions", async () => {
  harness.dismiss.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Connection was lost")),
  });
  render();
  await act(async () => button("Dismiss suggestion").click());
  expect(container.textContent).toContain("Connection was lost");
  act(() => button("Show dismissed suggestions").click());
  await act(async () => button("Restore suggestion").click());
  expect(harness.dismiss).toHaveBeenLastCalledWith({
    environmentId: "computer",
    input: { suggestionId: "suggestion", dismissed: false },
  });
});
it("blocks mutations while offline or connected read-only", () => {
  harness.permitted = false;
  render();
  expect(button("Create from suggestion").disabled).toBe(true);
  expect(button("Dismiss suggestion").disabled).toBe(true);
  harness.permitted = true;
  harness.connected = false;
  render();
  expect(button("Create from suggestion").disabled).toBe(true);
  expect(button("Dismiss suggestion").disabled).toBe(true);
});

it("refreshes suggestions when returning from an editor without refetching on each render", () => {
  render();
  render();
  expect(harness.refresh).not.toHaveBeenCalled();
  harness.focused = false;
  render();
  expect(harness.refresh).not.toHaveBeenCalled();
  harness.focused = true;
  render();
  expect(harness.refresh).toHaveBeenCalled();
});
