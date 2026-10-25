import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry, type Atom } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { LibraryPushRecord } from "./libraryPushPlan";

const LIBRARY = EnvironmentId.make("env-library");
const COMPUTER = EnvironmentId.make("env-computer");
const ACCOUNT = { issuer: "https://id.example.test", subject: "kyle" };
const TOKEN = "a1".repeat(32);
const KEPT_ROW = "Row_kept-0123456789abc";
const LANDED_ROW = "Row_land-0123456789abc";
const AGAIN_ROW = "Row_again-0123456789ab";
const DAY = 24 * 60 * 60 * 1000;

const harness = await vi.hoisted(async () => {
  const { Atom: A, AsyncResult, AtomRegistry: Registry } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  const library = {
    entry: {
      enabled: true,
      profile: Option.some({
        _tag: "BearerConnectionProfile",
        identity: { issuer: "https://id.example.test", subject: "kyle" },
      }),
    },
    connection: { phase: "connected" },
    serverConfig: { environment: { capabilities: [] } },
  };
  return {
    registry: Registry.make(),
    libraryPresentation: A.make<typeof library | null>(library).pipe(A.keepAlive),
    noPresentation: A.make(null),
    preferences: A.make(
      AsyncResult.success({ "loom.library.authorityEnvironmentId": "env-library" }),
    ),
    catalog: A.make({ isReady: true }),
    allowed: A.make(true),
    secure: new Map<string, string>(),
    /** Every Library call and the removal, in order. */
    calls: [] as Array<string>,
    // Reset before each test; a test that holds one open replaces it.
    register: (): Promise<string> => Promise.reject(new Error("unset")),
    token: (): Promise<{ readonly type: string; readonly data: string }> =>
      Promise.reject(new Error("unset")),
  };
});

