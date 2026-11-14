import * as Schema from "effect/Schema";
import { mobileAccess } from "../cloudflare-access/mobileAccess"; // fork: cloudflare-access
// @effect-diagnostics globalDate:off globalTimers:off -- Expo OAuth is an imperative native boundary with a bounded cancellation timer.
import type { BearerConnectionRegistration } from "@t3tools/client-runtime/connection";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import Constants from "expo-constants";
import type { LoomDesktopApprovalRequest } from "@t3tools/contracts/fork";
import { identityApprovalRefusalText } from "@t3tools/shared/fork/identity-grant";
import * as Base64Url from "effect/encoding/Base64Url";
import {
  AuthRequest,
  exchangeCodeAsync,
  makeRedirectUri,
  ResponseType,
  type TokenResponse,
} from "expo-auth-session";
import { CryptoDigestAlgorithm, digest, getRandomValues } from "expo-crypto";
import { dismissAuthSession } from "expo-web-browser";

import { identityGrantStore } from "../identity-renewal/mobileIdentityRenewal";
import {
  assertNativeIdentityUnchanged,
  completeNativeIdentitySignIn,
  libraryIdentityAddress,
  libraryIdentityResourceParameters,
  loadLibraryIdentity,
  loadNativeIdentityDiscovery,
  nativeIdentityAuthorizationParameters,
  nativeIdentityScopes,
  requestLibraryApproval,
  type IdentityOptions,
  type NativeIdentityPurpose,
} from "./libraryIdentity";

/** Long enough for a passkey, bounded if the provider sheet hangs. */
const SIGN_IN_TIMEOUT_MS = 300_000;

export type NativeIdentitySignIn = Awaited<ReturnType<typeof completeNativeIdentitySignIn>>;

/** Callers word the progress for their own surface. */
export type NativeIdentitySignInStage = "signing-in" | "verifying";

/** The sign-in outlived its time limit and its sheet was closed. */
export class NativeIdentitySignInExpired extends Schema.TaggedError<NativeIdentitySignInExpired>()(
  "NativeIdentitySignInExpired",
  {
    cause: Schema.optional(Schema.Defect()),
  },
) {
  static new(options?: ErrorOptions) {
    return new NativeIdentitySignInExpired({ ...options });
  }
  override get message(): string {
    return "Sign-in expired. Try again.";
  }
}

function dismissSignInSheet() {
  try {
    dismissAuthSession();
  } catch {
    // The provider sheet may already be closed.
  }
}

type IdentitySheet = {
  readonly destination: ReturnType<typeof libraryIdentityAddress>;
  readonly metadata: Awaited<ReturnType<typeof loadLibraryIdentity>>;
  readonly discovery: Awaited<ReturnType<typeof loadNativeIdentityDiscovery>>;
  readonly tokens: TokenResponse;
  readonly options: IdentityOptions;
};

/**
 * Runs Loom Identity in the provider's sheet for one computer, then hands the account tokens to
 * `finish`. Null when the user closes the sheet or `signal` aborts.
 */
