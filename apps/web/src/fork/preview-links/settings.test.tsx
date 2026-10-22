import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";

const state = vi.hoisted(() => ({
  snapshot: {
    setup: {
      settings: {
        enabled: true,
        suffix: "example.com",
        machine: "laptop",
        defaultLifetime: "12h",
        gatewayPort: 3779,
      },
      tokenStored: false,
      ready: false,
      tunnel: { state: "needs-token", message: null },
      gateway: { state: "off", message: null },
    },
    links: [],
  },
  run: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) =>
    atom === "snapshot" ? AsyncResult.success(state.snapshot) : true,
}));
vi.mock("@t3tools/client-runtime/fork", () => ({
  supportsLoomFeature: (_capabilities: unknown, feature: string) => feature === "preview-links",
}));
vi.mock("~/components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: { environmentId: "preview-env" } }),
}));
vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: vi.fn() } }));
vi.mock("~/localApi", () => ({ ensureLocalApi: vi.fn() }));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("~/components/settings/SecretInput", () => ({ SecretInput: "input" }));
vi.mock("~/components/ui/switch", () => ({ Switch: "button" }));
vi.mock("~/components/ui/select", () => ({
  Select: "div",
  SelectItem: "div",
  SelectPopup: "div",
  SelectTrigger: "div",
  SelectValue: "div",
}));
vi.mock("~/components/settings/settingsLayout", () => ({
  SettingsRow: ({
    children,
    control,
  }: {
    children?: React.ReactNode;
    control?: React.ReactNode;
  }) => (
    <div>
      {children}
      {control}
    </div>
  ),
}));
vi.mock("./pages", () => ({ EnvironmentPreviewPages: () => null }));
vi.mock("./parts", () => ({
  failureOf: () => null,
  useAction: () => ({
    busy: false,
    act: async (_title: string, task: () => Promise<unknown>) => task(),
  }),
}));
vi.mock("./state", () => ({
  FEATURE: "preview-links",
  previewLinks: {
    snapshot: () => "snapshot",
    configure: { permissionAtom: () => "permission" },
    revokeAll: { permissionAtom: () => "permission" },
  },
  runCommand: state.run,
  openPreviewLinksSheet: vi.fn(),
}));

import { PreviewLinksSettingsSection } from "./settings";
let renderer: ReactTestRenderer;
const button = (text: string) =>
  renderer.root.findAllByType("button").find((node) => node.props.children === text)!;
async function edit(label: string, value: string) {
  await act(async () =>
    renderer.root.findByProps({ "aria-label": label }).props.onChange({ target: { value } }),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  await act(async () => {
    renderer = create(<PreviewLinksSettingsSection />);
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("can discard a connector-token edit without requiring another setting to change", async () => {
  expect(button("Save settings").props.disabled).toBe(true);
  await edit("Connector token", "example-connector-token-for-test");
  expect(button("Save settings").props.disabled).toBe(false);
  await act(async () => button("Discard changes").props.onClick());
  expect(renderer.root.findByProps({ "aria-label": "Connector token" }).props.value).toBe("");
  expect(button("Save settings").props.disabled).toBe(true);
  expect(state.run).not.toHaveBeenCalled();
});

it("does not save domain edits that normalize to the stored settings", async () => {
  await edit("Link domain", " Example.COM ");
  expect(button("Save settings").props.disabled).toBe(true);
  await edit("Computer name", "desktop");
  expect(button("Save settings").props.disabled).toBe(false);
  await edit("Computer name", "laptop");
  expect(button("Save settings").props.disabled).toBe(true);
  expect(state.run).not.toHaveBeenCalled();
});
