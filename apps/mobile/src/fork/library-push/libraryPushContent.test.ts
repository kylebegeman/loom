import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  LIBRARY_PUSH_COPY,
  libraryPushContent,
  type LibraryPushContent,
  type LibraryPushContentInput,
  type LibraryPushContentKind,
  type LibraryPushTestFailure,
} from "./libraryPushContent";
import {
  IDLE_ACTIVITY,
  NOT_READY_SNAPSHOT,
  type LibraryPushLibrary,
  type LibraryPushRecord,
  type LibraryPushRegistration,
} from "./libraryPushPlan";

const LIBRARY = EnvironmentId.make("env-library");
const ACCOUNT = { issuer: "https://id.example.test", subject: "kyle" };
const EM_DASH = String.fromCodePoint(0x2014);

const library = (overrides: Partial<LibraryPushLibrary> = {}): LibraryPushLibrary => ({
  id: LIBRARY,
  configured: true,
  connected: true,
  advertised: true,
  canChange: true,
  account: ACCOUNT,
  ...overrides,
});

const registration: LibraryPushRegistration = {
  id: "Row_id-0123456789abcde",
  registeredAt: 0,
  expiresAt: 1,
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  appVersion: "1.4.0",
  tokenSuffix: "abcd1234",
};

const record = (overrides: Partial<LibraryPushRecord> = {}): LibraryPushRecord => ({
  v: 1,
  libraryEnvironmentId: LIBRARY,
  account: ACCOUNT,
  optedIn: true,
  registration: null,
  refusal: null,
  ...overrides,
});

type Overrides = Partial<Omit<LibraryPushContentInput, "snapshot">> & {
  readonly chosen?: LibraryPushLibrary | null;
  readonly record?: LibraryPushRecord | null;
  readonly ready?: boolean;
};

const content = (overrides: Overrides = {}): LibraryPushContent => {
  const { chosen = library(), record: stored = record(), ready = true, ...rest } = overrides;
  return libraryPushContent({
    supported: true,
    snapshot: ready ? { ready, chosen, recorded: null, record: stored } : NOT_READY_SNAPSHOT,
    permission: "granted",
    activity: IDLE_ACTIVITY,
    status: { state: "ready", reason: null },
    served: null,
    libraryLabel: "Home Library",
    test: { phase: "idle" },
    ...rest,
  });
};

const registered = record({ registration });

