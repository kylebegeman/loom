import type { ThreadId } from "@t3tools/contracts";
import {
  ProjectStorageError,
  type ProjectStorageCategory,
  type ProjectStorageCategoryTotal,
  type ProjectStorageBreakdown,
  type ProjectStorageReport,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isNetworkPath } from "@t3tools/shared/path";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as DatabaseStorage from "../../persistence/DatabaseStorage.ts";
import * as Settings from "../../serverSettings.ts";
import * as StorageCleanup from "../../storageCleanup.ts";
import { managedWorktreesDirectories } from "../../worktreesDirectory.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as LibraryWorkspaceStore from "../project-library/LibraryWorkspaceStore.ts";
import * as LibraryGitFetch from "../project-library/LibraryGitFetch.ts";
import * as ProjectLifecycle from "./ProjectLifecycleService.ts";
import * as Accounting from "./StorageCleanupAccounting.ts";
import { measureStoragePath } from "./storageMeasurement.ts";

const STORAGE_CACHE_MS = 60_000;
const ROOT_LIMIT = 512;
type MutableTotal = {
  -readonly [K in keyof ProjectStorageCategoryTotal]: ProjectStorageCategoryTotal[K];
};
const categories: ReadonlyArray<ProjectStorageCategory> = [
  "worktrees",
  "primary",
  "library-copies",
  "git-mirrors",
  "lanes",
  "scratch",
  "database",
];
type Root = {
  path: string;
  kind: ProjectStorageCategory;
  repository?: string | undefined;
  threadId?: ThreadId | undefined;
  released?: boolean | undefined;
  borrowed?: boolean;
};

export class ProjectStorageInventory extends Context.Service<
  ProjectStorageInventory,
  {
    readonly byCategory: (input?: {
      readonly refresh?: boolean;
    }) => Effect.Effect<ProjectStorageReport, ProjectStorageError>;
  }
