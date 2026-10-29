import { AuthAccessTokenType, EnvironmentId } from "@t3tools/contracts";
import {
  LOOM_IDENTITY_METADATA_PATH,
  LOOM_IDENTITY_SESSION_PATH,
  type LoomIdentityDirectoryAddresses,
  type LoomIdentityMetadata,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  NativeIdentitySignInExpired,
  saveNativeIdentitySignIn,
  signInWithNativeIdentity,
  type NativeIdentitySignInStage,
} from "./nativeIdentitySignIn";

type PromptResult = { readonly type: string; readonly params?: { readonly code: string } };

const native = vi.hoisted(() => {
  const state = {
    requests: [] as unknown[],
    exchanges: [] as unknown[],
    /** "wait" keeps the sheet open until it is dismissed. */
    outcome: "success" as "success" | "dismiss" | "wait",
    onOpen: null as (() => void) | null,
    close: null as ((result: PromptResult) => void) | null,
  };
  return {
    state,
    dismissAuthSession: vi.fn(() => {
      state.close?.({ type: "dismiss" });
      state.close = null;
    }),
    access: { prepare: vi.fn(async () => null), complete: vi.fn(async () => {}), cancel: vi.fn() },
    grants: { put: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
  };
});

vi.mock("../cloudflare-access/mobileAccess", () => ({
  mobileAccess: {
    ...native.access,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  },
}));

vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "loom" } } }));
vi.mock("expo-web-browser", () => ({ dismissAuthSession: native.dismissAuthSession }));
vi.mock("../identity-renewal/mobileIdentityRenewal", () => ({
  identityGrantStore: native.grants,
}));
vi.mock("expo-auth-session", () => ({
  ResponseType: { Code: "code" },
  makeRedirectUri: (input: { readonly scheme: string; readonly path: string }) =>
    `${input.scheme}://${input.path}`,
  AuthRequest: class {
    readonly codeVerifier = "pkce-verifier";
    constructor(config: unknown) {
      native.state.requests.push(config);
    }
    promptAsync(): Promise<PromptResult> {
      if (native.state.outcome === "dismiss") return Promise.resolve({ type: "dismiss" });
      if (native.state.outcome === "success")
        return Promise.resolve({ type: "success", params: { code: "auth-code" } });
      return new Promise((resolve) => {
        native.state.close = resolve;
        native.state.onOpen?.();
      });
    }
  },
  exchangeCodeAsync: async (config: unknown) => {
    native.state.exchanges.push(config);
    return {
      tokenType: "Bearer",
      accessToken: "account-access",
      issuedAt: Math.floor(Date.now() / 1000),
      expiresIn: 3600,
    };
  },
}));

const BOOK = EnvironmentId.make("book");
const STUDIO = EnvironmentId.make("studio");
const ADDRESS = "https://book.example.ts.net";
const ISSUER = "https://id.example";
const metadata: LoomIdentityMetadata = {
  enabled: true,
  browserLoginEnabled: true,
  issuer: ISSUER,
  clientId: "web-client",
  nativeClientId: "native-client",
  authorizationEndpoint: `${ISSUER}/authorize`,
  tokenEndpoint: `${ISSUER}/token`,
  scopes: ["openid", "profile"],
  audience: "loom",
  environmentId: BOOK,
  sessionExchangeEnabled: true,
};
const routes: Record<string, unknown> = {
  [`${ADDRESS}${LOOM_IDENTITY_METADATA_PATH}`]: metadata,
  [`${ISSUER}/.well-known/openid-configuration`]: {
    issuer: ISSUER,
    authorization_endpoint: metadata.authorizationEndpoint,
    token_endpoint: metadata.tokenEndpoint,
  },
  [`${ADDRESS}${LOOM_IDENTITY_SESSION_PATH}`]: {
    access_token: "computer-session",
    issued_token_type: AuthAccessTokenType,
    token_type: "Bearer",
    expires_in: 600,
    scope: "orchestration:read",
    environmentId: BOOK,
    identity: { issuer: ISSUER, subject: "kyle" },
  },
};

