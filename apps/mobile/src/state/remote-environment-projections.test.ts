import type {
  EnvironmentPresentation,
  PreparedConnection,
} from "@t3tools/client-runtime/connection";
import {
  PrimaryConnectionTarget,
  BearerConnectionTarget,
  BearerConnectionProfile,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { ServerConfig } from "@t3tools/contracts";
import { EnvironmentId, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";

import { createRemoteEnvironmentProjectionAtoms } from "./remote-environment-projections";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("environment-2");

function target(environmentId: EnvironmentId, endpoint: string = environmentId) {
  return new PrimaryConnectionTarget({
    environmentId,
    label: `Environment ${environmentId}`,
    httpBaseUrl: `https://${endpoint}.example.test`,
    wsBaseUrl: `wss://${endpoint}.example.test`,
  });
}

function presentation(
  environmentId: EnvironmentId,
  endpoint: string = environmentId,
  serverConfig: ServerConfig | null = null,
): EnvironmentPresentation {
  return {
    entry: { target: target(environmentId, endpoint), profile: Option.none(), enabled: true },
    connection: { phase: "connected", error: null, traceId: null },
    serverConfig,
  };
}

function prepared(
  environmentId: EnvironmentId,
  endpoint: string,
  token: string,
): PreparedConnection {
  return {
    environmentId,
    label: `Environment ${environmentId}`,
    httpBaseUrl: `https://${endpoint}.example.test`,
    socketUrl: `wss://${endpoint}.example.test/ws?token=redacted`,
    httpAuthorization: { _tag: "Bearer", token },
    target: target(environmentId, endpoint),
  };
}

function makeHarness() {
  const presentationAtoms = Atom.family((environmentId: EnvironmentId) =>
    Atom.make<EnvironmentPresentation | null>(presentation(environmentId)),
  );
  const preparedConnectionAtoms = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<Option.Option<PreparedConnection>>(Option.none()),
  );
  const serverConfigAtoms = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<ServerConfig | null>(null),
  );
  const projections = createRemoteEnvironmentProjectionAtoms({
    presentationAtom: presentationAtoms,
    preparedConnectionAtom: preparedConnectionAtoms,
    serverConfigAtom: serverConfigAtoms,
  });

  return {
    registry: AtomRegistry.make(),
    presentationAtom: presentationAtoms,
    preparedConnectionAtom: preparedConnectionAtoms,
    serverConfigAtom: serverConfigAtoms,
    projections,
  };
}