describe("libraryPushContent", () => {
  it("explains the states that have no switch", () => {
    expect(content({ supported: false })).toMatchObject({
      kind: "unsupported",
      toggle: null,
      message: { text: LIBRARY_PUSH_COPY.unsupported },
    });
    expect(content({ ready: false })).toMatchObject({
      kind: "loading",
      toggle: null,
      message: { text: LIBRARY_PUSH_COPY.checking },
    });
    expect(content({ chosen: null })).toMatchObject({
      kind: "no-library",
      toggle: null,
      chooseLibrary: true,
      message: { text: LIBRARY_PUSH_COPY.chooseLibrary },
    });
  });

  it("starts off, per device, and offers turning on only where it can work", () => {
    expect(content({ record: null })).toMatchObject({
      kind: "available",
      toggle: { value: false, disabled: false, label: "Notifications from Home Library" },
    });
    expect(content({ record: null, chosen: library({ connected: false }) })).toMatchObject({
      kind: "unreachable",
      toggle: { value: false, disabled: true, description: LIBRARY_PUSH_COPY.unreachable },
    });
    expect(content({ record: null, chosen: library({ advertised: false }) })).toMatchObject({
      kind: "off",
      toggle: { value: false, disabled: true, description: LIBRARY_PUSH_COPY.off },
    });
    expect(content({ record: null, chosen: library({ canChange: false }) })).toMatchObject({
      kind: "not-allowed",
      toggle: { value: false, disabled: true, description: LIBRARY_PUSH_COPY.notAllowed },
    });
  });

  it("always lets an opted-in iPhone turn notifications off", () => {
    expect(content({ chosen: library({ connected: false }) })).toMatchObject({
      kind: "unreachable",
      toggle: { value: true, disabled: false, description: LIBRARY_PUSH_COPY.unreachableKept },
    });
    expect(content({ chosen: library({ advertised: false }) }).toggle?.disabled).toBe(false);
    expect(content({ chosen: library({ canChange: false }) }).toggle?.disabled).toBe(false);
  });

  it("says the Library does not serve this build, without offering to turn on or retry", () => {
    expect(content({ record: null, served: false })).toMatchObject({
      kind: "not-served",
      retry: false,
      toggle: { value: false, disabled: true, description: LIBRARY_PUSH_COPY.unsupportedApp },
    });
    const refused = record({ refusal: { reason: "unsupported-app", appVersion: "1.4.0" } });
    expect(content({ record: refused, served: false })).toMatchObject({
      kind: "not-served",
      retry: false,
      message: null,
      toggle: { value: true, disabled: false },
    });
    // A Library without the list leaves the refusal and its Try again as before.
    expect(content({ record: refused })).toMatchObject({ kind: "refused", retry: true });
    expect(content({ record: registered, served: true }).kind).toBe("registered");
  });

  it("treats another account's record on the same Library as off", () => {
    const theirs = record({ registration, account: { ...ACCOUNT, subject: "someone-else" } });
    expect(content({ record: theirs })).toMatchObject({
      kind: "available",
      toggle: { value: false },
    });
  });

  it("shows an opt-out the Library has not heard yet, and its failure", () => {
    const optedOut = record({ optedIn: false, registration });
    expect(content({ record: optedOut, chosen: library({ connected: false }) })).toMatchObject({
      kind: "pending-off",
      toggle: { value: false, disabled: false, description: LIBRARY_PUSH_COPY.pendingOff },
    });
    expect(
      content({ record: optedOut, activity: { ...IDLE_ACTIVITY, running: "unregister" } }),
    ).toMatchObject({
      kind: "turning-off",
      toggle: { value: false, disabled: true, description: LIBRARY_PUSH_COPY.turningOff },
    });
    expect(
      content({ record: optedOut, activity: { ...IDLE_ACTIVITY, failure: "unregister" } }),
    ).toMatchObject({
      kind: "unregister-failed",
      retry: true,
      message: { text: LIBRARY_PUSH_COPY.unregisterFailed, tone: "danger" },
    });
  });

  it("sends a denied permission to iOS Settings", () => {
    expect(content({ permission: "denied", record: registered })).toMatchObject({
      kind: "permission-denied",
      openSettings: true,
      toggle: { value: true, description: LIBRARY_PUSH_COPY.permissionDenied },
    });
  });

  it("shows registering while it runs, and each way it can fail", () => {
    expect(content({ activity: { ...IDLE_ACTIVITY, running: "register" } })).toMatchObject({
      kind: "turning-on",
      toggle: { value: true, disabled: true, description: LIBRARY_PUSH_COPY.turningOn },
    });
    expect(content({ activity: { ...IDLE_ACTIVITY, failure: "token" } })).toMatchObject({
      kind: "token-failed",
      retry: true,
      message: { text: LIBRARY_PUSH_COPY.tokenFailed },
    });
    expect(
      content({ activity: { running: null, failure: "register", failureReason: "storage" } }),
    ).toMatchObject({
      kind: "register-failed",
      retry: true,
      message: {
        text: `${LIBRARY_PUSH_COPY.registerFailed} The Library could not save its device list. Try again.`,
      },
    });
  });

  it("explains each refusal it backs off from", () => {
    const refused = (reason: NonNullable<LibraryPushRecord["refusal"]>["reason"]) =>
      content({ record: record({ refusal: { reason, appVersion: "1.4.0" } }) });
    expect(refused("identity-required")).toMatchObject({
      kind: "refused",
      retry: true,
      message: { text: LIBRARY_PUSH_COPY.identityRequired },
    });
    expect(refused("unsupported-app").message?.text).toBe(LIBRARY_PUSH_COPY.unsupportedApp);
    expect(refused("misconfigured").message?.text).toBe(LIBRARY_PUSH_COPY.keyUnusable);
    expect(refused("off").message?.text).toBe(LIBRARY_PUSH_COPY.off);
    expect(refused("limit").message?.text).toBe(
      `${LIBRARY_PUSH_COPY.registerFailed} The Library has reached its limit of registered devices. Remove one and try again.`,
    );
  });

  it("offers a test once registered, and reports the Library's key trouble", () => {
    expect(content({ record: registered })).toMatchObject({
      kind: "registered",
      toggle: { value: true, description: "On. Registered with Home Library." },
      message: null,
      test: { description: null, loading: false },
    });
    expect(
      content({ record: registered, status: { state: "failing", reason: "key-rejected" } }).message,
    ).toEqual({ text: LIBRARY_PUSH_COPY.keyRejected, tone: "danger" });
    expect(
      content({ record: registered, status: { state: "misconfigured", reason: "key-invalid" } })
        .message,
    ).toEqual({ text: LIBRARY_PUSH_COPY.keyUnusable, tone: "danger" });
    expect(content({ record: registered, test: { phase: "sending" } }).test).toEqual({
      description: LIBRARY_PUSH_COPY.testSending,
      loading: true,
    });
    expect(content({ record: registered, test: { phase: "sent" } }).test?.description).toBe(
      LIBRARY_PUSH_COPY.testSent,
    );
    expect(
      content({ record: registered, test: { phase: "failed", reason: "rate-limited" } }).test
        ?.description,
    ).toBe(
      `${LIBRARY_PUSH_COPY.testFailed} Wait a little before sending another test notification.`,
    );
  });

  it("says why a test did not reach this iPhone", () => {
    const failedTest = (reason: LibraryPushTestFailure | null) =>
      content({ record: registered, test: { phase: "failed", reason } }).test?.description;
    expect(failedTest("not-registered")).toBe(
      `${LIBRARY_PUSH_COPY.testFailed} ${LIBRARY_PUSH_COPY.testNotRegistered}`,
    );
    expect(failedTest("bad-token")).toBe(
      `${LIBRARY_PUSH_COPY.testFailed} ${LIBRARY_PUSH_COPY.testBadToken}`,
    );
    expect(failedTest("topic-disallowed")).toBe(
      `${LIBRARY_PUSH_COPY.testFailed} ${LIBRARY_PUSH_COPY.testTopicDisallowed}`,
    );
    expect(failedTest("other")).toBe(LIBRARY_PUSH_COPY.testFailed);
    expect(failedTest(null)).toBe(LIBRARY_PUSH_COPY.testFailed);
  });

  it("stays on while it refreshes a registration the Library already holds", () => {
    expect(
      content({ record: registered, activity: { ...IDLE_ACTIVITY, running: "register" } }),
    ).toMatchObject({
      kind: "registered",
      toggle: { value: true, disabled: false },
      test: { loading: false },
    });
  });

  it("names the Library generically when it has no label", () => {
    expect(content({ record: registered, libraryLabel: null }).toggle).toMatchObject({
      label: LIBRARY_PUSH_COPY.toggleLabel,
      description: "On. Registered with the Library.",
    });
  });

  it("covers every kind without an em dash in any copy", () => {
    const optedOut = record({ optedIn: false, registration });
    const cases: ReadonlyArray<Overrides> = [
      { supported: false },
      { ready: false },
      { chosen: null },
      { chosen: library({ connected: false }) },
      { record: optedOut, chosen: library({ connected: false }) },
      { chosen: library({ advertised: false }) },
      { chosen: library({ canChange: false }) },
      { served: false },
      { record: null },
      { activity: { ...IDLE_ACTIVITY, running: "register" } },
      { record: optedOut, activity: { ...IDLE_ACTIVITY, running: "unregister" } },
      { permission: "denied" },
      { record: record({ refusal: { reason: "limit", appVersion: null } }) },
      { activity: { ...IDLE_ACTIVITY, failure: "token" } },
      { activity: { running: null, failure: "register", failureReason: "invalid" } },
      { record: optedOut, activity: { ...IDLE_ACTIVITY, failure: "unregister" } },
      { record: registered, test: { phase: "failed", reason: "off" } },
    ];
    const kinds = new Set<LibraryPushContentKind>();
    const texts: Array<string> = [];
    for (const overrides of cases) {
      const view = content(overrides);
      kinds.add(view.kind);
      texts.push(
        view.footer,
        view.toggle?.label ?? "",
        view.toggle?.description ?? "",
        view.message?.text ?? "",
        view.test?.description ?? "",
      );
    }
    expect(kinds.size).toBe(17);
    for (const value of Object.values(LIBRARY_PUSH_COPY)) {
      texts.push(typeof value === "function" ? value("Home Library") : value);
    }
    expect(texts.filter((text) => text.includes(EM_DASH))).toEqual([]);
  });
});