beforeEach(() => {
  native.state.requests = [];
  native.state.exchanges = [];
  native.state.outcome = "success";
  native.state.onOpen = null;
  native.state.close = null;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const body = routes[String(input)];
      return body === undefined
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function signIn(input: {
  readonly signal?: AbortSignal;
  readonly expectedEnvironmentId?: EnvironmentId;
  readonly stages?: NativeIdentitySignInStage[];
  readonly directory?: LoomIdentityDirectoryAddresses;
}) {
  return signInWithNativeIdentity({
    httpBaseUrl: "book.example.ts.net",
    expectedEnvironmentId: input.expectedEnvironmentId,
    options: {
      requireSessionExchange: true,
      ...(input.directory ? { directory: input.directory } : {}),
    },
    signal: input.signal ?? new AbortController().signal,
    onProgress: (stage) => input.stages?.push(stage),
  });
}

function sheetOpened() {
  native.state.outcome = "wait";
  return new Promise<void>((resolve) => {
    native.state.onOpen = resolve;
  });
}

describe("native Identity sign-in", () => {
  it("signs in with PKCE and returns an unsaved connection named after its host", async () => {
    const stages: NativeIdentitySignInStage[] = [];
    const signedIn = await signIn({ stages });
    expect(stages).toEqual(["signing-in", "verifying"]);
    expect(native.state.requests).toEqual([
      expect.objectContaining({
        clientId: "native-client",
        redirectUri: "loom://library-auth",
        usePKCE: true,
      }),
    ]);
    expect(native.state.exchanges).toEqual([
      expect.objectContaining({
        code: "auth-code",
        extraParams: { code_verifier: "pkce-verifier" },
      }),
    ]);
    expect(signedIn?.registration.profile).toMatchObject({
      environmentId: BOOK,
      label: "book.example.ts.net",
      httpBaseUrl: ADDRESS,
      identity: { issuer: ISSUER, subject: "kyle" },
    });
    expect(native.grants.put).not.toHaveBeenCalled();
    expect(native.grants.remove).not.toHaveBeenCalled();
  });

  it("refuses an address that reaches another computer before the sheet opens", async () => {
    await expect(signIn({ expectedEnvironmentId: STUDIO })).rejects.toThrow("another computer");
    expect(native.state.requests).toEqual([]);
  });

  it("refuses a typed address for a computer the Library lists elsewhere before the sheet opens", async () => {
    const library = {
      environmentId: EnvironmentId.make("library"),
      label: "Helios",
      addresses: [],
    };
    await expect(
      signIn({
        directory: {
          library,
          computers: [
            { environmentId: BOOK, label: "Book", addresses: ["https://book.example.com"] },
          ],
        },
      }),
    ).rejects.toThrow(
      "This address says it is Book, but your Library lists Book at other addresses.",
    );
    expect(native.state.requests).toEqual([]);

    // The same computer at an address the Library lists for it signs in as before.
    const signedIn = await signIn({
      directory: {
        library,
        computers: [{ environmentId: BOOK, label: "Book", addresses: [`${ADDRESS}/`] }],
      },
    });
    expect(signedIn?.registration.profile.environmentId).toBe(BOOK);
  });

  it("returns null when the user closes the sheet or the caller cancels, closing it", async () => {
    native.state.outcome = "dismiss";
    await expect(signIn({})).resolves.toBeNull();
    expect(native.dismissAuthSession).not.toHaveBeenCalled();

    const opened = sheetOpened();
    const abort = new AbortController();
    const pending = signIn({ signal: abort.signal });
    await opened;
    abort.abort();
    await expect(pending).resolves.toBeNull();
    expect(native.dismissAuthSession).toHaveBeenCalledOnce();
    expect(native.state.exchanges).toEqual([]);
  });

  it("closes the sheet and reports expiry after five minutes", async () => {
    vi.useFakeTimers();
    const opened = sheetOpened();
    const outcome = expect(signIn({})).rejects.toBeInstanceOf(NativeIdentitySignInExpired);
    await opened;
    vi.advanceTimersByTime(300_000);
    await outcome;
    expect(native.dismissAuthSession).toHaveBeenCalledOnce();
  });
});

describe("saving a native Identity sign-in", () => {
  it("saves the connection, drops an older refresh grant and switches it on", async () => {
    const signedIn = await signIn({});
    if (signedIn === null) throw new Error("not signed in");
    const register = vi.fn(async () => AsyncResult.success(true));
    const enable = vi.fn(async () => AsyncResult.success(undefined));
    await saveNativeIdentitySignIn(signedIn, { register, enable });
    expect(register).toHaveBeenCalledWith(signedIn.registration);
    // The provider issued no refresh token, so no grant replaces the one kept for this account.
    expect(native.grants.remove).toHaveBeenCalledWith(signedIn.grantKey);
    expect(enable).toHaveBeenCalledWith({ environmentId: BOOK, enabled: true });

    register.mockResolvedValueOnce(AsyncResult.success(false));
    await expect(saveNativeIdentitySignIn(signedIn, { register, enable })).rejects.toThrow(
      "managed by this app",
    );
  });
});
