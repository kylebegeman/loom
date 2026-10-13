import type {
  RelayClientEnvironmentRecord,
  RelayEnvironmentStatusResponse,
} from "@t3tools/contracts/relay";
import { relayComputerDisplayRecord } from "./computer-label.ts";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { PrimaryConnectionTarget, AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import {
  createEnvironmentPresentationAtoms,
  createEnvironmentSummaryAtoms,
} from "../state/presentation.ts";
import type { EnvironmentCatalogState } from "../state/connections.ts";

const id = EnvironmentId.make("rack-host");
const entry = {
  target: new PrimaryConnectionTarget({
    environmentId: id,
    label: "Local alias",
    httpBaseUrl: "https://rack.test",
    wsBaseUrl: "wss://rack.test",
  }),
  enabled: true,
  profile: Option.none(),
};
const config = (label: string, capable = true) =>
  ({
    environment: {
      environmentId: id,
      label,
      platform: { os: "linux", arch: "arm64" },
      serverVersion: "0.0.45",
      orchestrationProtocolVersion: 2,
      capabilities: { repositoryIdentity: true, loomFeatures: capable ? ["computer-naming"] : [] },
    },
    cwd: "/workspace",
  }) as unknown as ServerConfig;

function harness() {
  const catalog = Atom.make<EnvironmentCatalogState>({
    isReady: true,
    entries: new Map([[id, entry]]),
  });
  const current = Atom.make<ServerConfig | null>(config("Rack Mac"));
  const full = createEnvironmentPresentationAtoms({
    catalogValueAtom: catalog,
    stateAtom: () => Atom.make(AsyncResult.success(AVAILABLE_CONNECTION_STATE)),
    serverConfigValueAtom: () => current,
  });
  const summaries = createEnvironmentSummaryAtoms({
    catalogValueAtom: catalog,
    presentationAtom: full.presentationAtom,
  });
  return { current, ...summaries, registry: AtomRegistry.make() };
}

describe("computer label projection", () => {
  it("updates all shared identities and connection labels when a capable host is renamed", () => {
    const h = harness();
    try {
      const ids = h.registry.get(h.environmentIdsAtom);
      expect(h.registry.get(h.identitiesAtom)[0]?.label).toBe("Rack Mac");
      expect(h.registry.get(h.environmentsAtom)[0]?.environmentLabel).toBe("Rack Mac");
      h.registry.set(h.current, config("Orange Pi"));
      expect(h.registry.get(h.identitiesAtom)[0]?.label).toBe("Orange Pi");
      expect(h.registry.get(h.environmentsAtom)[0]?.environmentLabel).toBe("Orange Pi");
      expect(h.registry.get(h.environmentIdsAtom)).toBe(ids);
    } finally {
      h.registry.dispose();
    }
  });
  it("preserves local aliases on legacy hosts and falls back safely when no config exists", () => {
    const h = harness();
    try {
      h.registry.set(h.current, config("Legacy name", false));
      expect(h.registry.get(h.identitiesAtom)[0]?.label).toBe("Local alias");
      expect(h.registry.get(h.environmentsAtom)[0]?.environmentLabel).toBe("Local alias");
      h.registry.set(h.current, null);
      expect(h.registry.get(h.identitiesAtom)[0]?.label).toBe("Local alias");
    } finally {
      h.registry.dispose();
    }
  });
  it("keeps name consumers stable through unrelated provider/config refreshes", () => {
    const h = harness();
    try {
      const names = h.registry.get(h.identitiesAtom);
      const connections = h.registry.get(h.environmentsAtom);
      for (let index = 0; index < 20; index++) {
        h.registry.set(h.current, { ...config("Rack Mac"), cwd: `/workspace-${index}` });
        expect(h.registry.get(h.identitiesAtom)).toBe(names);
        expect(h.registry.get(h.environmentsAtom)).toBe(connections);
      }
    } finally {
      h.registry.dispose();
    }
  });
});

const relayEnvironment: RelayClientEnvironmentRecord = {
  environmentId: id,
  label: "Last linked name",
  linkedAt: "2026-10-13T00:00:00.000Z",
  endpoint: {
    httpBaseUrl: "https://rack.test",
    wsBaseUrl: "wss://rack.test",
    providerKind: "cloudflare_tunnel",
  },
};
const online = (label: string): RelayEnvironmentStatusResponse => ({
  environmentId: id,
  endpoint: relayEnvironment.endpoint,
  status: "online",
  checkedAt: "2026-10-13T00:00:00.000Z",
  descriptor: config(label).environment,
});

it("uses the verified live canonical name for account discovery before connecting", () => {
  const refreshed = relayComputerDisplayRecord(relayEnvironment, online("Orange Pi"));
  expect(refreshed.label).toBe("Orange Pi");
  expect(refreshed.endpoint).toBe(relayEnvironment.endpoint);
  expect(refreshed.environmentId).toBe(id);
  expect(relayComputerDisplayRecord(refreshed, online("Orange Pi"))).toBe(refreshed);
});
it("preserves the last verified discovery name through offline and legacy status", () => {
  const refreshed = relayComputerDisplayRecord(relayEnvironment, online("Orange Pi"));
  expect(relayComputerDisplayRecord(refreshed, { ...online("Wrong"), status: "offline" })).toBe(
    refreshed,
  );
  const legacy = { ...online("Legacy"), descriptor: config("Legacy", false).environment };
  expect(relayComputerDisplayRecord(refreshed, legacy)).toBe(refreshed);
  const otherHost = {
    ...online("Other"),
    descriptor: { ...config("Other").environment, environmentId: EnvironmentId.make("other-host") },
  };
  expect(relayComputerDisplayRecord(refreshed, otherHost)).toBe(refreshed);
});
