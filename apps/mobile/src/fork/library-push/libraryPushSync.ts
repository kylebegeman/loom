import { createLibraryPushAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  executeAtomQuery,
  runAtomCommand,
  settleAsyncResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_PUSH_FEATURE,
  type LibraryPushDeviceRowId,
  type LibraryPushErrorReason,
  type LibraryPushStatus,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";

import { environmentCatalog } from "../../connection/catalog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { requestAgentNotificationPermission } from "../../features/agent-awareness/notificationPermissions";
import { runtime } from "../../lib/runtime";
import { loadOrCreateAgentAwarenessDeviceId } from "../../persistence/imperative";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { mobilePreferencesAtom } from "../../state/preferences";
import {
  currentLibraryPushBuild,
  libraryPushDeviceLabel,
  type LibraryPushBuild,
} from "./libraryPushBuild";
import {
  IDLE_ACTIVITY,
  LIBRARY_PUSH_REFRESH_MS,
  LIBRARY_PUSH_ROW_SETTLE_MS,
  NOT_READY_SNAPSHOT,
  libraryPushErrorReason,
  libraryPushRefusal,
  planLibraryPush,
  planLibraryPushRegistration,
  recordAfterClear,
  recordAfterRefusal,
  recordAfterRegister,
  recordAfterStatus,
  recordAfterUnregister,
  recordForOptIn,
  recordForRetry,
  sameLibraryPushSnapshot,
  tokenSuffix,
  type LibraryPushActivity,
  type LibraryPushLibrary,
  type LibraryPushPermission,
  type LibraryPushRecord,
  type LibraryPushSnapshot,
  type LibraryPushStep,
} from "./libraryPushPlan";
import {
  libraryPushRecordAtom,
  loadLibraryPushRecord,
  updateLibraryPushRecord,
} from "./libraryPushStore";

export const libraryPush = createLibraryPushAtoms(connectionAtomRuntime);

export const libraryPushPermissionAtom = Atom.make<LibraryPushPermission>("unknown").pipe(
  Atom.keepAlive,
  Atom.withLabel("loom:library-push:permission"),
);

export const libraryPushActivityAtom = Atom.make<LibraryPushActivity>(IDLE_ACTIVITY).pipe(
  Atom.keepAlive,
  Atom.withLabel("loom:library-push:activity"),
);

function libraryView(get: Atom.AtomContext, id: EnvironmentId): LibraryPushLibrary {
  const presentation = get(environmentPresentations.presentationAtom(id));
  if (presentation === null)
    return {
      id,
      configured: false,
      connected: false,
      advertised: null,
      canChange: false,
      account: null,
    };
  const profile = Option.getOrNull(presentation.entry.profile);
  const identity = profile?._tag === "BearerConnectionProfile" ? profile.identity : undefined;
  return {
    id,
    configured: true,
    connected: presentation.entry.enabled && presentation.connection.phase === "connected",
    advertised:
      presentation.serverConfig === null
        ? null
        : supportsLoomFeature(
            presentation.serverConfig.environment.capabilities,
            LIBRARY_PUSH_FEATURE,
          ),
    canChange: get(libraryPush.register.permissionAtom(id)),
    account: identity === undefined ? null : { issuer: identity.issuer, subject: identity.subject },
  };
}

/**
 * Everything a sync step depends on except permission, which changes on its own. The equality
 * keeps thread and provider traffic on the Library's connection from waking the coordinator.
 */
export const libraryPushSnapshotAtom = Atom.make((get): LibraryPushSnapshot => {
  const preferences = get(mobilePreferencesAtom);
  const stored = get(libraryPushRecordAtom);
  if (!AsyncResult.isSuccess(preferences) || !stored.loaded) return NOT_READY_SNAPSHOT;
  if (!get(environmentCatalog.catalogValueAtom).isReady) return NOT_READY_SNAPSHOT;
  const chosenId = preferences.value["loom.library.authorityEnvironmentId"];
  const chosen = chosenId ? libraryView(get, EnvironmentId.make(chosenId)) : null;
  const record = stored.record;
  const recorded =
    record !== null && record.libraryEnvironmentId !== chosen?.id
      ? libraryView(get, record.libraryEnvironmentId)
      : null;
  return { ready: true, chosen, recorded, record };
}).pipe(Atom.withEquality(sameLibraryPushSnapshot), Atom.withLabel("loom:library-push:snapshot"));

const setActivity = (registry: AtomRegistry.AtomRegistry, activity: LibraryPushActivity) =>
  registry.set(libraryPushActivityAtom, activity);

const failed = (
  failure: NonNullable<LibraryPushActivity["failure"]>,
  error: unknown,
): LibraryPushActivity => ({
  running: null,
  failure,
  failureReason: libraryPushErrorReason(error),
});

/** Never logged, not even in part. */
async function readDevicePushToken(): Promise<string | null> {
  const token = await Notifications.getDevicePushTokenAsync().catch(() => null);
  return token?.type === "ios" && typeof token.data === "string" && token.data.trim() !== ""
    ? token.data.trim()
    : null;
}

async function unregisterRow(
  registry: AtomRegistry.AtomRegistry,
  step: Extract<LibraryPushStep, { kind: "unregister" }>,
) {
  setActivity(registry, { ...IDLE_ACTIVITY, running: "unregister" });
  const result = await runAtomCommand(
    registry,
    libraryPush.unregister,
    { environmentId: step.libraryId, input: { id: step.id } },
    { reportFailure: false },
  );
  const answered = result._tag === "Success";
  await updateLibraryPushRecord(registry, (record) =>
    recordAfterUnregister(record, step, { kind: answered ? "answered" : "failed" }),
  );
  setActivity(
    registry,
    answered ? IDLE_ACTIVITY : failed("unregister", squashAtomCommandFailure(result)),
  );
}

/**
 * Forgets this iPhone's registration when a status read after it registered no longer lists its
 * row. The record change starts another sync, which registers again.
 */
export const reconcileLibraryPushStatus = (
  registry: AtomRegistry.AtomRegistry,
  libraryId: EnvironmentId,
  status: Pick<LibraryPushStatus, "devices">,
  readAt: number,
) =>
  updateLibraryPushRecord(registry, (record) =>
    recordAfterStatus(record, libraryId, { devices: status.devices, readAt }),
  );

/**
 * A fresh registration skips registering, so read the Library's list instead: a row it dropped
 * (an operator's Remove, or Apple refusing the token) then registers again on this connect, not
 * at the daily refresh. One read per sync that would otherwise do nothing; never on a timer.
 */
async function checkLibraryPushRow(registry: AtomRegistry.AtomRegistry, libraryId: EnvironmentId) {
  const status = await executeAtomQuery(registry, libraryPush.status(libraryId), {
    refresh: true,
    reportFailure: false,
  });
  if (status._tag === "Success")
    await reconcileLibraryPushStatus(registry, libraryId, status.value, Date.now());
}

async function registerDevice(
  registry: AtomRegistry.AtomRegistry,
  step: Extract<LibraryPushStep, { kind: "needsToken" }>,
  planned: LibraryPushRecord,
  build: LibraryPushBuild,
) {
  const token = await readDevicePushToken();
  if (token === null) {
    setActivity(registry, failed("token", null));
    return;
  }
  const device = {
    bundleId: build.bundleId,
    apsEnvironment: build.apsEnvironment,
    appVersion: build.appVersion,
    tokenSuffix: tokenSuffix(token),
  };
  const now = Date.now();
  if (planLibraryPushRegistration(planned.registration, device, now) === "none") {
    if (
      planned.registration !== null &&
      now >= planned.registration.registeredAt + LIBRARY_PUSH_ROW_SETTLE_MS
    )
      await checkLibraryPushRow(registry, step.libraryId);
    setActivity(registry, IDLE_ACTIVITY);
    return;
  }
  setActivity(registry, { ...IDLE_ACTIVITY, running: "register" });
  const deviceId = await loadOrCreateAgentAwarenessDeviceId();
  const result = await runAtomCommand(
    registry,
    libraryPush.register,
    {
      environmentId: step.libraryId,
      input: {
        deviceId,
        label: libraryPushDeviceLabel(Constants.deviceName),
        platform: "ios",
        bundleId: build.bundleId,
        apsEnvironment: build.apsEnvironment,
        ...(build.appVersion === null ? {} : { appVersion: build.appVersion }),
        token: Redacted.make(token),
      },
    },
    { reportFailure: false },
  );
  if (result._tag === "Success") {
    const registeredAt = Date.now();
    const expiresAt = Date.parse(result.value.expiresAt);
    await updateLibraryPushRecord(registry, (record) =>
      recordAfterRegister(record, planned, {
        ...device,
        id: result.value.id,
        registeredAt,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : registeredAt + LIBRARY_PUSH_REFRESH_MS,
      }),
    );
    setActivity(registry, IDLE_ACTIVITY);
    return;
  }
  const error = squashAtomCommandFailure(result);
  const refusal = libraryPushRefusal(error);
  if (refusal === null) {
    setActivity(registry, failed("register", error));
    return;
  }
  await updateLibraryPushRecord(registry, (record) =>
    recordAfterRefusal(record, planned, refusal, build.appVersion),
  );
  setActivity(registry, IDLE_ACTIVITY);
}

async function syncOnce(registry: AtomRegistry.AtomRegistry) {
  const build = currentLibraryPushBuild();
  if (build === null) return;
  const snapshot = registry.get(libraryPushSnapshotAtom);
  const planned = snapshot.record;
  const step = planLibraryPush({
    ...snapshot,
    supported: true,
    permission: registry.get(libraryPushPermissionAtom),
    appVersion: build.appVersion,
  });
  if (step.kind === "clearLocal")
    await updateLibraryPushRecord(registry, (record) =>
      record === planned ? recordAfterClear(record, step) : record,
    );
  else if (step.kind === "unregister") await unregisterRow(registry, step);
  else if (step.kind === "needsToken" && planned !== null)
    await registerDevice(registry, step, planned, build);
}

let syncing = false;
let syncAgain = false;

/** One step at a time; a change that arrives meanwhile plans again from the latest state. */
export function requestLibraryPushSync(registry: AtomRegistry.AtomRegistry) {
  syncAgain = true;
  if (syncing) return;
  syncing = true;
  void (async () => {
    while (syncAgain) {
      syncAgain = false;
      // Only keychain and device-id storage can throw here, and neither sees the token.
      await syncOnce(registry).catch((error: unknown) => {
        registry.update(libraryPushActivityAtom, (activity) =>
          activity.running === null ? activity : { ...IDLE_ACTIVITY, failure: activity.running },
        );
        console.warn("Could not update Library notifications.", error);
      });
    }
    syncing = false;
  })();
}

async function refreshPermission(registry: AtomRegistry.AtomRegistry) {
  const permissions = await Notifications.getPermissionsAsync().catch(() => null);
  if (permissions !== null)
    registry.set(libraryPushPermissionAtom, permissions.granted ? "granted" : "denied");
}

/**
 * Runs for the app's lifetime. Foregrounding only re-reads local state: the iOS permission and,
 * after a failed keychain read, the record. No timers and no token listener; a rotated token is
 * noticed on the next Library connect.
 */
export function startLibraryPushSync(registry: AtomRegistry.AtomRegistry): () => void {
  const refreshLocal = () => {
    void loadLibraryPushRecord(registry).catch(() =>
      console.warn("Could not read Library notification settings."),
    );
    void refreshPermission(registry);
  };
  const sync = () => requestLibraryPushSync(registry);
  const stopSnapshot = registry.subscribe(libraryPushSnapshotAtom, sync);
  const stopPermission = registry.subscribe(libraryPushPermissionAtom, sync);
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") refreshLocal();
  });
  refreshLocal();
  sync();
  return () => {
    stopSnapshot();
    stopPermission();
    appState.remove();
  };
}