async function withIdentitySheet<A>(
  input: {
    readonly httpBaseUrl: string;
    readonly expectedEnvironmentId?: EnvironmentId | undefined;
    readonly options: Omit<IdentityOptions, "signal">;
    readonly purpose: NativeIdentityPurpose;
    readonly signal: AbortSignal;
    readonly onProgress: (stage: NativeIdentitySignInStage) => void;
  },
  finish: (sheet: IdentitySheet) => Promise<A>,
): Promise<A | null> {
  if (input.signal.aborted) return null;
  const abort = new AbortController();
  let expired = false;
  const stop = () => {
    abort.abort();
    dismissSignInSheet();
  };
  const timer = setTimeout(() => {
    expired = true;
    stop();
  }, SIGN_IN_TIMEOUT_MS);
  input.signal.addEventListener("abort", stop, { once: true });
  const options: IdentityOptions = { ...input.options, signal: abort.signal };
  let accessOrigin: string | undefined;
  let accessCreated = false;
  let completed = false;
  try {
    const destination = libraryIdentityAddress(input.httpBaseUrl);
    accessOrigin = destination.httpBaseUrl;
    const configuredScheme = Constants.expoConfig?.scheme;
    const scheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
    if (!scheme) throw new Error("This app does not have a sign-in callback configured.");
    const ticket = await mobileAccess.prepare(
      destination.httpBaseUrl,
      makeRedirectUri({ scheme, path: "access-auth" }),
    );
    if (abort.signal.aborted) return null;
    if (ticket) {
      input.onProgress("signing-in");
      const accessAuth = new AuthRequest({
        clientId: ticket.registration.clientId,
        redirectUri: ticket.registration.redirectUri,
        responseType: ResponseType.Code,
        usePKCE: true,
        scopes: [],
        extraParams: { resource: ticket.registration.origin },
      });
      const result = await accessAuth.promptAsync({
        authorizationEndpoint: ticket.registration.issuer + "/cdn-cgi/access/oauth/authorization",
      });
      if (abort.signal.aborted || result.type === "cancel" || result.type === "dismiss")
        return null;
      if (result.type !== "success" || !result.params.code || !accessAuth.codeVerifier)
        throw new Error("Cloudflare Access sign-in did not complete. Try again.");
      await mobileAccess.complete(ticket, result.params.code, accessAuth.codeVerifier);
      accessCreated = true;
    }
    const metadata = await loadLibraryIdentity(
      destination.httpBaseUrl,
      input.expectedEnvironmentId,
      mobileAccess.fetch,
      options,
    );
    const discovery = await loadNativeIdentityDiscovery(metadata, mobileAccess.fetch, abort.signal);
    // The registered native callback serves the Library and every other computer.
    const redirectUri = makeRedirectUri({ scheme, path: "library-auth" });
    const auth = new AuthRequest({
      clientId: metadata.nativeClientId,
      redirectUri,
      responseType: ResponseType.Code,
      usePKCE: true,
      scopes: [...nativeIdentityScopes(metadata, input.purpose)],
      extraParams: nativeIdentityAuthorizationParameters(metadata, input.purpose),
    });
    input.onProgress("signing-in");
    const result = await auth.promptAsync(discovery);
    if (abort.signal.aborted) throw new Error("Sign-in cancelled.");
    if (result.type === "cancel" || result.type === "dismiss") return null;
    if (result.type !== "success" || !result.params.code || !auth.codeVerifier)
      throw new Error("Account sign-in did not complete. Try again.");
    input.onProgress("verifying");
    const tokens = await exchangeCodeAsync(
      {
        clientId: metadata.nativeClientId,
        code: result.params.code,
        redirectUri,
        extraParams: {
          code_verifier: auth.codeVerifier,
          ...libraryIdentityResourceParameters(metadata),
        },
      },
      discovery,
    );
    if (abort.signal.aborted) throw new Error("Sign-in cancelled.");
    const finished = await finish({ destination, metadata, discovery, tokens, options });
    completed = true;
    return finished;
  } catch (cause) {
    if (expired) throw NativeIdentitySignInExpired.new({ cause });
    if (abort.signal.aborted) return null;
    throw cause;
  } finally {
    if (accessOrigin) {
      mobileAccess.cancel(accessOrigin);
      if (accessCreated && !completed)
        await mobileAccess.forget(accessOrigin).catch(() => undefined);
    }
    clearTimeout(timer);
    input.signal.removeEventListener("abort", stop);
  }
}

/**
 * Signs in to one computer with Loom Identity in the provider's sheet and exchanges the account
 * tokens there. Nothing is saved: the caller checks the result, then calls
 * `saveNativeIdentitySignIn`. Null when the user closes the sheet or `signal` aborts.
 */
