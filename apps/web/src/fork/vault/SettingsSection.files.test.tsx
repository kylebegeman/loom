// @vitest-environment jsdom
import * as NodeBuffer from "node:buffer";
import { act, type ReactNode, type InputHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  values: new Map<unknown, unknown>(),
  items: [] as unknown[],
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (state.values.has(atom) ? state.values.get(atom) : atom),
}));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: {
    set: (atom: unknown, value: unknown) => state.values.set(atom, value),
    refresh: vi.fn(),
  },
}));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () =>
    new Map([
      [
        "selected-host",
        {
          environment: { capabilities: { loomFeatures: ["vault-core", "vault-owner-trusted"] } },
        },
      ],
    ]),
}));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("~/components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: { environmentId: "selected-host" } }),
}));
vi.mock("./state", () => ({
  vault: {
    status: () => ({ _tag: "Success", value: { state: "ready" }, waiting: false }),
    list: () => ({ _tag: "Success", value: { items: state.items, cursor: null }, waiting: false }),
    save: { permissionAtom: () => true },
    change: { permissionAtom: () => true },
    reveal: { permissionAtom: () => true },
  },
  runVault: (...args: unknown[]) => state.save(...args),
}));
vi.mock("./OwnerSettingsSection", () => ({ VaultOwnerSettings: () => null }));
vi.mock("./SshDialog", () => ({ VaultSshDialog: () => null }));
vi.mock("~/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("~/components/ui/button", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} />
  ),
}));
vi.mock("~/components/ui/dialog", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrapper,
    DialogPopup: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
    DialogDescription: Wrapper,
    DialogFooter: Wrapper,
  };
});
vi.mock("~/components/ui/select", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Select: Wrapper,
    SelectTrigger: Wrapper,
    SelectValue: Wrapper,
    SelectPopup: Wrapper,
    SelectItem: Wrapper,
  };
});
vi.mock("~/components/ui/checkbox", () => ({ Checkbox: () => null }));
import { VaultSettingsSection } from "./SettingsSection";
import { openVaultAdd, vaultAddTarget } from "./add-navigation";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.save.mockReset().mockResolvedValue({});
  state.values.clear();
  state.values.set(vaultAddTarget, null);
  state.items = [];
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<VaultSettingsSection />));
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function drop(file: NodeBuffer.File) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  const target = Array.from(container.querySelectorAll("div")).find(
    (element) =>
      element.textContent?.startsWith("Drop a file here") && element.childElementCount === 0,
  )!;
  target.dispatchEvent(event);
}
it("opens empty records and lets the palette add request choose a file without changing Kind first", async () => {
  await render();
  expect(container.querySelector("details")?.open).toBe(true);
  openVaultAdd(EnvironmentId.make("selected-host"));
  await render();
  expect(container.textContent).toContain("Add Vault item");
  const choose = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Choose file",
  )!;
  expect(choose.disabled).toBe(false);
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(picker, "files", {
      value: [
        new NodeBuffer.File(["fixture-data"], "signing.p8", { type: "application/x-pem-file" }),
      ],
    });
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await submit();
  const saved = state.save.mock.calls[0]?.[1];
  expect(saved).toMatchObject({
    environmentId: "selected-host",
    input: { label: "signing.p8", kind: "secure-file", expectedVersion: 0 },
  });
  expect(JSON.parse(Redacted.value(saved.input.value) as string)).toEqual({
    name: "signing.p8",
    mediaType: "application/x-pem-file",
    base64: btoa("fixture-data"),
  });
});
it("opens collapsed records on drop and preloads the secure file without saving until confirmation", async () => {
  state.items = [
    { id: "a".repeat(32), label: "Existing", kind: "secret", state: "active", version: 1 },
  ];
  await render();
  expect(container.querySelector("details")?.open).toBe(false);
  await act(async () => drop(new NodeBuffer.File(["fixture-data"], "service.json")));
  expect(container.querySelector("details")?.open).toBe(true);
  expect(state.save).not.toHaveBeenCalled();
  await submit();
  expect(state.save.mock.calls[0]?.[1]).toMatchObject({
    input: { kind: "secure-file", label: "service.json" },
  });
});
it("reveals a rejected drop error even when records began collapsed", async () => {
  state.items = [
    { id: "a".repeat(32), label: "Existing", kind: "secret", state: "active", version: 1 },
  ];
  await render();
  await act(async () => drop(new NodeBuffer.File([new Uint8Array(512 * 1024 + 1)], "too-large")));
  expect(container.querySelector("details")?.open).toBe(true);
  expect(container.textContent).toContain("Choose a file no larger than 512 KB.");
  expect(state.save).not.toHaveBeenCalled();
  expect(container.querySelector("form")).toBeNull();
});
