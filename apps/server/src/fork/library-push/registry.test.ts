import { describe, expect, it } from "@effect/vitest";
import { LibraryPushDeviceRowId } from "@t3tools/contracts/fork";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  applyRegistration,
  applyUnregister,
  EMPTY_LIBRARY_PUSH_REGISTRY,
  LIBRARY_PUSH_ACCOUNT_DEVICE_LIMIT,
  LIBRARY_PUSH_REFRESH_AFTER_MS,
  LIBRARY_PUSH_TOTAL_DEVICE_LIMIT,
  type LibraryPushAccount,
  type LibraryPushPolicy,
  type LibraryPushRegistration,
  type LibraryPushRegistry,
  libraryPushRowId,
  pruneRegistry,
  removeDeadTokens,
} from "./registry.ts";

const ISSUER = "https://id.example.test";
const ALICE: LibraryPushAccount = { issuer: ISSUER, subject: "alice" };
const BOB: LibraryPushAccount = { issuer: ISSUER, subject: "bob" };
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const SUBJECTS = Array.from({ length: 60 }, (_, index) => `user-${index}`);

const policy = (nowMs = NOW, overrides: Partial<LibraryPushPolicy> = {}): LibraryPushPolicy => ({
  nowMs,
  issuer: ISSUER,
  allowedSubjects: ["alice", "bob", ...SUBJECTS],
  topics: [{ bundleId: "com.kylebegeman.loom", apsEnvironment: "production" }],
  ...overrides,
});

const tokenFor = (seed: number) => seed.toString(16).padStart(8, "0").repeat(8);

const registration = (
  account: LibraryPushAccount,
  deviceId: string,
  overrides: Partial<Omit<LibraryPushRegistration, "token">> & { readonly token?: string } = {},
): LibraryPushRegistration => ({
  account,
  deviceId,
  label: `${account.subject}'s ${deviceId}`,
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  appVersion: "1.0.0",
  ...overrides,
  token: Redacted.make(overrides.token ?? tokenFor(deviceId.length * 31 + account.subject.length)),
});

const register = (
  registry: LibraryPushRegistry,
  input: LibraryPushRegistration,
  at: LibraryPushPolicy = policy(),
) => {
  const outcome = applyRegistration(registry, input, at, TTL_SECONDS);
  if (outcome._tag !== "Changed") throw new Error(`expected a change, got ${outcome._tag}`);
  return outcome;
};

const isRowId = Schema.is(LibraryPushDeviceRowId);

const owners = (registry: LibraryPushRegistry) =>
  registry.devices.map((row) => `${row.subject}/${row.deviceId}`);

