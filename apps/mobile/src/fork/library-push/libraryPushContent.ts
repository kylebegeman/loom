import {
  LibraryPushError,
  type LibraryPushDeliveryReason,
  type LibraryPushErrorReason,
  type LibraryPushState,
  type LibraryPushStatusReason,
} from "@t3tools/contracts/fork";

import {
  recordFor,
  type LibraryPushActivity,
  type LibraryPushPermission,
  type LibraryPushRefusalReason,
  type LibraryPushSnapshot,
} from "./libraryPushPlan";

export const LIBRARY_PUSH_COPY = {
  sectionTitle: "Library notifications",
  rowLabel: "Notifications",
  toggleLabel: "Library notifications",
  toggleLabelFor: (library: string) => `Notifications from ${library}`,
  footer:
    "Lets your Library send notifications to this iPhone. For now it sends only test notifications.",
  unsupported: "This build of Loom can't receive notifications.",
  checking: "Checking the Library...",
  chooseLibrary: "Choose a Library in Library connection to get notifications.",
  chooseLibraryAction: "Library connection",
  unreachable: "Can't reach the Library.",
  unreachableKept: "Can't reach the Library. Your setting is kept.",
  pendingOff: "Turned off. The Library will forget this iPhone when it reconnects.",
  off: "Turned off on the Library.",
  notAllowed: "This iPhone's sign-in to the Library can't change notification settings.",
  turningOn: "Turning on...",
  turningOff: "Turning off...",
  permissionDenied: "Off in iOS Settings.",
  openSettings: "Open iOS Settings",
  tokenFailed: "Couldn't get a notification token from iOS. Try again later.",
  registerFailed: "Couldn't register this iPhone with the Library.",
  unregisterFailed:
    "Couldn't turn off notifications on the Library. Loom tries again when it reconnects.",
  identityRequired: "Sign in to the Library with Loom Identity to get notifications.",
  unsupportedApp: "Your Library doesn't accept notifications from this build.",
  registered: (library: string) => `On. Registered with ${library}.`,
  theLibrary: "the Library",
  keyRejected: "The Library can't sign notifications. Check its Apple key.",
  keyUnusable: "The Library can't use its Apple push key.",
  retry: "Try again",
  testLabel: "Send test notification",
  testSending: "Sending...",
  testSent: "Test sent. It should arrive in a few seconds.",
  testFailed: "Couldn't send a test notification.",
  // Shown only once the test row is back, which takes a registration, so it has already happened.
  testNotRegistered:
    "The Library no longer had this iPhone, so Loom registered it again. Try again.",
  testBadToken:
    "Apple no longer accepted this iPhone's notification token, so Loom registered it again. Try again.",
  testKeyRejected: "Apple refused the Library's push key.",
  testTopicDisallowed: "Apple won't accept the Library's push key for this build of Loom.",
  testUnavailable: "Apple did not answer. Try again later.",
  deniedAlertTitle: "Notifications are off for Loom",
  deniedAlertMessage: "Allow notifications for Loom in iOS Settings.",
  saveFailed: "Couldn't save your notification setting. Try again.",
  cancel: "Cancel",
} as const;

export type LibraryPushContentKind =
  | "unsupported"
  | "loading"
  | "no-library"
  | "unreachable"
  | "pending-off"
  | "off"
  | "not-allowed"
  | "available"
  | "turning-on"
  | "turning-off"
  | "permission-denied"
  | "refused"
  | "token-failed"
  | "register-failed"
  | "unregister-failed"
  | "registered";

/**
 * Why a test did not go out: the Library refused the request, Apple refused this iPhone's
 * delivery, or the Library no longer held a row for it.
 */
export type LibraryPushTestFailure =
  | LibraryPushErrorReason
  | LibraryPushDeliveryReason
  | "not-registered";

export type LibraryPushTestState =
  | { readonly phase: "idle" }
  | { readonly phase: "sending" }
  | { readonly phase: "sent" }
  | { readonly phase: "failed"; readonly reason: LibraryPushTestFailure | null };

