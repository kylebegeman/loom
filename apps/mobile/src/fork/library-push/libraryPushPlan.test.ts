import { EnvironmentId } from "@t3tools/contracts";
import { LibraryPushError } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import {
  LIBRARY_PUSH_REFRESH_MS,
  LIBRARY_PUSH_ROW_SETTLE_MS,
  libraryPushRefusal,
  libraryPushServes,
  planLibraryPush,
  planLibraryPushRegistration,
  recordAfterClear,
  recordAfterRefusal,
  recordAfterRegister,
  recordAfterServed,
  recordAfterStatus,
  recordAfterUnregister,
  recordForOptIn,
  recordForRetry,
  type LibraryPushDeviceState,
  type LibraryPushLibrary,
  type LibraryPushPlanInput,
  type LibraryPushRecord,
  type LibraryPushRegistration,
} from "./libraryPushPlan";

const LIBRARY = EnvironmentId.make("env-library");
const OTHER_LIBRARY = EnvironmentId.make("env-other-library");
const ACCOUNT = { issuer: "https://id.example.test", subject: "kyle" };
const OTHER_ACCOUNT = { issuer: "https://id.example.test", subject: "someone-else" };
const ROW_ID = "Row_id-0123456789abcde";
const NOW = Date.UTC(2026, 9, 24, 12);
const DAY = 24 * 60 * 60 * 1000;

const library = (overrides: Partial<LibraryPushLibrary> = {}): LibraryPushLibrary => ({
  id: LIBRARY,
  configured: true,
  connected: true,
  advertised: true,
  canChange: true,
  account: ACCOUNT,
  ...overrides,
});

const registration = (
  overrides: Partial<LibraryPushRegistration> = {},
): LibraryPushRegistration => ({
  id: ROW_ID,
  registeredAt: NOW - 60_000,
  expiresAt: NOW + 30 * DAY,
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  appVersion: "1.4.0",
  tokenSuffix: "abcd1234",
  ...overrides,
});

const record = (overrides: Partial<LibraryPushRecord> = {}): LibraryPushRecord => ({
  v: 1,
  libraryEnvironmentId: LIBRARY,
  account: ACCOUNT,
  optedIn: true,
  registration: null,
  refusal: null,
  ...overrides,
});

const plan = (overrides: Partial<LibraryPushPlanInput> = {}) =>
  planLibraryPush({
    ready: true,
    chosen: library(),
    recorded: null,
    record: record(),
    supported: true,
    permission: "granted",
    appVersion: "1.4.0",
    ...overrides,
  });

const device = (overrides: Partial<LibraryPushDeviceState> = {}): LibraryPushDeviceState => ({
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  appVersion: "1.4.0",
  tokenSuffix: "abcd1234",
  ...overrides,
});

const unregisterStep = { kind: "unregister", libraryId: LIBRARY, id: ROW_ID } as const;

