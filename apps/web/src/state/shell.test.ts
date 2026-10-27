import {
  AVAILABLE_CONNECTION_STATE, // fork: client-computer
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  type SupervisorConnectionState, // fork: client-computer
} from "@t3tools/client-runtime/connection";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import { EMPTY_SHELL_STATE, type EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"; // fork: client-computer
import { describe, expect, it } from "vite-plus/test";

import {
  createAllEnvironmentProjectSnapshotsReadyAtom,
  createAllReachableShellsLiveAtom, // fork: client-computer
} from "./shell";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const OTHER = EnvironmentId.make("other"); // fork: client-computer

function shellState(status: EnvironmentShellState["status"]): EnvironmentShellState {
  return {
    ...EMPTY_SHELL_STATE,
    status,
    snapshot:
      status === "empty"
        ? Option.none()
        : Option.some({
            schemaVersion: 1,
            snapshotSequence: 1,
            projects: [],
            threads: [],
            archivedThreads: [],
          }),
    error: Option.none(),
  };
}

function catalogState(environmentIds: readonly EnvironmentId[]): EnvironmentCatalogState {
  return {
    isReady: true,
    entries: new Map(
      environmentIds.map((environmentId) => [
        environmentId,
        {
          target:
            environmentId === LOCAL
              ? new PrimaryConnectionTarget({
                  environmentId,
                  label: environmentId,
                  httpBaseUrl: `https://${environmentId}.example.test`,
                  wsBaseUrl: `wss://${environmentId}.example.test`,
                })
              : new BearerConnectionTarget({
                  environmentId,
                  connectionId: environmentId,
                  label: environmentId,
                }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
  };
}

function makeHarness(requiresPrimaryEnvironment = true) {
  const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
  const shells = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(shellState("empty")),
  );
  const ready = createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    requiresPrimaryEnvironment,
  });
  const registry = AtomRegistry.make();
  return { catalog, shells, ready, registry };
}

describe("project snapshot readiness", () => {
  it("does not clear a saved scope while the ready catalog is still empty", () => {
    const { catalog, ready, registry } = makeHarness();
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([]));
    expect(registry.get(ready)).toBe(false);
    registry.dispose();
  });

  it("waits for primary discovery even if a persisted remote is already live", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("allows a hosted client to load projects without a primary environment", () => {
    const { catalog, shells, ready, registry } = makeHarness(false);
    registry.set(catalog, catalogState([REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("waits for live snapshots through offline startup and reconnect", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("synchronizing"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);

    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("stops waiting for an environment only when it leaves the catalog", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([LOCAL]));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });
});

// fork: client-computer
function makeReachableHarness(input: {
  readonly requiresPrimaryEnvironment: boolean;
  readonly clientComputer: boolean;
}) {
  const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
  const shells = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<EnvironmentShellState>(shellState("empty")),
  );
  const connections = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make(AsyncResult.success<SupervisorConnectionState>(AVAILABLE_CONNECTION_STATE)),
  );
  const settled = createAllReachableShellsLiveAtom({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    connectionStateAtom: connections,
    ...input,
  });
  return { catalog, shells, connections, settled, registry: AtomRegistry.make() };
}

// fork: client-computer
describe("reachable shells settling", () => {
  const client = { requiresPrimaryEnvironment: false, clientComputer: true };

  it("settles a client once each saved computer is live or offline", () => {
    const { catalog, shells, connections, settled, registry } = makeReachableHarness(client);
    expect(registry.get(settled)).toBe(false);
    registry.set(catalog, catalogState([REMOTE, OTHER]));
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(settled)).toBe(false);
    registry.set(
      connections(OTHER),
      AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase: "offline" }),
    );
    expect(registry.get(settled)).toBe(true);
    registry.dispose();
  });

  it("settles a client that saves no computers once its catalog is ready", () => {
    const { catalog, settled, registry } = makeReachableHarness(client);
    expect(registry.get(settled)).toBe(false);
    registry.set(catalog, catalogState([]));
    expect(registry.get(settled)).toBe(true);
    registry.dispose();
  });

  it("keeps a host waiting for its primary and hosted web waiting on an empty catalog", () => {
    const host = makeReachableHarness({ requiresPrimaryEnvironment: true, clientComputer: false });
    host.registry.set(host.catalog, catalogState([REMOTE]));
    host.registry.set(host.shells(REMOTE), shellState("live"));
    expect(host.registry.get(host.settled)).toBe(false);
    host.registry.set(host.catalog, catalogState([LOCAL, REMOTE]));
    host.registry.set(host.shells(LOCAL), shellState("live"));
    expect(host.registry.get(host.settled)).toBe(true);
    host.registry.dispose();

    const hosted = makeReachableHarness({
      requiresPrimaryEnvironment: false,
      clientComputer: false,
    });
    hosted.registry.set(hosted.catalog, catalogState([]));
    expect(hosted.registry.get(hosted.settled)).toBe(false);
    hosted.registry.dispose();
  });
});