export function signInWithNativeIdentity(input: {
  readonly httpBaseUrl: string;
  /** Refuses an address that reaches another computer. Absent when adding a new one. */
  readonly expectedEnvironmentId?: EnvironmentId | undefined;
  readonly options: Omit<IdentityOptions, "signal">;
  /** The saved connection's name. Defaults to the address's host name. */
  readonly label?: string | undefined;
  readonly signal: AbortSignal;
  readonly onProgress: (stage: NativeIdentitySignInStage) => void;
}): Promise<NativeIdentitySignIn | null> {
  return withIdentitySheet({ ...input, purpose: "sign-in" }, (sheet) =>
    completeNativeIdentitySignIn({
      ...sheet,
      label: input.label ?? new URL(sheet.destination.httpBaseUrl).hostname,
      request: mobileAccess.fetch,
      now: Date.now,
    }),
  );
}

export type NativeIdentityApproval = {
  readonly code: string;
  readonly verifier: string;
  /** Approves later computers after Face ID or the passcode, until it expires. */
  readonly device?: { readonly token: string; readonly expiresAt: number } | undefined;
};

/**
 * A new passkey sign-in to the Library, made only to approve one computer joining the account.
 * The Library trades it for a single-use code bound to `verifier`; no session is saved. Null when
 * the user closes the sheet.
 */
export function confirmApprovalWithNativeIdentity(input: {
  readonly target: LoomDesktopApprovalRequest;
  /** Also asks for a token this phone approves with after Face ID or its passcode. */
  readonly device: boolean;
  readonly signal?: AbortSignal | undefined;
}): Promise<NativeIdentityApproval | null> {
  return withIdentitySheet(
    {
      httpBaseUrl: input.target.httpBaseUrl,
      expectedEnvironmentId: input.target.expectedEnvironmentId,
      options: input.target.expectedIdentity
        ? { expectedIdentity: input.target.expectedIdentity }
        : {},
      purpose: "approve",
      signal: input.signal ?? new AbortController().signal,
      onProgress: () => undefined,
    },
    async ({ destination, metadata, tokens, options }) => {
      if (tokens.tokenType.toLowerCase() !== "bearer" || !tokens.idToken)
        throw new Error(identityApprovalRefusalText(null));
      assertNativeIdentityUnchanged(
        metadata,
        await loadLibraryIdentity(
          destination.httpBaseUrl,
          metadata.environmentId,
          mobileAccess.fetch,
          options,
        ),
      );
      const verifier = Base64Url.encode(getRandomValues(new Uint8Array(32)));
      const challenge = Base64Url.encode(
        new Uint8Array(
          await digest(CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(verifier)),
        ),
      );
      const granted = await requestLibraryApproval(
        destination.httpBaseUrl,
        {
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
          environmentId: metadata.environmentId,
          challenge,
          ...(input.device ? { device: true } : {}),
        },
        mobileAccess.fetch,
        options.signal,
      );
      return { code: granted.code, verifier, device: granted.device };
    },
  );
}

/**
 * Saves a checked sign-in: the connection, then its refresh grant, then switches it on. Throws
 * with a short line when the connection cannot be saved.
 */
export async function saveNativeIdentitySignIn(
  signedIn: NativeIdentitySignIn,
  commands: {
    readonly register: (
      registration: BearerConnectionRegistration,
    ) => Promise<AtomCommandResult<boolean, unknown>>;
    readonly enable: (input: {
      readonly environmentId: EnvironmentId;
      readonly enabled: boolean;
    }) => Promise<AtomCommandResult<unknown, unknown>>;
  },
): Promise<void> {
  const registered = await commands.register(signedIn.registration);
  if (AsyncResult.isFailure(registered)) throw squashAtomCommandFailure(registered);
  if (!registered.value)
    throw new Error("This computer is managed by this app and cannot be added here.");
  // Without a new grant, an older one would keep renewing a sign-in the user just replaced.
  await (
    signedIn.grant
      ? identityGrantStore.put(signedIn.grant)
      : identityGrantStore.remove(signedIn.grantKey)
  ).catch(() => {
    // The session still works until it ends; Loom then asks to sign in again.
  });
  const enabled = await commands.enable({
    environmentId: signedIn.registration.profile.environmentId,
    enabled: true,
  });
  if (AsyncResult.isFailure(enabled)) throw squashAtomCommandFailure(enabled);
}