describe("planLibraryPush step one", () => {
  it("does nothing in an unsupported build, whatever the record says", () => {
    expect(plan({ supported: false })).toEqual({ kind: "none" });
    expect(
      plan({ supported: false, record: record({ optedIn: false, registration: registration() }) }),
    ).toEqual({ kind: "none" });
  });

  it("waits for preferences, the catalog and the record before deciding", () => {
    expect(plan({ ready: false })).toEqual({ kind: "none" });
    expect(plan({ record: null })).toEqual({ kind: "none" });
  });

  it("asks for a token only when opted in, allowed, connected and advertised", () => {
    expect(plan()).toEqual({ kind: "needsToken", libraryId: LIBRARY });
    expect(plan({ chosen: library({ connected: false }) })).toEqual({ kind: "none" });
    expect(plan({ chosen: library({ advertised: null }) })).toEqual({ kind: "none" });
    expect(plan({ permission: "unknown" })).toEqual({ kind: "none" });
    expect(plan({ permission: "denied" })).toEqual({ kind: "none" });
    expect(plan({ chosen: library({ canChange: false }) })).toEqual({ kind: "none" });
  });

  it("forgets the registration and keeps the opt-in when the Library stops advertising push", () => {
    const registered = record({ registration: registration() });
    const step = plan({ chosen: library({ advertised: false }), record: registered });
    expect(step).toEqual({ kind: "clearLocal", keepOptIn: true });
    if (step.kind !== "clearLocal") throw new Error("expected clearLocal");
    expect(recordAfterClear(registered, step)).toEqual(record());
    expect(plan({ chosen: library({ advertised: false }) })).toEqual({ kind: "none" });
  });

  it("unregisters after an opt-out or a denied permission while a row exists", () => {
    expect(plan({ record: record({ optedIn: false, registration: registration() }) })).toEqual(
      unregisterStep,
    );
    expect(
      plan({ permission: "denied", record: record({ registration: registration() }) }),
    ).toEqual(unregisterStep);
  });

  it("clears an opt-out that has no row left to remove", () => {
    expect(plan({ record: record({ optedIn: false }) })).toEqual({
      kind: "clearLocal",
      keepOptIn: false,
    });
  });

  it("keeps an opt-out made while disconnected and unregisters on the next connect", () => {
    const registered = record({ registration: registration() });
    const optedOut = recordForOptIn(registered, library(), false);
    expect(optedOut).toEqual({ ...registered, optedIn: false });
    expect(plan({ chosen: library({ connected: false }), record: optedOut })).toEqual({
      kind: "none",
    });
    expect(plan({ record: optedOut })).toEqual(unregisterStep);
  });

  it("unregisters the old Library after a Library change while it is connected", () => {
    const registered = record({ registration: registration() });
    const chosen = library({ id: OTHER_LIBRARY });
    expect(plan({ chosen, recorded: library(), record: registered })).toEqual(unregisterStep);
  });

  it("keeps the old Library's record while it is configured but unreachable", () => {
    const registered = record({ registration: registration() });
    const chosen = library({ id: OTHER_LIBRARY });
    expect(plan({ chosen, recorded: library({ connected: false }), record: registered })).toEqual({
      kind: "none",
    });
  });

  it("clears locally once the record's Library is no longer on this phone", () => {
    const registered = record({ registration: registration() });
    expect(
      plan({
        chosen: library({ id: OTHER_LIBRARY }),
        recorded: library({ configured: false, connected: false }),
        record: registered,
      }),
    ).toEqual({ kind: "clearLocal", keepOptIn: false });
    expect(plan({ chosen: null, recorded: null, record: registered })).toEqual({
      kind: "clearLocal",
      keepOptIn: false,
    });
  });

  it("resets the opt-in when the same Library now signs in as another account", () => {
    const registered = record({ registration: registration() });
    const step = plan({ chosen: library({ account: OTHER_ACCOUNT }), record: registered });
    expect(step).toEqual({ kind: "clearLocal", keepOptIn: false });
    if (step.kind !== "clearLocal") throw new Error("expected clearLocal");
    expect(recordAfterClear(registered, step)).toBeNull();
  });

  it("backs off after a refusal until the app version changes or the user retries", () => {
    const refused = record({ refusal: { reason: "limit", appVersion: "1.4.0" } });
    expect(plan({ record: refused })).toEqual({ kind: "none" });
    expect(plan({ record: refused, appVersion: "1.5.0" })).toEqual({
      kind: "needsToken",
      libraryId: LIBRARY,
    });
    expect(plan({ record: recordForRetry(refused) })).toEqual({
      kind: "needsToken",
      libraryId: LIBRARY,
    });
    expect(recordForOptIn(refused, library(), true)?.refusal).toBeNull();
  });

  it("checks the Library's status while it refuses this build, and only then", () => {
    const refused = record({ refusal: { reason: "unsupported-app", appVersion: "1.4.0" } });
    expect(plan({ record: refused })).toEqual({ kind: "checkServed", libraryId: LIBRARY });
    expect(plan({ record: refused, chosen: library({ connected: false }) })).toEqual({
      kind: "none",
    });
    expect(plan({ record: refused, permission: "denied" })).toEqual({ kind: "none" });
    expect(plan({ record: refused, appVersion: "1.5.0" })).toEqual({
      kind: "needsToken",
      libraryId: LIBRARY,
    });
  });

  it("forgets a refusal when the Library turns push off, so turning it back on starts fresh", () => {
    const refused = record({ refusal: { reason: "off", appVersion: "1.4.0" } });
    const step = plan({ chosen: library({ advertised: false }), record: refused });
    expect(step).toEqual({ kind: "clearLocal", keepOptIn: true });
    if (step.kind !== "clearLocal") throw new Error("expected clearLocal");
    expect(recordAfterClear(refused, step)).toEqual(record());
  });
});

