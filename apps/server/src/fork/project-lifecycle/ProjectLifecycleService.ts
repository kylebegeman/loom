// @effect-diagnostics nodeBuiltinImport:off - Lanes need statfs, realpath and file modes Effect does not expose.
import * as NodeCrypto from "node:crypto";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
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
  type LaneFreeScope,
  type ProjectLifecycleLane,
  type ProjectLifecycleSettings,
  type ProjectLifecycleStatus,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ServerConfig } from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  GB,
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
  renderXcodebuildShim,
  shellDir,
  shimsDir,
} from "./shell.ts";
import { SPACE_FOLDERS, imageBackendAvailable, makeSpaceOps, type LanePaths } from "./space.ts";
import { makeStore, type LaneRow } from "./store.ts";

const WATCHDOG_INTERVAL = "30 seconds";
/** `du` walks the whole folder, so folder lanes are measured less often. */
const FOLDER_MEASURE_INTERVAL_MS = 5 * 60 * 1000;
/** Status snapshots go out only when a size changes by at least this much. */
const STATUS_ROUNDING_BYTES = 100_000_000;

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
}

export interface ProjectLifecycleOptions {
  readonly homeDir: string;
  readonly imageBackend: boolean;
}

const error = (reason: ProjectLifecycleError["reason"], message: string) =>
  new ProjectLifecycleError({ reason, message });

const node = <A>(label: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => error("command-failed", `${label}: ${String(cause)}`),
  });

const exists = (path: string) =>
  Effect.promise(() =>
    NodeFs.access(path).then(
      () => true,
      () => false,
    ),
  );