export interface LibraryPushContentInput {
  readonly supported: boolean;
  readonly snapshot: LibraryPushSnapshot;
  readonly permission: LibraryPushPermission;
  readonly activity: LibraryPushActivity;
  /** The Library's own push status, when it answered. */
  readonly status: {
    readonly state: LibraryPushState;
    readonly reason: LibraryPushStatusReason | null;
  } | null;
  readonly libraryLabel: string | null;
  readonly test: LibraryPushTestState;
}

export interface LibraryPushMessage {
  readonly text: string;
  readonly tone: "muted" | "danger";
}

export interface LibraryPushContent {
  readonly kind: LibraryPushContentKind;
  readonly toggle: {
    readonly label: string;
    readonly value: boolean;
    readonly disabled: boolean;
    readonly description: string | null;
  } | null;
  readonly message: LibraryPushMessage | null;
  readonly footer: string;
  readonly chooseLibrary: boolean;
  readonly openSettings: boolean;
  readonly retry: boolean;
  readonly test: { readonly description: string | null; readonly loading: boolean } | null;
}

const withReason = (text: string, reason: LibraryPushErrorReason | null) =>
  reason === null ? text : `${text} ${new LibraryPushError({ reason }).message}`;

const refusalText = (reason: LibraryPushRefusalReason): string => {
  switch (reason) {
    case "identity-required":
      return LIBRARY_PUSH_COPY.identityRequired;
    case "unsupported-app":
      return LIBRARY_PUSH_COPY.unsupportedApp;
    case "off":
      return LIBRARY_PUSH_COPY.off;
    case "misconfigured":
      return LIBRARY_PUSH_COPY.keyUnusable;
    case "invalid":
    case "limit":
      return withReason(LIBRARY_PUSH_COPY.registerFailed, reason);
  }
};

const keyMessage = (status: LibraryPushContentInput["status"]): LibraryPushMessage | null => {
  if (status?.state === "failing" && status.reason === "key-rejected")
    return { text: LIBRARY_PUSH_COPY.keyRejected, tone: "danger" };
  if (status?.state === "misconfigured")
    return { text: LIBRARY_PUSH_COPY.keyUnusable, tone: "danger" };
  return null;
};

const testFailureDetail = (reason: LibraryPushTestFailure | null): string | null => {
  switch (reason) {
    case null:
    case "other":
      return null;
    case "not-registered":
      return LIBRARY_PUSH_COPY.testNotRegistered;
    case "bad-token":
      return LIBRARY_PUSH_COPY.testBadToken;
    case "key-rejected":
      return LIBRARY_PUSH_COPY.testKeyRejected;
    case "topic-disallowed":
      return LIBRARY_PUSH_COPY.testTopicDisallowed;
    case "unavailable":
      return LIBRARY_PUSH_COPY.testUnavailable;
    default:
      // The Library's own refusals, `rate-limited` included, which both sides mean the same way.
      return new LibraryPushError({ reason }).message;
  }
};

const testDescription = (test: LibraryPushTestState): string | null => {
  switch (test.phase) {
    case "idle":
      return null;
    case "sending":
      return LIBRARY_PUSH_COPY.testSending;
    case "sent":
      return LIBRARY_PUSH_COPY.testSent;
    case "failed": {
      const detail = testFailureDetail(test.reason);
      return detail === null
        ? LIBRARY_PUSH_COPY.testFailed
        : `${LIBRARY_PUSH_COPY.testFailed} ${detail}`;
    }
  }
};

const BASE = {
  footer: LIBRARY_PUSH_COPY.footer,
  chooseLibrary: false,
  openSettings: false,
  retry: false,
  test: null,
  message: null,
} as const;

/**
 * Turning off is always offered, turning on only where it can work, so the switch never asks iOS
 * for permission on behalf of a Library that cannot use it.
 */