describe("planLibraryPushRegistration step two", () => {
  it("leaves a fresh matching registration alone", () => {
    expect(planLibraryPushRegistration(registration(), device(), NOW)).toBe("none");
  });

  it("registers when nothing is registered or anything the Library holds changed", () => {
    expect(planLibraryPushRegistration(null, device(), NOW)).toBe("register");
    const changes: ReadonlyArray<Partial<LibraryPushDeviceState>> = [
      { tokenSuffix: "zzzz9999" },
      { appVersion: "1.5.0" },
      { appVersion: null },
      { bundleId: "com.kylebegeman.loom.preview" },
      { apsEnvironment: "sandbox" },
    ];
    for (const change of changes) {
      expect(planLibraryPushRegistration(registration(), device(change), NOW)).toBe("register");
    }
  });

  it("refreshes a registration a day old, or halfway to a short expiry", () => {
    const dayOld = registration({ registeredAt: NOW - LIBRARY_PUSH_REFRESH_MS });
    expect(planLibraryPushRegistration(dayOld, device(), NOW)).toBe("register");
    const short = registration({ registeredAt: NOW - 3 * 60 * 60 * 1000, expiresAt: NOW + 60_000 });
    expect(planLibraryPushRegistration(short, device(), NOW)).toBe("register");
  });
});

describe("record updates", () => {
  it("keeps the record when an unregister fails, so the next connect retries", () => {
    const optedOut = record({ optedIn: false, registration: registration() });
    expect(recordAfterUnregister(optedOut, unregisterStep, { kind: "failed" })).toBe(optedOut);
  });

  it("clears an opted-out record only after the Library answers", () => {
    const optedOut = record({ optedIn: false, registration: registration() });
    expect(recordAfterUnregister(optedOut, unregisterStep, { kind: "answered" })).toBeNull();
    const deniedButOptedIn = record({ registration: registration() });
    expect(recordAfterUnregister(deniedButOptedIn, unregisterStep, { kind: "answered" })).toEqual(
      record(),
    );
  });

  it("ignores an unregister answer for a row the record no longer holds", () => {
    const newer = record({ registration: registration({ id: "Newer_row-0123456789ab" }) });
    expect(recordAfterUnregister(newer, unregisterStep, { kind: "answered" })).toBe(newer);
  });

  it("drops a registration that finished after a move to another account or Library", () => {
    const planned = record();
    const moved = record({ account: OTHER_ACCOUNT });
    expect(recordAfterRegister(moved, planned, registration())).toBe(moved);
    const elsewhere = record({ libraryEnvironmentId: OTHER_LIBRARY });
    expect(recordAfterRefusal(elsewhere, planned, "limit", "1.4.0")).toBe(elsewhere);
  });

  it("records a registration that finished after an opt-out, so it is unregistered next", () => {
    const optedOut = record({ optedIn: false });
    const updated = recordAfterRegister(optedOut, record(), registration());
    expect(updated).toEqual({ ...optedOut, registration: registration() });
    expect(plan({ record: updated })).toEqual(unregisterStep);
  });

  it("registers again once the Library's status no longer lists this iPhone's row", () => {
    const registered = record({ registration: registration() });
    const settled = registration().registeredAt + LIBRARY_PUSH_ROW_SETTLE_MS;
    const missing = { devices: [{ id: "Other_row-0123456789ab" }], readAt: settled };
    const dropped = recordAfterStatus(registered, LIBRARY, missing);
    expect(dropped).toEqual(record());
    // Before, the fresh row skipped registering until its daily refresh.
    expect(planLibraryPushRegistration(registered.registration, device(), NOW)).toBe("none");
    expect(plan({ record: dropped })).toEqual({ kind: "needsToken", libraryId: LIBRARY });
    expect(planLibraryPushRegistration(dropped!.registration, device(), NOW)).toBe("register");
    // An opted-out record has nothing left to unregister.
    const optedOut = record({ optedIn: false, registration: registration() });
    expect(recordAfterStatus(optedOut, LIBRARY, missing)).toBeNull();
  });

  it("keeps the registration while the row is listed, settling, or another Library's", () => {
    const registered = record({ registration: registration() });
    const settled = registration().registeredAt + LIBRARY_PUSH_ROW_SETTLE_MS;
    expect(
      recordAfterStatus(registered, LIBRARY, { devices: [{ id: ROW_ID }], readAt: settled }),
    ).toBe(registered);
    // A read that started before the registration landed can arrive just after it.
    expect(recordAfterStatus(registered, LIBRARY, { devices: [], readAt: settled - 1 })).toBe(
      registered,
    );
    expect(recordAfterStatus(registered, OTHER_LIBRARY, { devices: [], readAt: settled })).toBe(
      registered,
    );
    expect(recordAfterStatus(null, LIBRARY, { devices: [], readAt: settled })).toBeNull();
  });

  it("starts a new account or Library from a fresh opt-in", () => {
    const old = record({ registration: registration(), account: OTHER_ACCOUNT });
    expect(recordForOptIn(old, library(), true)).toEqual(record());
    expect(recordForOptIn(old, library(), false)).toBe(old);
    expect(recordForOptIn(null, library(), false)).toBeNull();
  });
});

