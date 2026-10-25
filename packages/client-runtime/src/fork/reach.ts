import { EnvironmentAuthorizationError, type EnvironmentId } from "@t3tools/contracts";
import {
  REACH_WS_METHODS,
  ReachError,
  ReachLibraryError,
  hasExtraReachConnector,
  type ReachBlocked,
  type ReachFailureReason,
  type ReachIdentityFailure,
  type ReachLibraryComputer,
  type ReachLibraryListing,
  type ReachLibrarySetup,
  type ReachPrepared,
  type ReachStatus,
  type ReachWarning,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Opening the Library's list again after this long reads it again. Nothing reads it on a timer. */
const LIBRARY_LIST_STALE_MS = 15_000;
const IDLE_TTL_MS = 5 * 60_000;

/** Stand in while no computer or Library is chosen, or it lacks the feature, so nothing is read. */
const IDLE_STATUS = Atom.make(AsyncResult.initial<ReachStatus, never>(false)).pipe(
  Atom.withLabel("loom:reach:status:idle"),
);
const IDLE_LIBRARY_LIST = Atom.make(AsyncResult.initial<ReachLibraryListing, never>(false)).pipe(
  Atom.withLabel("loom:reach:library-list:idle"),
);

/**
 * Reach for web, desktop and mobile. `status` streams one computer's reach while mounted; pass
 * null while no computer is chosen or it lacks `reach`. Send `forget` only to a computer that
 * advertises `reach-forget`, as `reachView` offers it. `libraryList` reads the Library's records
 * when it mounts (if older than a few seconds) and after a retire, never on a timer; pass null
 * unless the Library advertises `reach-library`. Feed results to `reachView` and
 * `reachLibraryView`.
 */
export function createReachAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const status = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "loom:reach:status",
    tag: REACH_WS_METHODS.watch,
  });
  const libraryList = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:reach:library-list",
    tag: REACH_WS_METHODS.libraryList,
    staleTimeMs: LIBRARY_LIST_STALE_MS,
    idleTtlMs: IDLE_TTL_MS,
  });
  return {
    status: (
      environmentId: EnvironmentId | null,
    ): Atom.Atom<AsyncResult.AsyncResult<ReachStatus, unknown>> =>
      environmentId === null ? IDLE_STATUS : status({ environmentId, input: {} }),
    applyIdentity: createEnvironmentRpcCommand(runtime, {
      label: "loom:reach:apply-identity",
      tag: REACH_WS_METHODS.applyIdentity,
    }),
    /** Answers once the intent is stored; `status` shows the provisioning that follows. */
    set: createEnvironmentRpcCommand(runtime, {
      label: "loom:reach:set",
      tag: REACH_WS_METHODS.set,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "loom:reach:remove",
      tag: REACH_WS_METHODS.remove,
    }),
    forget: createEnvironmentRpcCommand(runtime, {
      label: "loom:reach:forget",
      tag: REACH_WS_METHODS.forget,
    }),
    /** Refresh this atom for an explicit refresh. */
    libraryList: (
      libraryId: EnvironmentId | null,
    ): Atom.Atom<AsyncResult.AsyncResult<ReachLibraryListing, unknown>> =>
      libraryId === null ? IDLE_LIBRARY_LIST : libraryList({ environmentId: libraryId, input: {} }),
    libraryRetire: createEnvironmentRpcCommand(runtime, {
      label: "loom:reach:library-retire",
      tag: REACH_WS_METHODS.libraryRetire,
      // A refused retire usually means the record moved on, so the list reads again either way.
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(libraryList({ environmentId, input: {} }))),
    }),
  };
}

// Web, desktop and mobile describe reach with the same words. Every product line lives below.

export type ReachTone = "neutral" | "active" | "success" | "warning" | "danger";

export interface ReachLine {
  readonly tone: ReachTone;
  readonly text: string;
}

