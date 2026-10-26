import type { ProjectId, ServerFolders } from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { newProjectFolderName } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { hasManagedProjectReceipt } from "../workspace/ManagedProjectCheckout.ts";
import * as SetupMarker from "../workspace/setupMarker.ts";
import {
  isFilesystemRoot,
  managedWorktreesDirectories,
  resolveWorktreesDirectory as resolveDirectorySetting,
} from "../worktreesDirectory.ts";

export class ProjectPlacementRefusedError extends Schema.TaggedError<ProjectPlacementRefusedError>()(
  "ProjectPlacementRefusedError",
  { path: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export class ProjectPlacementFolderError extends Schema.TaggedError<ProjectPlacementFolderError>()(
  "ProjectPlacementFolderError",
  { folder: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to create the project folder.";
  }
}

export interface RepositoryCheckout {
  readonly path: string;
  /** The registered project rooted here, or null for a folder Loom found but never registered. */
  readonly projectId: ProjectId | null;
}

export interface PlacementGuardOptions {
  readonly allowReuseOf?: string;
  /**
   * `within` lets registered projects sit inside the target, as when an existing folder is adopted
   * with its own projects; `ignore` leaves registered projects to a caller that checks them itself.
   */
  readonly projects?: "refuse" | "within" | "ignore";
}

/** Lanes folders to keep checkouts out of; hosts without lanes leave it unprovided. */
export class LanesRoots extends Context.Service<
  LanesRoots,
  { readonly roots: Effect.Effect<ReadonlyArray<string>> }
>()("t3/project/ProjectPlacement/LanesRoots") {}

export class ProjectPlacement extends Context.Service<
  ProjectPlacement,
  {
    /** The Projects folder: the setting when it resolves on this host, else `<managedRoot>/projects`. */
    readonly projectsRoot: Effect.Effect<string>;
    /** The current, previous and default Projects folders. */
    readonly managedProjectRoots: Effect.Effect<ReadonlyArray<string>>;
    readonly folders: Effect.Effect<Pick<ServerFolders, "projects" | "worktrees" | "lanes">>;
    /** Registered projects and direct children of the Projects folders whose origin matches. */
    readonly findRepositoryCheckouts: (
      remoteUrl: string,
    ) => Effect.Effect<ReadonlyArray<RepositoryCheckout>>;
    /** Atomically creates `<Projects folder>/<slug>`, adding -2…-100 when the name is taken. */
    readonly claimFolder: (title: string) => Effect.Effect<string, ProjectPlacementFolderError>;
    /** The folder `claimFolder` would take now, without creating it. */
    readonly previewFolder: (title: string) => Effect.Effect<string>;
    /** Resolves a requested destination, refusing places a checkout must never go. */
    readonly assertPlacementAllowed: (
      target: string,
      options?: PlacementGuardOptions,
    ) => Effect.Effect<string, ProjectPlacementRefusedError>;
  }
>()("t3/project/ProjectPlacement") {}

const MAX_FOLDER_ATTEMPTS = 100;
const ORIGIN_READ_CONCURRENCY = 8;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/**
 * Release tombstones and restore stages Loom makes beside a checkout: LibraryWorkspace release,
 * restore and reopen, ManagedProjectCheckout release and ScratchCheckout restore. A retried
 * release deletes its tombstone, so none of them may be reused as a checkout.
 */
const LOOM_WORK_FOLDER = new RegExp(
  `(\\.loom-released-[0-9a-f]{16}|\\.t3-released-${UUID}|\\.t3-restore-${UUID})$|^\\.loom-(restore|reopen)-`,
  "i",
);

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const lanes = yield* Effect.serviceOption(LanesRoots);
  const home = yield* HostProcess.HomeDirectory;
  const key = SetupMarker.pathKey(yield* HostProcess.Platform);
  const defaultProjectsRoot = path.resolve(
    config.managedProjectsRoot ?? config.baseDir,
    "projects",
  );

  const settings = serverSettings.getSettings.pipe(
    Effect.orElseSucceed(() => ({
      projectsDirectory: "",
      previousProjectsDirectories: [],
      worktreesDirectory: "",
      previousWorktreesDirectories: [],
    })),
  );

  const projectsRoot = settings.pipe(
    Effect.map(
      (current) =>
        resolveDirectorySetting(current.projectsDirectory, defaultProjectsRoot, path, home) ??
        defaultProjectsRoot,
    ),
  );

  const managedProjectRoots = settings.pipe(
    // Earlier Projects folders stay managed, as earlier worktree folders do.
    Effect.map((current) =>
      managedWorktreesDirectories(
        {
          worktreesDirectory: current.projectsDirectory,
          previousWorktreesDirectories: current.previousProjectsDirectories,
        },
        defaultProjectsRoot,
        path,
        home,
      ),
    ),
  );

  const lanesRoots = Option.match(lanes, {
    onNone: () => Effect.succeed<ReadonlyArray<string>>([]),
    onSome: (service) => service.roots,
  });

  const folders = Effect.gen(function* () {
    const current = yield* settings;
    const [lanesRoot] = yield* lanesRoots;
    return {
      projects:
        resolveDirectorySetting(current.projectsDirectory, defaultProjectsRoot, path, home) ??
        defaultProjectsRoot,
      worktrees:
        resolveDirectorySetting(current.worktreesDirectory, config.worktreesDir, path, home) ??
        config.worktreesDir,
      ...(lanesRoot === undefined ? {} : { lanes: lanesRoot }),
    };
  }).pipe(Effect.withSpan("ProjectPlacement.folders"));

  const activeProjects = projects.list().pipe(Effect.orElseSucceed(() => []));

  const readOrigin = (directory: string) =>
    fileSystem.stat(path.join(directory, ".git")).pipe(
      // Linked worktrees have a .git file; only a primary checkout counts as the repository's.
      Effect.flatMap((info) =>
        info.type === "Directory"
          ? git.readConfigValue(directory, "remote.origin.url")
          : Effect.succeed(null),
      ),
      Effect.orElseSucceed(() => null),
    );

  const childDirectories = (root: string) =>
    fileSystem.readDirectory(root).pipe(
      Effect.map((entries) => entries.map((entry) => path.join(root, entry))),
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );

  const findRepositoryCheckouts = Effect.fn("ProjectPlacement.findRepositoryCheckouts")(function* (
    remoteUrl: string,
  ) {
    const wanted = normalizeGitRemoteUrl(remoteUrl);
    const candidates = new Map<string, ProjectId | null>();
    for (const project of yield* activeProjects) {
      candidates.set(path.resolve(project.workspaceRoot), project.projectId);
    }
    for (const root of yield* managedProjectRoots) {
      for (const child of yield* childDirectories(root)) {
        if (!candidates.has(child)) candidates.set(child, null);
      }
    }
    for (const candidate of candidates.keys())
      if (LOOM_WORK_FOLDER.test(path.basename(candidate))) candidates.delete(candidate);
    const matches = yield* Effect.forEach(
      candidates,
      ([candidate, projectId]) =>
        readOrigin(candidate).pipe(
          Effect.map((origin) =>
            origin !== null && normalizeGitRemoteUrl(origin) === wanted
              ? Option.some<RepositoryCheckout>({ path: candidate, projectId })
              : Option.none<RepositoryCheckout>(),
          ),
        ),
      { concurrency: ORIGIN_READ_CONCURRENCY },
    );
    // Registered projects come first so callers reuse the project rather than register a twin.
    return matches
      .flatMap((match) => (Option.isSome(match) ? [match.value] : []))
      .toSorted(
        (left, right) => Number(left.projectId === null) - Number(right.projectId === null),
      );
  });

  const contains = (root: string, target: string) => {
    const relative = path.relative(key(root), key(target));
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };
  // Symlinks and case or Unicode variants must not disguise a protected folder.
  const canonical = (target: string) =>
    SetupMarker.canonicalPath(target).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  const overlaps = (left: string, right: string) => contains(left, right) || contains(right, left);

  const folderName = (root: string, name: string, attempt: number) =>
    path.join(root, attempt === 1 ? name : `${name}-${attempt}`);

  // A receipt or a registered project keeps a name taken after its folder is gone.
  const nameTaken = Effect.fn("ProjectPlacement.nameTaken")(function* (folder: string) {
    if (yield* fileSystem.exists(folder).pipe(Effect.orElseSucceed(() => true))) return true;
    const receipt = yield* hasManagedProjectReceipt(folder).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig.ServerConfig, config),
      Effect.orElseSucceed(() => true),
    );
    if (receipt) return true;
    const real = yield* canonical(folder);
    for (const project of yield* activeProjects)
      if (overlaps(yield* canonical(path.resolve(project.workspaceRoot)), real)) return true;
    return false;
  });

  const previewFolder = Effect.fn("ProjectPlacement.previewFolder")(function* (title: string) {
    const root = yield* projectsRoot;
    const name = newProjectFolderName(title);
    for (let attempt = 1; attempt < MAX_FOLDER_ATTEMPTS; attempt++) {
      const folder = folderName(root, name, attempt);
      if (!(yield* nameTaken(folder))) return folder;
    }
    return folderName(root, name, MAX_FOLDER_ATTEMPTS);
  });

  const claimFolder = Effect.fn("ProjectPlacement.claimFolder")(function* (title: string) {
    const root = yield* projectsRoot;
    // The setting accepts any absolute folder, so every claim checks where it points.
    yield* assertPlacementAllowed(root, { projects: "within" }).pipe(
      Effect.mapError((cause) => new ProjectPlacementFolderError({ folder: root, cause })),
    );
    yield* fileSystem
      .makeDirectory(root, { recursive: true })
      .pipe(Effect.mapError((cause) => new ProjectPlacementFolderError({ folder: root, cause })));
    const name = newProjectFolderName(title);
    // Non-recursive mkdir claims a name atomically; racers move on after AlreadyExists.
    for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt++) {
      const folder = folderName(root, name, attempt);
      if (yield* nameTaken(folder)) continue;
      const claimed = yield* fileSystem.makeDirectory(folder).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.succeed(false),
        ),
        Effect.mapError((cause) => new ProjectPlacementFolderError({ folder, cause })),
      );
      if (claimed) return folder;
    }
    return yield* new ProjectPlacementFolderError({
      folder: path.join(root, name),
      cause: `Every folder name for "${name}" is taken.`,
    });
  });

  const assertPlacementAllowed = Effect.fn("ProjectPlacement.assertPlacementAllowed")(function* (
    target: string,
    options?: PlacementGuardOptions,
  ) {
    const refuse = (reason: string) => new ProjectPlacementRefusedError({ path: target, reason });
    const expanded = expandHomePath(target.trim(), home);
    if (!path.isAbsolute(expanded)) return yield* refuse("Choose an absolute folder path.");
    const resolved = path.resolve(expanded);
    const real = yield* canonical(resolved);
    if (isFilesystemRoot(resolved, path) || isFilesystemRoot(real, path))
      return yield* refuse("A project cannot go at the root of the disk.");
    if (key(real) === key(yield* canonical(path.resolve(home))))
      return yield* refuse("A project cannot go directly in the home folder.");
    const current = yield* settings;
    const protectedRoots: ReadonlyArray<readonly [string, string]> = [
      [config.stateDir, "Loom's data folder"],
      ...(yield* lanesRoots).map((root) => [root, "a lanes folder"] as const),
      ...managedWorktreesDirectories(current, config.worktreesDir, path, home).map(
        (root) => [root, "a worktree folder"] as const,
      ),
    ];
    for (const [root, label] of protectedRoots) {
      if (overlaps(yield* canonical(path.resolve(root)), real))
        return yield* refuse(`A project cannot go inside or around ${label} (${root}).`);
    }
    const reuse = options?.allowReuseOf === undefined ? null : path.resolve(options.allowReuseOf);
    const projectRule = options?.projects ?? "refuse";
    for (const project of projectRule === "ignore" ? [] : yield* activeProjects) {
      const root = path.resolve(project.workspaceRoot);
      if (reuse !== null && key(root) === key(reuse) && key(resolved) === key(reuse)) continue;
      const projectRoot = yield* canonical(root);
      if (projectRule === "within" ? contains(projectRoot, real) : overlaps(projectRoot, real))
        return yield* refuse(
          `This folder is inside or around the project "${project.title}" (${root}).`,
        );
    }
    return resolved;
  });

  return ProjectPlacement.of({
    projectsRoot,
    managedProjectRoots,
    folders,
    findRepositoryCheckouts,
    claimFolder,
    previewFolder,
    assertPlacementAllowed,
  });
});

export const layer = Layer.effect(ProjectPlacement, make);

export const layerWithProjectStore = layer.pipe(Layer.provide(ProjectStore.layer));
