// @effect-diagnostics nodeBuiltinImport:off - Lanes need statfs, realpath and file modes Effect does not expose.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  CommandId,
  MessageId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import {
  DEFAULT_PROJECT_LIFECYCLE_CAPS,
  ProjectLifecycleError,
  type AdoptableLeaseKind,
  type LaneFreeScope,
  type LaneLease,
  type LaneLeaseKind,
  type ProjectLifecycleLane,
  type ProjectLifecycleSettings,
  type ProjectLifecycleStatus,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ServerConfig } from "../../config.ts";
import { DeviceService } from "../../device/DeviceService.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ThreadSettlement from "../../orchestration-v2/ThreadSettlementService.ts";
import { withWorkspaceLease } from "../../workspace/workspaceLease.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { pruneLaneTmp } from "./tmpCleanup.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  DOCKER_LABEL,
  ancestorsOf,
  leaseOf,
  ledgerLine,
  liveProcess,
  makeLeaseOps,
  parseLedger,
  parseSlotHolder,
  partitionListeners,
  withDescendants,
  type DockerResource,
  type LedgerEntry,
  type Listener,
  type ProcessInfo,
  type SlotHolder,
} from "./leases.ts";
import {
  GB,
  PORT_BLOCK,
  PORT_RANGE,
  allocatePortBase,
  autoBuildSlots,
  formatGb,
  growTarget,
  holdsLane,
  isAppleCheckout,
  laneActions,
  laneBaseName,
  laneCapBytes,
  laneSteerText,
  machinePressure,
  projectFolder,
  reserveSteerText,
  shouldGrow,
  threadRunning,
  uniqueName,
} from "./policy.ts";
import {
  addProfileBlock,
  hasProfileBlock,
  removeProfileBlock,
  renderHook,
  renderIndex,
  renderShims,
  ledgerPath,
  shellDir,
  shimsDir,
  slotsDir,
} from "./shell.ts";
import {
  SPACE_FOLDERS,
  imageBackendAvailable,
  makeSpaceOps,
  type LanePaths,
  type SpaceOps,
} from "./space.ts";
import { makePortClaims, portClaimsDir } from "./portClaims.ts";
import { makeStore, type LaneRow } from "./store.ts";

const WATCHDOG_INTERVAL = "30 seconds";
const CHECKOUT_PROTECTION_MESSAGE =
  "This lane contains registered project or thread working files. Remove those files through their project before discarding the lane.";
/** `du` walks the whole folder, so folder lanes are measured less often. */
const FOLDER_MEASURE_INTERVAL_MS = 5 * 60 * 1000;
/** Status snapshots go out only when a size changes by at least this much. */
const STATUS_ROUNDING_BYTES = 100_000_000;
/** Simulators, Docker and port listeners are listed this often; processes every tick. */
const LEASE_SCAN_INTERVAL_MS = 2 * 60 * 1000;
const BUSY_PORT_LOOKUP_TIMEOUT = "5 seconds";

type Thread = OrchestrationV2ThreadShell;

interface LaneLive {
  usedBytes: number | null;
  imageBytes: number | null;
  measuredAt: number;
  mounted: boolean;
  /** Set while the lane's running agents have been told it is filling up. */
  steered: boolean;
  /** When the current crossing started; part of the steer ids so a retry cannot double-send. */
  crossingAt: number;
  message: string | null;
  failed: boolean;
  leases: ReadonlyArray<LaneLease>;
  /**
   * A release attempt already stopped the listeners on the lane's ports. Listeners are matched
   * by port alone, so whatever listens there during a retry started after the lane was let go.
   */
  portsReleased: boolean;
}

interface SpaceBackends {
  readonly image: SpaceOps;
  readonly folder: SpaceOps;
}

export interface ProjectLifecycleOptions {
  readonly homeDir: string;
  readonly imageBackend: boolean;
  /** Tests point these at stubs; by default the tools are found on PATH. */
  readonly xcrunPath?: string;
  readonly lsofPath?: string;
  readonly dockerPath?: string;
  /** Tests wrap the space backends, for example to keep an unmount busy. */
  readonly wrapSpaces?: (spaces: SpaceBackends) => SpaceBackends;
  /** Free and total bytes on the volume holding `path`. Tests pin it; by default statfs. */
  readonly hostSpace?: (path: string) => Promise<{ readonly free: number; readonly total: number }>;
}

const statfsSpace = (path: string) =>
  NodeFSP.statfs(path).then((stats) => ({
    free: stats.bavail * stats.bsize,
    total: stats.blocks * stats.bsize,
  }));

const error = (reason: ProjectLifecycleError["reason"], message: string) =>
  new ProjectLifecycleError({ reason, message });

const node = <A>(label: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => error("command-failed", `${label}: ${String(cause)}`),
  });

const exists = (path: string) =>
  Effect.promise(() =>
    NodeFSP.access(path).then(
      () => true,
      () => false,
    ),
  );

const writeAtomically = (path: string, contents: string, mode = 0o644) =>
  node(`write ${path}`, async () => {
    await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await NodeFSP.writeFile(temporary, contents, { mode });
    await NodeFSP.rename(temporary, path);
  });

const lanePaths = (lane: Pick<LaneRow, "laneDir">): LanePaths => ({
  laneDir: lane.laneDir,
  spacePath: `${lane.laneDir}/space`,
  imagePath: `${lane.laneDir}/space.asif`,
});

/** The image volume name Finder and diskutil show for a lane. */
const volumeName = (laneId: string) => `loom-${laneId.slice(0, 8)}`;

const checkoutOf = (thread: Thread, projects: ReadonlyMap<string, OrchestrationProjectShell>) =>
  thread.worktreePath ?? projects.get(thread.projectId)?.workspaceRoot ?? null;

const portsOf = (lane: Pick<LaneRow, "portBase">) =>
  lane.portBase === null ? null : { first: lane.portBase, last: lane.portBase + PORT_BLOCK - 1 };

const laneMarkdown = (lane: LaneRow, lanesRoot: string) => {
  const space = lanePaths(lane).spacePath;
  const ports = portsOf(lane);
  const shims = shimsDir(lanesRoot);
  return `# Lane: ${lane.projectName} / ${lane.name}

Lane id: ${lane.id}
Checkout: ${lane.checkoutPath}
Cap: ${formatGb(lane.capBytes)} (${lane.backend === "image" ? "capped disk image" : "folder, soft cap"})
${ports === null ? "" : `Ports: ${ports.first} to ${ports.last}\n`}
Shells inside the checkout get \`TMPDIR=${space}/tmp/\`, \`LOOM_LANE_BUILD\` / \`LOOM_LANE_DATA\`,
\`LOOM_LANE_ID\` and \`LOOM_LANE_PORT\` (the first of the lane's ports).

- \`space/tmp\`: scratch. Loom removes unused entries older than 24 hours, including while the lane is active.
- \`space/build\`: DerivedData, package checkouts and other build output.
- \`space/data\`: files worth keeping while the thread is active.

Released with the lane:

- Servers and watchers started with \`${shims}/lane-run [--name NAME] [--detach] command...\`.
  \`--detach\` keeps it running after your command returns and logs to \`space/tmp\`.
- Anything listening on the lane's ports.
- Simulators made with \`xcrun simctl create\` or \`clone\` inside the checkout.
- Docker containers and volumes labelled \`${DOCKER_LABEL}=${lane.id}\`.
- Simulators and processes handed over with \`loom_project_lifecycle_adopt\`.

Heavy builds share the machine's build slots: xcodebuild waits for one automatically, and other
builds can use \`${shims}/lane-slot command...\`.

Agents free space with the \`loom_project_lifecycle_free\` tool and raise the cap with
\`loom_project_lifecycle_grow\`. Loom removes this lane when every thread using the checkout is
settled or archived. The checkout itself is never touched.
`;
};

