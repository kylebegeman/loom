import { EnvironmentAuthorizationError, type EnvironmentId } from "@t3tools/contracts";
import {
  LibraryPushApsEnvironment,
  LibraryPushBundleId,
  LibraryPushError,
  type LibraryPushDeliveryReason,
  type LibraryPushDevice,
  type LibraryPushDeviceRowId,
  type LibraryPushLastDelivery,
  type LibraryPushServedTopic,
  type LibraryPushStatus,
  type LibraryPushTestResult,
  type LibraryPushUnregisterResult,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";

// Every product line for the Library push section lives here. Agent alerts are promised only where
// the Library advertises them; otherwise it sends only test notifications.

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
  /** Push is on, but its settings name no app build it can send to. */
  | "no-app"
  | "ready";

export interface LibraryPushViewInput {
  /** The Library chosen on this device, or null. */
  readonly libraryId: EnvironmentId | null;
  /** This device is connected to the Library now. */
  readonly connected: boolean;
  /** The Library advertises `library-push`; null while its capabilities are unknown. */
  readonly supported: boolean | null;
  /** The Library advertises `library-push-activity`, so it sends agent alerts too. */
  readonly alerts: boolean;
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
  /** The app builds the Library sends to; null when it does not say or the headline already does. */
  readonly builds: string | null;
  /** What the Library notifies iPhones about; null while push cannot send at all. */
  readonly alerts: string | null;
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
const NO_APP_TEXT = "The Library's push settings name no app it can send to.";
const ALERTS_ON_TEXT =
  "Agent alerts are on: the Library notifies your iPhones when an agent on any of your computers needs your approval or an answer, fails, reaches a usage limit or finishes.";
const ALERTS_OFF_TEXT =
  "Agent alerts are off, so the Library sends only test notifications. They are turned on in the Library's server environment.";

const BUNDLE_NAMES: Readonly<Record<LibraryPushBundleId, string>> = {
  "com.kylebegeman.loom": "Loom",
  "com.kylebegeman.loom.preview": "Loom Preview",
  "com.kylebegeman.loom.dev": "Loom Dev",
};

const APS_ENVIRONMENT_NAMES: Readonly<Record<LibraryPushApsEnvironment, string>> = {
  sandbox: "Development",
  production: "Production",
};

const isBundleId = Schema.is(LibraryPushBundleId);
const isApsEnvironment = Schema.is(LibraryPushApsEnvironment);

// The served list uses plain strings, so a build newer than this client shows its raw ID.
const bundleName = (bundleId: string) => (isBundleId(bundleId) ? BUNDLE_NAMES[bundleId] : bundleId);
const environmentName = (environment: string) =>
  isApsEnvironment(environment) ? APS_ENVIRONMENT_NAMES[environment] : environment;

const buildName = (topic: LibraryPushServedTopic) =>
  `${bundleName(topic.bundleId)} (${environmentName(topic.apsEnvironment)})`;

const DELIVERY_REASON_TEXT: Readonly<Record<LibraryPushDeliveryReason, string>> = {
  "bad-token": "Apple no longer accepts this iPhone's notification token.",
  "key-rejected": "Apple refused the Library's push key.",
  "topic-disallowed": "Apple won't accept the Library's push key for this build of Loom.",
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
  // Tests and agent alerts both count, since either one shows whether this iPhone still hears.
  if (delivery.outcome === "sent")
    return { tone: "success", text: `Last notification sent ${at}.` };
  const reason = delivery.reason ?? "other";
  return {
    tone: DELIVERY_REASON_TONE[reason],
    text: `Last notification failed ${at}. ${DELIVERY_REASON_TEXT[reason]}`,
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
      APS_ENVIRONMENT_NAMES[device.apsEnvironment],
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

/** An empty list, not a missing one: a Library from before the list omits it. */
const servesNoApp = (status: LibraryPushStatus) =>
  status.state === "ready" && status.topics !== undefined && status.topics.length === 0;

/** A Library from before the served list, or with push off, has nothing to show here. */
function buildsLine(status: LibraryPushStatus): string | null {
  if (status.topics === undefined || status.state === "off" || servesNoApp(status)) return null;
  // A key problem takes the headline, so an empty list still needs a line of its own.
  if (status.topics.length === 0) return NO_APP_TEXT;
  return `Builds it sends to: ${status.topics.map(buildName).join(", ")}.`;
}

function stateLines(status: LibraryPushStatus): {
  readonly headline: LibraryPushLine;
  readonly hint: string | null;
} {
  if (servesNoApp(status))
    return {
      headline: { tone: "danger", text: NO_APP_TEXT },
      hint: "Check the app builds named in the Library's push settings, then restart the Library.",
    };
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
    builds: null,
    alerts: null,
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
  const noApp = servesNoApp(status);
  return {
    status: noApp ? "no-app" : status.state,
    headline,
    hint,
    key: status.key === null ? null : `Apple key ${status.key.keyId}, team ${status.key.teamId}.`,
    builds: buildsLine(status),
    alerts: canSend && !noApp ? (input.alerts ? ALERTS_ON_TEXT : ALERTS_OFF_TEXT) : null,
    devices,
    // With no app served, nothing can register, and the headline already says why.
    empty:
      devices.length > 0 || status.state === "off" || noApp
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
