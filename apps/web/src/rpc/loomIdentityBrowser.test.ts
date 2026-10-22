import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, AuthAccessTokenType } from "@t3tools/contracts";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import { cancelLoomBrowserSignIn, signInToLoomBrowser } from "./loomIdentity";

const environmentId = EnvironmentId.make("execution-computer");
const origin = "https://computer.example.test";
const metadata: LoomIdentityMetadata = {
  enabled: true,
  browserLoginEnabled: true,
  sessionExchangeEnabled: true,
  browserOrigins: ["https://app.example.test"],
  issuer: "https://id.example.test",
  clientId: "computer-web",
  authorizationEndpoint: "https://id.example.test/authorize",
  tokenEndpoint: "https://id.example.test/token",
  scopes: ["openid"],
  audience: "execution-computer",
  environmentId,
};
function setup(settings = metadata) {
  let resolveNavigation!: (url: string) => void;
  const navigation = {
    promise: new Promise<string>((resolve) => {
      resolveNavigation = resolve;
    }),
    resolve: (url: string) => resolveNavigation(url),
  };
  const listeners = new Set<(event: MessageEvent) => void>();
  const popup = {
    closed: false,
    close: vi.fn(),
    location: { replace: (url: string) => navigation.resolve(url) },
  };
  vi.stubGlobal("window", {
    location: { origin: "https://app.example.test" },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MessageEvent) => void) =>
      listeners.delete(listener),
  });
  const request = vi.fn().mockImplementation(
    async (_url: string | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? {
                access_token: "host-session",
                token_type: "Bearer",
                issued_token_type: AuthAccessTokenType,
                expires_in: 3600,
                scope: "orchestration:read",
                environmentId,
                identity: { issuer: metadata.issuer, subject: "allowed-owner" },
              }
            : settings,
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", request);
  const send = (
    url: string,
    overrides: Record<string, unknown> = {},
    eventOverrides: Record<string, unknown> = {},
  ) => {
    const state = new URL(url).searchParams.get("state");
    for (const listener of listeners)
      listener({
        origin,
        source: popup,
        data: {
          type: "loom:identity:complete",
          state,
          environmentId,
          code: "c".repeat(43),
          ...overrides,
        },
        ...eventOverrides,
      } as unknown as MessageEvent);
  };
  return { popup, navigation, listeners, request, send };
}
afterEach(() => vi.unstubAllGlobals());

it("accepts only the selected popup, host origin, state and environment, then redeems without credentials in URLs", async () => {
  const test = setup();
  const result = signInToLoomBrowser({ httpBaseUrl: origin }, test.popup as unknown as Window);
  const login = await test.navigation.promise;
  const url = new URL(login);
  expect(url.origin).toBe(origin);
  expect(url.searchParams.get("origin")).toBe("https://app.example.test");
  expect(url.searchParams.get("challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(url.searchParams.get("environmentId")).toBe(environmentId);
  expect(url.searchParams.has("code")).toBe(false);
  test.send(login, {}, { origin: "https://attacker.test" });
  test.send(login, {}, { source: {} });
  test.send(login, { state: "attacker" });
  expect(test.request).toHaveBeenCalledTimes(1);
  test.send(login);
  expect(await result).toMatchObject({
    accessToken: "host-session",
    environmentId,
    identity: { issuer: metadata.issuer, subject: "allowed-owner" },
  });
  const [endpoint, request] = test.request.mock.calls[1]!;
  expect(String(endpoint)).toBe(`${origin}/api/loom/identity/session`);
  expect(request).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
  const body = JSON.parse(request.body);
  expect(body).toMatchObject({ type: "browser", code: "c".repeat(43), environmentId });
  expect(body.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(login).not.toContain(body.verifier);
  expect(test.listeners.size).toBe(0);
  expect(test.popup.close).toHaveBeenCalled();
});

it("cancels a pending login, closes its popup and removes its listener without issuing a session", async () => {
  const test = setup();
  const result = signInToLoomBrowser({ httpBaseUrl: origin }, test.popup as unknown as Window);
  const rejected = expect(result).rejects.toThrow("cancelled or expired");
  await test.navigation.promise;
  cancelLoomBrowserSignIn(origin);
  await rejected;
  expect(test.listeners.size).toBe(0);
  expect(test.request).toHaveBeenCalledTimes(1);
  expect(test.popup.close).toHaveBeenCalled();
});

it("rejects a different environment's response and retains manual pairing for hosts without an enrolled frontend", async () => {
  const test = setup();
  const result = signInToLoomBrowser({ httpBaseUrl: origin }, test.popup as unknown as Window);
  const rejected = expect(result).rejects.toThrow("does not belong");
  test.send(await test.navigation.promise, { environmentId: "other-computer" });
  await rejected;
  expect(test.request).toHaveBeenCalledTimes(1);
  const unavailable = setup({ ...metadata, browserOrigins: [] });
  await expect(
    signInToLoomBrowser({ httpBaseUrl: origin }, unavailable.popup as unknown as Window),
  ).rejects.toThrow("pairing link");
  expect(unavailable.listeners.size).toBe(0);
});

it("rejects saved environment and issuer changes before opening account authorization", async () => {
  const test = setup();
  await expect(
    signInToLoomBrowser(
      { httpBaseUrl: origin, expectedEnvironmentId: EnvironmentId.make("different-host") },
      test.popup as unknown as Window,
    ),
  ).rejects.toThrow("another computer");
  await expect(
    signInToLoomBrowser(
      {
        httpBaseUrl: origin,
        expectedIdentity: { issuer: "https://other-id.test", subject: "owner" },
      },
      test.popup as unknown as Window,
    ),
  ).rejects.toThrow("provider changed");
});
