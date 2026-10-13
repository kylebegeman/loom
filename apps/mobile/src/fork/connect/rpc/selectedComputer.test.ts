import { beforeEach, vi } from "vite-plus/test";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import {
  EnvironmentId,
  type EnvironmentCloudLinkStateResult,
  type RelayClientStatus,
  type RelayClientInstallProgressEvent,
} from "@t3tools/contracts";
import { RelayMobileClientId } from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";

import * as MobileStorage from "../../../persistence/mobile-storage";
import { linkEnvironmentToCloud } from "../../../features/cloud/linkEnvironment";
import {
  getSelectedComputerConnectState,
  linkSelectedComputer,
  unlinkSelectedComputer,
  type SelectedComputerTarget,
} from "./selectedComputer";

vi.mock("../../../features/cloud/linkEnvironment", () => ({
  linkEnvironmentToCloud: vi.fn(() => Effect.void),
}));
vi.mock("expo-device", () => ({
  deviceType: 1,
  DeviceType: { PHONE: 1 },
  osVersion: "18",
  modelName: "iPhone",
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({}));

const id = EnvironmentId.make("selected-fixture");
const target: SelectedComputerTarget = {
  environmentId: id,
  connection: {
    environmentId: id,
    environmentLabel: "Fixture",
    pairingUrl: "http://127.0.0.1:16516/",
    displayUrl: "http://127.0.0.1:16516/",
    httpBaseUrl: "http://127.0.0.1:16516/",
    wsBaseUrl: "ws://127.0.0.1:16516/ws",
    bearerToken: "fixture-bearer",
  },
  canConfigure: () => true,
};
const account = { accountId: "user_fixture", clerkToken: "fixture-clerk", isCurrent: () => true };
const descriptor = {
  environmentId: id,
  label: "Fixture",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.49",
  capabilities: {},
};
const unlinked = {
  linked: false,
  cloudUserId: null,
  relayUrl: null,
  relayIssuer: null,
  publishAgentActivity: false,
};
const linked = {
  ...unlinked,
  linked: true,
  cloudUserId: account.accountId,
  relayUrl: "https://relay.example.test",
  managedTunnelActive: true,
};
let state: EnvironmentCloudLinkStateResult = unlinked;
let registered = false;
let actualId = id;
let failRelayUnlink = false;
let allowed = true;
const available: RelayClientStatus = {
  status: "available",
  executablePath: "/fixture/cloudflared",
  source: "path",
  version: "2026.10.0",
};
let helperStatus: RelayClientStatus = available;
let installEvents: RelayClientInstallProgressEvent[] = [];
let onPrepare = () => {};
let onInstall = () => {};
let onReadState = () => {};
const requests: Array<{ url: string; method: string }> = [];
const rpcIds: EnvironmentId[] = [];

function testLayer() {
  const http = layerRemoteHttpClient(async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/.well-known/t3/environment"))
      return Response.json({ ...descriptor, environmentId: actualId });
    if (url.endsWith("/api/connect/link-state")) {
      onReadState();
      return Response.json(state);
    }
    if (url.endsWith("/api/connect/unlink")) {
      state = unlinked;
      return Response.json({ ok: true, endpointRuntimeStatus: { status: "disabled" } });
    }
    if (url.endsWith("/v1/environments"))
      return Response.json({
        environments: registered
          ? [
              {
                environmentId: id,
                label: "Fixture",
                endpoint: {
                  providerKind: "cloudflare_tunnel",
                  httpBaseUrl: "https://fixture.example.test",
                  wsBaseUrl: "wss://fixture.example.test/ws",
                },
                linkedAt: "2026-10-13T00:00:00Z",
              },
            ]
          : [],
      });
    if (url.endsWith(`/v1/client/environment-links/${id}`)) {
      if (failRelayUnlink)
        return Response.json(
          {
            _tag: "RelayAuthInvalidError",
            code: "auth_invalid",
            reason: "invalid_bearer",
            traceId: "fixture-trace",
          },
          { status: 401 },
        );
      registered = false;
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected fixture request ${url}`);
  });
  // This selected-host service only uses these two registry operations. Unrelated methods are not exercised.
  const registry = {
    run: (environmentId: EnvironmentId) => {
      rpcIds.push(environmentId);
      return Effect.sync(() => {
        onPrepare();
        return helperStatus;
      });
    },
    runStream: (environmentId: EnvironmentId) => {
      rpcIds.push(environmentId);
      return Stream.fromIterable(installEvents).pipe(Stream.tap(() => Effect.sync(onInstall)));
    },
  } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"];
  const dpop = Layer.succeed(ManagedRelay.ManagedRelayDpopSigner, {
    thumbprint: Effect.succeed("fixture-key"),
    createProof: () => Effect.succeed("fixture-proof"),
  });
  return Layer.mergeAll(
    http,
    Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, registry),
    Layer.succeed(
      MobileStorage.MobileStorage,
      MobileStorage.MobileStorage.of({
        loadSavedConnections: Effect.succeed([]),
        saveConnection: () => Effect.void,
        clearSavedConnection: () => Effect.void,
        loadOrCreateAgentAwarenessDeviceId: Effect.succeed("fixture-device"),
        loadAgentAwarenessDeviceId: Effect.succeed("fixture-device"),
        loadAgentAwarenessRegistrationRecord: Effect.succeed(null),
        saveAgentAwarenessRegistrationRecord: () => Effect.void,
        clearAgentAwarenessRegistrationRecord: Effect.void,
        loadRecentThreadShortcuts: Effect.succeed([]),
        saveRecentThreadShortcuts: () => Effect.void,
      }),
    ),
    ManagedRelay.layer({
      relayUrl: "https://relay.example.test",
      clientId: RelayMobileClientId,
    }).pipe(Layer.provideMerge(dpop), Layer.provide(http)),
  );
}
const withServices = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | HttpClient.HttpClient
    | ManagedRelay.ManagedRelayClient
    | EnvironmentRegistry.EnvironmentRegistry
    | MobileStorage.MobileStorage
  >,
) => effect.pipe(Effect.provide(testLayer()));

beforeEach(() => {
  state = unlinked;
  registered = false;
  actualId = id;
  failRelayUnlink = false;
  allowed = true;
  helperStatus = available;
  installEvents = [];
  onPrepare = () => {};
  onInstall = () => {};
  onReadState = () => {};
  requests.length = 0;
  rpcIds.length = 0;
  vi.mocked(linkEnvironmentToCloud).mockClear();
});

describe("selected computer Connect management", () => {
  it.effect("links only the immutable selected host with delivery preferences off", () =>
    Effect.gen(function* () {
      yield* withServices(linkSelectedComputer(target, account));
      expect(rpcIds).toEqual([id]);
      expect(linkEnvironmentToCloud).toHaveBeenCalledExactlyOnceWith({
        connection: target.connection,
        clerkToken: account.clerkToken,
        notificationsEnabled: false,
        liveActivitiesEnabled: false,
        canContinue: expect.any(Function),
      });
    }),
  );
  it.effect("does not rewrite an already linked host's delivery settings", () =>
    Effect.gen(function* () {
      state = linked;
      yield* withServices(linkSelectedComputer(target, account));
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
      expect(rpcIds).toEqual([]);
    }),
  );
  it.effect("rejects wrong, relay-only and unauthorized selections before any side effects", () =>
    Effect.gen(function* () {
      for (const invalid of [
        { ...target, canConfigure: () => false },
        { ...target, connection: null },
        {
          ...target,
          connection: { ...target.connection!, environmentId: EnvironmentId.make("other") },
        },
        {
          ...target,
          connection: {
            ...target.connection!,
            bearerToken: null,
            authenticationMethod: "dpop" as const,
          },
        },
      ]) {
        yield* withServices(linkSelectedComputer(invalid, account)).pipe(Effect.flip);
      }
      expect(requests).toEqual([]);
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
    }),
  );
  it.effect("verifies the live descriptor before reading or mutating host state", () =>
    Effect.gen(function* () {
      actualId = EnvironmentId.make("production-host");
      const error = yield* withServices(getSelectedComputerConnectState(target)).pipe(Effect.flip);
      expect(error).toMatchObject({
        message:
          "This address now belongs to a different computer. Pair the selected computer again.",
      });
      expect(requests.map((entry) => entry.method)).toEqual(["GET"]);
    }),
  );
  it.effect("requires the current signed-in account and respects another host owner", () =>
    Effect.gen(function* () {
      yield* withServices(
        linkSelectedComputer(target, { ...account, isCurrent: () => false }),
      ).pipe(Effect.flip);
      expect(requests).toEqual([]);
      state = { ...linked, cloudUserId: "different-account" };
      yield* withServices(unlinkSelectedComputer(target, account)).pipe(Effect.flip);
      expect(requests.every((entry) => entry.method === "GET")).toBe(true);
    }),
  );
  it.effect("requires cleanup of a stale account record before relinking", () =>
    Effect.gen(function* () {
      registered = true;
      const error = yield* withServices(linkSelectedComputer(target, account)).pipe(Effect.flip);
      expect(error).toMatchObject({ reason: "previous-link" });
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
    }),
  );
  it.effect("rechecks grants after asynchronous helper preparation", () =>
    Effect.gen(function* () {
      const changed = {
        ...target,
        canConfigure: () => {
          const permitted = allowed;
          allowed = false;
          return permitted;
        },
      };
      yield* withServices(linkSelectedComputer(changed, account)).pipe(Effect.flip);
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
    }),
  );
  it.effect("installs a missing tunnel helper before linking only the selected host", () =>
    Effect.gen(function* () {
      helperStatus = { status: "missing", version: "2026.10.0" };
      installEvents = [
        { type: "progress", stage: "downloading" },
        { type: "complete", status: available },
      ];
      yield* withServices(linkSelectedComputer(target, account));
      expect(rpcIds).toEqual([id, id]);
      expect(linkEnvironmentToCloud).toHaveBeenCalledTimes(1);
    }),
  );
  it.effect("rejects unsupported or incomplete helper installations without linking", () =>
    Effect.gen(function* () {
      helperStatus = {
        status: "unsupported",
        platform: "fixture",
        arch: "unsupported",
        version: "2026.10.0",
      };
      yield* withServices(linkSelectedComputer(target, account)).pipe(Effect.flip);
      expect(rpcIds).toEqual([id]);
      helperStatus = { status: "missing", version: "2026.10.0" };
      for (const events of [
        [],
        [{ type: "progress" as const, stage: "downloading" as const }],
        [{ type: "complete" as const, status: helperStatus }],
      ]) {
        installEvents = events;
        yield* withServices(linkSelectedComputer(target, account)).pipe(Effect.flip);
      }
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
    }),
  );
  it.effect("stops linking when permission or account changes during helper installation", () =>
    Effect.gen(function* () {
      helperStatus = { status: "missing", version: "2026.10.0" };
      installEvents = [{ type: "complete", status: available }];
      onInstall = () => {
        allowed = false;
      };
      yield* withServices(
        linkSelectedComputer({ ...target, canConfigure: () => allowed }, account),
      ).pipe(Effect.flip);
      allowed = true;
      let current = true;
      onInstall = () => {
        current = false;
      };
      yield* withServices(
        linkSelectedComputer(target, { ...account, isCurrent: () => current }),
      ).pipe(Effect.flip);
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
    }),
  );
  it.effect("preserves a matching link completed while the tunnel helper was prepared", () =>
    Effect.gen(function* () {
      onPrepare = () => {
        state = linked;
      };
      yield* withServices(linkSelectedComputer(target, account));
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
    }),
  );
  it.effect("rejects another owner or incomplete account record created during preparation", () =>
    Effect.gen(function* () {
      onPrepare = () => {
        state = { ...linked, cloudUserId: "different-account" };
      };
      yield* withServices(linkSelectedComputer(target, account)).pipe(Effect.flip);
      state = unlinked;
      onPrepare = () => {
        registered = true;
      };
      const error = yield* withServices(linkSelectedComputer(target, account)).pipe(Effect.flip);
      expect(error).toMatchObject({ reason: "previous-link" });
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
    }),
  );
  it.effect("rechecks current account before stopping the selected host", () =>
    Effect.gen(function* () {
      state = linked;
      let current = true;
      onReadState = () => {
        current = false;
      };
      yield* withServices(
        unlinkSelectedComputer(target, { ...account, isCurrent: () => current }),
      ).pipe(Effect.flip);
      expect(requests.every((entry) => entry.method === "GET")).toBe(true);
    }),
  );
  it.effect("stops the selected host before revoking only its account link", () =>
    Effect.gen(function* () {
      state = linked;
      registered = true;
      yield* withServices(unlinkSelectedComputer(target, account));
      expect(requests.filter((entry) => entry.method !== "GET")).toEqual([
        { url: "http://127.0.0.1:16516/api/connect/unlink", method: "POST" },
        { url: `https://relay.example.test/v1/client/environment-links/${id}`, method: "DELETE" },
      ]);
      expect(registered).toBe(false);
      expect(state.linked).toBe(false);
    }),
  );
  it.effect("reports a failed relay cleanup and allows an idempotent retry", () =>
    Effect.gen(function* () {
      state = linked;
      registered = true;
      failRelayUnlink = true;
      yield* withServices(unlinkSelectedComputer(target, account)).pipe(Effect.flip);
      expect(state.linked).toBe(false);
      expect(registered).toBe(true);
      failRelayUnlink = false;
      yield* withServices(unlinkSelectedComputer(target, account));
      expect(registered).toBe(false);
    }),
  );
});
