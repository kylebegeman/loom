import {
  directorySignInMismatch,
  type DirectoryCatalogRow,
  type DirectoryConnectStep,
  type DirectoryPlanConnectInput,
  type DirectorySignIn,
} from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityConnectInput } from "../identity/connection";

const POPUP_FEATURES = "popup,width=520,height=720";

export type LibraryComputerSignInStep = Extract<DirectoryConnectStep, { readonly kind: "sign-in" }>;

export type LibraryComputerConnectOutcome =
  | { readonly kind: "connected"; readonly environmentId: EnvironmentId }
  /** Open the pairing form expecting this computer, at this address when there is one. */
  | {
      readonly kind: "pairing";
      readonly environmentId: EnvironmentId;
      readonly httpBaseUrl: string | null;
      readonly reasonText: string;
    }
  /** A browser opens the sign-in window only from a click, so it asks for a second one. */
  | { readonly kind: "sign-in"; readonly step: LibraryComputerSignInStep }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "cancelled" };

type ConnectIdentity = (
  input: LoomIdentityConnectInput,
) => Promise<AtomCommandResult<EnvironmentId, unknown>>;

const failedWith = (
  result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
  fallback: string,
): LibraryComputerConnectOutcome => {
  if (isAtomCommandInterrupted(result)) return { kind: "cancelled" };
  const cause = squashAtomCommandFailure(result);
  return {
    kind: "failed",
    message: cause instanceof Error && cause.message.trim() ? cause.message : fallback,
  };
};

const signsInNatively = () => window.desktopBridge?.signInToLoom !== undefined;

/** Call during the click that starts a browser sign-in; browsers block a window opened later. */
export function openLibraryComputerSignInWindow(): Window | null {
  return window.open("about:blank", "_blank", POPUP_FEATURES);
}

/**
 * Connects a computer the Library lists: Loom Identity where the computer offers it under the
 * Library's own issuer, otherwise the pairing form. Desktop signs in natively right away. A
 * browser gets a `sign-in` outcome to finish with `signInLibraryComputer` from a second click,
 * so no empty window waits while Loom reads the computer.
 */
export async function connectLibraryComputer(input: {
  readonly row: DirectoryCatalogRow;
  readonly libraryEnvironmentId: EnvironmentId;
  readonly plan: (
    input: DirectoryPlanConnectInput,
  ) => Promise<AtomCommandResult<DirectoryConnectStep | null, unknown>>;
  readonly connect: ConnectIdentity;
  /** Sign-in is waiting at this address, so the caller can offer to cancel it. */
  readonly onSignIn?: (httpBaseUrl: string) => void;
}): Promise<LibraryComputerConnectOutcome> {
  const native = signsInNatively();
  const signIn: DirectorySignIn = native
    ? { surface: "native" }
    : { surface: "browser", origin: window.location.origin };
  const planned = await input.plan({
    row: input.row,
    signIn,
    libraryEnvironmentId: input.libraryEnvironmentId,
  });
  if (planned._tag === "Failure")
    return failedWith(planned, "Loom could not check this computer's sign-in.");
  const step = planned.value;
  if (step === null) return { kind: "failed", message: "Loom has no address for this computer." };
  if (step.kind === "pairing")
    return {
      kind: "pairing",
      environmentId: step.environmentId,
      httpBaseUrl: step.httpBaseUrl,
      reasonText: step.reasonText,
    };
  if (!native) return { kind: "sign-in", step };
  return signInLibraryComputer({
    step,
    popup: null,
    connect: input.connect,
    ...(input.onSignIn ? { onSignIn: input.onSignIn } : {}),
  });
}

/** Signs in to a planned computer. A browser passes the window it opened during the click. */
export async function signInLibraryComputer(input: {
  readonly step: LibraryComputerSignInStep;
  readonly popup: Window | null;
  readonly connect: ConnectIdentity;
  readonly onSignIn?: (httpBaseUrl: string) => void;
}): Promise<LibraryComputerConnectOutcome> {
  const { step, popup } = input;
  if (step.surface === "browser" && popup === null)
    return { kind: "failed", message: "Allow the sign-in window and try again." };
  input.onSignIn?.(step.request.httpBaseUrl);
  const connected = await input.connect({
    ...step.request,
    ...(popup === null ? {} : { popup }),
    // The computer could change its settings between the plan and the sign-in.
    verify: (session) => directorySignInMismatch(step, session),
  });
  popup?.close();
  return connected._tag === "Success"
    ? { kind: "connected", environmentId: connected.value }
    : failedWith(connected, "Could not sign in to this computer.");
}