vi.mock("@t3tools/client-runtime/fork", () => ({
  supportsLoomFeature: () => true,
  createLibraryPushAtoms: () => ({
    status: () => harness.noPresentation,
    register: { tag: "register", permissionAtom: () => harness.allowed },
    unregister: { tag: "unregister", permissionAtom: () => harness.allowed },
    test: { tag: "test", permissionAtom: () => harness.allowed },
  }),
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  executeAtomQuery: async () => ({ _tag: "Failure" }),
  settleAsyncResult: async () => ({ _tag: "Failure" }),
  squashAtomCommandFailure: () => null,
  runAtomCommand: async (
    _registry: unknown,
    command: { readonly tag: string },
    request: { readonly input: { readonly id?: string } },
  ) => {
    if (command.tag === "register") {
      harness.calls.push("register");
      const id = await harness.register();
      return {
        _tag: "Success",
        value: { id, expiresAt: new Date(Date.now() + 30 * DAY).toISOString() },
      };
    }
    harness.calls.push(`${command.tag} ${request.input.id}`);
    return { _tag: "Success", value: { removed: true } };
  },
}));
vi.mock("expo-constants", () => ({ default: { deviceName: "Test iPhone" } }));
vi.mock("expo-notifications", () => ({
  getDevicePushTokenAsync: () => harness.token(),
  getPermissionsAsync: async () => ({ granted: true }),
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (key: string) => harness.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void harness.secure.set(key, value),
  deleteItemAsync: async (key: string) => void harness.secure.delete(key),
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock("../../connection/catalog", () => ({
  environmentCatalog: { catalogValueAtom: harness.catalog },
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../features/agent-awareness/notificationPermissions", () => ({
  requestAgentNotificationPermission: {},
}));
vi.mock("../../lib/runtime", () => ({ runtime: {} }));
vi.mock("../../persistence/imperative", () => ({
  loadOrCreateAgentAwarenessDeviceId: async () => "device-1",
}));
vi.mock("../../state/atom-registry", () => ({
  get appAtomRegistry() {
    return harness.registry;
  },
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: {
    presentationAtom: (id: string) =>
      id === "env-library" ? harness.libraryPresentation : harness.noPresentation,
  },
}));
vi.mock("../../state/preferences", () => ({ mobilePreferencesAtom: harness.preferences }));
vi.mock("./libraryPushBuild", () => ({
  currentLibraryPushBuild: () => ({
    bundleId: "com.kylebegeman.loom",
    apsEnvironment: "production",
    appVersion: "1.4.0",
  }),
  libraryPushDeviceLabel: () => "Test iPhone",
}));

type Sync = typeof import("./libraryPushSync");
type Store = typeof import("./libraryPushStore");

const record = (registration: string | null): LibraryPushRecord => ({
  v: 1,
  libraryEnvironmentId: LIBRARY,
  account: ACCOUNT,
  optedIn: true,
  registration:
    registration === null
      ? null
      : {
          id: registration,
          // Fresh, so the start-up sync neither registers again nor reads the Library's list.
          registeredAt: Date.now(),
          expiresAt: Date.now() + 30 * DAY,
          bundleId: "com.kylebegeman.loom",
          apsEnvironment: "production",
          appVersion: "1.4.0",
          tokenSuffix: TOKEN.slice(-8),
        },
  refusal: null,
});

/** Settles on the change itself, through the registry's own subscription. */
const until = <A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  done: (value: A) => boolean,
) =>
  new Promise<void>((resolve) => {
    if (done(registry.get(atom))) return resolve();
    const stop = registry.subscribe(atom, (value) => {
      if (!done(value)) return;
      stop();
      resolve();
    });
  });

let sync: Sync;
let store: Store;
let stopSync: () => void;

async function start(seed: LibraryPushRecord) {
  harness.secure.set("loom.push.library.v1", JSON.stringify(seed));
  sync = await import("./libraryPushSync");
  store = await import("./libraryPushStore");
  stopSync = sync.startLibraryPushSync(harness.registry);
  await store.loadLibraryPushRecord(harness.registry);
  harness.registry.set(sync.libraryPushPermissionAtom, "granted");
}

const registrationId = () => {
  const stored = harness.registry.get(store.libraryPushRecordAtom);
  return stored.loaded ? (stored.record?.registration?.id ?? null) : null;
};

const removeLibrary = (succeeds: boolean) => async (environmentId: EnvironmentId) => {
  harness.calls.push(`remove ${environmentId}`);
  if (succeeds && environmentId === LIBRARY)
    harness.registry.set(harness.libraryPresentation, null);
};

beforeEach(() => {
  // A fresh module and registry per test, since the sync loop's state is module-level.
  vi.resetModules();
  harness.registry = AtomRegistry.make();
  harness.secure.clear();
  harness.calls = [];
  harness.register = () => Promise.resolve(AGAIN_ROW);
  harness.token = () => Promise.resolve({ type: "ios", data: TOKEN });
});

afterEach(() => stopSync());

const recordGone = () =>
  until(
    harness.registry,
    store.libraryPushRecordAtom,
    (stored) => stored.loaded && stored.record === null,
  );

describe("removing the Library connection", () => {
  it("asks the Library to forget this iPhone and does not register it again", async () => {
    await start(record(KEPT_ROW));

    await sync.forgetPushThen(removeLibrary(true), LIBRARY);
    // The record goes once the removal lands, after any step the loop had queued.
    await recordGone();

    expect(harness.calls).toEqual([`unregister ${KEPT_ROW}`, `remove ${LIBRARY}`]);
  });

  it("unregisters a registration that lands while the removal waits", async () => {
    let land!: () => void;
    // Only the first register is held open, so a stray second one shows up in the calls.
    const registerSent = new Promise<void>((sent) => {
      harness.register = () => {
        harness.register = () => Promise.resolve(AGAIN_ROW);
        sent();
        return new Promise((resolve) => (land = () => resolve(LANDED_ROW)));
      };
    });
    await start(record(null));
    await registerSent;

    const removal = sync.forgetPushThen(removeLibrary(true), LIBRARY);
    land();
    await removal;
    await recordGone();

    expect(harness.calls).toEqual(["register", `unregister ${LANDED_ROW}`, `remove ${LIBRARY}`]);
  });

  it("registers again when the removal fails", async () => {
    await start(record(KEPT_ROW));

    await sync.forgetPushThen(removeLibrary(false), LIBRARY);
    await until(
      harness.registry,
      store.libraryPushRecordAtom,
      () => registrationId() === AGAIN_ROW,
    );

    expect(harness.calls).toEqual([`unregister ${KEPT_ROW}`, `remove ${LIBRARY}`, "register"]);
  });

  it("leaves this iPhone's registration alone when a computer is removed", async () => {
    await start(record(KEPT_ROW));

    await sync.forgetPushThen(removeLibrary(true), COMPUTER);

    expect(harness.calls).toEqual([`remove ${COMPUTER}`]);
    expect(registrationId()).toBe(KEPT_ROW);
  });
});

describe("registering", () => {
  it("does not register after an opt-out made while iOS was reading the token", async () => {
    let answer!: () => void;
    const tokenAsked = new Promise<void>((asked) => {
      harness.token = () => {
        asked();
        return new Promise((resolve) => (answer = () => resolve({ type: "ios", data: TOKEN })));
      };
    });
    await start(record(null));
    await tokenAsked;

    // The opt-out deletes the record, so a row registered now would have nothing to remove it.
    expect(await sync.setLibraryPushOptIn(harness.registry, false)).toBe("saved");
    const waiting = { running: null, failure: "token", failureReason: null } as const;
    harness.registry.set(sync.libraryPushActivityAtom, waiting);
    answer();
    await until(harness.registry, sync.libraryPushActivityAtom, (activity) => activity !== waiting);

    expect(harness.registry.get(sync.libraryPushActivityAtom).running).toBeNull();
    expect(harness.calls).toEqual([]);
  });
});