export type LibraryPushOptInOutcome = "saved" | "denied" | "failed";

/** The only place Loom asks iOS for notification permission on behalf of the Library. */
export async function setLibraryPushOptIn(
  registry: AtomRegistry.AtomRegistry,
  optedIn: boolean,
): Promise<LibraryPushOptInOutcome> {
  const library = registry.get(libraryPushSnapshotAtom).chosen;
  if (library === null) return "failed";
  let outcome: LibraryPushOptInOutcome = "saved";
  if (optedIn) {
    const permission = await settleAsyncResult(() =>
      runtime.runPromiseExit(requestAgentNotificationPermission),
    );
    if (permission._tag === "Failure") return "failed";
    const granted = permission.value.type === "granted";
    registry.set(libraryPushPermissionAtom, granted ? "granted" : "denied");
    if (!granted) outcome = "denied";
  }
  setActivity(registry, IDLE_ACTIVITY);
  return updateLibraryPushRecord(registry, (record) =>
    recordForOptIn(record, library, optedIn),
  ).then(
    () => outcome,
    () => "failed" as const,
  );
}

/** Forgets a refusal or failure and plans again, which is the user's way past a backoff. */
export function retryLibraryPush(registry: AtomRegistry.AtomRegistry) {
  setActivity(registry, IDLE_ACTIVITY);
  void updateLibraryPushRecord(registry, recordForRetry).then(
    () => requestLibraryPushSync(registry),
    () => setActivity(registry, failed("register", null)),
  );
}