/** D9 gates reach in the UI only, so this never claims the device cannot change it. */
export const REACH_CHANGE_ELSEWHERE_TEXT =
  "Turn reach on or off from the computer itself or from a device paired with full access.";
const RETIRE_ELSEWHERE_TEXT =
  "Retire reach addresses from your Library itself or from a device paired with full access.";
const DISCONNECTED_TEXT = "Connect this computer to change reach.";
const UNSUPPORTED_TEXT = "Update Loom on this computer to turn this on.";
const LOADING_TEXT = "Checking reach...";
const READ_FAILED_TEXT = "Loom could not read reach on this computer.";
const REFRESH_FAILED_TEXT =
  "Loom could not refresh reach on this computer, so this is the last state it read.";
/** Reading reach needs relay:read, which a narrowed pairing can lack; trying again never helps. */
export const REACH_UNREADABLE_TEXT =
  "Pair this device with full access to see reach on this computer.";

export const REACH_BLOCKED_TEXT: Readonly<Record<ReachBlocked, string>> = {
  "no-library": "Sign this computer in to your Library to turn this on.",
  "is-library": "This computer is your Library. Turn reach on from your other computers.",
  "library-signed-out":
    "This computer's Library sign-in ended. Open Settings > Connections on this computer for its sign-in repair. A replaced credential is picked up automatically.",
  "library-not-ready":
    "Your Library is not set up for reach yet. It needs a reach zone and a Cloudflare token file. Turn this on again once it has them.",
  "library-outdated": "Update Loom on your Library, then turn this on again.",
};

type RetryableBlock = Extract<ReachBlocked, "library-not-ready" | "library-outdated">;

/**
 * Blocks a refused ensure taught the computer. Turning reach on asks the Library again, so the
 * switch stays usable; the other blocks come from the reloaded Library connection. A
 * refusal at start keeps reach on, so then the way back is turning it off and on.
 */
const BLOCKED_WHILE_ON_TEXT: Readonly<Record<RetryableBlock, string>> = {
  "library-not-ready":
    "Your Library is not set up for reach yet. It needs a reach zone and a Cloudflare token file. Turn reach off and on again once it has them.",
  "library-outdated": "Update Loom on your Library, then turn reach off and on again.",
};

const isRetryable = (blocked: ReachBlocked): blocked is RetryableBlock =>
  blocked === "library-not-ready" || blocked === "library-outdated";

/** Failure warnings the computer's own `message` already explains in `error` and `removing`. */
const FAILURE_WARNINGS: ReadonlySet<ReachWarning> = new Set([
  "library-unreachable",
  "library-signed-out",
]);

const IDENTITY_OFF_TEXT =
  "Loom sign-in is off on this computer, so only paired devices can connect.";
const PREPARED_HERE_TEXT =
  "Your Library prepared Loom sign-in for this computer. Use these values to save them on this computer and restart its backend. Server environment variables still take precedence.";
const PREPARED_ELSEWHERE_TEXT =
  "Your Library prepared Loom sign-in for this computer. Open its own Connections settings and choose Use these values.";

const WARNING_TEXT: Readonly<Record<Exclude<ReachWarning, "identity-off">, string>> = {
  "library-unreachable": "Your Library is not reachable right now. Loom keeps trying.",
  retired:
    "Your Library retired this computer's address, or another copy of this computer took it over. Turn reach on to get an address again.",
  "library-signed-out": REACH_BLOCKED_TEXT["library-signed-out"],
  "identity-resource-differs":
    "This computer's Loom sign-in differs from what your Library prepared, so devices that find it through your Library pair instead.",
  "passkey-not-required":
    "Loom sign-in here does not require a passkey. In this computer's own Connections settings, select Require passkey and use the prepared sign-in values.",
};

