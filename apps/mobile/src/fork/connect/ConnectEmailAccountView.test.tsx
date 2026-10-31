// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type AlertAction = {
  readonly text: string;
  readonly onPress?: () => void;
  readonly style?: string;
};
const harness = vi.hoisted(() => ({
  cloudAvailable: true,
  accountPortalUrl: "https://accounts.example.test",
  signOut: vi.fn(),
  openURL: vi.fn(),
  alert: vi.fn<(title: string, message: string, buttons?: readonly AlertAction[]) => void>(),
  deregister: vi.fn(),
  refreshRelayEnvironments: vi.fn(),
  relay: {
    accountId: "account-1" as string | null,
    data: [] as RelayClientEnvironmentRecord[] | null,
    error: null as string | null,
    errorTraceId: null as string | null,
    isPending: false,
    refresh: vi.fn(),
  },
}));

vi.mock("@clerk/expo", () => ({
  useClerk: () => ({ signOut: harness.signOut }),
  useSignIn: () => ({ signIn: null }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "kyle@example.test" } } }),
}));
vi.mock("../../features/cloud/publicConfig", () => ({
  hasCloudPublicConfig: () => harness.cloudAvailable,
  resolveCloudPublicConfig: () => ({ clerk: { accountPortalUrl: harness.accountPortalUrl } }),
}));
vi.mock("../../features/cloud/managedRelayState", () => ({
  useManagedRelayEnvironments: () => harness.relay,
  deregisterManagedRelayEnvironmentCommand: {},
}));
vi.mock("../../state/relay", () => ({
  relayEnvironmentDiscovery: { refreshAfterMutation: "refreshRelayEnvironments" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === "refreshRelayEnvironments" ? harness.refreshRelayEnvironments : harness.deregister,
}));
vi.mock("../../lib/copyTextWithHaptic", () => ({ copyTextWithHaptic: vi.fn() }));
vi.mock("../../native/NativeHeaderToolbar", () => ({
  NativeHeaderToolbar: Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Button: ({
        accessibilityLabel,
        onPress,
      }: {
        accessibilityLabel: string;
        onPress: () => void;
      }) => <button onClick={onPress}>{accessibilityLabel}</button>,
    },
  ),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RefreshControl: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  Alert: { alert: harness.alert },
  Linking: { openURL: harness.openURL },
}));
vi.mock("../../components/ui/Menu", () => ({
  Menu: ({ onPressAction }: { onPressAction: () => void }) => (
    <button onClick={onPressAction}>Deregister computer</button>
  ),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppActivityIndicator", () => ({
  AppActivityIndicator: () => <span>Loading</span>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: () => null,
}));
vi.mock("../../components/ui/ErrorBanner", () => ({
  ErrorBanner: ({ message }: { message: string }) => <span role="alert">{message}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
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
vi.mock("../../components/ui/AppBar", () => ({
  AppBar: ({ title, onBack }: { title: string; onBack: () => void }) => (
    <header>
      <h1>{title}</h1>
      <button onClick={onBack}>Back</button>
    </header>
  ),
}));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { ConnectEmailAccountView } from "./ConnectEmailAuthView";

const computer: RelayClientEnvironmentRecord = {
  environmentId: EnvironmentId.make("linked-mac"),
  label: "Dorothy",
  endpoint: {
    providerKind: "cloudflare_tunnel",
    httpBaseUrl: "https://mac.example.test",
    wsBaseUrl: "wss://mac.example.test/ws",
  },
  linkedAt: "2026-10-13T12:00:00.000Z",
};
let root: Root | null = null;
let container: HTMLDivElement;
const onBack = vi.fn();
function render() {
  act(() => root!.render(<ConnectEmailAccountView onBack={onBack} />));
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  );
  if (!found) throw new Error(`Missing action: ${label}`);
  return found;
}
function openComputers() {
  act(() => button("Linked computers").click());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("EXPO_OS", "ios");
  harness.cloudAvailable = true;
  harness.accountPortalUrl = "https://accounts.example.test";
  harness.signOut.mockReset().mockResolvedValue(undefined);
  harness.openURL.mockReset().mockResolvedValue(undefined);
  harness.alert.mockClear();
  harness.deregister.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  harness.relay = {
    accountId: "account-1",
    data: [computer],
    error: null,
    errorTraceId: null,
    isPending: false,
    refresh: vi.fn(),
  };
  onBack.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllEnvs();
});

describe("email-account linked computer management", () => {
  it("opens the upstream linked-computer page and returns to account controls before leaving the account", () => {
    render();
    openComputers();
    expect(container.textContent).toContain("Registered servers");
    expect(container.textContent).toContain("Dorothy");
    expect(container.textContent).toContain("Managed tunnel");
    act(() => button("Back to account").click());
    expect(container.textContent).toContain("kyle@example.test");
    expect(button("Manage account")).toBeDefined();
    expect(onBack).not.toHaveBeenCalled();
    act(() => button("Back").click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("retains the upstream confirmation and deregisters only after explicit approval", async () => {
    render();
    openComputers();
    act(() => button("Deregister computer").click());
    expect(harness.deregister).not.toHaveBeenCalled();
    const [title, message, actions] = harness.alert.mock.calls[0]!;
    expect(title).toBe("Deregister server?");
    expect(message).toContain("Local connections on your devices are not changed");
    expect(actions?.some((action) => action.text === "Cancel")).toBe(true);
    const approve = actions?.find((action) => action.text === "Deregister");
    expect(approve?.style).toBe("destructive");
    await act(async () => approve?.onPress?.());
    expect(harness.deregister).toHaveBeenCalledWith({
      accountId: "account-1",
      environmentId: computer.environmentId,
    });
    expect(harness.relay.refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("No servers registered");
    expect(harness.signOut).not.toHaveBeenCalled();
  });

  it("keeps a computer visible and exposes the upstream error when account removal fails", async () => {
    const failure = new Error("Account service unavailable");
    harness.deregister.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(failure)));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render();
      openComputers();
      act(() => button("Deregister computer").click());
      const approve = harness.alert.mock.calls[0]?.[2]?.find(
        (action) => action.text === "Deregister",
      );
      await act(async () => approve?.onPress?.());
      expect(container.textContent).toContain("Dorothy");
      expect(harness.alert).toHaveBeenLastCalledWith(
        "Could not deregister server",
        "Account service unavailable",
        undefined,
      );
      expect(harness.relay.refresh).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("preserves loading and empty linked-computer states", () => {
    harness.relay.data = null;
    render();
    openComputers();
    expect(container.textContent).toContain("Loading environments");
    harness.relay.data = [];
    render();
    expect(container.textContent).toContain("No servers registered");
  });

  it("retains hosted profile and sign-out controls alongside linked computer management", async () => {
    render();
    await act(async () => button("Manage account").click());
    expect(harness.openURL).toHaveBeenCalledWith("https://accounts.example.test/user");
    await act(async () => button("Sign out").click());
    expect(harness.signOut).toHaveBeenCalledOnce();
    expect(harness.deregister).not.toHaveBeenCalled();
  });

  it("omits linked account management when the optional public connection configuration is unavailable", () => {
    harness.cloudAvailable = false;
    render();
    expect(container.textContent).not.toContain("Linked computers");
    expect(button("Manage account")).toBeDefined();
  });
});
