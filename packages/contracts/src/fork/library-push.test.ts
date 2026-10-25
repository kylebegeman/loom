import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  LIBRARY_PUSH_DEVICE_ROW_ID_LENGTH,
  LibraryPushDevice,
  LibraryPushError,
  LibraryPushErrorReason,
  LibraryPushKeySummary,
  LibraryPushRegisterRequest,
  LibraryPushState,
  LibraryPushStatus,
  LibraryPushStatusReason,
  LibraryPushTestRequest,
  LibraryPushUnregisterRequest,
  LOOM_IOS_PUSH_BUNDLE_IDS,
} from "./library-push.ts";

const decodeRegister = Schema.decodeUnknownSync(LibraryPushRegisterRequest);
const decodeRegisterResult = Schema.decodeUnknownResult(LibraryPushRegisterRequest);
const encodeRegister = Schema.encodeSync(LibraryPushRegisterRequest);
const decodeUnregister = Schema.decodeUnknownResult(LibraryPushUnregisterRequest);
const decodeTest = Schema.decodeUnknownResult(LibraryPushTestRequest);
const decodeError = Schema.decodeUnknownSync(LibraryPushError);
const encodeError = Schema.encodeSync(LibraryPushError);

const SENTINEL_TOKEN = "sentinel0token0abcdef0123456789";

const registration = {
  deviceId: "5f0c8d2e-1b7a-4c3e-9d6f-2a8b7c6d5e4f",
  label: "Kyle’s iPhone",
  platform: "ios",
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  appVersion: "1.4.0",
  token: SENTINEL_TOKEN,
};

describe("LibraryPushRegisterRequest", () => {
  it("accepts every Loom bundle in either APNs environment, with or without an app version", () => {
    for (const bundleId of LOOM_IOS_PUSH_BUNDLE_IDS) {
      for (const apsEnvironment of ["sandbox", "production"]) {
        expect(decodeRegister({ ...registration, bundleId, apsEnvironment }).bundleId).toBe(
          bundleId,
        );
      }
    }
    const { appVersion: _omitted, ...withoutVersion } = registration;
    expect(decodeRegister(withoutVersion).appVersion).toBeUndefined();
  });

  it("refuses other platforms, apps and oversized or control-character fields", () => {
    for (const change of [
      { platform: "android" },
      { bundleId: "com.example.other" },
      { bundleId: "com.kylebegeman.loom.widgets" },
      { apsEnvironment: "development" },
      { deviceId: "d".repeat(129) },
      { deviceId: " " },
      { label: "l".repeat(81) },
      { label: "Kyle\niPhone" },
      { appVersion: "v".repeat(65) },
      { token: 42 },
    ]) {
      expect(Result.isFailure(decodeRegisterResult({ ...registration, ...change }))).toBe(true);
    }
    expect(decodeRegister({ ...registration, deviceId: "d".repeat(128) }).deviceId).toHaveLength(
      128,
    );
    expect(decodeRegister({ ...registration, label: "l".repeat(80) }).label).toHaveLength(80);
  });

  it("holds the token redacted after decoding and restores it only on encode", () => {
    const request = decodeRegister(registration);
    expect(Redacted.isRedacted(request.token)).toBe(true);
    expect(Redacted.value(request.token)).toBe(SENTINEL_TOKEN);
    expect(JSON.stringify(request)).not.toContain(SENTINEL_TOKEN);
    expect(String(request.token)).not.toContain(SENTINEL_TOKEN);
    // The phone sends the request through this same schema, so encoding must yield the raw value.
    expect(encodeRegister(request).token).toBe(SENTINEL_TOKEN);
  });

  it("never echoes the token when another field fails to decode", () => {
    for (const change of [
      { label: "l".repeat(81) },
      { bundleId: "com.example.other" },
      { platform: "android" },
      { deviceId: "" },
    ]) {
      const result = decodeRegisterResult({ ...registration, ...change });
      if (!Result.isFailure(result)) throw new Error("expected a decode failure");
      // RpcServer answers a payload it cannot decode with this same issue text.
      expect(result.failure.message).not.toContain(SENTINEL_TOKEN);
    }
  });
});