>()("t3/fork/project-lifecycle/ProjectStorageInventory") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const home = yield* HostProcess.HomeDirectory;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* Settings.ServerSettingsService;
  const workspaces = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  const mirrors = yield* LibraryGitFetch.LibraryGitFetch;
  const lifecycle = yield* ProjectLifecycle.ProjectLifecycleService;
  const databaseStorage = yield* DatabaseStorage.DatabaseStorage;
  const cleanup = yield* StorageCleanup.StorageCleanup;
  const accounting = yield* Accounting.StorageCleanupAccounting;
  const git = yield* Effect.serviceOption(GitVcsDriver.GitVcsDriver);
  const lock = yield* Semaphore.make(1);
  let cached: { at: number; revision: number; breakdown: ProjectStorageBreakdown } | null = null;

  const read = Effect.fn("ProjectStorageInventory.measure")(
    function* () {
      const [snapshot, projectRows, preferences, receipts, mirrorRows, laneOption, databaseOption] =
        yield* Effect.all([
          projections.getShellSnapshot(),
          projects.listShells(),
          settings.getSettings,
          workspaces.receipts,
          mirrors.mirrorLocations,
          lifecycle.changes.pipe(Stream.runHead),
          databaseStorage.status.pipe(Stream.runHead),
        ]).pipe(Effect.mapError(() => new ProjectStorageError({ reason: "unavailable" })));
      const lanes = Option.getOrNull(laneOption);
      const database = Option.getOrNull(databaseOption);
      const roots: Root[] = [];
      const deadline = (yield* Clock.currentTimeMillis) + 30_000;
      const totals = new Map<ProjectStorageCategory, MutableTotal>(
        categories.map((kind) => [
          kind,
          {
            kind,
            bytes: 0,
            knownBytes: 0,
            locations: 0,
            unknownLocations: 0,
            landed: 0,
            released: 0,
          },
        ]),
      );
      const unknown = (kind: ProjectStorageCategory, count = 1) => {
        const row = totals.get(kind)!;
        row.unknownLocations += count;
        row.bytes = null;
      };
      const scratch = new Set([
        path.resolve(config.baseDir, "scratch"),
        path.resolve(config.managedProjectsRoot ?? config.baseDir, "scratch"),
      ]);
      const projectById = new Map(projectRows.map((project) => [project.id, project]));
      for (const project of projectRows)
        if (!scratch.has(path.resolve(project.workspaceRoot)))
          roots.push({ path: project.workspaceRoot, kind: "primary" });
      const threads = [...snapshot.threads, ...snapshot.archivedThreads];
      const released = new Set(lanes?.releasedCheckouts ?? []);
      for (const thread of threads) {
        if (thread.worktreePath === null) continue;
        const project = projectById.get(thread.projectId);
        roots.push({
          path: thread.worktreePath,
          kind:
            project && scratch.has(path.resolve(project.workspaceRoot)) ? "scratch" : "worktrees",
          repository: project?.workspaceRoot,
          threadId: thread.id,
          released: released.has(thread.id),
        });
      }
      const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));
      for (const root of [
        path.join(config.stateDir, "scratch-archives"),
        path.join(config.stateDir, "project-archives"),
      ])
        if (yield* exists(root))
          roots.push({
            path: root,
            kind: root.endsWith("scratch-archives") ? "scratch" : "primary",
          });
      for (const receipt of receipts) {
        if (receipt.copy.ownership === "borrowed")
          roots.push({ path: receipt.copy.rootPath, kind: "primary", borrowed: true });
        if (receipt.copy.ownership === "managed")
          roots.push({
            path: receipt.copy.rootPath,
            kind: "library-copies",
            released: receipt.copy.state === "released",
          });
        if (receipt.removalPath !== null && (yield* exists(receipt.removalPath)))
          roots.push({ path: receipt.removalPath, kind: "library-copies" });
        if (receipt.archivePath !== null && (yield* exists(receipt.archivePath)))
          roots.push({ path: receipt.archivePath, kind: "library-copies" });
      }
      for (const mirror of mirrorRows) roots.push({ path: mirror.path, kind: "git-mirrors" });
      if (lanes !== null) {
        for (const lane of lanes.lanes)
          roots.push({
            path: lane.backend === "image" ? path.join(lane.laneDir, "space.asif") : lane.spacePath,
            kind: "lanes",
          });
        for (const lane of lanes.unrecordedLanes)
          roots.push({
            path: (yield* exists(path.join(lane.path, "space.asif")))
              ? path.join(lane.path, "space.asif")
              : lane.path,
            kind: "lanes",
          });
      } else unknown("lanes");
      let discovered = 0;
      directoryScan: for (const root of managedWorktreesDirectories(
        preferences,
        config.worktreesDir,
        path,
        home,
      )) {
        if (isNetworkPath(root)) {
          unknown("worktrees");
          continue;
        }
        if (!(yield* exists(root))) continue;
        const first = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
        for (const name of first.slice(0, ROOT_LIMIT)) {
          if (++discovered > ROOT_LIMIT) {
            unknown("worktrees");
            break directoryScan;
          }
          const directory = path.join(root, name);
          if (yield* exists(path.join(directory, ".git")))
            roots.push({ path: directory, kind: "worktrees" });
          else {
            const second = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
            for (const child of second.slice(0, ROOT_LIMIT)) {
              if (++discovered > ROOT_LIMIT) {
                unknown("worktrees");
                break directoryScan;
              }
              const target = path.join(directory, child);
              if (yield* exists(path.join(target, ".git")))
                roots.push({ path: target, kind: "worktrees" });
            }
          }
        }
        if (first.length > ROOT_LIMIT) unknown("worktrees", first.length - ROOT_LIMIT);
      }
      roots.push({ path: config.dbPath, kind: "database" });
      for (const suffix of ["-wal", "-shm"])
        if (yield* exists(config.dbPath + suffix))
          roots.push({ path: config.dbPath + suffix, kind: "database" });
      const priority: Record<ProjectStorageCategory, number> = {
        "library-copies": 0,
        "git-mirrors": 1,
        lanes: 2,
        scratch: 3,
        worktrees: 4,
        primary: 5,
        database: 6,
      };
      const distinct = new Map<string, Root>();
      for (const root of roots.toSorted(
        (a, b) => (a.borrowed ? -1 : priority[a.kind]) - (b.borrowed ? -1 : priority[b.kind]),
      )) {
        const canonical = yield* (
          isNetworkPath(root.path) ? Effect.succeed(root.path) : fs.realPath(root.path)
        ).pipe(Effect.orElseSucceed(() => path.resolve(root.path)));
        const current = distinct.get(canonical);
        if (current === undefined) distinct.set(canonical, { ...root, path: canonical });
        else if (current.threadId === undefined && root.threadId !== undefined)
          distinct.set(canonical, {
            ...current,
            threadId: root.threadId,
            repository: root.repository,
            released: root.released,
          });
      }
      const selected = [...distinct.values()].slice(0, ROOT_LIMIT);
      const omitted = [...distinct.values()].slice(ROOT_LIMIT);
      for (const root of omitted) unknown(root.kind);
      const seen = new Set<string>();
      const localDefaults = new Map<string, { remote: string; branch: string } | null>();
      for (const root of selected) {
        const row = totals.get(root.kind)!;
        if (isNetworkPath(root.path)) {
          row.locations++;
          unknown(root.kind);
          continue;
        }
        const present = yield* exists(root.path);
        if (root.released && !present) {
          row.released++;
          continue;
        }
        row.locations++;
        const exclude = new Set(
          selected
            .filter(
              (other) =>
                other.path !== root.path &&
                path.relative(root.path, other.path).split(path.sep)[0] !== ".." &&
                !path.isAbsolute(path.relative(root.path, other.path)),
            )
            .map((other) => other.path),
        );
        if (lanes !== null)
          for (const lane of lanes.lanes) if (lane.backend === "image") exclude.add(lane.spacePath);
        const remaining = deadline - (yield* Clock.currentTimeMillis);
        const bytes =
          remaining <= 0
            ? null
            : yield* measureStoragePath(root.path, { exclude, seen }).pipe(
                Effect.timeout(Duration.millis(remaining)),
                Effect.orElseSucceed(() => null),
              );
        if (bytes === null) unknown(root.kind);
        else {
          row.knownBytes += bytes;
          if (row.bytes !== null) row.bytes += bytes;
        }
        if (
          root.kind === "worktrees" &&
          present &&
          root.repository !== undefined &&
          Option.isSome(git)
        ) {
          const driver = git.value;
          const landed = yield* Effect.gen(function* () {
            let target = localDefaults.get(root.repository!);
            if (target === undefined) {
              const remote = yield* driver.resolvePrimaryRemoteName(root.repository!);
              const branch = yield* driver.resolveDefaultBranchName(root.repository!, remote);
              target = branch === null ? null : { remote, branch };
              localDefaults.set(root.repository!, target);
            }
            if (target === null) return false;
            const result = yield* driver.execute({
              operation: "ProjectStorage.landed",
              cwd: root.path,
              args: [
                "merge-base",
                "--is-ancestor",
                "HEAD",
                `refs/remotes/${target.remote}/${target.branch}`,
              ],
              allowNonZeroExit: true,
            });
            return result.exitCode === 0;
          }).pipe(Effect.orElseSucceed(() => false));
          if (landed) row.landed++;
        }
      }
      return {
        measuredAt: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
        categories: [...totals.values()],
        omittedLocations: omitted.length,
        database,
      } satisfies ProjectStorageBreakdown;
    },
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
  );
  return ProjectStorageInventory.of({
    byCategory: Effect.fn("ProjectStorageInventory.byCategory")(function* (input) {
      const observed = cached;
      return yield* lock.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const history = yield* accounting.history;
          if (
            cached === null ||
            now - cached.at >= STORAGE_CACHE_MS ||
            cached.revision !== history.revision ||
            (input?.refresh && cached === observed)
          )
            cached = { at: now, revision: history.revision, breakdown: yield* read() };
          return {
            breakdown: cached.breakdown,
            cleanup: yield* cleanup.latestReport,
            additionalEntries: [...history.entries],
            additionalBytesFreed: history.entries
              .filter((entry) => entry.kind === "library-copy")
              .reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
          };
        }),
      );
    }),
  });
});

export const layer = Layer.effect(ProjectStorageInventory, make);
