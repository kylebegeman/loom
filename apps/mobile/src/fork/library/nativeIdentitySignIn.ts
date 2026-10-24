// @effect-diagnostics globalDate:off globalTimers:off -- Expo OAuth is an imperative native boundary with a bounded cancellation timer.
import type { BearerConnectionRegistration } from "@t3tools/client-runtime/connection";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import Constants from "expo-constants";
import { AuthRequest, exchangeCodeAsync, makeRedirectUri, ResponseType } from "expo-auth-session";
import { dismissAuthSession } from "expo-web-browser";

import { identityGrantStore } from "../identity-renewal/mobileIdentityRenewal";
import {
  completeNativeIdentitySignIn,
  libraryIdentityAddress,
  libraryIdentityResourceParameters,
  loadLibraryIdentity,
  loadNativeIdentityDiscovery,
  nativeIdentityAuthorizationParameters,
  nativeIdentityScopes,
  type IdentityOptions,
} from "./libraryIdentity";

/** Long enough for a passkey, bounded if the provider sheet hangs. */
const SIGN_IN_TIMEOUT_MS = 300_000;

export type NativeIdentitySignIn = Awaited<ReturnType<typeof completeNativeIdentitySignIn>>;

/** Callers word the progress for their own surface. */
export type NativeIdentitySignInStage = "signing-in" | "verifying";

/** The sign-in outlived its time limit and its sheet was closed. */
export class NativeIdentitySignInExpired extends Error {
  constructor(options?: ErrorOptions) {
    super("Sign-in expired. Try again.", options);
  }
}

function dismissSignInSheet() {
  try {
    dismissAuthSession();
  } catch {
    // The provider sheet may already be closed.
  }
}

/**
 * Signs in to one computer with Loom Identity in the provider's sheet and exchanges the account
 * tokens there. Nothing is saved: the caller checks the result, then calls
 * `saveNativeIdentitySignIn`. Null when the user closes the sheet or `signal` aborts.
 */
export async function signInWithNativeIdentity(input: {
  readonly httpBaseUrl: string;
  /** Refuses an address that reaches another computer. Absent when adding a new one. */
  readonly expectedEnvironmentId?: EnvironmentId | undefined;
  readonly options: Omit<IdentityOptions, "signal">;
  /** The saved connection's name. Defaults to the address's host name. */
  readonly label?: string | undefined;
  readonly signal: AbortSignal;
  readonly onProgress: (stage: NativeIdentitySignInStage) => void;
}): Promise<NativeIdentitySignIn | null> {
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
  try {
    const destination = libraryIdentityAddress(input.httpBaseUrl);
    const metadata = await loadLibraryIdentity(
      destination.httpBaseUrl,
      input.expectedEnvironmentId,
      fetch,
      options,
    );
    const discovery = await loadNativeIdentityDiscovery(metadata, fetch, abort.signal);
    const configuredScheme = Constants.expoConfig?.scheme;
    const scheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
    if (!scheme) throw new Error("This app does not have a sign-in callback configured.");
    // The registered native callback serves the Library and every other computer.
    const redirectUri = makeRedirectUri({ scheme, path: "library-auth" });
    const auth = new AuthRequest({
      clientId: metadata.nativeClientId,
      redirectUri,
      responseType: ResponseType.Code,
      usePKCE: true,
      scopes: [...nativeIdentityScopes(metadata)],
      extraParams: nativeIdentityAuthorizationParameters(metadata),
    });
    input.onProgress("signing-in");
    const result = await auth.promptAsync(discovery);
    if (abort.signal.aborted) throw new Error("Sign-in cancelled.");
    if (result.type === "cancel" || result.type === "dismiss") return null;
    if (result.type !== "success" || !result.params.code || !auth.codeVerifier)
      throw new Error("Account sign-in did not complete. Try again.");
    input.onProgress("verifying");
    const account = await exchangeCodeAsync(
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
    return await completeNativeIdentitySignIn({
      destination,
      metadata,
      discovery,
      tokens: account,
      label: input.label ?? new URL(destination.httpBaseUrl).hostname,
      options,
      request: fetch,
      now: Date.now,
    });
  } catch (cause) {
    if (expired) throw new NativeIdentitySignInExpired({ cause });
    if (abort.signal.aborted) return null;
    throw cause;
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", stop);
  }
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
