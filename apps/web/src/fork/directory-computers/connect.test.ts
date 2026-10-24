// @vitest-environment jsdom
import {
  DIRECTORY_PAIRING_REASON_TEXT,
  type DirectoryCatalogRow,
  type DirectoryConnectStep,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { LoomIdentityConnectInput } from "../identity/connection";
import {
  connectLibraryComputer,
  openLibraryComputerSignInWindow,
  signInLibraryComputer,
  type LibraryComputerSignInStep,
} from "./connect";

const STUDIO = EnvironmentId.make("studio");
const LIBRARY = EnvironmentId.make("library");
const ROUTE = { kind: "tailnet", url: "https://studio.example.ts.net" } as const;
const ISSUER = "https://id.example.com";

const row: DirectoryCatalogRow = {
  environmentId: STUDIO,
  label: "Studio",
  saved: null,
  report: null,
  routes: [ROUTE],
  machines: [],
  connected: false,
  proof: null,
  action: "connect",
};

const signInStep: LibraryComputerSignInStep = {
  kind: "sign-in",
  surface: "browser",
  environmentId: STUDIO,
  route: ROUTE,
  request: { httpBaseUrl: ROUTE.url, expectedEnvironmentId: STUDIO, expectedIssuer: ISSUER },
  issuer: ISSUER,
};

const pairingStep: DirectoryConnectStep = {
  kind: "pairing",
  environmentId: STUDIO,
  httpBaseUrl: ROUTE.url,
  reason: "issuer-mismatch",
  reasonText: DIRECTORY_PAIRING_REASON_TEXT["issuer-mismatch"],
};

let popup: { close: ReturnType<typeof vi.fn> };
let open: ReturnType<typeof vi.fn>;
const connect = vi.fn(async (_input: LoomIdentityConnectInput) => AsyncResult.success(STUDIO));

beforeEach(() => {
  popup = { close: vi.fn() };
  open = vi.fn(() => popup);
  vi.stubGlobal("open", open);
  connect.mockClear();
});
afterEach(() => {
  delete window.desktopBridge;
  vi.unstubAllGlobals();
});

const run = (step: DirectoryConnectStep) =>
  connectLibraryComputer({
    row,
    libraryEnvironmentId: LIBRARY,
    plan: async () => AsyncResult.success(step),
    connect,
  });

const nativeDesktop = () =>
  Object.defineProperty(window, "desktopBridge", {
    configurable: true,
    value: { signInToLoom: vi.fn() },
  });

it("opens pairing expecting the computer, without opening a sign-in window", async () => {
  const outcome = await run(pairingStep);

  expect(outcome).toEqual({
    kind: "pairing",
    environmentId: STUDIO,
    httpBaseUrl: ROUTE.url,
    reasonText: DIRECTORY_PAIRING_REASON_TEXT["issuer-mismatch"],
  });
  expect(open).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

it("asks a browser for a second click before it opens the sign-in window", async () => {
  await expect(run(signInStep)).resolves.toEqual({ kind: "sign-in", step: signInStep });
  expect(open).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

const verifyRefusesOtherIssuer = (input: LoomIdentityConnectInput) => {
  expect(
    input.verify?.({
      httpBaseUrl: ROUTE.url,
      environmentId: STUDIO,
      accessToken: "token",
      identity: { issuer: "https://other.example.com", subject: "kyle" },
    }),
  ).toBe(DIRECTORY_PAIRING_REASON_TEXT["issuer-mismatch"]);
  expect(
    input.verify?.({
      httpBaseUrl: ROUTE.url,
      environmentId: STUDIO,
      accessToken: "token",
      identity: { issuer: ISSUER, subject: "kyle" },
    }),
  ).toBeNull();
};

it("signs in natively on desktop in one click and refuses a session from another issuer", async () => {
  nativeDesktop();

  await expect(run({ ...signInStep, surface: "native" })).resolves.toEqual({
    kind: "connected",
    environmentId: STUDIO,
  });
  expect(open).not.toHaveBeenCalled();
  const input = connect.mock.calls[0]![0];
  expect(input.popup).toBeUndefined();
  expect(input.httpBaseUrl).toBe(ROUTE.url);
  // The pin reaches desktop main, which refuses another provider before the browser opens.
  expect(input.expectedIssuer).toBe(ISSUER);
  verifyRefusesOtherIssuer(input);
});

it("signs in from a browser in the window opened by the second click", async () => {
  const outcome = await signInLibraryComputer({
    step: signInStep,
    popup: openLibraryComputerSignInWindow(),
    connect,
  });

  expect(outcome).toEqual({ kind: "connected", environmentId: STUDIO });
  expect(open).toHaveBeenCalledOnce();
  const input = connect.mock.calls[0]![0];
  expect(input.popup).toBe(popup);
  expect(popup.close).toHaveBeenCalled();
  expect(input.expectedIssuer).toBe(ISSUER);
  verifyRefusesOtherIssuer(input);
});

it("asks to allow the window when the browser blocks it", async () => {
  open.mockReturnValue(null);

  await expect(
    signInLibraryComputer({
      step: signInStep,
      popup: openLibraryComputerSignInWindow(),
      connect,
    }),
  ).resolves.toEqual({ kind: "failed", message: "Allow the sign-in window and try again." });
  expect(connect).not.toHaveBeenCalled();
});