export const makeWith = Effect.fn("ProjectLifecycle.makeWith")(function* (
  options: ProjectLifecycleOptions,
) {
  const config = yield* ServerConfig;
  const threads = yield* ThreadManagementService;
  const settlement = yield* ThreadSettlement.ThreadSettlementServiceV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const devices = yield* DeviceService;
  const platform = yield* HostProcess.Platform;
  const runner = yield* ProcessRunner.ProcessRunner;
  const store = yield* makeStore;
  const madeSpaces = yield* makeSpaceOps;
  const spaces = options.wrapSpaces?.(madeSpaces) ?? madeSpaces;
  const leaseOps = yield* makeLeaseOps({
    homeDir: options.homeDir,
    xcrunPath: options.xcrunPath ?? "xcrun",
    lsofPath: options.lsofPath ?? "lsof",
    dockerPath: options.dockerPath,
  });
  const backend = options.imageBackend ? "image" : "folder";
  const opsFor = (lane: Pick<LaneRow, "backend">) =>
    lane.backend === "image" ? spaces.image : spaces.folder;
  // A dev server installs its shell hook into a profile of its own, never the real ~/.zshenv.
  const profilePath =
    config.devUrl === undefined
      ? `${options.homeDir}/.zshenv`
      : `${config.stateDir}/fork/project-lifecycle/zshenv`;

  const defaults: ProjectLifecycleSettings = {
    // A dev server keeps its own lanes and starts disabled, so it never touches real lanes.
    enabled: config.devUrl === undefined,
    lanesRoot:
      config.devUrl === undefined
        ? `${options.homeDir}/Developer/lanes`
        : `${config.stateDir}/fork/project-lifecycle/lanes`,
    ...DEFAULT_PROJECT_LIFECYCLE_CAPS,
    projectCapsGb: {},
    buildSlots: null,
  };
  const getSettings = store.getSettings(defaults).pipe(Effect.orDie);
  const rootOf = (settings: ProjectLifecycleSettings) =>
    settings.lanesRoot.startsWith("~/")
      ? `${options.homeDir}${settings.lanesRoot.slice(1)}`
      : settings.lanesRoot;

  const lanes = new Map<string, LaneRow>();
  for (const lane of yield* store.listLanes().pipe(Effect.orDie)) lanes.set(lane.id, lane);
  const claims = makePortClaims(portClaimsDir(options.homeDir), config.stateDir);
  const ownBases = (except?: string) =>
    [...lanes.values()].flatMap((lane) =>
      lane.portBase === null || lane.id === except ? [] : [lane.portBase],
    );
  /**
   * Ports already in use across the lane range. Docker's published ports cover forwarders
   * lsof cannot see, such as a root-owned docker-proxy. A lookup that fails or outlasts
   * `BUSY_PORT_LOOKUP_TIMEOUT` adds nothing, so a Docker that is still starting cannot hold up
   * a new lane.
   */
  const busyPorts = Effect.gen(function* () {
    const busy = new Set<number>();
    const [listening, published] = yield* Effect.all(
      [
        leaseOps
          .listeners(PORT_RANGE.first, PORT_RANGE.last)
          .pipe(Effect.timeoutOption(BUSY_PORT_LOOKUP_TIMEOUT)),
        leaseOps.publishedPorts.pipe(Effect.timeoutOption(BUSY_PORT_LOOKUP_TIMEOUT)),
      ],
      { concurrency: "unbounded" },
    );
    if (Option.isSome(listening))
      for (const listener of listening.value.values())
        for (const port of listener.ports) busy.add(port);
    if (Option.isSome(published)) for (const port of published.value ?? []) busy.add(port);
    return busy;
  });
  /**
   * A free block claimed for the lane, skipping this server's lanes, other servers' claims and
   * blocks where something already listens.
   */
  const claimPortBase = (laneId: string) =>
    busyPorts.pipe(
      Effect.flatMap((busy) =>
        node("claim lane ports", async () => {
          const taken = await claims.heldByOthers();
          for (const base of ownBases(laneId)) taken.add(base);
          for (;;) {
            const base = allocatePortBase(taken, busy);
            if (base === null || (await claims.claim(base, laneId))) return base;
            taken.add(base);
          }
        }).pipe(
          // Releasing a lane stops its port listeners, so a block must be reserved against
          // other servers before this server may treat those processes as its own.
          Effect.catch((cause) =>
            Effect.logWarning("Could not claim lane ports", { cause }).pipe(Effect.as(null)),
          ),
        ),
      ),
    );
  yield* node("prune lane port claims", () =>
    claims.prune(
      new Map(
        [...lanes.values()].flatMap((lane) =>
          lane.portBase === null ? [] : [[lane.portBase, lane.id] as const],
        ),
      ),
    ),
  ).pipe(Effect.ignore({ log: true }));
  // Lanes made before ports existed, or whose block another server claimed first, move.
  for (const lane of lanes.values()) {
    const current = lane.portBase;
    if (current !== null) {
      const held = yield* node("claim lane ports", () => claims.claim(current, lane.id)).pipe(
        Effect.orElseSucceed(() => false),
      );
      if (held) continue;
    }
    const portBase = yield* claimPortBase(lane.id);
    if (portBase === current) continue;
    yield* store.setPortBase(lane.id, portBase).pipe(Effect.orDie);
    const moved = { ...lane, portBase };
    lanes.set(lane.id, moved);
    if (current !== null)
      yield* writeAtomically(
        `${lane.laneDir}/LANE.md`,
        laneMarkdown(moved, rootOf(yield* getSettings)),
      ).pipe(Effect.ignore({ log: true }));
  }
  const live = new Map<string, LaneLive>();
  const liveOf = (id: string) => {
    let entry = live.get(id);
    if (entry === undefined) {
      entry = {
        usedBytes: null,
        imageBytes: null,
        measuredAt: 0,
        mounted: false,
        steered: false,
        crossingAt: 0,
        message: null,
        failed: false,
        leases: [],
        portsReleased: false,
      };
      live.set(id, entry);
    }
    return entry;
  };
  const laneForCheckout = (checkout: string) =>
    [...lanes.values()].find((lane) => lane.checkoutPath === checkout);

  // Lane changes run one at a time; creating or growing an image takes a second or two.
  const mutate = yield* Semaphore.make(1);
  let reserveEpisode = { active: false, startedAt: 0 };
  let host: { free: number | null; total: number | null } = { free: null, total: null };
  let shellInstalled = false;
  /** The latest look at what lanes own outside their spaces. */
  let scan: {
    table: ReadonlyMap<number, ProcessInfo> | null;
    simulators: ReadonlyMap<string, { readonly name: string }> | null;
    docker: ReadonlyArray<DockerResource> | null;
    listeners: ReadonlyMap<string, ReadonlySet<number>>;
    /** Lane port listeners a container runtime owns; never offered or stopped as leases. */
    runtime: ReadonlySet<number>;
    slowAt: number;
  } = {
    table: null,
    simulators: null,
    docker: null,
    listeners: new Map(),
    runtime: new Set(),
    slowAt: 0,
  };
  let slotHolders: ReadonlyArray<SlotHolder> = [];

  const loadThreads = Effect.gen(function* () {
    const [snapshot, shells] = yield* Effect.all([
      threads.getShellSnapshot({ location: "active" }),
      projects.listShells(),
    ]);
    return {
      threads: snapshot.threads,
      projects: new Map(shells.map((project) => [project.id as string, project])),
    };
  });
  type Threads = Effect.Success<typeof loadThreads>;

  const holdersOf = (lane: LaneRow, view: Threads, released?: ThreadId) =>
    view.threads.filter(
      (thread) =>
        thread.id !== released &&
        holdsLane(thread) &&
        checkoutOf(thread, view.projects) === lane.checkoutPath,
    );

  /** Whether a thread outside this lane is still working; its devices are left alone. */
  const activeElsewhere = (threadId: ThreadId, lane: LaneRow, view: Threads) =>
    view.threads.some(
      (thread) =>
        thread.id === threadId &&
        holdsLane(thread) &&
        checkoutOf(thread, view.projects) !== lane.checkoutPath,
    );

  const slotCount = (settings: ProjectLifecycleSettings) =>
    settings.buildSlots ?? autoBuildSlots(NodeOS.availableParallelism());

  let shellFilesReady = false;
  const writeShellFiles = Effect.gen(function* () {
    shellFilesReady = false;
    const settings = yield* getSettings;
    const root = rootOf(settings);
    const index = yield* Effect.forEach([...lanes.values()], (lane) =>
      Effect.promise(() => NodeFSP.realpath(lane.checkoutPath).catch(() => lane.checkoutPath)).pipe(
        Effect.map((real) => ({
          checkoutPaths: [lane.checkoutPath, real],
          spacePath: lanePaths(lane).spacePath,
          laneId: lane.id,
          portBase: lane.portBase ?? 0,
        })),
      ),
    );
    yield* writeAtomically(`${shellDir(root)}/lanes.tsv`, renderIndex(index));
    yield* writeAtomically(`${shellDir(root)}/lanes.zsh`, renderHook(root));
    for (const [name, contents] of Object.entries(renderShims(root)))
      yield* writeAtomically(`${shimsDir(root)}/${name}`, contents, 0o755);
    yield* writeAtomically(`${slotsDir(root)}/count`, `${slotCount(settings)}\n`);
    shellFilesReady = true;
  });

  const readProfile = Effect.promise(() =>
    NodeFSP.realpath(profilePath)
      .catch(() => profilePath)
      .then(async (target) => ({
        target,
        text: await NodeFSP.readFile(target, "utf8").catch(() => ""),
      })),
  );

  const refreshShellInstalled = readProfile.pipe(
    Effect.map(({ text }) => {
      shellInstalled = hasProfileBlock(text);
    }),
  );

  const laneView = (
    lane: LaneRow,
    holders: ReadonlyArray<Thread>,
    root: string,
  ): ProjectLifecycleLane => {
    const entry = liveOf(lane.id);
    const paths = lanePaths(lane);
    return {
      id: lane.id,
      projectId: lane.projectId,
      projectName: lane.projectName,
      name: lane.name,
      checkoutPath: lane.checkoutPath,
      laneDir: lane.laneDir,
      spacePath: paths.spacePath,
      tmpPath: `${paths.spacePath}/tmp`,
      buildPath: `${paths.spacePath}/build`,
      dataPath: `${paths.spacePath}/data`,
      backend: lane.backend,
      state: entry.failed ? "error" : entry.mounted ? "ready" : "unmounted",
      capBytes: lane.capBytes,
      usedBytes: entry.usedBytes,
      imageBytes: entry.imageBytes,
      threadIds: holders.map((thread) => thread.id),
      running: holders.some(threadRunning),
      createdAt: lane.createdAt,
      message: entry.message,
      ports: portsOf(lane),
      leases: entry.leases,
      helpers: { run: `${shimsDir(root)}/lane-run`, slot: `${shimsDir(root)}/lane-slot` },
    };
  };

  const buildStatus = Effect.fn("ProjectLifecycle.buildStatus")(function* (view: Threads | null) {
    const settings = yield* getSettings;
    const reserveBytes = settings.reserveGb * GB;
    const root = rootOf(settings);
    const laneBySpace = new Map(
      [...lanes.values()].map((lane) => [lanePaths(lane).spacePath, lane.id]),
    );
    return {
      enabled: settings.enabled,
      lanesRoot: root,
      backend,
      hostFreeBytes: host.free,
      hostTotalBytes: host.total,
      reserveBytes,
      belowReserve: host.free !== null && host.free < reserveBytes,
      shell: { installed: shellInstalled, profilePath },
      lanes: [...lanes.values()].map((lane) =>
        laneView(lane, view === null ? [] : holdersOf(lane, view), root),
      ),
      buildSlots: {
        count: slotCount(settings),
        holders: slotHolders.map((holder) => ({
          slot: holder.slot,
          pid: holder.pid,
          laneId: laneBySpace.get(holder.spacePath) ?? null,
          command: holder.command,
        })),
      },
    } satisfies ProjectLifecycleStatus;
  });

  const status = yield* SubscriptionRef.make<ProjectLifecycleStatus>(yield* buildStatus(null));
  const round = (bytes: number | null) =>
    bytes === null ? null : Math.round(bytes / STATUS_ROUNDING_BYTES);
  const statusKey = (value: ProjectLifecycleStatus) =>
    JSON.stringify({
      ...value,
      hostFreeBytes: round(value.hostFreeBytes),
      hostTotalBytes: round(value.hostTotalBytes),
      lanes: value.lanes.map((lane) => ({
        ...lane,
        usedBytes: round(lane.usedBytes),
        imageBytes: round(lane.imageBytes),
      })),
    });
  let publishedKey = statusKey(yield* SubscriptionRef.get(status));

  /** Publishes a snapshot when something a client shows has changed. */
  const publish = Effect.fn("ProjectLifecycle.publish")(function* () {
    const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
    const next = yield* buildStatus(view);
    const key = statusKey(next);
    if (key === publishedKey) return next;
    publishedKey = key;
    yield* SubscriptionRef.set(status, next);
    return next;
  });

  const measureHost = Effect.fn("ProjectLifecycle.measureHost")(function* () {
    let path = rootOf(yield* getSettings);
    while (path !== "/" && !(yield* exists(path))) path = NodePath.dirname(path);
    const hostSpace = options.hostSpace ?? statfsSpace;
    host = yield* Effect.promise(() => hostSpace(path).catch(() => ({ free: null, total: null })));
  });

  const measure = Effect.fn("ProjectLifecycle.measure")(function* (lane: LaneRow, force = false) {
    const entry = liveOf(lane.id);
    const ops = opsFor(lane);
    entry.mounted = yield* ops.isMounted(lanePaths(lane));
    const now = yield* Clock.currentTimeMillis;
    const due = now - entry.measuredAt >= FOLDER_MEASURE_INTERVAL_MS;
    if (lane.backend === "image" || force || due) {
      const usage = yield* ops.usage(lanePaths(lane));
      entry.usedBytes = usage?.usedBytes ?? null;
      entry.imageBytes = usage?.imageBytes ?? null;
      entry.measuredAt = now;
    }
    return entry;
  });

  const readLedger = (lane: Pick<LaneRow, "laneDir">) =>
    Effect.promise(() =>
      NodeFSP.readFile(ledgerPath(lane.laneDir), "utf8").then(parseLedger, () => []),
    );

  const appendLedger = (lane: LaneRow, entry: LedgerEntry) =>
    node("record lease", () => NodeFSP.appendFile(ledgerPath(lane.laneDir), ledgerLine(entry)));

  const leasesOf = (lane: LaneRow, ledger: ReadonlyArray<LedgerEntry>): Array<LaneLease> => {
    const { table, simulators, docker } = scan;
    const processes = ledger.filter((entry) => table !== null && liveProcess(table, entry));
    const recorded = new Set(processes.map((entry) => Number(entry.ref)));
    const listening = [...(scan.listeners.get(lane.id) ?? [])]
      .filter((pid) => !recorded.has(pid))
      .map((pid): LaneLease => ({
        kind: "process",
        ref: String(pid),
        label: "Listening on a lane port",
      }));
    const sims = ledger
      .filter((entry) => entry.kind === "simulator")
      .filter((entry) => simulators === null || simulators.has(entry.ref))
      .map((entry) => ({
        ...leaseOf(entry),
        label: entry.label || simulators?.get(entry.ref)?.name || "Simulator",
      }));
    return [
      ...processes.map(leaseOf),
      ...listening,
      ...sims,
      ...(docker ?? []).filter((resource) => resource.laneId === lane.id).map(leaseOf),
    ];
  };

  /** Refreshes every lane's leases. Simulators, Docker and ports are listed when due or forced. */
  const scanLeases = Effect.fn("ProjectLifecycle.scanLeases")(function* (force: boolean) {
    const settings = yield* getSettings;
    const ledgers = new Map<string, ReadonlyArray<LedgerEntry>>();
    for (const lane of lanes.values()) ledgers.set(lane.id, yield* readLedger(lane));
    const table = yield* leaseOps.processTable;
    const now = yield* Clock.currentTimeMillis;
    scan = { ...scan, table };
    if (force || now - scan.slowAt >= LEASE_SCAN_INTERVAL_MS) {
      const wantsSimulators = [...ledgers.values()].some((ledger) =>
        ledger.some((entry) => entry.kind === "simulator"),
      );
      const found = new Map<string, ReadonlyMap<number, Listener>>();
      for (const lane of lanes.values()) {
        const ports = portsOf(lane);
        if (ports !== null) found.set(lane.id, yield* leaseOps.listeners(ports.first, ports.last));
      }
      // Docker is asked for its ports only when something listens on a lane port.
      const published = [...found.values()].some((pids) => pids.size > 0)
        ? yield* leaseOps.publishedPorts
        : null;
      const self = table === null ? new Set([process.pid]) : ancestorsOf(table, process.pid);
      const listeners = new Map<string, ReadonlySet<number>>();
      const runtime = new Set<number>();
      for (const [laneId, pids] of found) {
        const owners = partitionListeners(pids, published);
        listeners.set(laneId, new Set([...owners.lane].filter((pid) => !self.has(pid))));
        for (const pid of owners.runtime) runtime.add(pid);
      }
      scan = {
        table,
        simulators: wantsSimulators ? yield* leaseOps.simulators : null,
        docker: yield* leaseOps.dockerResources,
        listeners,
        runtime,
        slowAt: now,
      };
    }
    for (const lane of lanes.values())
      liveOf(lane.id).leases = leasesOf(lane, ledgers.get(lane.id) ?? []);

    const slots = slotsDir(rootOf(settings));
    const holders: Array<SlotHolder> = [];
    for (let slot = 1; slot <= slotCount(settings); slot++) {
      const text = yield* Effect.promise(() =>
        NodeFSP.readFile(`${slots}/${slot}.holder`, "utf8").catch(() => ""),
      );
      const holder = parseSlotHolder(slot, text);
      if (holder !== null && table?.get(holder.pid)?.started === holder.started)
        holders.push(holder);
    }
    slotHolders = holders;
  });

  /** Lane port listeners on published ports from the last scan, and runtimes known by name. */
  const runtimeProcesses = leaseOps.runtimeProcesses.pipe(
    Effect.map((named) => new Set([...scan.runtime, ...(named ?? [])])),
  );

  /**
   * Stops processes and their children; never this server or anything above it, and never a
   * spared process, a container runtime or their children. A root above the server would take
   * the server's own children with it, so such roots are dropped before descendants are
   * gathered. Runtimes are checked here as well because a ledger entry can name one, and
   * Docker closes its forwarder's lane port once the container is gone.
   */
  const stopProcesses = Effect.fn("ProjectLifecycle.stopProcesses")(function* (
    roots: ReadonlyArray<number>,
    spare: ReadonlySet<number> = new Set(),
  ) {
    if (roots.length === 0) return [];
    const table = yield* leaseOps.processTable;
    const named = yield* leaseOps.runtimeProcesses;
    // Without names a runtime could be among the targets, so nothing is stopped.
    if (table === null || named === null) return ["Could not list processes."];
    const self = ancestorsOf(table, process.pid);
    const spared = withDescendants(table, [...spare, ...named]);
    const kept = (pid: number) => !self.has(pid) && !spared.has(pid);
    const targets = new Set([...withDescendants(table, roots.filter(kept))].filter(kept));
    const stuck = yield* leaseOps.terminate(targets);
    return stuck.length === 0 ? [] : [`Processes ${stuck.join(", ")} did not stop.`];
  });

  /**
   * Closes the device panels showing a lane simulator, then deletes it. A simulator another
   * lane's active thread is looking at is left alone.
   */
  const releaseSimulator = Effect.fn("ProjectLifecycle.releaseSimulator")(function* (
    lane: LaneRow,
    udid: string,
    view: Threads | null,
  ) {
    const sessions = (yield* devices.state).sessions.filter((session) => session.deviceId === udid);
    if (sessions.some((session) => view === null || activeElsewhere(session.threadId, lane, view)))
      return `Simulator ${udid} is open in another thread, so it was left.`;
    yield* Effect.forEach(
      sessions,
      (session) =>
        devices
          .close({
            threadId: session.threadId,
            hostId: session.hostId,
            deviceId: session.deviceId,
          })
          .pipe(Effect.ignore({ log: true })),
      { discard: true },
    );
    return yield* leaseOps.deleteSimulator(udid);
  });

  /** Releases everything the lane owns outside its space. Returns what could not be released. */
  const releaseLeases = Effect.fn("ProjectLifecycle.releaseLeases")(function* (lane: LaneRow) {
    const ledger = yield* readLedger(lane);
    const ports = portsOf(lane);
    const state = liveOf(lane.id);
    const sweepPorts = ports !== null && !state.portsReleased;
    // Read before removal: Docker can drop a forwarder's listener after `docker rm` returns.
    const published = sweepPorts ? yield* leaseOps.publishedPorts : null;
    const problems: Array<string> = [];
    const docker = (yield* leaseOps.dockerResources) ?? [];
    // Containers go before listeners, since a published port's listener is the runtime's own
    // forwarder, and before volumes, since a volume in use cannot be removed.
    for (const kind of ["container", "volume"] as const)
      for (const resource of docker)
        if (resource.laneId === lane.id && resource.kind === kind) {
          const problem = yield* leaseOps.removeDocker(resource);
          if (problem !== null) problems.push(problem);
        }
    const table = yield* leaseOps.processTable;
    const owners = partitionListeners(
      sweepPorts ? yield* leaseOps.listeners(ports.first, ports.last) : new Map<number, Listener>(),
      published,
    );
    const recorded = ledger
      .filter((entry) => table !== null && liveProcess(table, entry))
      .map((entry) => Number(entry.ref));
    problems.push(...(yield* stopProcesses([...recorded, ...owners.lane], owners.runtime)));
    if (table !== null) state.portsReleased = true;
    const simulators = ledger.filter((entry) => entry.kind === "simulator");
    if (simulators.length > 0) {
      const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
      const existing = yield* leaseOps.simulators;
      for (const entry of simulators) {
        if (existing !== null && !existing.has(entry.ref)) continue;
        const problem = yield* releaseSimulator(lane, entry.ref, view);
        if (problem !== null) problems.push(problem);
      }
    }
    return problems;
  });

  /**
   * Closes a released thread's device panels. A device another active thread is showing stays
   * on; otherwise it is shut down. Lane simulators are deleted later, with their lane.
   */
  const releaseThreadDevices = Effect.fn("ProjectLifecycle.releaseThreadDevices")(function* (
    released: ThreadId,
  ) {
    const sessions = yield* devices.sessionsForThread(released);
    if (sessions.length === 0) return;
    const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
    if (view === null || view.threads.some((thread) => thread.id === released && holdsLane(thread)))
      return;
    const { sessions: all } = yield* devices.state;
    yield* Effect.forEach(
      sessions,
      (session) => {
        const shared = all.some(
          (other) =>
            other.threadId !== released &&
            other.hostId === session.hostId &&
            other.deviceId === session.deviceId &&
            (view === null ||
              view.threads.some((thread) => thread.id === other.threadId && holdsLane(thread))),
        );
        return devices
          .close({
            threadId: released,
            hostId: session.hostId,
            deviceId: session.deviceId,
            shutdown: !shared,
          })
          .pipe(Effect.ignore({ log: true }));
      },
      { discard: true },
    );
  });

  const attach = Effect.fn("ProjectLifecycle.attach")(
    function* (lane: LaneRow) {
      const { device } = yield* opsFor(lane).attach(
        lanePaths(lane),
        lane.capBytes,
        volumeName(lane.id),
      );
      // A lane folder deleted outside Loom comes back empty and needs its notes again.
      if (!(yield* exists(`${lane.laneDir}/LANE.md`)))
        yield* writeAtomically(
          `${lane.laneDir}/LANE.md`,
          laneMarkdown(lane, rootOf(yield* getSettings)),
        );
      if (device !== lane.device) {
        const next = { ...lane, device };
        lanes.set(lane.id, next);
        yield* store.updateLane(lane.id, { capBytes: lane.capBytes, device }).pipe(Effect.orDie);
      }
      const entry = liveOf(lane.id);
      entry.failed = false;
      entry.message = null;
    },
    (effect, lane) =>
      effect.pipe(
        Effect.tapError((cause) =>
          Effect.sync(() => {
            const entry = liveOf(lane.id);
            entry.failed = true;
            entry.message = cause.message;
          }),
        ),
      ),
  );

  const createLane = Effect.fn("ProjectLifecycle.createLane")(function* (
    checkout: string,
    project: OrchestrationProjectShell,
  ) {
    const settings = yield* getSettings;
    const root = rootOf(settings);
    const entries = yield* node("read checkout", () => NodeFSP.readdir(checkout));
    const capBytes = laneCapBytes(settings, project.id, isAppleCheckout(entries));
    const existing = [...lanes.values()].map((lane) => ({
      projectId: lane.projectId as string,
      folder: NodePath.basename(NodePath.dirname(lane.laneDir)),
    }));
    const folder = projectFolder({
      projectId: project.id,
      workspaceRoot: project.workspaceRoot,
      existing,
    });
    const projectDir = `${root}/${folder}`;
    const taken = new Set(
      yield* Effect.promise(() => NodeFSP.readdir(projectDir).catch(() => [] as Array<string>)),
    );
    const name = uniqueName(laneBaseName(checkout, project.workspaceRoot), taken);
    const id = NodeCrypto.randomUUID();
    const rootIsNew = !(yield* exists(root));
    const lane: LaneRow = {
      id,
      checkoutPath: checkout,
      projectId: project.id,
      projectName: project.title,
      name,
      laneDir: `${projectDir}/${name}`,
      backend,
      capBytes,
      device: null,
      createdAt: DateTime.formatIso(yield* DateTime.now),
      portBase: yield* claimPortBase(id),
    };
    yield* node("create lane", () => NodeFSP.mkdir(lane.laneDir, { recursive: true }));
    if (rootIsNew && platform === "darwin")
      yield* runner
        .run({ command: "tmutil", args: ["addexclusion", root], timeout: "10 seconds" })
        .pipe(Effect.ignore);
    const created = yield* opsFor(lane)
      .create(lanePaths(lane), capBytes, volumeName(id))
      .pipe(
        Effect.map(({ device }) => ({ ...lane, device })),
        // A failed image leaves a folder lane with a soft cap rather than no lane.
        Effect.catch((cause) =>
          lane.backend === "image"
            ? Effect.logWarning("Lane image creation failed; using a folder", { cause }).pipe(
                Effect.andThen(
                  node("remove image", () =>
                    NodeFSP.rm(lanePaths(lane).imagePath, { force: true }),
                  ),
                ),
                Effect.andThen(
                  node("unlock space", () => NodeFSP.chmod(lanePaths(lane).spacePath, 0o755)),
                ),
                Effect.andThen(spaces.folder.create(lanePaths(lane), capBytes, "")),
                Effect.as({ ...lane, backend: "folder" as const }),
              )
            : Effect.fail(cause),
        ),
      );
    yield* writeAtomically(`${lane.laneDir}/LANE.md`, laneMarkdown(created, root));
    yield* store.insertLane(created).pipe(Effect.orDie);
    lanes.set(id, created);
    liveOf(id).mounted = true;
    yield* writeShellFiles;
    return created;
  });

  /** The lane for a thread's checkout, created or reattached as needed. */
  const ensureForThread = Effect.fn("ProjectLifecycle.ensureForThread")(function* (
    threadId: ThreadId,
    // Root setup can precede restoration of the thread's worktree.
    setupCheckout?: string,
  ) {
    const view = yield* loadThreads.pipe(
      Effect.mapError(() => error("command-failed", "Could not read threads.")),
    );
    const thread = view.threads.find((candidate) => candidate.id === threadId);
    if (thread === undefined) return yield* error("not-found", "The thread was not found.");
    const project = view.projects.get(thread.projectId);
    const checkout = setupCheckout ?? checkoutOf(thread, view.projects);
    if (project === undefined || checkout === null)
      return yield* error("not-found", "The thread has no project checkout.");
    return yield* mutate.withPermits(1)(
      Effect.gen(function* () {
        const current = laneForCheckout(checkout);
        if (current === undefined) {
          if (!(yield* getSettings).enabled)
            return yield* error("disabled", "Lanes are turned off in Settings.");
          return yield* createLane(checkout, project);
        }
        if (!(yield* opsFor(current).isMounted(lanePaths(current)))) yield* attach(current);
        // A failed shell-file write can leave the lane persisted but unusable for setup.
        if (!shellFilesReady) yield* writeShellFiles;
        return lanes.get(current.id) ?? current;
      }),
    );
  });

  const buildEnvironmentOf = (lane: LaneRow, settings: ProjectLifecycleSettings) => {
    const shims = shimsDir(rootOf(settings));
    const { spacePath } = lanePaths(lane);
    return {
      name: lane.name,
      spacePath,
      tmpPath: `${spacePath}/tmp`,
      buildPath: `${spacePath}/build`,
      /** Adds the lane's DerivedData and SourcePackages and takes a build slot for heavy actions. */
      xcodebuild: `${shims}/xcodebuild`,
      slot: `${shims}/lane-slot`,
    };
  };

  /** What another packet needs to run a build inside a thread's lane, creating the lane. */
  const buildEnvironment = Effect.fn("ProjectLifecycle.buildEnvironment")(function* (
    threadId: ThreadId,
  ) {
    const lane = yield* ensureForThread(threadId);
    return buildEnvironmentOf(lane, yield* getSettings);
  });

  /** The checkout's lane when one exists; never creates or mounts one. */
  const currentBuildEnvironment = Effect.fn("ProjectLifecycle.currentBuildEnvironment")(function* (
    checkout: string,
  ) {
    const lane = laneForCheckout(checkout);
    return lane === undefined ? null : buildEnvironmentOf(lane, yield* getSettings);
  });

  const detach = (lane: LaneRow) =>
    opsFor(lane)
      .detach(lanePaths(lane), lane.device)
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            liveOf(lane.id).mounted = false;
          }),
        ),
      );

  const containsPath = (directory: string, candidate: string) => {
    const relative = NodePath.relative(directory, candidate);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${NodePath.sep}`) &&
        !NodePath.isAbsolute(relative))
    );
  };

  /** Registered checkouts are working files, even when a caller placed them in auxiliary space. */
  const checkoutPathsWithin = Effect.fn("ProjectLifecycle.checkoutPathsWithin")(function* (
    directory: string,
  ) {
    const [snapshot, projectShells] = yield* Effect.all([
      threads.getShellSnapshot(),
      projects.listShells(),
    ]).pipe(
      Effect.mapError(() =>
        error(
          "command-failed",
          "Could not verify project working files before cleaning this lane.",
        ),
      ),
    );
    const candidates = new Set([
      ...projectShells.map((project) => project.workspaceRoot),
      ...[...snapshot.threads, ...snapshot.archivedThreads].flatMap((thread) =>
        thread.worktreePath === null ? [] : [thread.worktreePath],
      ),
    ]);
    const resolveExistingPath = (target: string) =>
      node("inspect registered checkout", async () => {
        try {
          return await NodeFSP.realpath(target);
        } catch (cause) {
          if (
            cause instanceof Error &&
            "code" in cause &&
            (cause.code === "ENOENT" || cause.code === "ENOTDIR")
          )
            return null;
          throw cause;
        }
      });
    const resolvedDirectory = NodePath.resolve(directory);
    const realDirectory = (yield* resolveExistingPath(resolvedDirectory)) ?? resolvedDirectory;
    const checkouts: string[] = [];
    for (const candidate of candidates) {
      const checkout = NodePath.resolve(candidate);
      const realCheckout = yield* resolveExistingPath(checkout);
      // Released checkouts retain metadata; their absent paths do not prevent cache cleanup.
      if (realCheckout === null) continue;
      // Keep both spellings: registered aliases and /var vs /private/var must reach the same guard.
      if (containsPath(resolvedDirectory, checkout) || containsPath(realDirectory, realCheckout))
        checkouts.push(checkout, realCheckout);
    }
    return checkouts;
  });

  /**
   * Releases a lane's leases, then detaches and deletes it. A lane with open files stays and
   * says why; the next attempt releases again.
   */
  const removeLane = Effect.fn("ProjectLifecycle.removeLane")(function* (lane: LaneRow) {
    if ((yield* checkoutPathsWithin(lane.laneDir)).length > 0) {
      liveOf(lane.id).message = CHECKOUT_PROTECTION_MESSAGE;
      return false;
    }
    const problems = yield* releaseLeases(lane);
    if (problems.length > 0)
      yield* Effect.logWarning("Some lane leases were not released", {
        lane: lane.laneDir,
        problems,
      });
    const detached = yield* detach(lane).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        Effect.sync(() => {
          liveOf(lane.id).message = cause.message;
          return false;
        }),
      ),
    );
    if (!detached) return false;
    yield* node("remove lane", async () => {
      await NodeFSP.chmod(lanePaths(lane).spacePath, 0o755).catch(() => undefined);
      await NodeFSP.rm(lane.laneDir, { recursive: true, force: true });
      await NodeFSP.rmdir(NodePath.dirname(lane.laneDir)).catch(() => undefined);
    });
    yield* store.deleteLane(lane.id).pipe(Effect.orDie);
    lanes.delete(lane.id);
    live.delete(lane.id);
    const { portBase } = lane;
    if (portBase !== null)
      yield* node("release lane ports", () => claims.release(portBase, lane.id)).pipe(
        Effect.ignore({ log: true }),
      );
    yield* writeShellFiles;
    return true;
  });

  /**
   * An unsettled archived thread sharing a worktree makes its probes answer ready without the
   * settle action, yet sits outside the loaded view. Archived threads cannot settle and
   * unarchiving brings them into the view, so a deletion is the one change the key misses.
   */
  let deletions = 0;

  /**
   * The settlement state a free lane's probes answered for. Any related thread joining,
   * leaving, settling or reopening changes it, and so does any deletion.
   */
  const settlementKey = (lane: LaneRow, view: Threads) =>
    `${deletions}\n` +
    view.threads
      .filter((thread) => checkoutOf(thread, view.projects) === lane.checkoutPath)
      .map(
        (thread) =>
          `${thread.id}:${thread.settledOverride}:${thread.settledAt === null ? "" : DateTime.toEpochMillis(thread.settledAt)}`,
      )
      .toSorted()
      .join("\n");

  /**
   * Only a settled thread with its own worktree runs a settle action; the probe returns at once
   * for every other thread.
   */
  const awaitsSettleAction = (thread: Thread) =>
    thread.settledOverride === "settled" && thread.worktreePath !== null;

  /**
   * Free lanes whose probes all answered ready, by lane id. A lane that stays unchanged, for
   * example one a registered checkout protects, skips its probes on later ticks. A not-ready
   * answer is never kept: the settlement service already remembers a failed settle action, and
   * any other failure deserves a retry.
   */
  const readyLanes = new Map<string, string>();

  /** Settle actions can still use lane files after their thread becomes settled. */
  const reclaimFree = Effect.fn("ProjectLifecycle.reclaimFree")(function* () {
    const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
    if (view === null) return;
    for (const laneId of readyLanes.keys()) if (!lanes.has(laneId)) readyLanes.delete(laneId);
    const free = [...lanes.values()].filter((lane) => holdersOf(lane, view).length === 0);
    let threadsChecked = 0;
    let notReady = 0;
    yield* Effect.forEach(
      free,
      (lane) =>
        Effect.gen(function* () {
          const key = settlementKey(lane, view);
          if (readyLanes.get(lane.id) !== key) {
            readyLanes.delete(lane.id);
            const pending = view.threads.filter(
              (thread) =>
                awaitsSettleAction(thread) &&
                checkoutOf(thread, view.projects) === lane.checkoutPath,
            );
            for (const thread of pending) {
              threadsChecked++;
              // The watchdog repeats this for every free lane each tick, so per-probe spans
              // would flood the trace. Settle actions stay traced on the thread.settled path.
              const ready = yield* settlement
                .prepareForCleanup(thread.id)
                .pipe(Effect.withTracerEnabled(false));
              if (!ready) {
                notReady++;
                liveOf(lane.id).message = "Waiting for the project's finish action to complete.";
                return;
              }
            }
            readyLanes.set(lane.id, key);
          }
          // Startup and settle hooks take the checkout lease before the lane mutation lock.
          yield* withWorkspaceLease(
            NodePath.resolve(lane.checkoutPath),
            mutate.withPermits(1)(
              Effect.gen(function* () {
                const latest = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
                if (latest === null || !lanes.has(lane.id) || holdersOf(lane, latest).length > 0)
                  return;
                // A thread that settled after the probes has a settle action they did not await.
                if (settlementKey(lane, latest) !== key) return;
                yield* removeLane(lane);
              }),
            ),
          );
        }).pipe(Effect.ignore({ log: true })),
      { concurrency: 8, discard: true },
    );
    yield* Effect.annotateCurrentSpan({ lanesChecked: free.length, threadsChecked, notReady });
  });

  const clear = Effect.fn("ProjectLifecycle.clear")(function* (
    lane: LaneRow,
    scope: LaneFreeScope,
  ) {
    const checkouts = yield* checkoutPathsWithin(lane.laneDir);
    let retained = false;
    yield* node("free lane", async () => {
      const folders = scope === "all" ? SPACE_FOLDERS : [scope];
      for (const folder of folders) {
        const dir = `${lanePaths(lane).spacePath}/${folder}`;
        const entries = await NodeFSP.readdir(dir).catch(() => [] as Array<string>);
        await Promise.all(
          entries.map(async (entry) => {
            const target = NodePath.join(dir, entry);
            let realTarget: string;
            try {
              realTarget = await NodeFSP.realpath(target);
            } catch (cause) {
              if (
                cause instanceof Error &&
                "code" in cause &&
                (cause.code === "ENOENT" || cause.code === "ENOTDIR")
              )
                return;
              throw cause;
            }
            if (
              checkouts.some((checkout) =>
                [target, realTarget].some(
                  (alias) => containsPath(alias, checkout) || containsPath(checkout, alias),
                ),
              )
            ) {
              retained = true;
              return;
            }
            await NodeFSP.rm(target, { recursive: true, force: true });
          }),
        );
      }
    });
    if (retained) liveOf(lane.id).message = CHECKOUT_PROTECTION_MESSAGE;
    else if (liveOf(lane.id).message === CHECKOUT_PROTECTION_MESSAGE)
      liveOf(lane.id).message = null;
    return retained;
  });

  /** Detach and attach again so the host gets back the space deleted files held. */
  const remount = (lane: LaneRow) =>
    lane.backend === "image"
      ? detach(lane).pipe(Effect.andThen(attach(lanes.get(lane.id) ?? lane)))
      : Effect.void;

  const grow = Effect.fn("ProjectLifecycle.grow")(function* (lane: LaneRow) {
    const settings = yield* getSettings;
    yield* measureHost();
    const target = growTarget({
      capBytes: lane.capBytes,
      hostFreeBytes: host.free,
      reserveBytes: settings.reserveGb * GB,
    });
    if (target === null)
      return yield* error(
        "no-room",
        `This machine has ${host.free === null ? "unknown" : formatGb(host.free)} free and keeps a ${settings.reserveGb} GB reserve, so the lane cannot grow. Free space in the lane instead.`,
      );
    const { device } = yield* opsFor(lane).resize(lanePaths(lane), target, lane.device);
    const next = { ...lane, capBytes: target, device };
    lanes.set(lane.id, next);
    yield* store.updateLane(lane.id, { capBytes: target, device }).pipe(Effect.orDie);
    yield* writeAtomically(`${lane.laneDir}/LANE.md`, laneMarkdown(next, rootOf(settings))).pipe(
      Effect.ignore,
    );
    return next;
  });

  const steer = (thread: Thread, key: string, text: string) =>
    threads
      .sendToThread({
        projectId: thread.projectId,
        commandId: CommandId.make(`lane-steer:${key}:${thread.id}`),
        threadId: thread.id,
        messageId: MessageId.make(`lane-steer-message:${key}:${thread.id}`),
        text,
        attachments: [],
        mode: "steer",
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(Effect.ignore({ log: true }));

  let lastTmpSweep = 0;
  const tick = Effect.fn("ProjectLifecycle.tick")(function* () {
    const settings = yield* getSettings;
    if (!settings.enabled) return yield* publish();
    yield* measureHost();
    yield* reclaimFree();
    const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
    if (view === null) return yield* publish();
    const reserveBytes = settings.reserveGb * GB;
    const now = yield* Clock.currentTimeMillis;
    const sweepTmp = now - lastTmpSweep >= 60 * 60 * 1000;
    if (sweepTmp) lastTmpSweep = now;

    yield* mutate.withPermits(1)(
      Effect.forEach(
        [...lanes.values()],
        (lane) =>
          Effect.gen(function* () {
            const holders = holdersOf(lane, view);
            if (holders.length === 0) return;
            liveOf(lane.id).portsReleased = false;
            let entry = yield* measure(lane);
            if (!entry.mounted && lane.backend === "image") {
              yield* attach(lane);
              entry = yield* measure(lane, true);
            }
            if (sweepTmp && entry.mounted) {
              yield* pruneLaneTmp({
                spacePath: lanePaths(lane).spacePath,
                protectedPaths: yield* checkoutPathsWithin(lane.laneDir),
                lsofPath: options.lsofPath ?? "lsof",
              }).pipe(Effect.provideService(ProcessRunner.ProcessRunner, runner));
            }
            const running = holders.filter(threadRunning);
            const wasSteered = entry.steered;
            const next = laneActions(
              {
                capBytes: lane.capBytes,
                usedBytes: entry.usedBytes,
                imageBytes: entry.imageBytes,
                running: running.length > 0,
                mounted: entry.mounted,
              },
              entry.steered,
            );
            entry.steered = next.steered;
            if (next.steered && !wasSteered) entry.crossingAt = yield* Clock.currentTimeMillis;
            for (const action of next.actions) {
              if (action.type === "steer" && entry.usedBytes !== null) {
                const text = laneSteerText({
                  usedBytes: entry.usedBytes,
                  capBytes: lane.capBytes,
                  tmpPath: `${lanePaths(lane).spacePath}/tmp`,
                });
                yield* Effect.forEach(
                  running,
                  (thread) => steer(thread, `${lane.id}:${entry.crossingAt}`, text),
                  { discard: true },
                );
              } else if (action.type === "clear-tmp") {
                // Automatic pressure relief follows the same age and open-file checks as the hourly sweep.
                if (!sweepTmp)
                  yield* pruneLaneTmp({
                    spacePath: lanePaths(lane).spacePath,
                    protectedPaths: yield* checkoutPathsWithin(lane.laneDir),
                    lsofPath: options.lsofPath ?? "lsof",
                  }).pipe(Effect.provideService(ProcessRunner.ProcessRunner, runner));
                entry = yield* measure(lanes.get(lane.id) ?? lane, true);
                const current = lanes.get(lane.id) ?? lane;
                if (
                  entry.usedBytes !== null &&
                  shouldGrow(entry.usedBytes, current.capBytes) &&
                  host.free !== null &&
                  host.free >= reserveBytes
                )
                  yield* grow(current);
              } else if (action.type === "remount") {
                yield* remount(lane);
              }
            }
          }).pipe(
            Effect.catch((cause) =>
              Effect.sync(() => {
                liveOf(lane.id).message = cause.message;
              }),
            ),
          ),
        { discard: true },
      ),
    );

    yield* scanLeases(false).pipe(Effect.ignore({ log: true }));

    const pressure = machinePressure({
      hostFreeBytes: host.free,
      reserveBytes,
      inEpisode: reserveEpisode.active,
    });
    if (pressure.steer)
      reserveEpisode = { active: true, startedAt: yield* Clock.currentTimeMillis };
    else reserveEpisode = { ...reserveEpisode, active: pressure.inEpisode };
    if (pressure.steer && host.free !== null) {
      const text = reserveSteerText({ hostFreeBytes: host.free, reserveBytes });
      const running = new Map<string, Thread>();
      for (const lane of lanes.values())
        for (const thread of holdersOf(lane, view))
          if (threadRunning(thread)) running.set(thread.id, thread);
      yield* Effect.forEach(
        running.values(),
        (thread) => steer(thread, `reserve:${reserveEpisode.startedAt}`, text),
        { discard: true },
      );
    }
    return yield* publish();
  });

  const requireLane = (laneId: string): Effect.Effect<LaneRow, ProjectLifecycleError> => {
    const lane = lanes.get(laneId);
    return lane === undefined
      ? Effect.fail(error("not-found", "That lane no longer exists."))
      : Effect.succeed(lane);
  };

  const refreshedView = Effect.fn("ProjectLifecycle.refreshedView")(function* (laneId: string) {
    const status = yield* publish();
    const lane = status.lanes.find((candidate) => candidate.id === laneId);
    return lane ?? (yield* error("not-found", "That lane no longer exists."));
  });

  const free = Effect.fn("ProjectLifecycle.free")(function* (laneId: string, scope: LaneFreeScope) {
    yield* mutate.withPermits(1)(
      Effect.gen(function* () {
        const lane = yield* requireLane(laneId);
        const retained = yield* clear(lane, scope);
        const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
        const idle = view !== null && !holdersOf(lane, view).some(threadRunning);
        // Running agents may hold files open; the watchdog remounts once they are idle.
        if (idle && !retained) yield* remount(lane).pipe(Effect.ignore);
        yield* measure(lanes.get(laneId) ?? lane, true);
        if (retained) {
          yield* publish();
          return yield* error("busy", CHECKOUT_PROTECTION_MESSAGE);
        }
      }),
    );
    return yield* refreshedView(laneId);
  });

  const growLane = Effect.fn("ProjectLifecycle.growLane")(function* (laneId: string) {
    yield* mutate.withPermits(1)(
      requireLane(laneId).pipe(
        Effect.flatMap(grow),
        Effect.flatMap((lane) => measure(lane, true)),
      ),
    );
    return yield* refreshedView(laneId);
  });

  const mount = Effect.fn("ProjectLifecycle.mount")(function* (laneId: string) {
    yield* mutate.withPermits(1)(
      requireLane(laneId).pipe(
        Effect.tap(attach),
        Effect.flatMap((lane) => measure(lanes.get(laneId) ?? lane, true)),
      ),
    );
    return yield* refreshedView(laneId);
  });

  const discard = Effect.fn("ProjectLifecycle.discard")(function* (laneId: string) {
    const removed = yield* mutate.withPermits(1)(
      requireLane(laneId).pipe(Effect.flatMap(removeLane)),
    );
    if (!removed)
      return yield* error(
        "busy",
        liveOf(laneId).message ??
          "Files in this lane are open. Stop the processes using it, then try again.",
      );
    yield* publish();
  });

  const adoptLease = Effect.fn("ProjectLifecycle.adoptLease")(function* (
    laneId: string,
    kind: AdoptableLeaseKind,
    ref: string,
    label: string | undefined,
  ) {
    yield* mutate.withPermits(1)(
      Effect.gen(function* () {
        const lane = yield* requireLane(laneId);
        const now = yield* Clock.currentTimeMillis;
        if (kind === "process") {
          const pid = /^\d+$/.test(ref.trim()) ? Number(ref.trim()) : Number.NaN;
          const table = yield* leaseOps.processTable;
          const info = table?.get(pid);
          if (table === null || info === undefined)
            return yield* error("not-found", `No process ${ref} is running.`);
          if (ancestorsOf(table, process.pid).has(pid))
            return yield* error("unsupported", "Loom's own processes cannot be leased.");
          if ((yield* runtimeProcesses).has(pid))
            return yield* error(
              "unsupported",
              `Process ${pid} forwards ports for containers, so a lane cannot own it. Label the container ${DOCKER_LABEL}=${lane.id} instead.`,
            );
          try {
            process.kill(pid, 0);
          } catch {
            return yield* error("unsupported", `Process ${pid} belongs to another user.`);
          }
          yield* appendLedger(lane, {
            kind,
            ref: String(pid),
            label: label ?? `Process ${pid}`,
            stamp: info.started,
          });
        } else {
          const simulators = yield* leaseOps.simulators;
          const device = simulators?.get(ref.trim());
          if (device === undefined)
            return yield* error("not-found", `No simulator ${ref} was found.`);
          for (const other of lanes.values())
            if (
              other.id !== lane.id &&
              (yield* readLedger(other)).some(
                (entry) => entry.kind === "simulator" && entry.ref === ref.trim(),
              )
            )
              return yield* error(
                "busy",
                `That simulator belongs to the ${other.projectName} / ${other.name} lane.`,
              );
          yield* appendLedger(lane, {
            kind,
            ref: ref.trim(),
            label: label ?? device.name,
            stamp: String(Math.floor(now / 1000)),
          });
        }
        yield* scanLeases(true);
      }),
    );
    return yield* refreshedView(laneId);
  });

  /** Stops a process, removes a container or volume, or deletes a simulator the lane owns. */
  const releaseLease = Effect.fn("ProjectLifecycle.releaseLease")(function* (
    laneId: string,
    kind: LaneLeaseKind,
    ref: string,
  ) {
    yield* mutate.withPermits(1)(
      Effect.gen(function* () {
        const lane = yield* requireLane(laneId);
        yield* scanLeases(true);
        const lease = liveOf(lane.id).leases.find(
          (candidate) => candidate.kind === kind && candidate.ref === ref,
        );
        if (lease === undefined)
          return yield* error("not-found", "This lane no longer holds that lease.");
        if (kind === "process" && (yield* runtimeProcesses).has(Number(ref)))
          return yield* error(
            "unsupported",
            `Process ${ref} forwards ports for containers, so stopping it would cut off every container. Remove the container instead.`,
          );
        const problems =
          kind === "process"
            ? yield* stopProcesses([Number(ref)], scan.runtime)
            : kind === "simulator"
              ? [
                  yield* releaseSimulator(
                    lane,
                    ref,
                    yield* loadThreads.pipe(Effect.orElseSucceed(() => null)),
                  ),
                ]
              : [yield* leaseOps.removeDocker({ kind, ref })];
        yield* scanLeases(true);
        const failed = problems.filter((problem) => problem !== null);
        if (failed.length > 0) return yield* error("command-failed", failed.join(" "));
      }),
    );
    return yield* refreshedView(laneId);
  });

  const updateSettings = Effect.fn("ProjectLifecycle.updateSettings")(function* (
    next: ProjectLifecycleSettings,
  ) {
    const previous = yield* getSettings;
    if (rootOf(next) !== rootOf(previous) && lanes.size > 0)
      return yield* error("busy", "Discard the existing lanes before moving the lanes folder.");
    const saved = yield* store.updateSettings(next).pipe(Effect.orDie);
    yield* writeShellFiles;
    if (shellInstalled && rootOf(next) !== rootOf(previous)) yield* installShell();
    // The watchdog skips measuring while lanes are off, so turning them on would show no free space.
    yield* measureHost();
    yield* publish();
    return saved;
  });

  const installShell = Effect.fn("ProjectLifecycle.installShell")(function* () {
    const root = rootOf(yield* getSettings);
    yield* writeShellFiles;
    const profile = yield* readProfile;
    yield* writeAtomically(profile.target, addProfileBlock(profile.text, root));
    yield* refreshShellInstalled;
    yield* publish();
  });

  const removeShell = Effect.fn("ProjectLifecycle.removeShell")(function* () {
    const profile = yield* readProfile;
    if (hasProfileBlock(profile.text))
      yield* writeAtomically(profile.target, removeProfileBlock(profile.text));
    yield* refreshShellInstalled;
    yield* publish();
  });

  /** Reattaches lanes after reboot, hides existing mounts and removes lanes nobody holds. */
  const reconcile = Effect.fn("ProjectLifecycle.reconcile")(function* () {
    yield* refreshShellInstalled;
    yield* reclaimFree();
    yield* mutate.withPermits(1)(
      Effect.forEach(
        [...lanes.values()],
        (lane) => attach(lane).pipe(Effect.ignore({ log: true })),
        { discard: true },
      ),
    );
    if (lanes.size > 0) yield* writeShellFiles;
    yield* scanLeases(true).pipe(Effect.ignore({ log: true }));
    yield* publish();
  });

  const start = Effect.fn("ProjectLifecycle.start")(function* () {
    yield* forkParked(
      reconcile().pipe(
        Effect.andThen(tick().pipe(Effect.repeat(Schedule.spaced(WATCHDOG_INTERVAL)))),
        Effect.catchCause((cause) => Effect.logWarning("Lane watchdog stopped", { cause })),
      ),
    );
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, (event) => {
        switch (event.type) {
          case "thread.settled":
            return settlement.prepareForCleanup(event.payload.id).pipe(
              Effect.flatMap((ready) =>
                ready
                  ? releaseThreadDevices(event.payload.id).pipe(Effect.andThen(reclaimFree()))
                  : Effect.void,
              ),
              Effect.andThen(publish()),
              Effect.ignore({ log: true }),
            );
          case "thread.archived":
          case "thread.deleted":
            if (event.type === "thread.deleted") deletions++;
            return getSettings.pipe(
              Effect.flatMap((settings) =>
                settings.enabled
                  ? releaseThreadDevices(event.payload.id).pipe(Effect.ignore({ log: true }))
                  : Effect.void,
              ),
              Effect.andThen(reclaimFree()),
              Effect.andThen(publish()),
              Effect.ignore({ log: true }),
            );
          default:
            return Effect.void;
        }
      }).pipe(
        Effect.catchCause((cause) => Effect.logWarning("Lane event stream failed", { cause })),
      ),
    );
  });

  return {
    start,
    tick,
    reconcile,
    getSettings,
    updateSettings,
    changes: SubscriptionRef.changes(status),
    ensureForThread,
    buildEnvironment,
    currentBuildEnvironment,
    free,
    grow: growLane,
    mount,
    discard,
    adoptLease,
    releaseLease,
    installShell,
    removeShell,
    // Agents ask right after starting things, so their view lists Docker and ports fresh.
    laneView: (laneId: string) =>
      scanLeases(true).pipe(Effect.ignore({ log: true }), Effect.andThen(refreshedView(laneId))),
  };
});

export const make = HostProcess.Platform.pipe(
  Effect.flatMap((platform) =>
    makeWith({
      homeDir: NodeOS.homedir(),
      imageBackend: imageBackendAvailable(platform, NodeOS.release()),
    }),
  ),
);

export class ProjectLifecycleService extends Context.Service<
  ProjectLifecycleService,
  Effect.Success<typeof make>
>()("t3/fork/project-lifecycle/ProjectLifecycleService") {}

export const layer = Layer.effect(
  ProjectLifecycleService,
  make.pipe(Effect.tap((service) => service.start())),
).pipe(Layer.provide(ProcessRunner.layer));