describe("LibraryPushStatus", () => {
  const decodeStatus = Schema.decodeUnknownSync(LibraryPushStatus);
  const encodeStatus = Schema.encodeSync(LibraryPushStatus);
  // The status as clients released before `topics` decode it.
  const decodeOlderStatus = Schema.decodeUnknownSync(
    Schema.Struct({
      state: LibraryPushState,
      reason: Schema.NullOr(LibraryPushStatusReason),
      key: Schema.NullOr(LibraryPushKeySummary),
      devices: Schema.Array(LibraryPushDevice),
    }),
  );
  const device = {
    id: "A".repeat(LIBRARY_PUSH_DEVICE_ROW_ID_LENGTH),
    deviceId: registration.deviceId,
    label: registration.label,
    bundleId: "com.kylebegeman.loom",
    apsEnvironment: "production",
    appVersion: "1.4.0",
    registeredAt: "2026-10-24T12:00:00.000Z",
    refreshedAt: "2026-10-24T12:00:00.000Z",
    expiresAt: "2026-11-23T12:00:00.000Z",
    mine: true,
    lastDelivery: null,
  };
  const status = {
    state: "ready",
    reason: null,
    key: { teamId: "TEAM123456", keyId: "KEY1234567" },
    devices: [device],
  };

  it("reads a Library from before the served list as not saying", () => {
    const decoded = decodeStatus(status);
    expect(decoded.topics).toBeUndefined();
    expect("topics" in encodeStatus(decoded)).toBe(false);
  });

  it("keeps an empty list, which means the Library serves no build", () => {
    expect(decodeStatus({ ...status, topics: [] }).topics).toEqual([]);
  });

  it("keeps unknown builds in the served list and drops their device rows", () => {
    const future = { bundleId: "com.kylebegeman.loom.next", apsEnvironment: "staging" };
    const decoded = decodeStatus({
      ...status,
      topics: [{ bundleId: "com.kylebegeman.loom", apsEnvironment: "production" }, future],
      devices: [
        device,
        { ...device, id: "B".repeat(LIBRARY_PUSH_DEVICE_ROW_ID_LENGTH), ...future },
      ],
    });
    expect(decoded.topics).toEqual([
      { bundleId: "com.kylebegeman.loom", apsEnvironment: "production" },
      future,
    ]);
    // An unknown build's device row is dropped, so it cannot fail the whole status.
    expect(decoded.devices.map((row) => row.id)).toEqual([device.id]);
  });

  it("decodes on a client from before the served list", () => {
    const wire = encodeStatus(
      decodeStatus({
        ...status,
        topics: [{ bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" }],
      }),
    );
    expect(wire.topics).toEqual([
      { bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" },
    ]);
    const older = decodeOlderStatus(JSON.parse(JSON.stringify(wire)));
    expect(older).toEqual(status);
    expect("topics" in older).toBe(false);
  });
});

describe("row ids", () => {
  const rowId = "A".repeat(LIBRARY_PUSH_DEVICE_ROW_ID_LENGTH - 2) + "-_";

  it("addresses unregister and test by the opaque row id only", () => {
    expect(Result.isSuccess(decodeUnregister({ id: rowId }))).toBe(true);
    expect(Result.isSuccess(decodeTest({ id: rowId }))).toBe(true);
    expect(Result.isSuccess(decodeTest({}))).toBe(true);
    expect(Result.isFailure(decodeUnregister({}))).toBe(true);
    for (const id of [
      rowId.slice(1),
      `${rowId}A`,
      `${rowId.slice(1)}=`,
      `${rowId.slice(1)}/`,
      registration.deviceId,
    ]) {
      expect(Result.isFailure(decodeUnregister({ id }))).toBe(true);
      expect(Result.isFailure(decodeTest({ id }))).toBe(true);
    }
  });
});

describe("LibraryPushError", () => {
  it("has fixed, distinct text for every reason and puts only the reason on the wire", () => {
    const messages = new Set<string>();
    for (const reason of LibraryPushErrorReason.literals) {
      const error = new LibraryPushError({ reason });
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).not.toContain("—");
      messages.add(error.message);
      expect(encodeError(error)).toEqual({ _tag: "LibraryPushError", reason });
      expect(error.cause).toBeUndefined();
    }
    expect(messages.size).toBe(LibraryPushErrorReason.literals.length);
  });

  it("ignores a cause or text a peer adds to the wire form", () => {
    const error = decodeError({
      _tag: "LibraryPushError",
      reason: "storage",
      message: `failed for ${SENTINEL_TOKEN}`,
      cause: { path: `/3/device/${SENTINEL_TOKEN}` },
    });
    expect(error.message).toBe(new LibraryPushError({ reason: "storage" }).message);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(encodeError(error))).not.toContain(SENTINEL_TOKEN);
  });
});
