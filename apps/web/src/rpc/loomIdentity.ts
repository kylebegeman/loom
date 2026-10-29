import {
  LoomIdentityMetadata,
  LOOM_IDENTITY_METADATA_PATH,
  LOOM_IDENTITY_LOGIN_PATH,
  LOOM_IDENTITY_SESSION_PATH,
  LOOM_IDENTITY_LOGOUT_PATH,
  LOOM_IDENTITY_PASSKEY_REQUIRED,
  LOOM_IDENTITY_SIGN_IN_EXPIRED,
  LoomIdentitySessionResult,
} from "@t3tools/contracts/fork";
import {
  IDENTITY_FRESH_SIGN_IN_TEXT,
  IDENTITY_PASSKEY_REQUIRED_TEXT,
  identityResourceRefusal,
} from "@t3tools/shared/fork/identity-grant";
import * as Schema from "effect/Schema";

const decodeIdentitySession = Schema.decodeUnknownSync(LoomIdentitySessionResult);
const decodeMetadata = Schema.decodeUnknownSync(LoomIdentityMetadata);

/** Public metadata is available before pairing. A login URL always targets the selected host. */
export function loomIdentityUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  if (base.username || base.password) return null;
  return new URL(path, base.origin).href;
}

export class LoomAccessRequiredError extends Error {
  constructor() {
    super("Sign in through Cloudflare Access before connecting to this computer.");
  }
}

export async function readLoomIdentity(baseUrl: string, signal?: AbortSignal, refresh = false) {
  const url = loomIdentityUrl(baseUrl, LOOM_IDENTITY_METADATA_PATH);
  if (!url) return null;
  // Same-origin Access needs its cookie; wildcard metadata CORS requires omitting cross-origin credentials.
  const response = await fetch(url, {
    credentials:
      typeof window !== "undefined" && new URL(url).origin === window.location.origin
        ? "same-origin"
        : "omit",
    redirect: "error",
    ...(refresh ? { cache: "no-store" as const } : {}),
    ...(signal ? { signal } : {}),
  });
  if (response.status === 401) {
    const resource = /resource_metadata="([^"]+)"/u.exec(
      response.headers.get("www-authenticate") ?? "",
    )?.[1];
    if (resource) {
      const metadata = new URL(resource, url);
      if (
        metadata.origin === new URL(url).origin &&
        metadata.pathname.startsWith("/.well-known/cloudflare-access-protected-resource/")
      )
        throw new LoomAccessRequiredError();
    }
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Could not check Loom sign-in on this server.");
  return decodeMetadata(await response.json());
}

export function loomBrowserLoginUrl(
  baseUrl: string,
  metadata: LoomIdentityMetadata | null,
  currentUrl?: string,
) {
  if (
    !metadata?.enabled ||
    !metadata.browserLoginEnabled ||
    !metadata.clientId ||
    !metadata.issuer ||
    !metadata.authorizationEndpoint ||
    !metadata.tokenEndpoint
  )
    return null;
  const login = loomIdentityUrl(baseUrl, LOOM_IDENTITY_LOGIN_PATH);
  if (!login || !currentUrl) return login;
  const target = new URL(login);
  const current = new URL(currentUrl);
  if (current.origin === target.origin)
    target.searchParams.set("returnTo", current.pathname + current.search + current.hash);
  return target.href;
}

const activeBrowserSignIns = new Map<string, AbortController>();

const SIGN_IN_FAILED_TEXT =
  "This account could not sign in to the computer. Try again or use pairing.";

/** The line for a refusal the computer named, from the callback window or the session exchange. */
function signInRefusalText(code: unknown) {
  if (code === LOOM_IDENTITY_PASSKEY_REQUIRED) return IDENTITY_PASSKEY_REQUIRED_TEXT;
  if (code === LOOM_IDENTITY_SIGN_IN_EXPIRED) return IDENTITY_FRESH_SIGN_IN_TEXT;
  return SIGN_IN_FAILED_TEXT;
}

/** The named refusal a computer sends when only a different sign-in would work, if any. */
async function sessionRefusalCode(response: Response): Promise<string | null> {
  if (response.status !== 401) return null;
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
    ? body.error
    : null;
}

export function cancelLoomBrowserSignIn(baseUrl: string) {
  activeBrowserSignIns.get(new URL(baseUrl).origin)?.abort();
}

