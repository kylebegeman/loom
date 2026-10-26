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
    /** Resolves a requested destination, refusing places a checkout must never go. */
    readonly assertPlacementAllowed: (
      target: string,
      options?: { readonly allowReuseOf?: string },
    ) => Effect.Effect<string, ProjectPlacementRefusedError>;
  }
>()("t3/project/ProjectPlacement") {}

const MAX_FOLDER_ATTEMPTS = 100;
const ORIGIN_READ_CONCURRENCY = 8;

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const lanes = yield* Effect.serviceOption(LanesRoots);
  const home = yield* HostProcess.HomeDirectory;
  const windows = yield* HostProcess.isWindows;
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

  const claimFolder = Effect.fn("ProjectPlacement.claimFolder")(function* (title: string) {
    const root = yield* projectsRoot;
    yield* fileSystem
      .makeDirectory(root, { recursive: true })
      .pipe(Effect.mapError((cause) => new ProjectPlacementFolderError({ folder: root, cause })));
    const name = newProjectFolderName(title);
    // Non-recursive mkdir claims a name atomically; racers move on after AlreadyExists.
    for (let attempt = 1; attempt <= MAX_FOLDER_ATTEMPTS; attempt++) {
      const folder = path.join(root, attempt === 1 ? name : `${name}-${attempt}`);
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

  const key = (target: string) => (windows ? target.toLowerCase() : target);
  const contains = (root: string, target: string) => {
    const relative = path.relative(key(root), key(target));
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };
  // Symlinks must not disguise a protected folder, so compare through the nearest real ancestor.
  const canonical = (target: string): Effect.Effect<string> => {
    const parent = path.dirname(target);
    return fileSystem
      .realPath(target)
      .pipe(
        Effect.catch(() =>
          parent === target
            ? Effect.succeed(target)
            : Effect.map(canonical(parent), (real) => path.join(real, path.basename(target))),
        ),
      );
  };
  const overlaps = (left: string, right: string) => contains(left, right) || contains(right, left);

  const assertPlacementAllowed = Effect.fn("ProjectPlacement.assertPlacementAllowed")(function* (
    target: string,
    options?: { readonly allowReuseOf?: string },
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
    for (const project of yield* activeProjects) {
      const root = path.resolve(project.workspaceRoot);
      if (reuse !== null && key(root) === key(reuse) && key(resolved) === key(reuse)) continue;
      if (overlaps(yield* canonical(root), real))
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
    assertPlacementAllowed,
  });
});

export const layer = Layer.effect(ProjectPlacement, make);

export const layerWithProjectStore = layer.pipe(Layer.provide(ProjectStore.layer));