export interface ReachViewInput {
  readonly result: AsyncResult.AsyncResult<ReachStatus, unknown>;
  /** This device is connected to the computer now. */
  readonly connected: boolean;
  /** The computer advertises `reach`; null while its capabilities are unknown. */
  readonly supported: boolean | null;
  /**
   * The session grants relay:read, which reading reach needs; null while the session is unknown.
   * Pass the status atom null unless this is true, since the computer refuses the read otherwise.
   */
  readonly canRead: boolean | null;
  /** The `set` command's permission atom for this computer; remove and forget need the same grant. */
  readonly canChange: boolean;
  /** The computer advertises `REACH_FORGET_FEATURE`, so it answers `forget`. */
  readonly forgetSupported: boolean;
  /**
   * Viewing the computer's own settings: its desktop app or the web app it serves. Its prepared
   * sign-in values are offered only there, where they get set; elsewhere a line points there.
   */
  readonly isThisComputer: boolean;
  /** The address this device is connected through, or null when unknown. */
  readonly activeRouteUrl: string | null;
}

/** A question to ask before a change, the same words in the web dialog and the iPhone alert. */
export interface ReachConfirm {
  readonly title: string;
  readonly message: string;
  /** The confirm button's label. */
  readonly action: string;
}

export interface ReachView {
  readonly status: ReachLine;
  /** The computer's own line about its last failure, when it has one. */
  readonly detail: string | null;
  /** `checked` is the intent, so it stays on while reach sets up, starts or retries. */
  readonly switch: {
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly disabledReason: string | null;
  };
  readonly address: { readonly url: string; readonly host: string } | null;
  readonly actions: {
    readonly copyAddress: boolean;
    readonly remove: boolean;
    /** Offered while removing, for a removal the Library may never confirm. */
    readonly forget: boolean;
    /** The status stream failed; refresh the status atom. */
    readonly retry: boolean;
  };
  /**
   * This device reaches the computer through its reach address now, so turning reach off or
   * removing it drops this connection. Pass it to `reachChangeErrorText` for those changes.
   */
  readonly throughAddress: boolean;
  /** Ask this before turning reach off, or null to turn it off at once. */
  readonly confirmOff: ReachConfirm | null;
  /** Always asked before removing; null when Remove is not offered. */
  readonly confirmRemove: ReachConfirm | null;
  /** Always asked before forgetting; null when Forget is not offered. */
  readonly confirmForget: ReachConfirm | null;
  readonly notes: readonly string[];
  readonly signIn: {
    readonly text: string;
    /** The values the Library prepared, offered only on the computer itself. */
    readonly values: ReachPrepared | null;
    /** What a "Copy values" action copies. */
    readonly copyText: string | null;
  } | null;
}