/** Only a PKCE code crosses windows. The host session is returned directly over HTTPS. */
export async function signInToLoomBrowser(
  input: import("@t3tools/contracts/fork").LoomDesktopSignInRequest,
  popup: Window,
): Promise<import("@t3tools/contracts/fork").LoomDesktopSignInResult> {
  const origin = new URL(input.httpBaseUrl).origin;
  if (activeBrowserSignIns.has(origin)) {
    popup.close();
    throw new Error("Sign-in is already open for this computer.");
  }
  const abort = new AbortController();
  activeBrowserSignIns.set(origin, abort);
  const timeout = window.setTimeout(() => abort.abort(), 300_000);
  let dispose = () => {};
  try {
    const metadata = await readLoomIdentity(origin, abort.signal, true);
    if (
      !metadata?.enabled ||
      !metadata.browserLoginEnabled ||
      !metadata.sessionExchangeEnabled ||
      !metadata.browserOrigins?.includes(window.location.origin)
    )
      throw new Error(
        "This computer has not enabled sign-in from this app. Use its own address or a pairing link.",
      );
    if (input.expectedEnvironmentId && metadata.environmentId !== input.expectedEnvironmentId)
      throw new Error("This address reaches another computer. Review the selected connection.");
    if (input.expectedIdentity && metadata.issuer !== input.expectedIdentity.issuer)
      throw new Error(
        "This computer's Identity provider changed. Remove the saved connection before signing in again.",
      );
    // Desktop and iPhone open the provider this issuer names. Here the computer's own login page
    // picks the provider, so this stops only a computer that reports its provider honestly.
    if (input.expectedIssuer !== undefined && metadata.issuer !== input.expectedIssuer)
      throw new Error("This computer uses a different sign-in provider than your Library.");
    const resourceRefusal = identityResourceRefusal(metadata);
    if (resourceRefusal !== null) throw new Error(resourceRefusal);
    const random = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
    };
    const state = random();
    const verifier = random();
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const challenge = btoa(String.fromCharCode(...digest))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const code = new Promise<string>((resolve, reject) => {
      const listener = (event: MessageEvent<unknown>) => {
        if (
          event.origin !== origin ||
          event.source !== popup ||
          !event.data ||
          typeof event.data !== "object"
        )
          return;
        const data = event.data;
        if (!("type" in data) || !("state" in data) || data.state !== state) return;
        // The computer's callback page reports a refused sign-in so this window can say why.
        if (data.type === "loom:identity:failed") {
          reject(new Error(signInRefusalText("error" in data ? data.error : null)));
          return;
        }
        if (data.type !== "loom:identity:complete") return;
        if (
          !("environmentId" in data) ||
          data.environmentId !== metadata.environmentId ||
          !("code" in data) ||
          typeof data.code !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(data.code)
        ) {
          reject(new Error("The sign-in response does not belong to this computer."));
          return;
        }
        resolve(data.code);
      };
      const cancelled = () => reject(new Error("Sign-in cancelled or expired. Try again."));
      window.addEventListener("message", listener);
      abort.signal.addEventListener("abort", cancelled, { once: true });
      const closed = window.setInterval(() => {
        if (popup.closed) cancelled();
      }, 500);
      dispose = () => {
        window.removeEventListener("message", listener);
        abort.signal.removeEventListener("abort", cancelled);
        window.clearInterval(closed);
      };
      if (abort.signal.aborted) cancelled();
    });
    const login = new URL(LOOM_IDENTITY_LOGIN_PATH, origin);
    for (const [key, value] of Object.entries({
      origin: window.location.origin,
      state,
      challenge,
      environmentId: metadata.environmentId,
    }))
      login.searchParams.set(key, value);
    if (input.expectedIdentity) {
      login.searchParams.set("issuer", input.expectedIdentity.issuer);
      login.searchParams.set("subject", input.expectedIdentity.subject);
    }
    popup.location.replace(login.href);
    const authorizationCode = await code;
    dispose();
    const response = await fetch(new URL(LOOM_IDENTITY_SESSION_PATH, origin), {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      signal: abort.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "browser",
        code: authorizationCode,
        verifier,
        environmentId: metadata.environmentId,
        ...(input.expectedIdentity ? { expectedIdentity: input.expectedIdentity } : {}),
      }),
    });
    if (!response.ok) throw new Error(signInRefusalText(await sessionRefusalCode(response)));
    const session = decodeIdentitySession(await response.json());
    if (
      session.token_type !== "Bearer" ||
      !Number.isFinite(session.expires_in) ||
      session.expires_in <= 0 ||
      session.expires_in > 3600
    )
      throw new Error("The computer returned an unsupported or expired Identity session.");
    if (
      session.environmentId !== metadata.environmentId ||
      session.identity.issuer !== metadata.issuer ||
      (input.expectedIdentity && session.identity.subject !== input.expectedIdentity.subject)
    )
      throw new Error("The sign-in account or computer changed. Review the saved connection.");
    return {
      httpBaseUrl: origin,
      environmentId: session.environmentId,
      accessToken: session.access_token,
      identity: session.identity,
      expiresAt: Date.now() + session.expires_in * 1000,
    };
  } finally {
    dispose();
    window.clearTimeout(timeout);
    activeBrowserSignIns.delete(origin);
    popup.close();
  }
}

/** Cookie logout is same-origin only; the server also checks Origin before revoking it. */
export async function signOutLoomBrowser() {
  const response = await fetch(new URL(LOOM_IDENTITY_LOGOUT_PATH, window.location.origin), {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Could not sign out of this computer. Try again.");
}
