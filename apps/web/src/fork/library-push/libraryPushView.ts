import { EnvironmentAuthorizationError, type EnvironmentId } from "@t3tools/contracts";
import {
  LibraryPushError,
  type LibraryPushBundleId,
  type LibraryPushDeliveryReason,
  type LibraryPushDevice,
  type LibraryPushDeviceRowId,
  type LibraryPushLastDelivery,
  type LibraryPushStatus,
  type LibraryPushTestResult,
  type LibraryPushUnregisterResult,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";

// Every product line for the Library push section lives here. Nothing below promises agent alerts:
// until computers send them, a Library only sends test notifications.

export type LibraryPushTone = "neutral" | "success" | "warning" | "danger";

export interface LibraryPushLine {
  readonly tone: LibraryPushTone;
  readonly text: string;
}

export type LibraryPushViewStatus =
  /** No Library is chosen on this device; the section is hidden. */
  | "no-library"
  | "disconnected"
  /** The Library does not advertise `library-push`, or reports push off. */
  | "off"
  | "loading"
  /** The status read failed and nothing was read before. */
  | "failed"
  | "misconfigured"
  | "failing"
  | "ready";

export interface LibraryPushViewInput {
  /** The Library chosen on this device, or null. */
  readonly libraryId: EnvironmentId | null;
  /** This device is connected to the Library now. */
  readonly connected: boolean;
  /** The Library advertises `library-push`; null while its capabilities are unknown. */
  readonly supported: boolean | null;
  readonly result: AsyncResult.AsyncResult<LibraryPushStatus, unknown>;
  /** The `test` command's permission atom for the Library. */
  readonly canTest: boolean;
  /** The `unregister` command's permission atom for the Library. */
  readonly canRemove: boolean;
  /** Formats a timestamp as a calendar date. Passed in so the view stays pure. */
  readonly formatDate: (iso: string) => string;
}

export interface LibraryPushDeviceView {
  readonly id: LibraryPushDeviceRowId;
  readonly label: string;
  readonly detail: string;
  readonly lastDelivery: LibraryPushLine | null;
  /** Offer "Send test" for this phone. */
  readonly test: boolean;
  /** Null when this device cannot remove phones. */
  readonly remove: { readonly confirm: string } | null;
}

export interface LibraryPushView {
  readonly status: LibraryPushViewStatus;
  /** Null only while no Library is chosen. */
  readonly headline: LibraryPushLine | null;
  readonly hint: string | null;
  /** Which Apple key the Library signs with, never the key or its file. */
  readonly key: string | null;
  readonly devices: readonly LibraryPushDeviceView[];
  /** The line shown in place of an empty device list. */
  readonly empty: string | null;
  /** A refresh failed while an earlier answer is still shown. */
  readonly error: string | null;
  /** The section reads the status here, so it offers Refresh. */
  readonly refreshable: boolean;
  readonly refreshing: boolean;
  /** The read failed; refresh the status atom. */
  readonly retry: boolean;
}

const OFF_TEXT = "Push notifications are off on this Library.";
const OFF_HINT =
  "They are turned on in the Library's server environment. Then each iPhone turns them on in Loom's notification settings.";
const KEY_SETTINGS_HINT =
  "Check the push key settings in the Library's server environment, then restart the Library.";
const LIBRARY_UNREACHABLE_TEXT = "Your Library is not reachable right now.";

const BUNDLE_NAMES: Readonly<Record<LibraryPushBundleId, string>> = {
  "com.kylebegeman.loom": "Loom",
  "com.kylebegeman.loom.preview": "Loom Preview",
  "com.kylebegeman.loom.dev": "Loom Dev",
};

const DELIVERY_REASON_TEXT: Readonly<Record<LibraryPushDeliveryReason, string>> = {
  "bad-token": "Apple no longer accepts this iPhone's notification token.",
  "key-rejected": "Apple refused the Library's push key.",
  "topic-disallowed": "Apple won't accept the Library's push key for this app.",
  "rate-limited": "Too many notifications went out recently. Wait a few minutes and try again.",
  unavailable: "Apple did not answer. Try again later.",
  other: "Apple did not deliver it.",
};

const DELIVERY_REASON_TONE: Readonly<Record<LibraryPushDeliveryReason, LibraryPushTone>> = {
  "bad-token": "warning",
  "key-rejected": "danger",
  "topic-disallowed": "danger",
  "rate-limited": "warning",
  unavailable: "warning",
  other: "warning",
};

const isLibraryPushError = Schema.is(LibraryPushError);
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
 * One short line for a failed status read, test or removal. Push errors carry only a reason, so
 * their contract message is safe; anything else gets a line of its own.
 */
export function libraryPushErrorText(
  cause: Cause.Cause<unknown>,
  action: "status" | "test" | "remove",
): string {
  const error = Option.getOrNull(Cause.findErrorOption(cause));
  if (isLibraryPushError(error)) return error.message;
  if (isAuthorizationError(error))
    return action === "status"
      ? "This connection can't read push notifications on your Library."
      : "This connection can't change push notifications on your Library. Use a device signed in with your Loom account or paired with Settings permission.";
  if (isUnreachable(error)) return LIBRARY_UNREACHABLE_TEXT;
  switch (action) {
    case "status":
      return "Loom could not read push notifications on your Library.";
    case "test":
      return "Couldn't send a test notification.";
    case "remove":
      return "Couldn't remove this iPhone.";
  }
}

function lastDeliveryLine(
  delivery: LibraryPushLastDelivery | null,
  formatDate: (iso: string) => string,
): LibraryPushLine | null {
  if (delivery === null) return null;
  const at = formatDate(delivery.at);
  if (delivery.outcome === "sent") return { tone: "success", text: `Last test sent ${at}.` };
  const reason = delivery.reason ?? "other";
  return {
    tone: DELIVERY_REASON_TONE[reason],
    text: `Last test failed ${at}. ${DELIVERY_REASON_TEXT[reason]}`,
  };
}

function deviceView(
  device: LibraryPushDevice,
  input: LibraryPushViewInput,
  canSend: boolean,
): LibraryPushDeviceView {
  const app = `${BUNDLE_NAMES[device.bundleId]}${device.appVersion === null ? "" : ` ${device.appVersion}`}`;
  return {
    id: device.id,
    label: device.label,
    detail: [
      app,
      device.apsEnvironment === "sandbox" ? "Development" : "Production",
      `Registered ${input.formatDate(device.registeredAt)}`,
      `Expires ${input.formatDate(device.expiresAt)}`,
    ].join(" · "),
    lastDelivery: lastDeliveryLine(device.lastDelivery, input.formatDate),
    test: canSend && input.canTest,
    remove: input.canRemove
      ? {
          confirm: `Remove ${device.label}? The Library stops sending to it now. If notifications are still on in that iPhone's Loom settings, it registers again the next time it connects.`,
        }
      : null,
  };
}

function stateLines(status: LibraryPushStatus): {
  readonly headline: LibraryPushLine;
  readonly hint: string | null;
} {
  switch (status.state) {
    case "off":
      return { headline: { tone: "neutral", text: OFF_TEXT }, hint: OFF_HINT };
    case "misconfigured":
      return {
        headline: {
          tone: "danger",
          text:
            status.reason === "key-invalid"
              ? "The Library's Apple push key is not a valid key."
              : "The Library can't read its Apple push key.",
        },
        hint: KEY_SETTINGS_HINT,
      };
    case "failing":
      return {
        headline: { tone: "danger", text: "Apple refused the Library's push key." },
        hint: "Check the key in your Apple developer account. A test that gets through clears this.",
      };
    case "ready":
      return {
        headline: {
          tone: "success",
          text: "On. iPhones signed in to this Library can turn on notifications in Loom's settings.",
        },
        hint: null,
      };
  }
}

const NO_DEVICES: readonly LibraryPushDeviceView[] = [];

/** The chosen Library's push status for its section on web and desktop. */
export function libraryPushView(input: LibraryPushViewInput): LibraryPushView {
  const quiet = {
    hint: null,
    key: null,
    devices: NO_DEVICES,
    empty: null,
    error: null,
    refreshable: false,
    refreshing: false,
    retry: false,
  };
  if (input.libraryId === null) return { ...quiet, status: "no-library", headline: null };
  if (!input.connected)
    return {
      ...quiet,
      status: "disconnected",
      headline: { tone: "neutral", text: "Connect to your Library to see its push notifications." },
    };
  if (input.supported === false)
    return {
      ...quiet,
      status: "off",
      headline: { tone: "neutral", text: OFF_TEXT },
      hint: OFF_HINT,
    };
  const loading = {
    ...quiet,
    status: "loading" as const,
    headline: { tone: "neutral" as const, text: "Checking push notifications..." },
  };
  if (input.supported === null) return loading;
  const status = Option.getOrNull(AsyncResult.value(input.result));
  const failure = AsyncResult.isFailure(input.result)
    ? libraryPushErrorText(input.result.cause, "status")
    : null;
  if (status === null)
    return failure === null
      ? { ...loading, refreshable: true }
      : {
          ...quiet,
          status: "failed",
          headline: { tone: "danger", text: failure },
          refreshable: true,
          retry: true,
        };
  const { headline, hint } = stateLines(status);
  // A misconfigured or off Library cannot sign a test; a failing one can, and a test that gets
  // through is how it recovers.
  const canSend = status.state === "ready" || status.state === "failing";
  const devices = status.devices.map((device) => deviceView(device, input, canSend));
  return {
    status: status.state,
    headline,
    hint,
    key: status.key === null ? null : `Apple key ${status.key.keyId}, team ${status.key.teamId}.`,
    devices,
    empty:
      devices.length > 0 || status.state === "off"
        ? null
        : input.canRemove
          ? "No iPhones are registered yet."
          : "This connection can't list the Library's iPhones. Use a device signed in with your Loom account or paired with Settings permission.",
    error: failure,
    refreshable: true,
    refreshing: input.result.waiting,
    retry: failure !== null,
  };
}

/** What one "Send test" did, for the phone it targeted. */
export function libraryPushTestText(result: LibraryPushTestResult, label: string): LibraryPushLine {
  const delivery = result.deliveries[0];
  if (delivery === undefined)
    return { tone: "neutral", text: `${label} is no longer registered with this Library.` };
  switch (delivery.outcome) {
    case "sent":
      return {
        tone: "success",
        text: `Test sent to ${delivery.label}. It should arrive in a few seconds.`,
      };
    case "removed":
      return {
        tone: "warning",
        text: `Apple no longer accepts ${delivery.label}, so the Library removed it. It registers again the next time it connects with notifications on.`,
      };
    case "failed": {
      const reason = delivery.reason ?? "other";
      return {
        tone: DELIVERY_REASON_TONE[reason],
        text: `Couldn't send a test to ${delivery.label}. ${DELIVERY_REASON_TEXT[reason]}`,
      };
    }
  }
}

/** What one "Remove" did. `removed: false` means the phone was already gone. */
export function libraryPushRemoveText(
  result: LibraryPushUnregisterResult,
  label: string,
): LibraryPushLine {
  return result.removed
    ? { tone: "success", text: `Removed ${label}. The Library no longer sends to it.` }
    : { tone: "neutral", text: `${label} was already removed.` };
}