describe("the Library's served list", () => {
  const build = { bundleId: "com.kylebegeman.loom", apsEnvironment: "production" } as const;
  const devBuild = { bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" } as const;
  const future = { bundleId: "com.kylebegeman.loom.next", apsEnvironment: "production" };
  const held = { reason: "unsupported-app", appVersion: "1.4.0" } as const;

  it("matches bundle and environment together, and says nothing without a list", () => {
    expect(libraryPushServes(undefined, build)).toBeNull();
    expect(libraryPushServes([], build)).toBe(false);
    expect(libraryPushServes([devBuild, future], build)).toBe(false);
    expect(libraryPushServes([{ ...build, apsEnvironment: "sandbox" }], build)).toBe(false);
    expect(libraryPushServes([future, build], build)).toBe(true);
  });

  it("holds a build left out as refused, so the phone never registers for it", () => {
    const optedIn = record();
    const notServed = recordAfterServed(optedIn, LIBRARY, false, "1.4.0");
    expect(notServed).toEqual(record({ refusal: held }));
    expect(plan({ record: notServed })).toEqual({ kind: "checkServed", libraryId: LIBRARY });
    // Settled: the same answer again changes nothing, so it starts no further sync.
    expect(recordAfterServed(notServed, LIBRARY, false, "1.4.0")).toBe(notServed);
    // An update stays refused rather than registering to find out.
    const updated = recordAfterServed(notServed, LIBRARY, false, "1.5.0");
    expect(updated?.refusal).toEqual({ reason: "unsupported-app", appVersion: "1.5.0" });
    expect(plan({ record: updated, appVersion: "1.5.0" }).kind).toBe("checkServed");
    // Another refusal gives way, since no answer about this account matters until it is served.
    expect(
      recordAfterServed(record({ refusal: { ...held, reason: "limit" } }), LIBRARY, false, "1.4.0")
        ?.refusal,
    ).toEqual(held);
  });

  it("registers on its own once a later status lists this build", () => {
    const refused = record({ refusal: held });
    const lifted = recordAfterServed(refused, LIBRARY, true, "1.4.0");
    expect(lifted).toEqual(record());
    expect(plan({ record: lifted })).toEqual({ kind: "needsToken", libraryId: LIBRARY });
    // Refusals the served list says nothing about stay until the user retries.
    const limited = record({ refusal: { ...held, reason: "limit" } });
    expect(recordAfterServed(limited, LIBRARY, true, "1.4.0")).toBe(limited);
    const served = record();
    expect(recordAfterServed(served, LIBRARY, true, "1.4.0")).toBe(served);
  });

  it("keeps today's behavior for a Library without the list, an opt-out or another Library", () => {
    const refused = record({ refusal: held });
    expect(recordAfterServed(refused, LIBRARY, null, "1.4.0")).toBe(refused);
    const fresh = record();
    expect(recordAfterServed(fresh, LIBRARY, null, "1.4.0")).toBe(fresh);
    const optedOut = record({ optedIn: false, registration: registration() });
    expect(recordAfterServed(optedOut, LIBRARY, false, "1.4.0")).toBe(optedOut);
    expect(recordAfterServed(refused, OTHER_LIBRARY, true, "1.4.0")).toBe(refused);
    expect(recordAfterServed(null, LIBRARY, false, "1.4.0")).toBeNull();
  });
});

describe("libraryPushRefusal", () => {
  it("backs off only for refusals the same request would get again", () => {
    expect(libraryPushRefusal(new LibraryPushError({ reason: "limit" }))).toBe("limit");
    expect(libraryPushRefusal({ _tag: "LibraryPushError", reason: "identity-required" })).toBe(
      "identity-required",
    );
    expect(libraryPushRefusal(new LibraryPushError({ reason: "storage" }))).toBeNull();
    expect(libraryPushRefusal(new LibraryPushError({ reason: "rate-limited" }))).toBeNull();
    expect(libraryPushRefusal(new Error("socket closed"))).toBeNull();
  });
});
