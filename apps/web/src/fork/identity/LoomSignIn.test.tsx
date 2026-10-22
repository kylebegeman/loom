// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

const harness = vi.hoisted(() => ({ metadata: vi.fn(), connect: vi.fn() }));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/environments/primary", () => ({
  resolvePrimaryEnvironmentHttpUrl: () => "https://primary.example",
}));
vi.mock("~/rpc/loomIdentity", () => ({
  readLoomIdentity: (...args: unknown[]) => harness.metadata(...args),
  loomBrowserLoginUrl: () => null,
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => harness.connect }));
vi.mock("./connection", () => ({ connectLoomIdentity: {} }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  squashAtomCommandFailure: () => new Error("The old Library refused sign-in."),
}));
vi.mock("~/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
import { LoomSignIn } from "./LoomSignIn";

let root: Root;
let container: HTMLDivElement;
const connected = vi.fn();
const metadata = { enabled: true, nativeClientId: "loom-native" };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "desktopBridge", {
    configurable: true,
    value: { signInToLoom: vi.fn() },
  });
  harness.metadata.mockReset();
  harness.metadata.mockResolvedValue(metadata);
  harness.connect.mockReset();
  connected.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  delete window.desktopBridge;
  vi.unstubAllGlobals();
});
async function render(baseUrl = "https://first.example") {
  await act(async () =>
    root.render(<LoomSignIn baseUrl={baseUrl} onConnected={connected} showUnavailable />),
  );
}
function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  expect(button, label).toBeDefined();
  act(() => button!.click());
}

it.each([
  [
    "a connected account",
    { _tag: "Success", value: EnvironmentId.make("first") },
    "Loom account connected",
  ],
  ["a sign-in error", { _tag: "Failure" }, "The old Library refused sign-in."],
] as const)("clears %s when the Library address changes", async (_, result, notice) => {
  harness.connect.mockResolvedValue(result);
  await render();
  click("Sign in to Loom");
  await act(async () => {});
  expect(container.textContent).toContain(notice);
  await render("https://second.example");
  expect(container.textContent).not.toContain(notice);
});

it("keeps a pending sign-in and its completion bound to the original Library", async () => {
  let finish!: (result: unknown) => void;
  harness.connect.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  click("Sign in to Loom");
  expect(container.textContent).toContain("Waiting for sign-in...");
  await render("https://second.example");
  expect(container.textContent).not.toContain("Waiting for sign-in...");
  expect(container.querySelector("button")?.disabled).toBe(false);
  await act(async () => finish({ _tag: "Success", value: EnvironmentId.make("first") }));
  expect(connected).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Loom account connected");
});

it.each([null, new Error("Metadata unavailable")])(
  "hides old metadata while an address check finishes without identity support: %s",
  async (result) => {
    await render();
    expect(container.textContent).toContain("Sign in to Loom");
    if (result instanceof Error) harness.metadata.mockRejectedValueOnce(result);
    else harness.metadata.mockResolvedValueOnce(result);
    await render("https://second.example");
    expect(container.textContent).not.toContain("Sign in to Loom");
    expect(container.textContent).toContain("Account sign-in is unavailable at this address.");
  },
);