export type LibraryPushTestOutcome =
  | { readonly phase: "sent" }
  | { readonly phase: "failed"; readonly reason: LibraryPushErrorReason | null };

export async function sendLibraryPushTest(
  registry: AtomRegistry.AtomRegistry,
  libraryId: EnvironmentId,
  id: LibraryPushDeviceRowId,
): Promise<LibraryPushTestOutcome> {
  const result = await runAtomCommand(
    registry,
    libraryPush.test,
    { environmentId: libraryId, input: { id } },
    { reportFailure: false },
  );
  if (result._tag === "Failure")
    return { phase: "failed", reason: libraryPushErrorReason(squashAtomCommandFailure(result)) };
  const delivery = result.value.deliveries.find((entry) => entry.id === id);
  if (delivery?.outcome === "sent") return { phase: "sent" };
  if (delivery === undefined || delivery.outcome === "removed") {
    // The Library holds no live row for this iPhone, so dropping ours registers it again.
    const step = { kind: "unregister", libraryId, id } as const;
    await updateLibraryPushRecord(registry, (record) =>
      recordAfterUnregister(record, step, { kind: "answered" }),
    ).catch(() => undefined);
  }
  return { phase: "failed", reason: null };
}

const REMOVAL_UNREGISTER_TIMEOUT_MS = 3_000;

