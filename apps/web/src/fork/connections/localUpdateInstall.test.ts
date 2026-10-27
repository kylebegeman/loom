import {
  AVAILABLE_CONNECTION_STATE,
  BearerConnectionTarget,
  type ConnectionCatalogEntry,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { RestartImpactThread } from "@t3tools/client-runtime/fork";
import { EMPTY_SHELL_STATE, type EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import {
  type DesktopBridge,
  type DesktopUpdateActionResult,
  type DesktopUpdateState,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const saved = vi.hoisted(() => ({ save: vi.fn(), clear: vi.fn() }));
vi.mock("~/connection/catalog", () => ({ environmentCatalog: {} }));
vi.mock("~/state/shell", () => ({ environmentShell: {} }));
vi.mock("~/state/threads", () => ({ environmentThreadShells: {} }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (toast: unknown) => toast,
}));
vi.mock("~/components/sidebar/updateEverythingRun", () => ({
  saveUpdateEverythingResult: saved.save,
  clearSavedUpdateEverythingResult: saved.clear,
}));

import { installArmedUpdate, localAgentsIdle } from "./localUpdateInstall";

const primaryId = EnvironmentId.make("primary");
const wslId = EnvironmentId.make("wsl");
const remoteId = EnvironmentId.make("remote");

const entry = (
  target: ConnectionCatalogEntry["target"],
  enabled = true,
): ConnectionCatalogEntry => ({
  target,
  profile: Option.none(),
  enabled,
});
const bearer = (environmentId: EnvironmentId, connectionId: string) =>
  new BearerConnectionTarget({ environmentId, label: connectionId, connectionId });

const catalog = (entries: ReadonlyArray<readonly [EnvironmentId, ConnectionCatalogEntry]>) => ({
  isReady: true,
  entries: new Map(entries),
});
const primaryEntry = [
  primaryId,
  entry(
    new PrimaryConnectionTarget({
      environmentId: primaryId,
      label: "This computer",
      httpBaseUrl: "http://localhost:3773",
      wsBaseUrl: "ws://localhost:3773",
    }),
  ),
] as const;

const live: EnvironmentShellState = {
  ...EMPTY_SHELL_STATE,
  snapshot: Option.some({} as never),
  status: "live",
};
const synchronizing: EnvironmentShellState = { ...EMPTY_SHELL_STATE, status: "synchronizing" };
const settled: RestartImpactThread = {
  title: "Done",
  status: "completed",
  activityRunStatus: null,
  pendingBackgroundTasks: [],
};
const running: RestartImpactThread = { ...settled, title: "Busy", status: "running" };

function idle({
  entries = [primaryEntry],
  shells = {},
  connections = {},
  threads = {},
  clientComputer = false,
}: {
  readonly clientComputer?: boolean;
  readonly entries?: ReadonlyArray<readonly [EnvironmentId, ConnectionCatalogEntry]>;
  readonly shells?: Partial<Record<string, EnvironmentShellState>>;
  readonly connections?: Partial<Record<string, SupervisorConnectionState>>;
  readonly threads?: Partial<Record<string, ReadonlyArray<RestartImpactThread>>>;
} = {}) {
  return localAgentsIdle({
    catalog: catalog(entries),
    desktop: true,
    clientComputer,
    shell: (id) => shells[id] ?? live,
    connection: (id) => connections[id] ?? null,
    threads: (id) => threads[id] ?? [settled],
  });
}

describe("localAgentsIdle", () => {
  it("is idle once every local backend is loaded and settled", () => {
    expect(idle()).toBe(true);
  });

  it("waits for working threads and threads waiting on background work", () => {
    expect(idle({ threads: { primary: [settled, running] } })).toBe(false);
    expect(
      idle({
        threads: {
          primary: [{ ...settled, pendingBackgroundTasks: [{ taskId: "a", kind: "subagent" }] }],
        },
      }),
    ).toBe(false);
  });

  it("waits until the catalog has loaded the primary backend", () => {
    expect(idle({ entries: [] })).toBe(false);
    expect(
      localAgentsIdle({
        catalog: { isReady: false, entries: new Map([primaryEntry]) },
        desktop: true,
        clientComputer: false,
        shell: () => live,
        connection: () => null,
        threads: () => [],
      }),
    ).toBe(false);
  });

  it("is idle on a computer that runs no agents of its own", () => {
    expect(
      idle({ clientComputer: true, entries: [[remoteId, entry(bearer(remoteId, "remote"))]] }),
    ).toBe(true);
  });

  it("ignores other computers and disabled backends", () => {
    expect(
      idle({
        entries: [
          primaryEntry,
          [remoteId, entry(bearer(remoteId, "remote"))],
          [wslId, entry(bearer(wslId, "local:wsl:Ubuntu"), false)],
        ],
        threads: { remote: [running], wsl: [running] },
      }),
    ).toBe(true);
  });

  it("waits for a local backend that is still connecting but not one that settled offline", () => {
    const entries = [primaryEntry, [wslId, entry(bearer(wslId, "local:wsl:Ubuntu"))] as const];
    expect(
      idle({
        entries,
        shells: { wsl: synchronizing },
        connections: { wsl: { ...AVAILABLE_CONNECTION_STATE, phase: "connecting" } },
      }),
    ).toBe(false);
    expect(
      idle({
        entries,
        shells: { wsl: synchronizing },
        connections: { wsl: { ...AVAILABLE_CONNECTION_STATE, phase: "offline" } },
      }),
    ).toBe(true);
    expect(
      idle({
        entries,
        shells: { wsl: synchronizing },
        connections: { wsl: { ...AVAILABLE_CONNECTION_STATE, phase: "backoff", attempt: 1 } },
      }),
    ).toBe(false);
  });
});

const updateState: DesktopUpdateState = {
  enabled: true,
  status: "downloaded",
  channel: "latest",
  currentVersion: "1.2.3",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: "1.2.4",
  downloadedVersion: "1.2.4",
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: 100,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: true,
  installWhenIdle: true,
};

function bridgeFor(install: () => Promise<DesktopUpdateActionResult>) {
  const setInstallWhenIdle = vi.fn(async (_armed: boolean) => updateState);
  return {
    bridge: { installUpdate: install, setInstallWhenIdle } as unknown as DesktopBridge,
    setInstallWhenIdle,
  };
}

describe("installArmedUpdate", () => {
  beforeEach(() => {
    saved.save.mockClear();
    saved.clear.mockClear();
  });

  it("records the update for the relaunched app and leaves it installing", async () => {
    const reportError = vi.fn();
    const { bridge } = bridgeFor(async () => ({
      accepted: true,
      completed: false,
      state: updateState,
    }));
    expect(await installArmedUpdate(bridge, "1.2.4", reportError)).toBe("installing");
    expect(saved.save).toHaveBeenCalledWith(expect.objectContaining({ localVersion: "1.2.4" }));
    expect(saved.clear).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("retries quietly when another update action holds the install", async () => {
    const reportError = vi.fn();
    const { bridge } = bridgeFor(async () => ({
      accepted: false,
      completed: false,
      state: updateState,
    }));
    expect(await installArmedUpdate(bridge, "1.2.4", reportError)).toBe("refused");
    expect(saved.clear).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a failed install once instead of retrying", async () => {
    const reportError = vi.fn();
    const { bridge } = bridgeFor(async () => ({
      accepted: true,
      completed: false,
      state: { ...updateState, status: "error", errorContext: "install", message: "No space" },
    }));
    expect(await installArmedUpdate(bridge, "1.2.4", reportError)).toBe("failed");
    expect(saved.clear).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith("Could not install update", "No space");
  });

  it("drops the arm when the desktop could not be reached", async () => {
    const reportError = vi.fn();
    const { bridge, setInstallWhenIdle } = bridgeFor(async () => {
      throw new Error("IPC closed");
    });
    expect(await installArmedUpdate(bridge, "1.2.4", reportError)).toBe("failed");
    expect(setInstallWhenIdle).toHaveBeenCalledWith(false);
    expect(reportError).toHaveBeenCalledWith("Could not install update", "IPC closed");
  });
});