const writeAtomically = (path: string, contents: string, mode = 0o644) =>
  node(`write ${path}`, async () => {
    await NodeFs.mkdir(NodePath.dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await NodeFs.writeFile(temporary, contents, { mode });
    await NodeFs.rename(temporary, path);
  });

const lanePaths = (lane: Pick<LaneRow, "laneDir">): LanePaths => ({
  laneDir: lane.laneDir,
  spacePath: `${lane.laneDir}/space`,
  imagePath: `${lane.laneDir}/space.asif`,
});

const checkoutOf = (thread: Thread, projects: ReadonlyMap<string, OrchestrationProjectShell>) =>
  thread.worktreePath ?? projects.get(thread.projectId)?.workspaceRoot ?? null;

const laneMarkdown = (lane: LaneRow) => {
  const space = lanePaths(lane).spacePath;
  return `# Lane: ${lane.projectName} / ${lane.name}

Checkout: ${lane.checkoutPath}
Cap: ${formatGb(lane.capBytes)} (${lane.backend === "image" ? "capped disk image" : "folder, soft cap"})

Shells inside the checkout get \`TMPDIR=${space}/tmp/\` and \`LOOM_LANE_BUILD\` / \`LOOM_LANE_DATA\`.

- \`space/tmp\`: scratch. Loom clears it when the lane is idle and nearly full.
- \`space/build\`: DerivedData, package checkouts and other build output.
- \`space/data\`: files worth keeping while the thread is active.

Agents free space with the \`loom_project_lifecycle_free\` tool and raise the cap with
\`loom_project_lifecycle_grow\`. Loom removes this lane when every thread using the checkout is
settled or archived. The checkout itself is never touched.
`;
};

export const makeWith = (options: ProjectLifecycleOptions) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const threads = yield* ThreadManagementService;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const runner = yield* ProcessRunner.ProcessRunner;
    const store = yield* makeStore;
    const spaces = yield* makeSpaceOps;
    const backend = options.imageBackend ? "image" : "folder";
    const opsFor = (lane: Pick<LaneRow, "backend">) =>
      lane.backend === "image" ? spaces.image : spaces.folder;
    const profilePath = `${options.homeDir}/.zshenv`;

    const defaults: ProjectLifecycleSettings = {
      // A dev server keeps its own lanes and starts disabled, so it never touches real lanes.
      enabled: config.devUrl === undefined,
      lanesRoot:
        config.devUrl === undefined
          ? `${options.homeDir}/Developer/lanes`
          : `${config.stateDir}/fork/project-lifecycle/lanes`,
      ...DEFAULT_PROJECT_LIFECYCLE_CAPS,
      projectCapsGb: {},
    };
    const getSettings = store.getSettings(defaults).pipe(Effect.orDie);
    const rootOf = (settings: ProjectLifecycleSettings) =>
      settings.lanesRoot.startsWith("~/")
        ? `${options.homeDir}${settings.lanesRoot.slice(1)}`
        : settings.lanesRoot;

    const lanes = new Map<string, LaneRow>();
    for (const lane of yield* store.listLanes().pipe(Effect.orDie)) lanes.set(lane.id, lane);
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

    // --- Threads ---------------------------------------------------------------------------

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

    // --- Shell files -------------------------------------------------------------------------

    const writeShellFiles = Effect.gen(function* () {
      const root = rootOf(yield* getSettings);
      const index = yield* Effect.forEach([...lanes.values()], (lane) =>
        Effect.promise(() =>
          NodeFs.realpath(lane.checkoutPath).catch(() => lane.checkoutPath),
        ).pipe(
          Effect.map((real) => ({
            checkoutPaths: [lane.checkoutPath, real],
            spacePath: lanePaths(lane).spacePath,
          })),
        ),
      );
      yield* writeAtomically(`${shellDir(root)}/lanes.tsv`, renderIndex(index));
      yield* writeAtomically(`${shellDir(root)}/lanes.zsh`, renderHook(root));
      yield* writeAtomically(`${shimsDir(root)}/xcodebuild`, renderXcodebuildShim(root), 0o755);
    }).pipe(
      Effect.catch((cause) => Effect.logWarning("Could not write lane shell files", { cause })),
    );

    const readProfile = Effect.promise(() =>
      NodeFs.realpath(profilePath)
        .catch(() => profilePath)
        .then(async (target) => ({
          target,
          text: await NodeFs.readFile(target, "utf8").catch(() => ""),
        })),
    );

    const refreshShellInstalled = readProfile.pipe(
      Effect.map(({ text }) => {
        shellInstalled = hasProfileBlock(text);
      }),
    );

    // --- Status ------------------------------------------------------------------------------

    const laneView = (lane: LaneRow, holders: ReadonlyArray<Thread>): ProjectLifecycleLane => {
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
      };
    };

    const buildStatus = (view: Threads | null) =>
      Effect.gen(function* () {
        const settings = yield* getSettings;
        const reserveBytes = settings.reserveGb * GB;
        return {
          enabled: settings.enabled,
          lanesRoot: rootOf(settings),
          backend,
          hostFreeBytes: host.free,
          hostTotalBytes: host.total,
          reserveBytes,
          belowReserve: host.free !== null && host.free < reserveBytes,
          shell: { installed: shellInstalled, profilePath },
          lanes: [...lanes.values()].map((lane) =>
            laneView(lane, view === null ? [] : holdersOf(lane, view)),
          ),
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

    // --- Measuring ---------------------------------------------------------------------------

    const measureHost = Effect.fn("ProjectLifecycle.measureHost")(function* () {
      let path = rootOf(yield* getSettings);
      while (path !== "/" && !(yield* exists(path))) path = NodePath.dirname(path);
      host = yield* Effect.promise(() =>
        NodeFs.statfs(path).then(
          (stats) => ({ free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize }),
          () => ({ free: null, total: null }),
        ),
      );
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

    // --- Lane operations ---------------------------------------------------------------------

    const attach = (lane: LaneRow) =>
      Effect.gen(function* () {
        const { device } = yield* opsFor(lane).attach(lanePaths(lane));
        if (device !== lane.device) {
          const next = { ...lane, device };
          lanes.set(lane.id, next);
          yield* store.updateLane(lane.id, { capBytes: lane.capBytes, device }).pipe(Effect.orDie);
        }
        const entry = liveOf(lane.id);
        entry.failed = false;
        entry.message = null;
      }).pipe(
        Effect.tapError((cause) =>
          Effect.sync(() => {
            const entry = liveOf(lane.id);
            entry.failed = true;
            entry.message = cause.message;
          }),
        ),
      );

    const createLane = Effect.fn("ProjectLifecycle.createLane")(function* (
      checkout: string,
      project: OrchestrationProjectShell,
    ) {
      const settings = yield* getSettings;
      const root = rootOf(settings);
      const entries = yield* node("read checkout", () => NodeFs.readdir(checkout));
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
        yield* Effect.promise(() => NodeFs.readdir(projectDir).catch(() => [] as Array<string>)),
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
      };
      yield* node("create lane", () => NodeFs.mkdir(lane.laneDir, { recursive: true }));
      if (rootIsNew && process.platform === "darwin")
        yield* runner
          .run({ command: "tmutil", args: ["addexclusion", root], timeout: "10 seconds" })
          .pipe(Effect.ignore);
      const created = yield* opsFor(lane)
        .create(lanePaths(lane), capBytes, `loom-${id.slice(0, 8)}`)
        .pipe(
          Effect.map(({ device }) => ({ ...lane, device })),
          // A failed image leaves a folder lane with a soft cap rather than no lane.
          Effect.catch((cause) =>
            lane.backend === "image"
              ? Effect.logWarning("Lane image creation failed; using a folder", { cause }).pipe(
                  Effect.andThen(
                    node("remove image", () =>
                      NodeFs.rm(lanePaths(lane).imagePath, { force: true }),
                    ),
                  ),
                  Effect.andThen(
                    node("unlock space", () => NodeFs.chmod(lanePaths(lane).spacePath, 0o755)),
                  ),
                  Effect.andThen(spaces.folder.create(lanePaths(lane), capBytes, "")),
                  Effect.as({ ...lane, backend: "folder" as const }),
                )
              : Effect.fail(cause),
          ),
        );
      yield* writeAtomically(`${lane.laneDir}/LANE.md`, laneMarkdown(created));
      yield* store.insertLane(created).pipe(Effect.orDie);
      lanes.set(id, created);
      liveOf(id).mounted = true;
      yield* writeShellFiles;
      return created;
    });

    /** The lane for a thread's checkout, created or reattached as needed. */
    const ensureForThread = Effect.fn("ProjectLifecycle.ensureForThread")(function* (
      threadId: ThreadId,
    ) {
      const view = yield* loadThreads.pipe(
        Effect.mapError(() => error("command-failed", "Could not read threads.")),
      );
      const thread = view.threads.find((candidate) => candidate.id === threadId);
      if (thread === undefined) return yield* error("not-found", "The thread was not found.");
      const project = view.projects.get(thread.projectId);
      const checkout = checkoutOf(thread, view.projects);
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
          return lanes.get(current.id) ?? current;
        }),
      );
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

    /** Detaches and deletes a lane. A lane with open files stays and says why. */
    const removeLane = Effect.fn("ProjectLifecycle.removeLane")(function* (lane: LaneRow) {
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
        await NodeFs.chmod(lanePaths(lane).spacePath, 0o755).catch(() => undefined);
        await NodeFs.rm(lane.laneDir, { recursive: true, force: true });
        await NodeFs.rmdir(NodePath.dirname(lane.laneDir)).catch(() => undefined);
      });
      yield* store.deleteLane(lane.id).pipe(Effect.orDie);
      lanes.delete(lane.id);
      live.delete(lane.id);
      yield* writeShellFiles;
      return true;
    });

    /** Removes lanes no thread holds any more. Skipped when threads cannot be read. */
    const reclaimFree = Effect.fn("ProjectLifecycle.reclaimFree")(function* (released?: ThreadId) {
      const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
      if (view === null) return;
      yield* mutate.withPermits(1)(
        Effect.forEach(
          [...lanes.values()].filter((lane) => holdersOf(lane, view, released).length === 0),
          (lane) => removeLane(lane).pipe(Effect.ignore({ log: true })),
          { discard: true },
        ),
      );
    });

    const clear = (lane: LaneRow, scope: LaneFreeScope) =>
      node("free lane", async () => {
        const folders = scope === "all" ? SPACE_FOLDERS : [scope];
        for (const folder of folders) {
          const dir = `${lanePaths(lane).spacePath}/${folder}`;
          const entries = await NodeFs.readdir(dir).catch(() => [] as Array<string>);
          await Promise.all(
            entries.map((entry) => NodeFs.rm(`${dir}/${entry}`, { recursive: true, force: true })),
          );
        }
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
      yield* writeAtomically(`${lane.laneDir}/LANE.md`, laneMarkdown(next)).pipe(Effect.ignore);
      return next;
    });

    // --- Steering ----------------------------------------------------------------------------

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

    // --- Watchdog ----------------------------------------------------------------------------

    const tick = Effect.fn("ProjectLifecycle.tick")(function* () {
      const settings = yield* getSettings;
      if (!settings.enabled) return yield* publish();
      yield* measureHost();
      const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
      if (view === null) return yield* publish();
      const reserveBytes = settings.reserveGb * GB;

      yield* mutate.withPermits(1)(
        Effect.forEach(
          [...lanes.values()],
          (lane) =>
            Effect.gen(function* () {
              const holders = holdersOf(lane, view);
              if (holders.length === 0) return yield* removeLane(lane).pipe(Effect.asVoid);
              let entry = yield* measure(lane);
              if (!entry.mounted && lane.backend === "image") {
                yield* attach(lane);
                entry = yield* measure(lane, true);
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
                  yield* clear(lane, "tmp");
                  yield* remount(lane);
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

    // --- Actions -----------------------------------------------------------------------------

    const requireLane = (laneId: string): Effect.Effect<LaneRow, ProjectLifecycleError> => {
      const lane = lanes.get(laneId);
      return lane === undefined
        ? Effect.fail(error("not-found", "That lane no longer exists."))
        : Effect.succeed(lane);
    };

    const refreshedView = (laneId: string) =>
      Effect.gen(function* () {
        const status = yield* publish();
        const lane = status.lanes.find((candidate) => candidate.id === laneId);
        return lane ?? (yield* error("not-found", "That lane no longer exists."));
      });

    const free = Effect.fn("ProjectLifecycle.free")(function* (
      laneId: string,
      scope: LaneFreeScope,
    ) {
      yield* mutate.withPermits(1)(
        Effect.gen(function* () {
          const lane = yield* requireLane(laneId);
          yield* clear(lane, scope);
          const view = yield* loadThreads.pipe(Effect.orElseSucceed(() => null));
          const idle = view !== null && !holdersOf(lane, view).some(threadRunning);
          // Running agents may hold files open; the watchdog remounts once they are idle.
          if (idle) yield* remount(lane).pipe(Effect.ignore);
          yield* measure(lanes.get(laneId) ?? lane, true);
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
          "Files in this lane are open. Stop the processes using it, then try again.",
        );
      yield* publish();
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

    // --- Lifecycle ---------------------------------------------------------------------------

    /** Reattaches lanes that detached on reboot and removes lanes nobody holds. */
    const reconcile = Effect.fn("ProjectLifecycle.reconcile")(function* () {
      yield* refreshShellInstalled;
      yield* reclaimFree();
      yield* mutate.withPermits(1)(
        Effect.forEach(
          [...lanes.values()],
          (lane) =>
            opsFor(lane)
              .isMounted(lanePaths(lane))
              .pipe(
                Effect.flatMap((mounted) => (mounted ? Effect.void : attach(lane))),
                Effect.ignore({ log: true }),
              ),
          { discard: true },
        ),
      );
      if (lanes.size > 0) yield* writeShellFiles;
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
            case "run.created":
              return getSettings.pipe(
                Effect.flatMap((settings) =>
                  settings.enabled
                    ? ensureForThread(event.payload.threadId).pipe(
                        Effect.andThen(publish()),
                        Effect.ignore({ log: true }),
                      )
                    : Effect.void,
                ),
              );
            case "thread.settled":
            case "thread.archived":
            case "thread.deleted":
              return reclaimFree(event.payload.id).pipe(
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
      free,
      grow: growLane,
      mount,
      discard,
      installShell,
      removeShell,
      laneView: (laneId: string) => refreshedView(laneId),
    };
  });

export const make = makeWith({
  homeDir: NodeOs.homedir(),
  imageBackend: imageBackendAvailable(),
});

export class ProjectLifecycleService extends Context.Service<
  ProjectLifecycleService,
  Effect.Success<typeof make>
>()("t3/fork/project-lifecycle/ProjectLifecycleService") {}

export const layer = Layer.effect(
  ProjectLifecycleService,
  make.pipe(Effect.tap((service) => service.start())),
).pipe(Layer.provide(ProcessRunner.layer));