/**
 * Removing a connection revokes its session, after which this phone can no longer unregister.
 * So removing the Library first asks it to forget this iPhone, briefly and best effort. A
 * Library that does not answer keeps the row until it expires.
 */
export function forgetLibraryPushBeforeRemoval(environmentId: EnvironmentId): Promise<void> {
  if (currentLibraryPushBuild() === null) return Promise.resolve();
  const snapshot = appAtomRegistry.get(libraryPushSnapshotAtom);
  const registration =
    snapshot.record?.libraryEnvironmentId === environmentId ? snapshot.record.registration : null;
  const library = snapshot.chosen?.id === environmentId ? snapshot.chosen : snapshot.recorded;
  if (registration === null || library === null || !library.connected || !library.canChange)
    return Promise.resolve();
  const step = { kind: "unregister", libraryId: environmentId, id: registration.id } as const;
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, REMOVAL_UNREGISTER_TIMEOUT_MS);
    void unregisterRow(appAtomRegistry, step)
      .catch(() => undefined)
      .then(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/** Wraps the connection controller's removal, the one upstream line that calls it. */
export const forgetPushThen = <A>(
  remove: (environmentId: EnvironmentId) => Promise<A>,
  environmentId: EnvironmentId,
): Promise<A> => forgetLibraryPushBeforeRemoval(environmentId).then(() => remove(environmentId));
