import { EnvironmentId, type OrchestrationV2ArchivedShellSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import {
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
} from "./archivedThreads.ts";
import { v2Now, v2Project, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

it("does not expose an archived snapshot failure message", () => {
  const environmentId = EnvironmentId.make("env-sensitive");
  const snapshotsAtom = createArchivedThreadSnapshotsAtomFamily<Error>({
    getSnapshotAtom: () =>
      Atom.make(
        AsyncResult.failure<OrchestrationV2ArchivedShellSnapshot, Error>(
          Cause.fail(new Error("credential=secret-value")),
        ),
      ),
    labelPrefix: "test:archived-thread-snapshots",
  });
  const registry = AtomRegistry.make();

  expect(registry.get(snapshotsAtom(makeArchivedThreadsEnvironmentKey([environmentId])))).toEqual({
    snapshots: [],
    error: "Failed to load archived threads.",
    isLoading: false,
  });

  registry.dispose();
});

const emptySnapshot: OrchestrationV2ArchivedShellSnapshot = {
  schemaVersion: 1,
  snapshotSequence: 0,
  projects: [],
  threads: [],
};
const archivedSnapshot: OrchestrationV2ArchivedShellSnapshot = {
  ...emptySnapshot,
  projects: [v2Project],
  threads: [{ ...v2ThreadShell, archivedAt: v2Now }],
};

it("settles an empty online archive without waiting forever for disconnected computers", () => {
  const online = EnvironmentId.make("env-online");
  const offline = ["env-offline-a", "env-offline-b", "env-offline-c"].map((id) =>
    EnvironmentId.make(id),
  );
  const snapshots = createArchivedThreadSnapshotsAtomFamily({
    getSnapshotAtom: (environmentId) =>
      Atom.make(
        environmentId === online
          ? AsyncResult.success(emptySnapshot)
          : AsyncResult.initial<OrchestrationV2ArchivedShellSnapshot>(true),
      ),
    getIsConnectedAtom: (environmentId) => Atom.make(environmentId === online),
    labelPrefix: "test:archive-offline",
  });
  const registry = AtomRegistry.make();

  try {
    const state = registry.get(snapshots(makeArchivedThreadsEnvironmentKey([online, ...offline])));
    expect(state.isLoading).toBe(false);
    expect(state.snapshots).toEqual([{ environmentId: online, snapshot: emptySnapshot }]);
    expect(state.error).toBe(
      "3 computers are not connected. Reconnect in Settings > Computers to see all archived threads.",
    );
  } finally {
    registry.dispose();
  }
});

it("reports a selected disconnected computer instead of an empty archive", () => {
  const environmentId = EnvironmentId.make("env-offline");
  const snapshots = createArchivedThreadSnapshotsAtomFamily({
    getSnapshotAtom: () =>
      Atom.make(AsyncResult.initial<OrchestrationV2ArchivedShellSnapshot>(true)),
    getIsConnectedAtom: () => Atom.make(false),
    labelPrefix: "test:archive-selected-offline",
  });
  const registry = AtomRegistry.make();

  try {
    expect(registry.get(snapshots(makeArchivedThreadsEnvironmentKey([environmentId])))).toEqual({
      snapshots: [],
      isLoading: false,
      error:
        "1 computer is not connected. Reconnect in Settings > Computers to see all archived threads.",
    });
  } finally {
    registry.dispose();
  }
});

it("retains available and cached archives through disconnect, reconnect and refresh", () => {
  const online = EnvironmentId.make("env-online");
  const reconnecting = EnvironmentId.make("env-reconnecting");
  const connected = Atom.make(false);
  const pending = Atom.make<AsyncResult.AsyncResult<OrchestrationV2ArchivedShellSnapshot, Error>>(
    AsyncResult.failure(Cause.fail(new Error("disconnected")), {
      previousSuccess: Option.some(AsyncResult.success(archivedSnapshot)),
      waiting: true,
    }),
  );
  const snapshots = createArchivedThreadSnapshotsAtomFamily({
    getSnapshotAtom: (environmentId) =>
      environmentId === online ? Atom.make(AsyncResult.success(emptySnapshot)) : pending,
    getIsConnectedAtom: (environmentId) => (environmentId === online ? Atom.make(true) : connected),
    labelPrefix: "test:archive-recovery",
  });
  const registry = AtomRegistry.make();
  const atom = snapshots(makeArchivedThreadsEnvironmentKey([online, reconnecting]));
  const release = registry.mount(atom);

  try {
    const available = [
      { environmentId: online, snapshot: emptySnapshot },
      { environmentId: reconnecting, snapshot: archivedSnapshot },
    ];
    expect(registry.get(atom)).toMatchObject({ snapshots: available, isLoading: false });
    expect(registry.get(atom).error).toContain("1 computer is not connected.");

    registry.set(pending, AsyncResult.waiting(AsyncResult.success(archivedSnapshot)));
    registry.set(connected, true);
    expect(registry.get(atom)).toEqual({
      snapshots: available,
      isLoading: true,
      error: null,
    });

    const refreshedSnapshot = { ...archivedSnapshot, snapshotSequence: 1 };
    registry.set(pending, AsyncResult.success(refreshedSnapshot));
    expect(registry.get(atom)).toEqual({
      snapshots: [available[0], { environmentId: reconnecting, snapshot: refreshedSnapshot }],
      isLoading: false,
      error: null,
    });

    registry.set(connected, false);
    expect(registry.get(atom)).toMatchObject({
      snapshots: [available[0], { environmentId: reconnecting, snapshot: refreshedSnapshot }],
      isLoading: false,
    });
    expect(registry.get(atom).error).toContain("1 computer is not connected.");
  } finally {
    release();
    registry.dispose();
  }
});

it("keeps loading connected computers while reporting disconnected ones", () => {
  const online = EnvironmentId.make("env-online");
  const offline = EnvironmentId.make("env-offline");
  const snapshots = createArchivedThreadSnapshotsAtomFamily({
    getSnapshotAtom: () =>
      Atom.make(AsyncResult.initial<OrchestrationV2ArchivedShellSnapshot>(true)),
    getIsConnectedAtom: (environmentId) => Atom.make(environmentId === online),
    labelPrefix: "test:archive-partial-loading",
  });
  const registry = AtomRegistry.make();

  try {
    const state = registry.get(snapshots(makeArchivedThreadsEnvironmentKey([online, offline])));
    expect(state.isLoading).toBe(true);
    expect(state.error).toContain("1 computer is not connected.");
  } finally {
    registry.dispose();
  }
});