describe("library push registry", () => {
  it("derives a stable opaque row id per account and device", () => {
    const id = libraryPushRowId(ALICE, "phone");
    expect(isRowId(id)).toBe(true);
    expect(libraryPushRowId(ALICE, "phone")).toBe(id);
    expect(libraryPushRowId(BOB, "phone")).not.toBe(id);
    expect(
      libraryPushRowId({ issuer: "https://other.example.test", subject: "alice" }, "phone"),
    ).not.toBe(id);
    expect(id).not.toContain("phone");
  });

  it("writes nothing for an identical re-register within 12 hours", () => {
    const first = register(EMPTY_LIBRARY_PUSH_REGISTRY, registration(ALICE, "phone"));
    const again = applyRegistration(
      first.registry,
      registration(ALICE, "phone"),
      policy(NOW + LIBRARY_PUSH_REFRESH_AFTER_MS - 1),
      TTL_SECONDS,
    );
    expect(again._tag).toBe("Unchanged");
  });

  it("extends the expiry of an identical re-register after 12 hours", () => {
    const first = register(EMPTY_LIBRARY_PUSH_REGISTRY, registration(ALICE, "phone"));
    const later = NOW + LIBRARY_PUSH_REFRESH_AFTER_MS;
    const again = register(first.registry, registration(ALICE, "phone"), policy(later));
    expect(again.row.registeredAt).toBe(first.row.registeredAt);
    expect(Date.parse(again.row.refreshedAt)).toBe(later);
    expect(Date.parse(again.row.expiresAt)).toBe(later + TTL_SECONDS * 1000);
    expect(again.registry.devices).toHaveLength(1);
  });

  it("treats a changed label, app version or token as a change", () => {
    const first = register(EMPTY_LIBRARY_PUSH_REGISTRY, registration(ALICE, "phone"));
    for (const change of [{ label: "Renamed" }, { appVersion: "1.0.1" }, { token: tokenFor(99) }]) {
      expect(
        applyRegistration(
          first.registry,
          registration(ALICE, "phone", change),
          policy(),
          TTL_SECONDS,
        )._tag,
      ).toBe("Changed");
    }
  });

  it("moves a token to its latest registration, across accounts", () => {
    const shared = tokenFor(7);
    const alice = register(
      EMPTY_LIBRARY_PUSH_REGISTRY,
      registration(ALICE, "phone", { token: shared }),
    );
    const bob = register(alice.registry, registration(BOB, "phone", { token: shared }));
    expect(owners(bob.registry)).toEqual(["bob/phone"]);
    const other = register(bob.registry, registration(BOB, "tablet", { token: shared }));
    expect(owners(other.registry)).toEqual(["bob/tablet"]);
  });

  it("keeps one row per account when two accounts report the same device id", () => {
    const alice = register(
      EMPTY_LIBRARY_PUSH_REGISTRY,
      registration(ALICE, "phone", { token: tokenFor(1) }),
    );
    const both = register(alice.registry, registration(BOB, "phone", { token: tokenFor(2) }));
    expect(owners(both.registry)).toEqual(["alice/phone", "bob/phone"]);
    expect(new Set(both.registry.devices.map((row) => row.id)).size).toBe(2);
  });

  it("evicts the account's least recently refreshed device past 10", () => {
    let registry = EMPTY_LIBRARY_PUSH_REGISTRY;
    for (let index = 0; index < LIBRARY_PUSH_ACCOUNT_DEVICE_LIMIT; index++) {
      registry = register(
        registry,
        registration(ALICE, `device-${index}`, { token: tokenFor(100 + index) }),
        policy(NOW + index * HOUR),
      ).registry;
    }
    registry = register(registry, registration(BOB, "phone", { token: tokenFor(1) })).registry;
    // Refreshing device-0 makes device-1 the oldest.
    registry = register(
      registry,
      registration(ALICE, "device-0", { token: tokenFor(100), label: "Refreshed" }),
      policy(NOW + 20 * HOUR),
    ).registry;
    const next = register(
      registry,
      registration(ALICE, "device-new", { token: tokenFor(200) }),
      policy(NOW + 21 * HOUR),
    );
    const alice = next.registry.devices.filter((row) => row.subject === "alice");
    expect(alice).toHaveLength(LIBRARY_PUSH_ACCOUNT_DEVICE_LIMIT);
    expect(alice.map((row) => row.deviceId)).not.toContain("device-1");
    expect(alice.map((row) => row.deviceId)).toContain("device-0");
    expect(owners(next.registry)).toContain("bob/phone");
  });

  it("refuses a new device once the Library holds 50, but still refreshes existing ones", () => {
    let registry = EMPTY_LIBRARY_PUSH_REGISTRY;
    for (let index = 0; index < LIBRARY_PUSH_TOTAL_DEVICE_LIMIT; index++) {
      registry = register(
        registry,
        registration({ issuer: ISSUER, subject: SUBJECTS[index]! }, "phone", {
          token: tokenFor(1000 + index),
        }),
      ).registry;
    }
    expect(
      applyRegistration(
        registry,
        registration({ issuer: ISSUER, subject: SUBJECTS[50]! }, "phone", {
          token: tokenFor(9999),
        }),
        policy(),
        TTL_SECONDS,
      ),
    ).toEqual({ _tag: "Limit" });
    expect(
      applyRegistration(
        registry,
        registration({ issuer: ISSUER, subject: SUBJECTS[0]! }, "phone", {
          token: tokenFor(1000),
          label: "Renamed",
        }),
        policy(),
        TTL_SECONDS,
      )._tag,
    ).toBe("Changed");
  });

  it("drops rows past their expiry", () => {
    const registry = register(EMPTY_LIBRARY_PUSH_REGISTRY, registration(ALICE, "phone")).registry;
    expect(pruneRegistry(registry, policy(NOW + TTL_SECONDS * 1000 - 1)).changed).toBe(false);
    expect(pruneRegistry(registry, policy(NOW + TTL_SECONDS * 1000))).toEqual({
      registry: EMPTY_LIBRARY_PUSH_REGISTRY,
      changed: true,
    });
  });

  it("drops rows from another issuer, a removed subject or an unserved topic", () => {
    const registry = register(
      register(EMPTY_LIBRARY_PUSH_REGISTRY, registration(ALICE, "phone", { token: tokenFor(1) }))
        .registry,
      registration(BOB, "phone", { token: tokenFor(2) }),
    ).registry;
    expect(
      owners(pruneRegistry(registry, policy(NOW, { allowedSubjects: ["bob"] })).registry),
    ).toEqual(["bob/phone"]);
    expect(
      pruneRegistry(registry, policy(NOW, { issuer: "https://new.example.test" })).registry,
    ).toEqual(EMPTY_LIBRARY_PUSH_REGISTRY);
    expect(
      pruneRegistry(
        registry,
        policy(NOW, { topics: [{ bundleId: "com.kylebegeman.loom", apsEnvironment: "sandbox" }] }),
      ).registry,
    ).toEqual(EMPTY_LIBRARY_PUSH_REGISTRY);
  });

  it("removes only a row the scope can see", () => {
    const registry = register(
      register(EMPTY_LIBRARY_PUSH_REGISTRY, registration(ALICE, "phone", { token: tokenFor(1) }))
        .registry,
      registration(BOB, "phone", { token: tokenFor(2) }),
    ).registry;
    const aliceRow = libraryPushRowId(ALICE, "phone");
    expect(
      applyUnregister(registry, aliceRow, { _tag: "Account", account: BOB }, policy()),
    ).toMatchObject({
      removed: false,
      changed: false,
    });
    expect(applyUnregister(registry, aliceRow, { _tag: "None" }, policy()).removed).toBe(false);
    const operator = applyUnregister(registry, aliceRow, { _tag: "Operator" }, policy());
    expect(operator.removed).toBe(true);
    expect(owners(operator.registry)).toEqual(["bob/phone"]);
  });

  it("removes a dead token's row only while it still holds that token", () => {
    const first = register(
      EMPTY_LIBRARY_PUSH_REGISTRY,
      registration(ALICE, "phone", { token: tokenFor(1) }),
    );
    const rotated = register(first.registry, registration(ALICE, "phone", { token: tokenFor(2) }));
    expect(removeDeadTokens(rotated.registry, [first.row]).removed.size).toBe(0);
    const removed = removeDeadTokens(rotated.registry, [rotated.row]);
    expect([...removed.removed]).toEqual([rotated.row.id]);
    expect(removed.registry.devices).toEqual([]);
  });
});
