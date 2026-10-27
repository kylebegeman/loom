import { DEFAULT_SERVER_SETTINGS, type ServerSettingsPatch } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { Children, mocks } = vi.hoisted(() => ({
  Children: ({ children }: { children?: ReactNode }) => children,
  mocks: {
    branchNaming: { onChange: (_patch: ServerSettingsPatch) => {} },
    updateSettings: vi.fn(),
    alert: vi.fn(),
    targets: [] as ReturnType<typeof environment>[],
    projectSelected: false,
    // fork: provider-auth-retry
    providerAuth: {
      data: null as { phase: string; methods: never[] } | null,
      error: null as string | null,
      isPending: false,
      refresh: vi.fn(),
    },
  },
}));

vi.mock("react-native", () => ({
  View: Children,
  Alert: { alert: mocks.alert },
  Pressable: ({
    children,
    disabled,
    onPress,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onPress: () => void;
    accessibilityLabel?: string;
  }) => (
    <button disabled={disabled} onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
}));
vi.mock("@effect/atom-react", () => ({
  // fork: provider-auth-retry
  useAtomValue: (atom: unknown) =>
    atom === "providers"
      ? new Map([
          [
            "local",
            [
              {
                instanceId: "codex",
                driver: "codex",
                enabled: true,
                installed: true,
                setup: { canAuthenticate: true },
                auth: { status: "unauthenticated" },
              },
            ],
          ],
        ])
      : AsyncResult.success({}),
  useAtomSet: () => () => {},
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: {},
  updateMobilePreferencesAtom: {},
}));
vi.mock("./components/AutoSettleDaysField", () => ({ AutoSettleDaysField: () => null }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({}) }));
vi.mock("../../state/session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentsWithScope: () => new Set(mocks.targets.map((target) => target.environmentId)),
}));
// fork: provider-auth-retry
vi.mock("../../state/server", () => ({
  serverEnvironment: { updateSettings: {}, providerAuthState: () => "auth" },
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { providersByEnvironmentAtom: "providers" },
}));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => mocks.providerAuth }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => mocks.updateSettings,
}));
vi.mock("../threads/thread-settings-options", () => ({ RUNTIME_MODE_CHOICES: [] }));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: Children }));
vi.mock("../../components/ui/AppText", () => ({ AppText: Children }));
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
vi.mock("./components/SettingsScreen", () => ({ SettingsScreen: Children }));
vi.mock("./components/SettingsEnvironmentFilterHeader", () => ({
  AndroidSettingsEnvironmentFilter: () => null,
  SettingsEnvironmentFilterHeader: () => null,
}));
// fork: github-host-setup
vi.mock("./components/GitHubHostSetupSettings", () => ({ GitHubHostSetupSettings: () => null }));
vi.mock("./components/DatabaseStorageNotice", () => ({ DatabaseStorageNotice: () => null }));
vi.mock("./components/SettingsSection", () => ({ SettingsSection: Children }));
vi.mock("./components/SettingsChoiceRow", () => ({ SettingsChoiceRow: () => null }));
vi.mock("./components/SettingsSwitchRow", () => ({
  SettingsSwitchRow: ({
    label,
    value,
    disabled,
    onValueChange,
  }: {
    label: string;
    value: boolean | null;
    disabled?: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <button
      role="switch"
      aria-checked={value ?? "mixed"}
      disabled={disabled}
      onClick={() => onValueChange(!value)}
    >
      {label}
    </button>
  ),
}));
vi.mock("./components/SettingsRow", () => ({ SettingsRow: () => null }));
// fork: provider-auth-retry
vi.mock("./components/SettingsActionRow", () => ({
  SettingsActionRow: ({
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
vi.mock("./components/BranchNamingSettings", () => ({
  BranchNamingSettings: (props: { onChange: (patch: ServerSettingsPatch) => void }) => {
    mocks.branchNaming.onChange = props.onChange;
    return null;
  },
}));
vi.mock("./settings-environment-filter", () => ({
  useSettingsEnvironmentFilter: () => ({
    selectedTargets: mocks.targets,
    projectGroups: [
      {
        key: "project",
        label: "Project",
        members: mocks.targets.map((target) => ({
          project: { environmentId: target.environmentId, id: "project" },
        })),
      },
    ],
    selectedProjectKey: mocks.projectSelected ? "project" : null,
  }),
}));

import { SettingsEnvironmentSourceControlRouteScreen } from "./SettingsServerControlsRouteScreen";
import { SettingsProviderAccountsRouteScreen } from "./SettingsProviderAccountsRouteScreen"; // fork: provider-auth-retry

function environment(environmentId: string, label: string) {
  return {
    environmentId,
    label,
    connection: { phase: "connected" },
    serverConfig: {
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        defaultAutoPull: false,
        sidebarAutoSettleOnMerge: false,
      },
      environment: {
        capabilities: { projectSettingsOverrides: true, threadAutoSettlement: true },
      },
    },
  };
}

// fork: provider-auth-retry -- the account-status retry case finds its controls by label
function button(label: string) {
  const result = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label || element.getAttribute("aria-label") === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  mocks.targets = [environment("local", "Local")];
  mocks.projectSelected = false;
  // fork: provider-auth-retry
  mocks.providerAuth.data = null;
  mocks.providerAuth.error = null;
  mocks.providerAuth.isPending = false;
  mocks.providerAuth.refresh.mockReset();
  mocks.alert.mockReset();
  mocks.updateSettings.mockReset();
  mocks.updateSettings.mockResolvedValue(AsyncResult.success(undefined));
});

afterEach(() => {
  act(() => root.unmount());
});

describe("SettingsServerControlsRouteScreen", () => {
  it("sends a draft saved during a pending write once that write settles", async () => {
    const pending = Promise.withResolvers<AsyncResult.Success<void>>();
    mocks.updateSettings.mockReturnValueOnce(pending.promise);
    act(() => root.render(<SettingsEnvironmentSourceControlRouteScreen />));

    act(() => mocks.branchNaming.onChange({ branchNamingMode: "custom" }));
    act(() => mocks.branchNaming.onChange({ branchNameInstructions: "Use issue IDs." }));
    expect(mocks.updateSettings).toHaveBeenCalledOnce();

    await act(async () => pending.resolve(AsyncResult.success(undefined)));

    expect(mocks.updateSettings).toHaveBeenCalledTimes(2);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      environmentId: "local",
      input: {
        patch: { branchNamingMode: "custom", branchNameInstructions: "Use issue IDs." },
      },
    });
  });
});

// fork: provider-auth-retry
it("recovers a failed agent account-status request without leaving Settings", async () => {
  mocks.providerAuth.error = "Could not read sign-in status.";
  act(() => root.render(<SettingsProviderAccountsRouteScreen />));
  expect(button("Sign in").disabled).toBe(true);
  expect(container.textContent).toContain("Could not read sign-in status.");
  mocks.providerAuth.refresh.mockImplementation(() => {
    mocks.providerAuth.data = { phase: "idle", methods: [] };
    mocks.providerAuth.error = null;
    root.render(<SettingsProviderAccountsRouteScreen />);
  });

  act(() => button("Retry sign-in status").click());
  expect(container.textContent).not.toContain("Could not read sign-in status.");
  expect(button("Sign in").disabled).toBe(false);
  await act(async () => button("Sign in").click());
  expect(mocks.updateSettings).toHaveBeenCalledWith({
    environmentId: "local",
    input: { instanceId: "codex" },
  });
});