function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function sameOrigin(left: string | null, right: string): boolean {
  if (left === null) return false;
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

/** The lines a computer's server environment needs to adopt what its Library prepared. */
export function reachPreparedEnvironment(prepared: ReachPrepared): string {
  return [
    `LOOM_IDENTITY_ISSUER=${prepared.issuer}`,
    `LOOM_IDENTITY_NATIVE_CLIENT_ID=${prepared.nativeClientId}`,
    `LOOM_IDENTITY_AUDIENCE=${prepared.resource}`,
    `LOOM_IDENTITY_RESOURCE=${prepared.resource}`,
  ].join("\n");
}

function stateLine(status: ReachStatus, host: string | null): ReachLine {
  switch (status.state) {
    case "off":
      if (status.warnings.includes("retired"))
        return { tone: "warning", text: WARNING_TEXT.retired };
      return {
        tone: "neutral",
        text:
          host === null
            ? "Off. Devices connect on your network or tailnet only."
            : `Off. ${host} is kept for when you turn it back on.`,
      };
    case "unavailable": {
      const { blocked } = status;
      if (blocked === null)
        return { tone: "warning", text: "Reach is not available on this computer." };
      return {
        tone: "warning",
        text:
          status.enabled && isRetryable(blocked)
            ? BLOCKED_WHILE_ON_TEXT[blocked]
            : REACH_BLOCKED_TEXT[blocked],
      };
    }
    case "provisioning":
      return {
        tone: "active",
        text:
          host === null ? "Setting up an address for this computer..." : `Setting up ${host}...`,
      };
    case "starting":
      return {
        tone: "active",
        text: host === null ? "Starting the tunnel..." : `Starting the tunnel to ${host}...`,
      };
    case "connected":
      return {
        tone: "success",
        text: `On at ${host ?? "its address"}. Every device still needs your sign-in or pairing.`,
      };
    case "error":
      return {
        tone: "danger",
        text:
          host === null
            ? "Reach could not set up an address yet."
            : `${host} is not answering right now.`,
      };
    case "removing":
      return { tone: "active", text: host === null ? "Removing..." : `Removing ${host}...` };
  }
}

function signInHint(
  status: ReachStatus,
  isThisComputer: boolean,
  warnings: ReadonlySet<ReachWarning>,
): ReachView["signIn"] {
  const off = warnings.has("identity-off");
  const prepared =
    isThisComputer ||
    off ||
    warnings.has("identity-resource-differs") ||
    warnings.has("passkey-not-required")
      ? status.prepared
      : null;
  if (prepared !== null && isThisComputer)
    return {
      text: PREPARED_HERE_TEXT,
      values: prepared,
      copyText: reachPreparedEnvironment(prepared),
    };
  const elsewhere = prepared === null ? null : PREPARED_ELSEWHERE_TEXT;
  if (!off) return elsewhere === null ? null : { text: elsewhere, values: null, copyText: null };
  return {
    text: elsewhere === null ? IDENTITY_OFF_TEXT : `${IDENTITY_OFF_TEXT} ${elsewhere}`,
    values: null,
    copyText: null,
  };
}

/** Why the row shows no status of its own yet; null once the computer's status applies. */
function gateText(
  input: ReachViewInput,
  status: ReachStatus | null,
  failed: boolean,
): string | null {
  if (input.supported === false) return UNSUPPORTED_TEXT;
  if (!input.connected) return DISCONNECTED_TEXT;
  if (input.canRead === false) return REACH_UNREADABLE_TEXT;
  if (failed) return READ_FAILED_TEXT;
  if (status === null || input.supported === null || input.canRead === null) return LOADING_TEXT;
  return null;
}

/** One computer's reach, for the switch row on web, desktop and mobile. */
export function reachView(input: ReachViewInput): ReachView {
  const status = Option.getOrNull(AsyncResult.value(input.result));
  const url = status?.url ?? null;
  const host = url === null ? null : urlHost(url);
  const removing = status?.state === "removing";
  const readFailed = AsyncResult.isFailure(input.result);
  // A stream that fails after a success keeps its last status, which stays on screen under a note.
  const failed = readFailed && status === null;
  const gate = gateText(input, status, failed);
  const statusLine: ReachLine =
    gate === null && status !== null
      ? stateLine(status, host)
      : { tone: gate === READ_FAILED_TEXT ? "danger" : "neutral", text: gate ?? LOADING_TEXT };
  const disabledReason =
    gate ??
    (!input.canChange
      ? REACH_CHANGE_ELSEWHERE_TEXT
      : removing
        ? "Loom is still removing this address."
        : status !== null &&
            status.blocked !== null &&
            !status.enabled &&
            !isRetryable(status.blocked)
          ? REACH_BLOCKED_TEXT[status.blocked]
          : null);
  const live = gate === null && status !== null;
  const canRemove = live && input.canChange && url !== null && !removing;
  // The user decides whether the Library is gone for good, so it is offered for every removal.
  const canForget = live && input.canChange && input.forgetSupported && removing;
  const throughAddress = url !== null && sameOrigin(input.activeRouteUrl, url);
  const warnings = new Set(status?.warnings ?? []);
  // The line already says why reach turned off; the computer's own copy of it would repeat it.
  const retiredOff = live && status.state === "off" && warnings.has("retired");
  const notes = new Set<string>();
  if (live) {
    if (readFailed) notes.add(REFRESH_FAILED_TEXT);
    const explained =
      status.message !== null && (status.state === "error" || status.state === "removing");
    for (const warning of warnings) {
      if (warning === "identity-off") continue;
      if (explained && FAILURE_WARNINGS.has(warning)) continue;
      const text = WARNING_TEXT[warning];
      if (text !== statusLine.text) notes.add(text);
    }
  }
  const removeEffect =
    "Loom deletes its tunnel and DNS record. Turning reach on again brings the same address back.";
  return {
    status: statusLine,
    detail:
      live && !retiredOff && status.message !== null && status.message !== statusLine.text
        ? status.message
        : null,
    switch: {
      checked: status?.enabled ?? false,
      disabled: disabledReason !== null,
      disabledReason,
    },
    address: url === null || host === null ? null : { url, host },
    actions: {
      copyAddress: url !== null,
      remove: canRemove,
      forget: canForget,
      retry:
        (readFailed && (gate === READ_FAILED_TEXT || live)) ||
        status?.blocked === "library-signed-out",
    },
    throughAddress,
    confirmOff:
      live && status.enabled && throughAddress
        ? {
            title: "Turn reach off?",
            message: `You are connected through ${host}, so this device disconnects.`,
            action: "Turn off",
          }
        : null,
    confirmRemove: !canRemove
      ? null
      : {
          title: `Remove ${host}?`,
          message: throughAddress
            ? `You are connected through it, so this device disconnects. ${removeEffect}`
            : `Devices away from your network lose this route. ${removeEffect}`,
          action: "Remove",
        },
    confirmForget: canForget
      ? {
          title: "Forget reach on this computer?",
          message:
            "Reach stops here without your Library. Its tunnel and address stay until you retire them in your Library under Reach addresses.",
          action: "Forget",
        }
      : null,
    notes: [...notes],
    signIn: live ? signInHint(status, input.isThisComputer, warnings) : null,
  };
}

const isReachError = Schema.is(ReachError);
const isReachLibraryError = Schema.is(ReachLibraryError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

function errorTag(error: unknown): string | null {
  return typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : null;
}

const isUnreachable = (error: unknown) => {
  const tag = errorTag(error);
  return (
    tag === "EnvironmentRpcUnavailableError" ||
    tag === "ConnectionTransientError" ||
    tag === "ConnectionBlockedError" ||
    tag === "EnvironmentNotRegisteredError"
  );
};

/**
 * One short line for a failed turn on, turn off, remove or forget, or null when there is nothing to
 * report. Reach errors carry only a reason, so their contract message is safe; anything else gets
 * a line of its own. Pass `view.throughAddress` as `dropsRoute` for any change but turning on: the
 * computer answers before it stops the tunnel, but the reply can still be lost with the route,
 * so only a refusal the computer actually sent counts as a failure then.
 */
export function reachChangeErrorText(
  cause: Cause.Cause<unknown>,
  dropsRoute = false,
): string | null {
  if (Cause.hasInterruptsOnly(cause)) return null;
  const error = Option.getOrNull(Cause.findErrorOption(cause));
  if (isReachError(error)) return error.message;
  if (isAuthorizationError(error)) return REACH_CHANGE_ELSEWHERE_TEXT;
  if (dropsRoute) return null;
  if (isUnreachable(error)) return DISCONNECTED_TEXT;
  return "Loom could not change reach on this computer.";
}

/** One short line for a failed Library list read or retire. */
export function reachLibraryErrorText(
  cause: Cause.Cause<unknown>,
  action: "list" | "retire",
): string {
  const error = Option.getOrNull(Cause.findErrorOption(cause));
  if (isReachLibraryError(error)) return error.message;
  if (isAuthorizationError(error))
    return action === "retire"
      ? RETIRE_ELSEWHERE_TEXT
      : "This device is not allowed to read your Library's reach addresses.";
  // The Library stays chosen after this device removes its connection, which these run on.
  if (errorTag(error) === "EnvironmentNotRegisteredError")
    return "Your Library is not saved on this device.";
  if (isUnreachable(error)) return "Your Library is not reachable right now.";
  return action === "retire"
    ? "Loom could not retire this reach address."
    : "Loom could not load your Library's reach addresses.";
}

const CREDENTIAL_LINES = {
  cloudflare: {
    ready: { tone: "success", text: "The Cloudflare token works." },
    missing: {
      tone: "warning",
      text: "The Cloudflare token file is missing. Computers cannot turn reach on or be removed until it is back.",
    },
    refused: { tone: "danger", text: "Cloudflare refused the token. Check its permissions." },
    unavailable: { tone: "warning", text: "Cloudflare did not answer the last check." },
  },
  identity: {
    ready: { tone: "success", text: "The Pocket ID key works." },
    missing: {
      tone: "neutral",
      text: "No Pocket ID key file is in place. Add one while a computer sets up reach so your Library can prepare its Loom sign-in.",
    },
    refused: { tone: "danger", text: "Pocket ID refused the admin key." },
    unavailable: { tone: "warning", text: "Pocket ID did not answer the last check." },
  },
} as const satisfies Record<
  "cloudflare" | "identity",
  Record<ReachLibrarySetup["cloudflare"], ReachLine>
>;

function setupLines(setup: ReachLibrarySetup): readonly ReachLine[] {
  const lines: ReachLine[] = [
    setup.zone === null
      ? {
          tone: "danger",
          text: "No reach zone is set. Set LOOM_REACH_ZONE on your Library and restart it.",
        }
      : { tone: "neutral", text: `Computers get addresses like studio-loom.${setup.zone}.` },
    CREDENTIAL_LINES.cloudflare[setup.cloudflare],
    CREDENTIAL_LINES.identity[setup.identity],
  ];
  const edge = setup.edge;
  if (edge === null) {
    lines.push({
      tone: "neutral",
      text: "Edge rules are checked when the first computer turns reach on.",
    });
    return lines;
  }
  if (edge.allowlist === "ready" && edge.rateLimit === "ready")
    lines.push({ tone: "success", text: "Edge rules are in place." });
  if (edge.allowlist === "stale")
    lines.push({
      tone: "warning",
      text: "The edge allowlist could not be updated, so the previous rule stays in place.",
    });
  if (edge.allowlist === "failed")
    lines.push({ tone: "danger", text: "The edge allowlist could not be applied." });
  if (edge.rateLimit === "occupied")
    lines.push({
      tone: "warning",
      text: "Another rate-limit rule holds the zone's only slot, so reach addresses have no rate limit.",
    });
  if (edge.rateLimit === "failed")
    lines.push({ tone: "warning", text: "The rate-limit rule could not be applied." });
  return lines;
}

const FAILURE_TEXT: Partial<Record<ReachFailureReason, string>> = {
  "key-changed": "This computer now signs with a different key. Retire it to start over.",
  "not-in-directory": "This computer is not in your Library's directory.",
  "edge-failed": "The edge rules could not be applied.",
  "cloudflare-denied": "Cloudflare refused the Library's token.",
  "cloudflare-limited": "Cloudflare limited the Library's requests.",
  "cloudflare-unavailable": "Cloudflare did not answer.",
  "hostname-unavailable": "No free address was left for this computer's name.",
  "tunnel-busy": "The computer's connector was still attached.",
  io: "Your Library could not store its reach records.",
};

const IDENTITY_FAILURE_TEXT: Readonly<Record<ReachIdentityFailure, string>> = {
  denied: "Pocket ID refused the Library's admin key, so Loom sign-in was not prepared.",
  unavailable: "Pocket ID did not answer, so Loom sign-in was not prepared.",
  conflict: "Pocket ID already has a conflicting entry, so Loom sign-in was not prepared.",
};

/**
 * A removed computer's failed identity may come from a failed "Also end Loom sign-in" as well as
 * an earlier ensure, and a Library older than the `identity-key-missing` refusal reports a missing
 * admin key file as `unavailable`. Either way its resource can still exist, and only a Retire
 * that ends sign-in deletes it.
 */
const IDENTITY_END_FAILURE_TEXT: Readonly<Record<ReachIdentityFailure, string>> = {
  denied:
    "Pocket ID refused the Library's admin key, so Loom sign-in for this computer may still work. Retire it and end Loom sign-in to try again.",
  unavailable:
    "Pocket ID or the Library's admin key was not available, so Loom sign-in for this computer may still work. Retire it and end Loom sign-in to try again.",
  conflict:
    "Pocket ID refused the change, so Loom sign-in for this computer may still work. Retire it and end Loom sign-in to try again.",
};

function computerStateLine(computer: ReachLibraryComputer): ReachLine {
  switch (computer.state) {
    case "provisioning":
      return { tone: "active", text: "Setting up" };
    case "ready":
      return computer.connection === "connected"
        ? { tone: "success", text: "Connected" }
        : computer.connection === "down"
          ? { tone: "warning", text: "Not connected right now" }
          : { tone: "neutral", text: "Ready, connection unknown" };
    case "removing":
      return { tone: "active", text: "Removing" };
    case "removed":
      return { tone: "neutral", text: "Removed" };
    case "removed-with-leftover":
      return { tone: "warning", text: "Removed, DNS record left in place" };
    case "failed":
      return { tone: "danger", text: "Setup failed" };
  }
}

export interface ReachLibraryComputerView {
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly hostname: string | null;
  /** A short label, which mobile shows as a pill; `notes` carry the sentences. */
  readonly state: ReachLine;
  readonly notes: readonly string[];
  /** Null when this device cannot retire; see `retireDisabledReason`. */
  readonly retire: {
    readonly confirm: ReachConfirm;
    /** The label of the checkbox that sets `endIdentity`. */
    readonly endIdentityLabel: string;
    readonly endIdentityHint: string;
    /**
     * Why ending sign-in is not offered now, shown in place of the choice; null while it is. A
     * Library without its admin key refuses that retire, so it is never sent then.
     */
    readonly endIdentityDisabledReason: string | null;
  } | null;
}

const END_IDENTITY_KEY_MISSING_TEXT =
  "Ending Loom sign-in needs your Library's Pocket ID key file, which is not in place. You can retire now and end sign-in with another Retire once the key is back.";

function computerView(
  computer: ReachLibraryComputer,
  canRetire: boolean,
  setup: ReachLibrarySetup,
): ReachLibraryComputerView {
  const title = computer.label ?? computer.hostname ?? computer.environmentId;
  const notes: string[] = [];
  if (hasExtraReachConnector(computer))
    notes.push(
      `${computer.connectors} connectors are attached. A copy of this computer's connector may be running somewhere else.`,
    );
  if (computer.leftoverDnsRecordId !== null)
    notes.push(
      `Cloudflare DNS record ${computer.leftoverDnsRecordId} no longer matched, so Loom left it alone. Check it in Cloudflare.`,
    );
  const failure = computer.lastError === null ? undefined : FAILURE_TEXT[computer.lastError];
  if (failure !== undefined) notes.push(failure);
  const removed = computer.state === "removed" || computer.state === "removed-with-leftover";
  if (computer.identity?.state === "failed" && computer.identity.lastError !== null)
    notes.push(
      (removed ? IDENTITY_END_FAILURE_TEXT : IDENTITY_FAILURE_TEXT)[computer.identity.lastError],
    );
  if (removed) notes.push("The address stays reserved for this computer.");
  const signedIn =
    computer.signIn === "active"
      ? " This computer is still signed in to your Library and sets reach up again on its next start, so revoke its Library sign-in too."
      : "";
  return {
    environmentId: computer.environmentId,
    title,
    hostname: computer.hostname,
    state: computerStateLine(computer),
    notes,
    retire: canRetire
      ? {
          confirm: {
            title: `Retire ${computer.hostname ?? title}?`,
            message: `Loom deletes its tunnel and DNS record and forgets this computer's key.${signedIn}`,
            action: "Retire",
          },
          endIdentityLabel: "Also end Loom sign-in for this computer",
          endIdentityHint:
            "Devices signed in to it with Loom lose access when their current sign-in ends.",
          endIdentityDisabledReason:
            setup.identity === "missing" ? END_IDENTITY_KEY_MISSING_TEXT : null,
        }
      : null,
  };
}

export interface ReachLibraryViewInput {
  readonly result: AsyncResult.AsyncResult<ReachLibraryListing, unknown>;
  /** The Library chosen on this device, or null. */
  readonly libraryId: EnvironmentId | null;
  /** The Library advertises `reach-library`; null while its capabilities are unknown. */
  readonly supported: boolean | null;
  /** The `libraryRetire` command's permission atom for the Library. */
  readonly canRetire: boolean;
}

export interface ReachLibraryView {
  readonly status: "no-library" | "unsupported" | "loading" | "failed" | "listed" | "empty";
  /** The line for `no-library`, `unsupported`, `loading` and `empty`. */
  readonly notice: string | null;
  /** Why the last read failed. After a failed refresh the last list stays on screen under it. */
  readonly error: string | null;
  readonly setup: readonly ReachLine[];
  readonly computers: readonly ReachLibraryComputerView[];
  readonly retireDisabledReason: string | null;
  readonly refreshing: boolean;
  /** Set with `error`: offer Try again, which refreshes the list atom. */
  readonly retry: boolean;
}

const NO_LINES: readonly ReachLine[] = [];
const NO_COMPUTERS: readonly ReachLibraryComputerView[] = [];

/** The Library's reach addresses, for its settings section on web and desktop and on mobile. */
export function reachLibraryView(input: ReachLibraryViewInput): ReachLibraryView {
  const empty = {
    error: null,
    setup: NO_LINES,
    computers: NO_COMPUTERS,
    retireDisabledReason: null,
    refreshing: false,
    retry: false,
  };
  if (input.libraryId === null)
    return {
      ...empty,
      status: "no-library",
      notice: "Choose your Library to see your computers' reach addresses.",
    };
  if (input.supported === false)
    return {
      ...empty,
      status: "unsupported",
      notice:
        "Your Library does not hand out reach addresses. It needs a current Loom, a reach zone and a Cloudflare token file.",
    };
  const error = AsyncResult.isFailure(input.result)
    ? reachLibraryErrorText(input.result.cause, "list")
    : null;
  const listing = Option.getOrNull(AsyncResult.value(input.result));
  if (listing === null) {
    return error !== null
      ? { ...empty, status: "failed", notice: null, error, retry: true }
      : { ...empty, status: "loading", notice: "Loading reach addresses..." };
  }
  const computers = [...listing.computers]
    .sort(
      (left, right) =>
        (left.label ?? left.hostname ?? "").localeCompare(right.label ?? right.hostname ?? "") ||
        left.environmentId.localeCompare(right.environmentId),
    )
    .map((computer) => computerView(computer, input.canRetire, listing.setup));
  return {
    status: computers.length === 0 ? "empty" : "listed",
    notice:
      computers.length === 0
        ? "No computer has reach yet. Turn it on in a computer's Connections settings."
        : null,
    error,
    setup: setupLines(listing.setup),
    computers,
    retireDisabledReason: input.canRetire ? null : RETIRE_ELSEWHERE_TEXT,
    refreshing: input.result.waiting,
    retry: error !== null,
  };
}
