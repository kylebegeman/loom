import {
  directorySignInMismatch,
  type DirectoryCatalogRow,
  type DirectoryComputersView,
  type DirectoryConnectStep,
  type DirectoryPlanConnectInput,
} from "@t3tools/client-runtime/fork";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import type { IdentityOptions } from "../library/libraryIdentity";
import type { NativeIdentitySignIn } from "../library/nativeIdentitySignIn";

const PLATFORM_TEXT: Readonly<Record<string, string>> = {
  darwin: "macOS",
  linux: "Linux",
  windows: "Windows",
};

export interface DirectoryComputerItem {
  readonly row: DirectoryCatalogRow;
  /** For example "macOS · Reported 2 min ago". */
  readonly description: string;
  readonly connectable: boolean;
}

export type DirectorySectionContent =
  /** No Library is chosen, or it does not keep a computer list. */
  | { readonly kind: "hidden" }
  /** Nothing to show yet. */
  | { readonly kind: "loading" }
  /** The Library answered and every computer it lists is already on this device. */
  | { readonly kind: "empty" }
  /** The read failed and no kept list has a computer to show. */
  | { readonly kind: "failed"; readonly error: string }
  | {
      readonly kind: "computers";
      readonly computers: readonly DirectoryComputerItem[];
      /** Set when the rows come from the list this device kept, for example while offline. */
      readonly cacheText: string | null;
      /** Why the latest read failed, shown above the kept rows. */
      readonly error: string | null;
    };

const HIDDEN: DirectorySectionContent = { kind: "hidden" };
const LOADING: DirectorySectionContent = { kind: "loading" };
const EMPTY: DirectorySectionContent = { kind: "empty" };

export function directoryComputerItem(row: DirectoryCatalogRow): DirectoryComputerItem {
  const parts = [
    row.report === null ? undefined : PLATFORM_TEXT[row.report.platform.os],
    row.proof?.text,
    row.action === null ? "No address to connect to" : undefined,
  ].filter((part): part is string => part !== undefined);
  return { row, description: parts.join(" · "), connectable: row.action === "connect" };
}

/**
 * What the Connections section shows. `savedReady` is false until this device's saved
 * connections have loaded; before then every listed computer would look new.
 */
export function directorySectionContent(
  view: DirectoryComputersView,
  savedReady: boolean,
): DirectorySectionContent {
  if (view.status === "no-library" || view.status === "unsupported") return HIDDEN;
  if (!savedReady) return LOADING;
  if (view.rows.length > 0)
    return {
      kind: "computers",
      computers: view.rows.map(directoryComputerItem),
      cacheText: view.listing.cacheText,
      error: view.error,
    };
  if (view.status === "failed")
    return { kind: "failed", error: view.error ?? "Loom could not load the computer list." };
  return view.status === "loading" ? LOADING : EMPTY;
}

type SignInStep = Extract<DirectoryConnectStep, { readonly kind: "sign-in" }>;
type PairingStep = Extract<DirectoryConnectStep, { readonly kind: "pairing" }>;

export type DirectoryConnectOutcome =
  | { readonly kind: "connected" }
  | { readonly kind: "pairing"; readonly step: PairingStep }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: string };

/** The pairing form's route params that decide what it checks. */
export interface PairingFormParams {
  readonly routeFor?: EnvironmentId;
  /**
   * A computer the Library lists. Set only from a directory row; a deep link that sets it only
   * narrows what the form accepts.
   */
  readonly libraryComputer?: EnvironmentId;
}

/** What opens the pairing form when a listed computer cannot use Loom Identity. */
export interface DirectoryPairing {
  /** The shared pending pairing address. Empty when every listed address reached another computer. */
  readonly httpBaseUrl: string;
  readonly params: { readonly libraryComputer: EnvironmentId };
}

export function directoryPairing(step: PairingStep): DirectoryPairing {
  return { httpBaseUrl: step.httpBaseUrl ?? "", params: { libraryComputer: step.environmentId } };
}

/**
 * Holds a listed computer's address in the shared pending pairing address only while its pairing
 * form is open. The plain "Connect computer" form reads the same address and offers Identity
 * sign-in with no issuer pin, so it must not reopen on a computer the Library's check refused.
 * A pending address left by any other form stays.
 */
