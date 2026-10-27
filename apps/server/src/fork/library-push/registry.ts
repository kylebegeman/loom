// @effect-diagnostics-next-line nodeBuiltinImport:off -- Row ids are a synchronous SHA-256 digest, which keeps these rules pure.
import * as NodeCrypto from "node:crypto";

import { IsoDateTime } from "@t3tools/contracts";
import {
  LIBRARY_PUSH_DEVICE_ROW_ID_LENGTH,
  LibraryPushApsEnvironment,
  LibraryPushAppVersion,
  LibraryPushBundleId,
  LibraryPushClientDeviceId,
  type LibraryPushDevice,
  LibraryPushDeviceLabel,
  LibraryPushDeviceRowId,
  type LibraryPushLastDelivery,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type { LibraryPushTopic } from "./config.ts";

export const LIBRARY_PUSH_ACCOUNT_DEVICE_LIMIT = 10;
export const LIBRARY_PUSH_TOTAL_DEVICE_LIMIT = 50;
/**
 * A phone re-registers about once a day. An identical registration younger than this writes
 * nothing; an older one moves `refreshedAt` and `expiresAt`, so a phone in use never expires.
 */
export const LIBRARY_PUSH_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

export const StoredLibraryPushDevice = Schema.Struct({
  id: LibraryPushDeviceRowId,
  issuer: Schema.String,
  subject: Schema.String,
  deviceId: LibraryPushClientDeviceId,
  label: LibraryPushDeviceLabel,
  bundleId: LibraryPushBundleId,
  apsEnvironment: LibraryPushApsEnvironment,
  appVersion: Schema.NullOr(LibraryPushAppVersion),
  /** Redacted in memory, so a logged or inspected row never shows it. The document holds it raw. */
  token: Schema.RedactedFromValue(Schema.String),
  registeredAt: IsoDateTime,
  refreshedAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type StoredLibraryPushDevice = typeof StoredLibraryPushDevice.Type;

export const LibraryPushRegistryDocument = Schema.Struct({
  version: Schema.Literal(1),
  devices: Schema.Array(StoredLibraryPushDevice),
});
export type LibraryPushRegistry = typeof LibraryPushRegistryDocument.Type;

export const EMPTY_LIBRARY_PUSH_REGISTRY: LibraryPushRegistry = { version: 1, devices: [] };

/** A Pocket ID account. It outlives Identity policy changes, which rename session subjects. */
export interface LibraryPushAccount {
  readonly issuer: string;
  readonly subject: string;
}

export type LibraryPushScope =
  | { readonly _tag: "Account"; readonly account: LibraryPushAccount }
  | { readonly _tag: "Operator" }
  | { readonly _tag: "None" };

/** What a row must still match to be sent to, listed, or kept. */
export interface LibraryPushPolicy {
  readonly nowMs: number;
  readonly issuer: string;
  readonly allowedSubjects: ReadonlyArray<string>;
  readonly topics: ReadonlyArray<LibraryPushTopic>;
}

/**
 * Deterministic, so a phone re-registering lands on its own row. The NUL separators cannot occur
 * inside the parts: the issuer and allowlist come from the environment and the device id refuses
 * control characters.
 */
export const libraryPushRowId = (account: LibraryPushAccount, deviceId: string) =>
  NodeCrypto.createHash("sha256")
    .update(`${account.issuer}\0${account.subject}\0${deviceId}`)
    .digest("base64url")
    .slice(0, LIBRARY_PUSH_DEVICE_ROW_ID_LENGTH);

export const isoAt = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const millisOf = (iso: string) => DateTime.makeUnsafe(iso).epochMilliseconds;

export const servesTopic = (
  topics: ReadonlyArray<LibraryPushTopic>,
  device: { readonly bundleId: string; readonly apsEnvironment: string },
) =>
  topics.some(
    (topic) => topic.bundleId === device.bundleId && topic.apsEnvironment === device.apsEnvironment,
  );

const ownsRow = (account: LibraryPushAccount, row: StoredLibraryPushDevice) =>
  row.issuer === account.issuer && row.subject === account.subject;

export const visibleTo = (scope: LibraryPushScope, row: StoredLibraryPushDevice) =>
  scope._tag === "Operator" || (scope._tag === "Account" && ownsRow(scope.account, row));

/**
 * Expired rows, rows from another issuer, rows whose subject left the allowlist and rows for a
 * topic the key no longer serves are never sent to, so they are never shown either.
 */
const isLive = (policy: LibraryPushPolicy, row: StoredLibraryPushDevice) =>
  millisOf(row.expiresAt) > policy.nowMs &&
  row.issuer === policy.issuer &&
  policy.allowedSubjects.includes(row.subject) &&
  servesTopic(policy.topics, row);

export const pruneRegistry = (registry: LibraryPushRegistry, policy: LibraryPushPolicy) => {
  const devices = registry.devices.filter((row) => isLive(policy, row));
  return devices.length === registry.devices.length
    ? { registry, changed: false }
    : { registry: { version: 1 as const, devices }, changed: true };
};

export const liveDevicesFor = (
  registry: LibraryPushRegistry,
  scope: LibraryPushScope,
  policy: LibraryPushPolicy,
) => registry.devices.filter((row) => isLive(policy, row) && visibleTo(scope, row));

const sameToken = (a: StoredLibraryPushDevice, b: StoredLibraryPushDevice) =>
  Redacted.value(a.token) === Redacted.value(b.token);

export const deviceView = (
  row: StoredLibraryPushDevice,
  scope: LibraryPushScope,
  lastDelivery: LibraryPushLastDelivery | undefined,
): LibraryPushDevice => ({
  id: row.id,
  deviceId: row.deviceId,
  label: row.label,
  bundleId: row.bundleId,
  apsEnvironment: row.apsEnvironment,
  appVersion: row.appVersion,
  registeredAt: row.registeredAt,
  refreshedAt: row.refreshedAt,
  expiresAt: row.expiresAt,
  mine: scope._tag === "Account" && ownsRow(scope.account, row),
  lastDelivery: lastDelivery ?? null,
});

export interface LibraryPushRegistration {
  readonly account: LibraryPushAccount;
  readonly deviceId: string;
  readonly label: string;
  readonly bundleId: LibraryPushBundleId;
  readonly apsEnvironment: LibraryPushApsEnvironment;
  readonly appVersion: string | null;
  /** Lower-case hex, already checked. */
  readonly token: Redacted.Redacted<string>;
}

export type LibraryPushRegisterOutcome =
  | { readonly _tag: "Unchanged"; readonly row: StoredLibraryPushDevice }
  | {
      readonly _tag: "Changed";
      readonly registry: LibraryPushRegistry;
      readonly row: StoredLibraryPushDevice;
    }
  | { readonly _tag: "Limit" };

/**
 * Upserts the account's device. A token held by any other row is dropped from it, across
 * accounts, so a reinstalled or re-signed-in phone stops receiving the earlier owner's pushes.
 */
export const applyRegistration = (
  registry: LibraryPushRegistry,
  registration: LibraryPushRegistration,
  policy: LibraryPushPolicy,
  ttlSeconds: number,
): LibraryPushRegisterOutcome => {
  const pruned = pruneRegistry(registry, policy);
  const id = libraryPushRowId(registration.account, registration.deviceId);
  const token = Redacted.value(registration.token);
  const existing = pruned.registry.devices.find((row) => row.id === id);
  const kept = pruned.registry.devices.filter(
    (row) => row.id !== id && Redacted.value(row.token) !== token,
  );
  const tokenHeldElsewhere =
    kept.length + (existing === undefined ? 0 : 1) !== pruned.registry.devices.length;
  if (
    existing !== undefined &&
    !pruned.changed &&
    !tokenHeldElsewhere &&
    Redacted.value(existing.token) === token &&
    existing.label === registration.label &&
    existing.bundleId === registration.bundleId &&
    existing.apsEnvironment === registration.apsEnvironment &&
    existing.appVersion === registration.appVersion &&
    policy.nowMs - millisOf(existing.refreshedAt) < LIBRARY_PUSH_REFRESH_AFTER_MS
  ) {
    return { _tag: "Unchanged", row: existing };
  }

  const now = isoAt(policy.nowMs);
  const row: StoredLibraryPushDevice = {
    id,
    issuer: registration.account.issuer,
    subject: registration.account.subject,
    deviceId: registration.deviceId,
    label: registration.label,
    bundleId: registration.bundleId,
    apsEnvironment: registration.apsEnvironment,
    appVersion: registration.appVersion,
    token: registration.token,
    registeredAt: existing?.registeredAt ?? now,
    refreshedAt: now,
    expiresAt: isoAt(policy.nowMs + ttlSeconds * 1000),
  };

  const accountRows = kept
    .filter((candidate) => ownsRow(registration.account, candidate))
    .toSorted((a, b) => millisOf(a.refreshedAt) - millisOf(b.refreshedAt));
  const evicted = new Set(
    accountRows
      .slice(0, Math.max(0, accountRows.length - LIBRARY_PUSH_ACCOUNT_DEVICE_LIMIT + 1))
      .map((candidate) => candidate.id),
  );
  const others = kept.filter((candidate) => !evicted.has(candidate.id));
  if (others.length >= LIBRARY_PUSH_TOTAL_DEVICE_LIMIT) return { _tag: "Limit" };

  const otherIds = new Set(others.map((candidate) => candidate.id));
  // An updated row keeps its place, so a device list does not reorder on every daily refresh.
  const devices =
    existing === undefined
      ? [...others, row]
      : pruned.registry.devices.flatMap((candidate) =>
          candidate.id === id ? [row] : otherIds.has(candidate.id) ? [candidate] : [],
        );
  return { _tag: "Changed", registry: { version: 1, devices }, row };
};

/** Removes the row only when the scope may see it; an unknown or foreign id removes nothing. */
export const applyUnregister = (
  registry: LibraryPushRegistry,
  id: string,
  scope: LibraryPushScope,
  policy: LibraryPushPolicy,
) => {
  const pruned = pruneRegistry(registry, policy);
  const target = pruned.registry.devices.find((row) => row.id === id && visibleTo(scope, row));
  if (target === undefined) return { ...pruned, removed: false };
  return {
    registry: {
      version: 1 as const,
      devices: pruned.registry.devices.filter((row) => row.id !== id),
    },
    changed: true,
    removed: true,
  };
};

/**
 * Drops rows Apple reported dead, but only while they still hold the token that was sent: a phone
 * that re-registered in the meantime keeps its new token.
 */
export const removeDeadTokens = (
  registry: LibraryPushRegistry,
  dead: ReadonlyArray<StoredLibraryPushDevice>,
) => {
  const devices = registry.devices.filter(
    (row) => !dead.some((sent) => sent.id === row.id && sameToken(sent, row)),
  );
  return devices.length === registry.devices.length
    ? { registry, removed: new Set<string>() }
    : {
        registry: { version: 1 as const, devices },
        removed: new Set(
          registry.devices.filter((row) => !devices.includes(row)).map((row) => row.id),
        ),
      };
};
