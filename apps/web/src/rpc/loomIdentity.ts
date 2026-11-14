import {
  LoomIdentityMetadata,
  LOOM_IDENTITY_METADATA_PATH,
  LOOM_IDENTITY_LOGIN_PATH,
  LOOM_IDENTITY_SESSION_PATH,
  LOOM_IDENTITY_LOGOUT_PATH,
  LOOM_IDENTITY_PASSKEY_REQUIRED,
  LOOM_IDENTITY_SIGN_IN_EXPIRED,
  LoomIdentitySessionResult,
  type LoomDesktopApprovalRequest,
  type LoomDesktopApprovalResult,
  type LoomDesktopSignInRequest,
  type LoomDesktopSignInResult,
  type LoomIdentityAccount,
} from "@t3tools/contracts/fork";
import {
  IDENTITY_FRESH_SIGN_IN_TEXT,
  IDENTITY_PASSKEY_REQUIRED_TEXT,
  identityApprovalRefusalText,
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

export class LoomAccessRequiredError extends Schema.TaggedError<LoomAccessRequiredError>()(
  "LoomAccessRequiredError",
  {},
) {
  override get message(): string {
    return "Sign in through Cloudflare Access before connecting to this computer.";
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

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/**
 * Sends `popup` to the computer's login and waits for the code its callback page posts back. The
 * code is spent only with `verifier`, which never leaves this window.
 */
async function browserIdentityCode(input: {
  readonly origin: string;
  readonly metadata: LoomIdentityMetadata;
  readonly popup: Window;
  readonly signal: AbortSignal;
  readonly expectedIdentity?: LoomIdentityAccount | undefined;
  readonly purpose?: "approve";
  readonly refusalText: (code: unknown) => string;
}): Promise<{ readonly code: string; readonly verifier: string }> {
  const { origin, metadata, popup, signal } = input;
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  let dispose = () => {};
  try {
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
          reject(new Error(input.refusalText("error" in data ? data.error : null)));
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
      signal.addEventListener("abort", cancelled, { once: true });
      const closed = window.setInterval(() => {
        if (popup.closed) cancelled();
      }, 500);
      dispose = () => {
        window.removeEventListener("message", listener);
        signal.removeEventListener("abort", cancelled);
        window.clearInterval(closed);
      };
      if (signal.aborted) cancelled();
    });
    const login = new URL(LOOM_IDENTITY_LOGIN_PATH, origin);
    for (const [key, value] of Object.entries({
      origin: window.location.origin,
      state,
      challenge,
      environmentId: metadata.environmentId,
      ...(input.purpose ? { purpose: input.purpose } : {}),
    }))
      login.searchParams.set(key, value);
    if (input.expectedIdentity) {
      login.searchParams.set("issuer", input.expectedIdentity.issuer);
      login.searchParams.set("subject", input.expectedIdentity.subject);
    }
    popup.location.replace(login.href);
    return { code: await code, verifier };
  } finally {
    dispose();
  }
}

/** Runs one browser sign-in per computer, closing its window however it ends. */
async function withBrowserSignIn<A>(
  httpBaseUrl: string,
  popup: Window,
  run: (origin: string, signal: AbortSignal) => Promise<A>,
): Promise<A> {
  const origin = new URL(httpBaseUrl).origin;
  if (activeBrowserSignIns.has(origin)) {
    popup.close();
    throw new Error("Sign-in is already open for this computer.");
  }
  const abort = new AbortController();
  activeBrowserSignIns.set(origin, abort);
  const timeout = window.setTimeout(() => abort.abort(), 300_000);
  try {
    return await run(origin, abort.signal);
  } finally {
    window.clearTimeout(timeout);
    activeBrowserSignIns.delete(origin);
    popup.close();
  }
}

/** Only a PKCE code crosses windows. The host session is returned directly over HTTPS. */
export async function signInToLoomBrowser(
  input: LoomDesktopSignInRequest,
  popup: Window,
): Promise<LoomDesktopSignInResult> {
  return withBrowserSignIn(input.httpBaseUrl, popup, async (origin, signal) => {
    const metadata = await readLoomIdentity(origin, signal, true);
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
    const { code, verifier } = await browserIdentityCode({
      origin,
      metadata,
      popup,
      signal,
      expectedIdentity: input.expectedIdentity,
      refusalText: signInRefusalText,
    });
    const response = await fetch(new URL(LOOM_IDENTITY_SESSION_PATH, origin), {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "browser",
        code,
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
  });
}

/**
 * A passkey check in `popup` made only to approve a computer. The Library's callback hands back a
 * single-use grant instead of a session, so this window gains no sign-in from it.
 */
export async function confirmLoomApprovalBrowser(
  input: LoomDesktopApprovalRequest,
  popup: Window,
): Promise<LoomDesktopApprovalResult> {
  return withBrowserSignIn(input.httpBaseUrl, popup, async (origin, signal) => {
    const metadata = await readLoomIdentity(origin, signal, true);
    // The Library's own app approves from a window even when its origin is not listed.
    if (
      !metadata?.enabled ||
      !metadata.browserLoginEnabled ||
      !(
        origin === window.location.origin ||
        metadata.browserOrigins?.includes(window.location.origin)
      )
    )
      throw new Error(
        "Your Library cannot check your passkey from this app. Approve from Loom on your iPhone or desktop, or from your Library's own address.",
      );
    if (metadata.environmentId !== input.expectedEnvironmentId)
      throw new Error("This address reaches another computer. Review your Library connection.");
    if (input.expectedIdentity && metadata.issuer !== input.expectedIdentity.issuer)
      throw new Error("Your Library's Identity provider changed. Sign in to your Library again.");
    return browserIdentityCode({
      origin,
      metadata,
      popup,
      signal,
      expectedIdentity: input.expectedIdentity,
      purpose: "approve",
      refusalText: (code) => identityApprovalRefusalText(typeof code === "string" ? code : null),
    });
  });
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