export function directoryPairingAddress(setPendingAddress: (address: string) => void) {
  let open = false;
  return {
    open: (pairing: DirectoryPairing) => {
      open = true;
      setPendingAddress(pairing.httpBaseUrl);
    },
    /** Once the screen that opened the form is shown again or goes away. */
    close: () => {
      if (!open) return;
      open = false;
      setPendingAddress("");
    },
  };
}

/**
 * For a listed computer the form expects that computer, so an address reaching another one is
 * refused before the pairing code is sent. It also drops "Sign in with Identity", which has no
 * issuer pin: a listed computer signs in with Identity only through the Library's issuer check,
 * which this one did not pass. Without the param the form is unchanged.
 */
export function pairingFormChecks(params: PairingFormParams) {
  return {
    expectedEnvironmentId: params.routeFor ?? params.libraryComputer,
    offersIdentity: params.libraryComputer === undefined,
  };
}

/** One computer's native sign-in, with the checks the directory requires. */
export interface DirectorySignInRequest {
  readonly httpBaseUrl: string;
  readonly expectedEnvironmentId: EnvironmentId;
  readonly options: Omit<IdentityOptions, "signal">;
  readonly label: string;
}

export interface DirectoryConnectDependencies {
  readonly plan: (
    input: DirectoryPlanConnectInput,
  ) => Promise<AtomCommandResult<DirectoryConnectStep | null, unknown>>;
  /** Null when the user closes the sign-in. Saves nothing. */
  readonly signIn: (request: DirectorySignInRequest) => Promise<NativeIdentitySignIn | null>;
  readonly save: (signedIn: NativeIdentitySignIn) => Promise<void>;
}

const NATIVE_SIGN_IN = { surface: "native" } as const;
const CONNECTED: DirectoryConnectOutcome = { kind: "connected" };
const CANCELLED: DirectoryConnectOutcome = { kind: "cancelled" };
const failed = (message: string): DirectoryConnectOutcome => ({ kind: "failed", message });

/**
 * The phone signs in where the computer stays on the Library's issuer, and on the resource the
 * Library attested for it: both are checked before the provider sheet opens and again before
 * anything is saved.
 */
export function directorySignInRequest(step: SignInStep, label: string): DirectorySignInRequest {
  const { expectedIdentity: account, expectedResource: resource } = step.request;
  return {
    httpBaseUrl: step.request.httpBaseUrl,
    expectedEnvironmentId: step.environmentId,
    options: {
      requireSessionExchange: true,
      expectedIssuer: step.issuer,
      ...(account === undefined ? {} : { expectedIdentity: account }),
      ...(resource === undefined ? {} : { expectedResource: resource }),
    },
    label,
  };
}

/** Connects a computer the Library lists: Loom Identity when it qualifies, pairing otherwise. */
export async function connectDirectoryComputer(
  input: { readonly row: DirectoryCatalogRow; readonly libraryEnvironmentId: EnvironmentId },
  dependencies: DirectoryConnectDependencies,
): Promise<DirectoryConnectOutcome> {
  const planned = await dependencies.plan({
    row: input.row,
    signIn: NATIVE_SIGN_IN,
    libraryEnvironmentId: input.libraryEnvironmentId,
  });
  if (AsyncResult.isFailure(planned))
    return failed("Loom could not check this computer. Try again.");
  const step = planned.value;
  if (step === null) return failed("This computer has no address this device can use.");
  if (step.kind === "pairing") return { kind: "pairing", step };
  try {
    const signedIn = await dependencies.signIn(directorySignInRequest(step, input.row.label));
    if (signedIn === null) return CANCELLED;
    const { profile } = signedIn.registration;
    // The computer can change between the check and the sign-in; such a session is not kept.
    const mismatch = directorySignInMismatch(step, {
      environmentId: profile.environmentId,
      identity: profile.identity,
    });
    if (mismatch !== null) return failed(mismatch);
    await dependencies.save(signedIn);
    return CONNECTED;
  } catch (cause) {
    return failed(cause instanceof Error ? cause.message : "Loom could not connect this computer.");
  }
}