describe("remote environment projections", () => {
  it("keeps the saved Identity host and account available after expiry and while another route is in use", () => {
    const harness = makeHarness();
    const identity = { issuer: "https://id.example.test", subject: "owner" };
    const identityTarget = new BearerConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "Computer",
      connectionId: "identity",
    });
    const profile = new BearerConnectionProfile({
      environmentId: ENVIRONMENT_ID,
      label: "Computer",
      connectionId: "identity",
      httpBaseUrl: "https://computer.tail.test",
      wsBaseUrl: "wss://computer.tail.test/ws",
      identity,
    });
    const initial = presentation(ENVIRONMENT_ID);
    harness.registry.set(harness.presentationAtom(ENVIRONMENT_ID), {
      ...initial,
      entry: { target: identityTarget, profile: Option.some(profile), enabled: true },
    });
    const atom = harness.projections.savedConnectionAtom(ENVIRONMENT_ID);
    expect(harness.registry.get(atom)).toMatchObject({
      identity,
      identityHttpBaseUrl: "https://computer.tail.test",
      bearerToken: null,
    });
    const relay = new RelayConnectionTarget({ environmentId: ENVIRONMENT_ID, label: "Computer" });
    harness.registry.set(
      harness.preparedConnectionAtom(ENVIRONMENT_ID),
      Option.some({
        ...prepared(ENVIRONMENT_ID, "relay", "unused"),
        target: relay,
        httpAuthorization: {
          _tag: "Dpop",
          accessToken: "relay-token",
          expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        },
      }),
    );
    expect(harness.registry.get(atom)).toMatchObject({
      identity,
      identityHttpBaseUrl: "https://computer.tail.test",
      relayManaged: true,
      httpBaseUrl: "https://relay.example.test",
      bearerToken: null,
    });
  });

  // fork: computer-naming - A host rename must update Home without replacing its route or credentials.
  it("refreshes the shared computer name while preserving credentials and older local aliases", () => {
    const harness = makeHarness();
    const initialPresentation = harness.registry.get(harness.presentationAtom(ENVIRONMENT_ID))!;
    harness.registry.set(
      harness.preparedConnectionAtom(ENVIRONMENT_ID),
      Option.some(prepared(ENVIRONMENT_ID, "paired", "paired-token")),
    );
    const savedAtom = harness.projections.savedConnectionAtom(ENVIRONMENT_ID);
    const initial = harness.registry.get(savedAtom);
    const descriptor = {
      environmentId: ENVIRONMENT_ID,
      label: "Office Mac",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.48",
      capabilities: { repositoryIdentity: false, loomFeatures: ["computer-naming"] },
    };
    const config: ServerConfig = {
      environment: descriptor,
      auth: {
        policy: "loopback-browser",
        bootstrapMethods: ["one-time-token"],
        sessionMethods: ["bearer-access-token"],
        sessionCookieName: "t3_session",
      },
      cwd: "/repo",
      keybindingsConfigPath: "/repo/keybindings.json",
      keybindings: [],
      issues: [],
      providers: [],
      availableEditors: [],
      settings: DEFAULT_SERVER_SETTINGS,
      observability: {
        logsDirectoryPath: "/repo/logs",
        localTracingEnabled: false,
        otlpTracesEnabled: false,
        otlpMetricsEnabled: false,
        otlpLogsEnabled: false,
      },
    };
    harness.registry.set(harness.presentationAtom(ENVIRONMENT_ID), {
      ...initialPresentation,
      serverConfig: config,
    });
    const renamed = harness.registry.get(savedAtom);
    expect(renamed).not.toBe(initial);
    expect(renamed).toMatchObject({
      environmentLabel: "Office Mac",
      bearerToken: "paired-token",
      httpBaseUrl: "https://paired.example.test",
    });
    harness.registry.set(harness.presentationAtom(ENVIRONMENT_ID), {
      ...initialPresentation,
      serverConfig: { ...config, cwd: "/changed" },
    });
    expect(harness.registry.get(savedAtom)).toBe(renamed);
    harness.registry.set(harness.presentationAtom(ENVIRONMENT_ID), {
      ...initialPresentation,
      serverConfig: {
        ...config,
        environment: { ...descriptor, capabilities: { repositoryIdentity: false } },
      },
    });
    expect(harness.registry.get(savedAtom)?.environmentLabel).toBe(initial?.environmentLabel);
  });
  it("shares each environment projection and invalidates only changed inputs", () => {
    const harness = makeHarness();
    const firstConsumer = Atom.make((get) =>
      get(harness.projections.savedConnectionAtom(ENVIRONMENT_ID)),
    );
    const secondConsumer = Atom.make((get) =>
      get(harness.projections.savedConnectionAtom(ENVIRONMENT_ID)),
    );
    const otherConsumer = Atom.make((get) =>
      get(harness.projections.savedConnectionAtom(OTHER_ENVIRONMENT_ID)),
    );
    const initial = harness.registry.get(firstConsumer);
    const otherInitial = harness.registry.get(otherConsumer);

    expect(harness.registry.get(secondConsumer)).toBe(initial);
    expect(initial).toMatchObject({
      environmentLabel: "Environment environment-1",
      pairingUrl: "https://environment-1.example.test",
      displayUrl: "https://environment-1.example.test",
      httpBaseUrl: "https://environment-1.example.test",
      wsBaseUrl: "wss://environment-1.example.test",
      bearerToken: null,
    });

    harness.registry.set(
      harness.preparedConnectionAtom(ENVIRONMENT_ID),
      Option.some(prepared(ENVIRONMENT_ID, "rotated", "rotated-token")),
    );
    const rotated = harness.registry.get(firstConsumer);

    expect(rotated).not.toBe(initial);
    expect(rotated).toMatchObject({
      httpBaseUrl: "https://rotated.example.test",
      wsBaseUrl: "wss://rotated.example.test",
      bearerToken: "rotated-token",
    });
    expect(harness.registry.get(secondConsumer)).toBe(rotated);
    expect(harness.registry.get(otherConsumer)).toBe(otherInitial);

    harness.registry.set(harness.preparedConnectionAtom(ENVIRONMENT_ID), Option.none());
    harness.registry.set(
      harness.presentationAtom(ENVIRONMENT_ID),
      presentation(ENVIRONMENT_ID, "catalog-updated"),
    );

    expect(harness.registry.get(firstConsumer)).toMatchObject({
      displayUrl: "https://catalog-updated.example.test",
      httpBaseUrl: "https://catalog-updated.example.test",
      wsBaseUrl: "wss://catalog-updated.example.test",
      bearerToken: null,
    });
  });
});
