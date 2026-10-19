// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { SheetProps } from "../../components/ui/Sheet.types";
import type { SitesSnapshot } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({ platform: "ios", save: vi.fn() }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("./state", () => ({
  sites: { saveSite: { permissionAtom: () => null }, saveService: {}, saveCheck: {} },
}));
vi.mock("../library/libraryState", () => ({ library: { projects: () => null } }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({ data: [] }) }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.save }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({
    children,
    accessibilityRole,
  }: {
    children: ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
  AppTextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    editable,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel: string;
    editable: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onInput={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
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
vi.mock("../../components/ui/AndroidScreenHeader", () => ({
  AndroidSheetHeader: ({ onBack }: { onBack?: () => void }) => (
    <button disabled={!onBack} onClick={onBack}>
      Back
    </button>
  ),
}));
vi.mock("../../native/StackHeader", () => ({ nativeHeaderScrollEdgeEffects: () => ({}) }));
vi.mock("uniwind", () => ({
  useResolveClassNames: () => ({}),
  withUniwind: (component: unknown) => component,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios", Version: 26 },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Switch: () => null,
  Modal: ({ children, onRequestClose }: { children: ReactNode; onRequestClose: () => void }) => (
    <div>
      {children}
      <button onClick={onRequestClose}>Escape</button>
    </div>
  ),
}));
vi.mock("react-native-screens", () => ({
  FormSheet: ({
    children,
    isOpen,
    preventNativeDismiss,
    onDismiss,
    onNativeDismiss,
  }: {
    children: ReactNode;
    isOpen: boolean;
    preventNativeDismiss?: boolean;
    onDismiss: () => void;
    onNativeDismiss: () => void;
  }) => {
    useEffect(() => {
      if (!isOpen) onDismiss();
    }, [isOpen, onDismiss]);
    return (
      <div>
        {children}
        <button
          onClick={() => {
            if (!preventNativeDismiss) onNativeDismiss();
          }}
        >
          Swipe or system back
        </button>
      </div>
    );
  },
  Screen: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScreenStack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScreenStackHeaderConfig: ({
    headerRightBarButtonItems,
  }: {
    headerRightBarButtonItems: {
      accessibilityLabel: string;
      disabled: boolean;
      onPress: () => void;
    }[];
  }) => (
    <>
      {headerRightBarButtonItems.map((item) => (
        <button key={item.accessibilityLabel} disabled={item.disabled} onClick={item.onPress}>
          {item.accessibilityLabel}
        </button>
      ))}
    </>
  ),
}));
vi.mock("../../components/ui/Sheet", async (importOriginal) => {
  const ios = await importOriginal<typeof import("../../components/ui/Sheet")>();
  const android = await import("../../components/ui/Sheet.android");
  const web = await import("../../components/ui/Sheet.web");
  return {
    Sheet: (props: SheetProps) => {
      const Component =
        harness.platform === "ios"
          ? ios.Sheet
          : harness.platform === "android"
            ? android.Sheet
            : web.Sheet;
      return <Component {...props} />;
    },
  };
});
import { SiteEditor, type SiteEditTarget } from "./SiteEditor";

const service = {
  id: "api",
  name: "API",
  url: "https://api.example.test",
  kind: "api" as const,
  active: 1 as const,
};
const snapshot: SitesSnapshot = {
  schemaVersion: 1,
  primarySiteId: "site",
  observedAt: "2026-10-17T00:00:00Z",
  staleAfterSeconds: 900,
  sites: [],
  services: [service],
  checks: [],
};
let root: Root;
let container: HTMLDivElement;
const close = vi.fn(),
  saved = vi.fn();
function render(target: SiteEditTarget) {
  act(() =>
    root.render(
      <SiteEditor
        target={target}
        snapshot={snapshot}
        environmentId={EnvironmentId.make("destination")}
        connected
        onClose={close}
        onSaved={saved}
      />,
    ),
  );
}
function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  expect(button, label).toBeDefined();
  act(() => button!.click());
}
// iOS closes from the header's xmark item, named by its accessibility label.
function closeLabel(platform: string) {
  return platform === "android" ? "Back" : platform === "web" ? "Done" : "Close Edit service";
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  close.mockClear();
  saved.mockClear();
  harness.save.mockReset();
});
afterEach(() => act(() => root.unmount()));

it.each(["ios", "android", "web"])(
  "preserves failed input and error across pending dismissal attempts on %s, then permits retry and close",
  async (platform) => {
    harness.platform = platform;
    let reject!: (error: Error) => void;
    harness.save.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    render({ kind: "service", row: service });
    const name = container.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
    act(() => {
      name.value = "Edited API";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("Save changes");
    expect(container.textContent).toContain("Saving…");
    click(platform === "web" ? "Escape" : "Swipe or system back");
    click(closeLabel(platform));
    click("Cancel");
    expect(close).not.toHaveBeenCalled();
    await act(async () => reject(new Error("The connection was interrupted.")));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')!.value).toBe(
      "Edited API",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "The connection was interrupted.",
    );
    expect(saved).not.toHaveBeenCalled();

    harness.save.mockResolvedValueOnce({ _tag: "Success", value: snapshot });
    click("Save changes");
    await act(async () => {});
    expect(harness.save.mock.calls[1]?.[0]).toMatchObject({ input: { name: "Edited API" } });
    expect(saved).toHaveBeenCalledWith("api");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    click(closeLabel(platform));
    expect(close).toHaveBeenCalledOnce();
  },
);

it("describes service-kind and endpoint-service selection using the existing selected-label convention", () => {
  harness.platform = "ios";
  render({ kind: "service", row: service });
  click("Selected: api");
  click("website");
  expect(container.textContent).toContain("Selected: website");
  expect(container.textContent).not.toContain("Selected: api");
  act(() => root.render(null));
  render({ kind: "check", serviceId: "api" });
  expect(container.textContent).toContain("Selected: API");
});
