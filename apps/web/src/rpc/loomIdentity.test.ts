import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AuthAccessTokenType, EnvironmentId } from "@t3tools/contracts";
import {
  LOOM_IDENTITY_PASSKEY_REQUIRED,
  type LoomDesktopSignInRequest,
  type LoomIdentityMetadata,
} from "@t3tools/contracts/fork";
import {
  IDENTITY_PASSKEY_REQUIRED_TEXT,
  IDENTITY_RESOURCE_MISMATCH_TEXT,
} from "@t3tools/shared/fork/identity-grant";
import {
  readLoomIdentity,
  loomBrowserLoginUrl,
  loomIdentityUrl,
  signInToLoomBrowser,
} from "./loomIdentity";
const metadata: LoomIdentityMetadata = {
  enabled: true,
  browserLoginEnabled: true,
  issuer: "https://identity.example.com",
  clientId: "loom",
  authorizationEndpoint: "https://identity.example.com/authorize",
  tokenEndpoint: "https://identity.example.com/token",
  scopes: ["openid"],
  audience: "loom",
  environmentId: EnvironmentId.make("central"),
};
afterEach(() => vi.unstubAllGlobals());
describe("Loom browser sign-in boundary", () => {
  it("requires the host's verified browser login capability", () => {
    expect(loomBrowserLoginUrl("https://library.example.com/library", metadata)).toBe(
      "https://library.example.com/api/loom/identity/login",
    );
    expect(
      loomBrowserLoginUrl("https://library.example.com", {
        ...metadata,
        browserLoginEnabled: false,
      }),
    ).toBeNull();
    expect(
      loomBrowserLoginUrl("https://library.example.com", { ...metadata, enabled: false }),
    ).toBeNull();
    expect(
      loomBrowserLoginUrl("https://library.example.com", { ...metadata, clientId: null }),
    ).toBeNull();
  });
  it("targets only the selected host origin and rejects URL credentials", () => {
    expect(
      loomIdentityUrl(
        "https://library.example.com/a?returnTo=https://other.example",
        "/api/loom/identity",
      ),
    ).toBe("https://library.example.com/api/loom/identity");
    expect(
      loomIdentityUrl("https://user:secret@library.example.com", "/api/loom/identity"),
    ).toBeNull();
    expect(loomIdentityUrl("file:///private", "/api/loom/identity")).toBeNull();
  });
  it("preserves pairing when the identity endpoint is unsupported", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    expect(await readLoomIdentity("https://old.example.com")).toBeNull();
  });
  it("decodes public metadata before advertising sign-in", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(metadata), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await readLoomIdentity("https://library.example.com")).toEqual(metadata);
    expect(fetch).toHaveBeenCalledWith("https://library.example.com/api/loom/identity", {
      credentials: "omit",
      redirect: "error",
    });
    fetch.mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    await expect(readLoomIdentity("https://library.example.com")).rejects.toThrow();
  });
});

it("returns browser sign-in to the requested page only on the selected host", () => {
  const login = loomBrowserLoginUrl(
    "https://library.example.com",
    metadata,
    "https://library.example.com/sites?range=30#checks",
  );
  expect(new URL(login!).searchParams.get("returnTo")).toBe("/sites?range=30#checks");
  const remote = loomBrowserLoginUrl(
    "https://library.example.com",
    metadata,
    "https://local.example.com/sites",
  );
  expect(new URL(remote!).searchParams.has("returnTo")).toBe(false);
});

describe("signInToLoomBrowser", () => {
  const APP_ORIGIN = "https://app.example.com";
  const COMPUTER = "https://studio.example.com";
  const ACCOUNT = { issuer: "https://identity.example.com", subject: "kyle" };
  const computerMetadata: LoomIdentityMetadata = {
    ...metadata,
    audience: "computer",
    resource: "https://studio.example.com/loom",
    environmentId: EnvironmentId.make("studio"),
    sessionExchangeEnabled: true,
    browserOrigins: [APP_ORIGIN],
  };
  const request: LoomDesktopSignInRequest = {
    httpBaseUrl: COMPUTER,
    expectedEnvironmentId: computerMetadata.environmentId,
    expectedIssuer: ACCOUNT.issuer,
  };

  /**
   * A popup whose provider finishes at once: replacing its location posts the completion message
   * the computer's callback page would send. The sign-in's timers are inert stubs.
   */
  function harness(session: () => Response) {
    let onMessage: ((event: unknown) => void) | null = null;
    const popup = {
      closed: false,
      close: vi.fn(),
      location: {
        replace: vi.fn((href: string) => {
          const state = new URL(href).searchParams.get("state");
          onMessage?.({
            origin: COMPUTER,
            source: popup,
            data: {
              type: "loom:identity:complete",
              state,
              environmentId: computerMetadata.environmentId,
              code: "c".repeat(43),
            },
          });
        }),
      },
    };
    vi.stubGlobal("window", {
      location: { origin: APP_ORIGIN },
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 2),
      clearInterval: vi.fn(),
      addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
        if (type === "message") onMessage = listener;
      }),
      removeEventListener: vi.fn(),
    });
    const fetch = vi.fn(async (url: string | URL) =>
      String(url).endsWith("/api/loom/identity")
        ? new Response(JSON.stringify(computerMetadata), { status: 200 })
        : session(),
    );
    vi.stubGlobal("fetch", fetch);
    return { popup: popup as unknown as Window, replace: popup.location.replace, fetch };
  }

  const issued = () =>
    new Response(
      JSON.stringify({
        access_token: "access",
        issued_token_type: AuthAccessTokenType,
        token_type: "Bearer",
        expires_in: 600,
        scope: "orchestration:read",
        environmentId: computerMetadata.environmentId,
        identity: ACCOUNT,
      }),
      { status: 200 },
    );

  it("refuses a computer naming another resource before the provider opens", async () => {
    const { popup, replace, fetch } = harness(issued);
    await expect(
      signInToLoomBrowser(
        { ...request, expectedResource: "https://other.example.com/loom" },
        popup,
      ),
    ).rejects.toThrow(IDENTITY_RESOURCE_MISMATCH_TEXT);
    expect(replace).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("signs in when the computer names the pinned resource", async () => {
    const { popup, replace } = harness(issued);
    await expect(
      signInToLoomBrowser(
        { ...request, expectedResource: "https://studio.example.com/loom" },
        popup,
      ),
    ).resolves.toMatchObject({
      httpBaseUrl: COMPUTER,
      environmentId: computerMetadata.environmentId,
      identity: ACCOUNT,
      resource: "https://studio.example.com/loom",
    });
    expect(replace).toHaveBeenCalledOnce();
  });

  it("says a passkey is needed when the computer refuses the sign-in method", async () => {
    const { popup } = harness(
      () =>
        new Response(
          JSON.stringify({ error: LOOM_IDENTITY_PASSKEY_REQUIRED, message: "Passkey required." }),
          { status: 401 },
        ),
    );
    await expect(signInToLoomBrowser(request, popup)).rejects.toThrow(
      IDENTITY_PASSKEY_REQUIRED_TEXT,
    );
  });

  it("keeps the generic line for any other refusal", async () => {
    const { popup } = harness(() => new Response("nope", { status: 401 }));
    await expect(signInToLoomBrowser(request, popup)).rejects.toThrow(
      "This account could not sign in to the computer. Try again or use pairing.",
    );
  });
});