export function libraryPushContent(input: LibraryPushContentInput): LibraryPushContent {
  if (!input.supported) {
    return {
      ...BASE,
      kind: "unsupported",
      toggle: null,
      message: { text: LIBRARY_PUSH_COPY.unsupported, tone: "muted" },
    };
  }
  const { snapshot, activity } = input;
  if (!snapshot.ready) {
    return {
      ...BASE,
      kind: "loading",
      toggle: null,
      message: { text: LIBRARY_PUSH_COPY.checking, tone: "muted" },
    };
  }
  const library = snapshot.chosen;
  if (library === null) {
    return {
      ...BASE,
      kind: "no-library",
      toggle: null,
      message: { text: LIBRARY_PUSH_COPY.chooseLibrary, tone: "muted" },
      chooseLibrary: true,
    };
  }

  const record = recordFor(snapshot.record, library);
  const value = record?.optedIn ?? false;
  const pendingOff = record !== null && !record.optedIn && record.registration !== null;
  const label =
    input.libraryLabel === null
      ? LIBRARY_PUSH_COPY.toggleLabel
      : LIBRARY_PUSH_COPY.toggleLabelFor(input.libraryLabel);
  const toggle = (description: string | null, disabled = false) => ({
    label,
    value,
    disabled,
    description,
  });
  const offeredOnlyOff = (description: string) => toggle(description, !value);

  if (!value && activity.running === "unregister")
    return { ...BASE, kind: "turning-off", toggle: toggle(LIBRARY_PUSH_COPY.turningOff, true) };
  if (pendingOff && activity.failure === "unregister") {
    return {
      ...BASE,
      kind: "unregister-failed",
      toggle: toggle(null),
      message: { text: LIBRARY_PUSH_COPY.unregisterFailed, tone: "danger" },
      retry: library.connected,
    };
  }
  if (pendingOff)
    return { ...BASE, kind: "pending-off", toggle: toggle(LIBRARY_PUSH_COPY.pendingOff) };
  if (!library.connected || library.advertised === null) {
    return {
      ...BASE,
      kind: "unreachable",
      toggle: offeredOnlyOff(
        value ? LIBRARY_PUSH_COPY.unreachableKept : LIBRARY_PUSH_COPY.unreachable,
      ),
    };
  }
  if (!library.advertised)
    return { ...BASE, kind: "off", toggle: offeredOnlyOff(LIBRARY_PUSH_COPY.off) };
  if (!library.canChange)
    return { ...BASE, kind: "not-allowed", toggle: offeredOnlyOff(LIBRARY_PUSH_COPY.notAllowed) };
  if (record === null || !value) return { ...BASE, kind: "available", toggle: toggle(null) };

  if (input.permission === "denied") {
    return {
      ...BASE,
      kind: "permission-denied",
      toggle: toggle(LIBRARY_PUSH_COPY.permissionDenied),
      openSettings: true,
    };
  }
  // Refreshing a registration the Library already holds stays "registered": it is still on.
  if (activity.running === "register" && record.registration === null)
    return { ...BASE, kind: "turning-on", toggle: toggle(LIBRARY_PUSH_COPY.turningOn, true) };
  if (record.refusal !== null) {
    return {
      ...BASE,
      kind: "refused",
      toggle: toggle(null),
      message: { text: refusalText(record.refusal.reason), tone: "danger" },
      retry: true,
    };
  }
  if (activity.failure === "token") {
    return {
      ...BASE,
      kind: "token-failed",
      toggle: toggle(null),
      message: { text: LIBRARY_PUSH_COPY.tokenFailed, tone: "danger" },
      retry: true,
    };
  }
  if (activity.failure === "register") {
    return {
      ...BASE,
      kind: "register-failed",
      toggle: toggle(null),
      message: {
        text: withReason(LIBRARY_PUSH_COPY.registerFailed, activity.failureReason),
        tone: "danger",
      },
      retry: true,
    };
  }
  if (activity.failure === "unregister") {
    return {
      ...BASE,
      kind: "unregister-failed",
      toggle: toggle(null),
      message: { text: LIBRARY_PUSH_COPY.unregisterFailed, tone: "danger" },
      retry: true,
    };
  }
  if (record.registration === null) {
    // Momentary: the coordinator is reading the permission or about to ask iOS for a token.
    return { ...BASE, kind: "turning-on", toggle: toggle(LIBRARY_PUSH_COPY.turningOn) };
  }
  return {
    ...BASE,
    kind: "registered",
    toggle: toggle(
      LIBRARY_PUSH_COPY.registered(input.libraryLabel ?? LIBRARY_PUSH_COPY.theLibrary),
    ),
    message: keyMessage(input.status),
    test: { description: testDescription(input.test), loading: input.test.phase === "sending" },
  };
}
