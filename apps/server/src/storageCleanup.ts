// @effect-diagnostics nodeBuiltinImport:off - rmdir atomically refuses nonempty project folders.
// fork: project-lifecycle
import * as NodeFSP from "node:fs/promises";
// fork: mini-native-retention
import {
  GitCommandError,
  OrchestrationV2AppThreadJson,
  OrchestrationV2ProviderSessionJson,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  OrchestrationV2ThreadShell,
  ProjectId,
  ServerSettings,
  ServerSettingsError,
  TerminalSummary,
  ThreadId, // fork: project-lifecycle
  WorktreeCleanupRules,
  StorageCleanupReport,
  StorageCleanupReportEntry,
  StorageCleanupGitMirror, // fork: library-launch-files
} from "@t3tools/contracts";
import { ProjectLifecycleError } from "@t3tools/contracts/fork"; // fork: project-lifecycle
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
// fork: project-checkout-management -- the sweep worker replaced the Ref import
import type { PlatformError } from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { parse as parseYaml } from "yaml";

import * as ServerConfig from "./config.ts";
import * as LibraryWorkspaceStore from "./fork/project-library/LibraryWorkspaceStore.ts"; // fork: library-projects
import * as LibraryGitFetch from "./fork/project-library/LibraryGitFetch.ts"; // fork: library-launch-files
import { ServerEnvironmentIdentity } from "./environment/ServerEnvironment.ts"; // fork: library-launch-files
import { makeLibraryCheckoutOwners } from "./project/libraryCheckoutOwnership.ts"; // fork: library-projects
import * as GitManager from "./git/GitManager.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "./orchestration-v2/ProviderSessionManager.ts";
import { threadWorkspaceIdle } from "./orchestration-v2/queuedTurnStart.ts"; // fork: project-lifecycle
import { forkParked } from "./serverActivation.ts";
import * as Settings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { isFilesystemRoot, managedWorktreesDirectories } from "./worktreesDirectory.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import { isNonRepositoryGitStderr } from "./vcs/GitVcsDriverCore.ts"; // fork: git-gitfile-errors
import { removeLinkedWorktree } from "./vcs/worktreeRemoval.ts";
import { withWorkspaceLease } from "./workspace/workspaceLease.ts";
import { proveGitPublication } from "./workspace/gitPublication.ts"; // fork: project-lifecycle
import * as SetupMarker from "./workspace/setupMarker.ts"; // fork: project-lifecycle
// fork: mini-native-retention
import {
  archiveScratchCheckout,
  scratchArchiveMatches,
  scratchCheckoutOwned,
  scratchArchivePaths,
  assertScratchUnmounted,
} from "./workspace/ScratchCheckout.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
// fork: project-lifecycle
import {
  readManagedProjectCheckout,
  assertManagedProjectOwned,
  archiveManagedProjectCheckout,
  releaseManagedProjectCheckout,
  managedProjectProcessReason,
  resolveManagedProjectRetention, // fork: project-checkout-management
} from "./workspace/ManagedProjectCheckout.ts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git"; // fork: project-lifecycle
import { isNetworkPath } from "@t3tools/shared/path";

const decodeCleanupThread = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const decodeCleanupSession = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ProviderSessionJson),
);
// pnpm 11 writes this file as JSON, older versions as YAML.
const decodePnpmModulesManifest = Schema.decodeUnknownEffect(
  Schema.Struct({
    storeDir: Schema.String,
    virtualStoreDir: Schema.optional(Schema.String),
  }),
);

const DAY_MS = 86_400_000;
// Give settle scripts time to open terminals that protect the worktree.
const SETTLE_SCRIPT_GRACE_MS = 60_000;
// Worktree creation can precede its thread row, including review-guide checkouts.
const ORPHAN_WORKTREE_GRACE_MS = 60 * 60 * 1_000;
// fork: library-launch-files: a mirror only speeds up new copies of its remote.
const GIT_MIRROR_UNUSED_DAYS = 30;

// fork: project-lifecycle -- dependency, build and tool output that installs and builds recreate,
// so the landing rule deletes it with the worktree. Any other ignored path (.env files, local
// databases, notes) keeps the worktree. Matched per path segment; "*." entries match file suffixes.
const REGENERABLE_IGNORED_NAMES = [
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  ".turbo",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".vite",
  ".cache",
  ".parcel-cache",
  ".expo",
  ".gradle",
  "DerivedData",
  "__pycache__",
  ".pytest_cache",
  ".build",
  ".generated",
  ".vite-hooks",
  ".astro",
  ".tanstack",
  ".DS_Store",
  "*.tsbuildinfo",
];
// fork: project-lifecycle
const regenerableIgnoredPath = (entry: string) => {
  const segments = entry.split("/").filter(Boolean);
  const name = segments.at(-1) ?? "";
  return REGENERABLE_IGNORED_NAMES.some((pattern) =>
    pattern.startsWith("*") ? name.endsWith(pattern.slice(1)) : segments.includes(pattern),
  );
};
// fork: file-placement -- Git lists an ignored folder as one entry and never looks inside it, so a
// repository or worktree in regenerable output (dist/nested) would be deleted with the folder.
const NESTED_REPOSITORY_SCAN_LIMIT = 2_000_000;
// fork: file-placement
const nestedRepository = Effect.fnUntraced(function* (cwd: string, entry: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(cwd);
  const pending = [yield* fs.realPath(path.join(root, entry))];
  let scanned = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const names = yield* fs.readDirectory(directory);
    if (
      names.includes(".git") ||
      (names.includes("HEAD") && names.includes("objects") && names.includes("refs"))
    )
      return `${path.relative(root, directory)}/`;
    scanned += names.length;
    if (scanned > NESTED_REPOSITORY_SCAN_LIMIT) return entry;
    for (const name of names) {
      const child = path.join(directory, name);
      // Removing a link leaves its target, so only real folders are searched.
      if (
        (yield* fs.realPath(child).pipe(Effect.orElseSucceed(() => null))) === child &&
        (yield* fs.stat(child)).type === "Directory"
      )
        pending.push(child);
    }
  }
  return null;
});
// fork: file-placement
/**
 * The "landed" rule for `git ls-files --others --ignored --exclude-standard --directory -z`
 * output: the first entry holding local data, or null when all are regenerable or empty. `.env`
 * files, local databases and any repository or worktree nested in ignored output keep the folder.
 * @public
 */
export const landedIgnoredFileBlocker = Effect.fn("StorageCleanup.landedIgnoredFileBlocker")(
  function* (cwd: string, ignoredListing: string) {
    const git = yield* GitVcsDriver.GitVcsDriver;
    const listed = ignoredListing.split("\0").filter(Boolean);
    // Git also lists the untracked folders that hold ignored entries; judge their contents.
    const containers = new Set<string>();
    for (const entry of listed) {
      let end = entry.indexOf("/");
      while (end !== -1 && end < entry.length - 1) {
        containers.add(entry.slice(0, end + 1));
        end = entry.indexOf("/", end + 1);
      }
    }
    for (const entry of listed) {
      if (containers.has(entry)) continue; // fork: file-placement
      // fork: file-placement
      if (regenerableIgnoredPath(entry)) {
        // fork: file-placement
        const nested = entry.endsWith("/") ? yield* nestedRepository(cwd, entry) : null;
        if (nested !== null) return nested; // fork: file-placement
        continue; // fork: file-placement
      } // fork: file-placement
      if (entry.endsWith("/")) {
        // Git lists empty ignored folders too, and those hold nothing to lose.
        const contents = yield* git.execute({
          operation: "StorageCleanup.ignoredFolderFiles",
          cwd,
          args: [
            "--literal-pathspecs",
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "-z",
            "--",
            entry,
          ],
          maxOutputBytes: 4 * 1024,
        });
        if (contents.stdout === "" && !contents.stdoutTruncated) continue;
      }
      return entry;
    }
    return null;
  },
);
// fork: project-lifecycle -- "landed" protects ignored files except regenerable output.
type LocalFileRules = {
  readonly worktreeKeepWhen: WorktreeCleanupRules["worktreeKeepWhen"] | "landed";
  /** The linked worktree whose own top-level .t3/ dev home the landed rule may delete. */
  readonly devHomeRoot?: string;
};

// fork: library-launch-files
const removedMirrorBytes = (mirrors: ReadonlyArray<StorageCleanupGitMirror> | undefined) =>
  (mirrors ?? []).reduce((sum, row) => sum + (row.outcome === "removed" ? row.bytes : 0), 0);
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const REPORT_ENTRY_LIMIT = 200;
const isGitCommandError = Schema.is(GitCommandError);
const isProjectLifecycleError = Schema.is(ProjectLifecycleError); // fork: project-lifecycle

function cleanupFailureReason(error: { readonly message: string }) {
  return isGitCommandError(error)
    ? `${error.command}: ${error.detail.split(/\r?\n/)[0]}${error.reason ? ` (${error.reason})` : ""}`
    : (error.message.split(/\r?\n/)[0] ?? error.message);
}

const worktreeCleanupEnabled = (rules: WorktreeCleanupRules) =>
  rules.worktreeAfterDays !== null ||
  rules.worktreeSettledAfterDays !== null ||
  rules.worktreeOnMerge ||
  rules.worktreeOnDelete ||
  rules.worktreeOnSettle ||
  rules.worktreeUnchanged ||
  rules.worktreeOnLand; // fork: project-lifecycle

function anyWorktreePolicy(
  settings: ServerSettings,
  predicate: (rules: WorktreeCleanupRules) => boolean,
): boolean {
  return (
    predicate(resolveWorktreeCleanup(settings, null)) ||
    Object.keys(settings.projectSettingsOverrides).some((projectId) =>
      predicate(resolveWorktreeCleanup(settings, projectId as ProjectId)),
    )
  );
}

function sameProjectWorktreePolicies(left: ServerSettings, right: ServerSettings): boolean {
  return [
    ...new Set([
      ...Object.keys(left.projectSettingsOverrides),
      ...Object.keys(right.projectSettingsOverrides),
    ]),
  ].every((projectId) =>
    Equal.equals(
      left.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
      right.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
    ),
  );
}

export function storageCleanupThreadIdle(thread: OrchestrationV2ThreadShell, now: number): boolean {
  // fork: project-lifecycle -- the shared workspace-idle rule also gates settlement.
  return thread.worktreePath !== null && threadWorkspaceIdle(thread, now);
}

/** PR metadata refreshes must not reset the inactivity clock. */
export function storageCleanupActivityAt(thread: OrchestrationV2ThreadShell): number {
  return Math.max(
    ...[
      thread.createdAt,
      thread.latestUserMessageAt,
      thread.latestRunRequestedAt,
      thread.latestRunStartedAt,
      thread.latestRunCompletedAt,
    ].flatMap((value) => (value == null ? [] : [DateTime.toEpochMillis(value)])),
  );
}

// fork: project-lifecycle -- generalized from one owner to the set of chain owners.
/**
 * The top-level holders, when every other holder is in a complete subagent chain within this
 * worktree that reaches one of them under the same root; otherwise undefined.
 */
function worktreeOwners<T extends Pick<OrchestrationV2ThreadShell, "id" | "lineage">>(
  threads: ReadonlyArray<T>,
) {
  if (threads.length === 1) return threads;
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const owners = threads.filter((thread) => !byId.has(thread.lineage.parentThreadId!));
  if (owners.length === 0) return undefined;
  const ownerIds = new Set(owners.map((owner) => owner.id));
  for (const thread of threads) {
    const chain: T[] = [];
    let current = thread;
    while (!ownerIds.has(current.id)) {
      if (chain.includes(current) || current.lineage.relationshipToParent !== "subagent")
        return undefined;
      chain.push(current);
      const parent = byId.get(current.lineage.parentThreadId!);
      if (parent === undefined) return undefined;
      current = parent;
    }
    const root = current.lineage.rootThreadId;
    if (chain.some((link) => link.lineage.rootThreadId !== root)) return undefined;
  }
  return owners;
}

/** Only a complete subagent chain within this worktree shares ownership. */
function worktreeOwner<T extends Pick<OrchestrationV2ThreadShell, "id" | "lineage">>(
  threads: ReadonlyArray<T>,
) {
  // fork: project-lifecycle
  const owners = worktreeOwners(threads);
  return owners?.length === 1 ? owners[0] : undefined;
}

/** Squash/rebase merges require the merged PR to name this exact head commit. */
export function storageCleanupPullRequestMerged(
  pullRequest: Pick<
    GitManager.GitBranchPullRequest,
    "state" | "headRef" | "baseRef" | "headSha"
  > | null,
  worktree: {
    readonly branch: string;
    readonly defaultBranch: string;
    readonly headSha: string;
    readonly integrated: boolean;
  },
): boolean {
  return (
    pullRequest?.state === "merged" &&
    (worktree.integrated ||
      (pullRequest.headRef === worktree.branch &&
        pullRequest.baseRef === worktree.defaultBranch &&
        pullRequest.headSha === worktree.headSha))
  );
}

export class StorageCleanup extends Context.Service<
  StorageCleanup,
  {
    readonly requestSweep: Effect.Effect<void>; // fork: project-checkout-management
    readonly runNow: Effect.Effect<StorageCleanupReport, ServerSettingsError>;
    // fork: project-lifecycle
    readonly removeOrphan: (
      worktreePath: string,
    ) => Effect.Effect<StorageCleanupReport, ServerSettingsError>;
    // fork: project-lifecycle -- the user's release of a thread's landed checkout.
    readonly releaseCheckout: (
      threadId: ThreadId,
    ) => Effect.Effect<StorageCleanupReportEntry, ProjectLifecycleError>;
    readonly latestReport: Effect.Effect<StorageCleanupReport | null>;
    readonly reports: Stream.Stream<StorageCleanupReport | null>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/storageCleanup") {}

// fork: project-checkout-management
/** Coalesces automatic sweeps while preserving every manual result and drain barrier. */
export const makeStorageCleanupWorker = Effect.fn("StorageCleanup.makeWorker")(function* <A, E, R>(
  sweep: (trigger: StorageCleanupReport["trigger"]) => Effect.Effect<A, E, R>,
) {
  let automaticState: "idle" | "queued" | "running" = "idle";
  let followUp = false;
  // Scheduling the flag and queue item must not be interrupted between the two.
  const requestSweep: Effect.Effect<void> = Effect.uninterruptible(
    Effect.suspend(() => {
      if (automaticState === "running") {
        followUp = true;
        return Effect.void;
      }
      if (automaticState === "queued") return Effect.void;
      automaticState = "queued";
      return worker.enqueue(undefined);
    }),
  );
  const worker = yield* makeDrainableWorker((completion: Deferred.Deferred<A, E> | undefined) =>
    Effect.gen(function* () {
      if (completion === undefined) {
        automaticState = "running";
        followUp = false;
      }
      const exit = yield* Effect.suspend(() =>
        sweep(completion === undefined ? "automatic" : "manual"),
      ).pipe(Effect.exit);
      if (completion !== undefined) return yield* Deferred.done(completion, exit);
      return yield* exit.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => Effect.logWarning("storage cleanup failed", { cause })),
      );
    }).pipe(
      Effect.ensuring(
        completion === undefined
          ? Effect.suspend(() => {
              automaticState = "idle";
              const rerun = followUp;
              followUp = false;
              // Enqueue before the current item finishes so drain includes the rerun.
              return rerun ? requestSweep : Effect.void;
            })
          : Effect.void,
      ),
    ),
  );
  const runNow = Effect.gen(function* () {
    const completion = yield* Deferred.make<A, E>();
    yield* worker.enqueue(completion);
    return yield* Deferred.await(completion);
  });
  return { requestSweep, runNow, drain: worker.drain };
});

const make = Effect.gen(function* () {
  const libraryCheckoutOwners = yield* makeLibraryCheckoutOwners; // fork: library-projects
  const config = yield* ServerConfig.ServerConfig;
  const libraryWorkspaces = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  const gitMirrorCache = yield* Effect.serviceOption(LibraryGitFetch.LibraryGitFetch); // fork: library-launch-files
  const environmentIdentity = yield* Effect.serviceOption(ServerEnvironmentIdentity); // fork: library-launch-files
  const settingsService = yield* Settings.ServerSettingsService;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const sql = yield* SqlClient.SqlClient;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitManager = yield* GitManager.GitManager;
  const terminals = yield* TerminalManager.TerminalManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveTerminals = new Map<string, Map<string, TerminalSummary>>();
  const orphanSizes = new Map<string, number | null>();
  const noteTerminal = (terminal: TerminalSummary) => {
    const threadTerminals =
      liveTerminals.get(terminal.threadId) ?? new Map<string, TerminalSummary>();
    threadTerminals.set(terminal.terminalId, terminal);
    liveTerminals.set(terminal.threadId, threadTerminals);
  };

  const isWindows = yield* HostProcess.isWindows;
  const pathKey = (target: string) => {
    const resolved = path.resolve(target);
    return isWindows ? resolved.toLowerCase() : resolved;
  };
  const inside = (root: string, target: string) => {
    const relative = path.relative(pathKey(root), pathKey(target));
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const hasTerminal = (worktreePath: string) =>
    [...liveTerminals.values()]
      .flatMap((entries) => [...entries.values()])
      .some((terminal) => {
        if (terminal.status !== "starting" && terminal.status !== "running") return false;
        const cwd = path.resolve(terminal.cwd);
        return (
          (terminal.worktreePath !== null &&
            path.resolve(terminal.worktreePath) === worktreePath) ||
          cwd === worktreePath ||
          inside(worktreePath, cwd)
        );
      });

  // pnpm imports packages by clone or reflink when its store shares a device
  // with the worktree. Those files have one link but share blocks with the
  // store, so removing them frees almost nothing. A store on another device
  // forces real copies, which still count.
  const sharedPnpmVirtualStore = Effect.fnUntraced(
    function* (root: string) {
      const nodeModules = path.join(root, "node_modules");
      const text = yield* fs.readFileString(path.join(nodeModules, ".modules.yaml"));
      const manifest = yield* decodePnpmModulesManifest(yield* Effect.try(() => parseYaml(text)));
      // An agent can write this manifest, and statting a network path makes
      // Windows sign in to its host with the user's NTLM credentials.
      if (isNetworkPath(manifest.storeDir) || isNetworkPath(manifest.virtualStoreDir ?? "")) {
        return null;
      }
      const virtualStore = path.resolve(nodeModules, manifest.virtualStoreDir ?? ".pnpm");
      const [store, virtual] = yield* Effect.all([
        fs.stat(manifest.storeDir),
        fs.stat(virtualStore),
      ]);
      return store.dev === virtual.dev ? virtualStore : null;
    },
    Effect.orElseSucceed(() => null),
  );

  const measureWorktree = Effect.fn("storageCleanup.measureWorktree")(
    function* (worktreePath: string) {
      const root = yield* fs.realPath(worktreePath);
      const skipped = yield* sharedPnpmVirtualStore(root);
      const pending = [root];
      let entries = 1;
      let bytes = 0;
      while (pending.length > 0) {
        const target = pending.pop()!;
        if (target === skipped) continue;
        // Effect's stat follows links. Probe with readLink first to get lstat
        // semantics, including skipping dangling links and directory links.
        const isLink = yield* fs.readLink(target).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) =>
              error.cause instanceof Error &&
              "code" in error.cause &&
              error.cause.code === "EINVAL",
            () => Effect.succeed(false),
          ),
        );
        if (isLink) continue;
        if ((yield* fs.realPath(target)) !== target) return null;
        const stat = yield* fs.stat(target);
        if (stat.type === "File") {
          // Removing a shared hardlink leaves its blocks allocated.
          if (Option.getOrElse(stat.nlink, () => 1n) !== 1n) continue;
          bytes += Option.match(stat.blocks, {
            onNone: () => Number(stat.size),
            onSome: (blocks) => Number(blocks * 512n),
          });
        } else if (stat.type === "Directory") {
          const names = yield* fs.readDirectory(target);
          entries += names.length;
          if (entries > 2_000_000) return null;
          for (const name of names) {
            const child = path.join(target, name);
            if (!inside(root, child)) return null;
            pending.push(child);
          }
        }
      }
      return bytes;
    },
    Effect.timeout("30 seconds"),
    Effect.orElseSucceed(() => null),
  );

  // Large snapshots take seconds; use the reader worker instead of blocking the event loop.
  // fork: mini-native-retention -- archived threads must stay included: they settle
  // their project and keep their Scratch folder eligible for archiving.
  const readThreads = Effect.fn("StorageCleanup.readThreads")(function* () {
    const snapshot = yield* projections.getShellSnapshot().pipe(NodeSqliteClient.readOnly);
    const projects = yield* projectStore.listShells();
    return { projects, threads: [...snapshot.threads, ...snapshot.archivedThreads] };
  });

  // fork: library-projects
  const libraryCleanupBlocker = Effect.fn("StorageCleanup.libraryCleanupBlocker")(function* (
    cwd: string,
    now: number,
  ) {
    const owners = yield* libraryCheckoutOwners(cwd);
    if (owners.some((receipt) => receipt.copy.ownership === "managed"))
      return "the Library manages these files";
    if (owners.length === 0) return null;
    const snapshot = yield* readThreads();
    const allBindings = yield* libraryWorkspaces.bindings;
    for (const receipt of owners) {
      // Borrowed folders opt into native retention through reviewed adoption. Library retention
      // intentionally cannot release them, but the whole copy's conversations still protect them.
      if (receipt.copy.state !== "ready") return "the Library copy is not ready";
      const bindings = allBindings.filter(
        (entry) => entry.resolved.binding.workingCopyId === receipt.copy.id,
      );
      const ids = new Set([
        receipt.rootLocalProjectId,
        receipt.copy.rootLocalProjectId,
        ...receipt.copy.repositories.map((repository) => repository.localProjectId),
      ]);
      const locations = yield* Effect.forEach(
        [receipt.copy.rootPath, ...receipt.copy.repositories.map((repository) => repository.path)],
        (location) => fs.realPath(location),
      );
      const related: OrchestrationV2ThreadShell[] = [];
      for (const thread of snapshot.threads) {
        if (
          ids.has(thread.projectId) ||
          receipt.legacyThreadIds.includes(thread.id) ||
          bindings.some((entry) => entry.threadId === thread.id)
        ) {
          related.push(thread);
          continue;
        }
        const location =
          thread.worktreePath ??
          snapshot.projects.find((project) => project.id === thread.projectId)?.workspaceRoot;
        if (location === undefined) continue;
        const canonical = yield* fs.realPath(location).pipe(Effect.orElseSucceed(() => location));
        if (
          locations.some((root) => pathKey(root) === pathKey(canonical) || inside(root, canonical))
        )
          related.push(thread);
      }
      if (
        related.some(
          (thread) =>
            thread.pinnedAt != null ||
            thread.goal?.status === "active" ||
            !threadWorkspaceIdle(thread, now) ||
            (thread.archivedAt === null && thread.settledOverride !== "settled"),
        )
      )
        return "a Library conversation is active or has pending work";
      if (
        related.length === 0 ||
        bindings.some((entry) => !related.some((thread) => thread.id === entry.threadId)) ||
        receipt.legacyThreadIds.some((id) => !related.some((thread) => thread.id === id)) ||
        related.some((thread) => !bindings.some((entry) => entry.threadId === thread.id))
      )
        return "Library conversation bindings could not be verified";
      if (locations.some(hasTerminal)) return "open terminal in the Library copy";
      const journal = yield* sql`SELECT 1 FROM fork_library_source_state
        WHERE key='host' AND environment_id=${receipt.copy.environmentId}`;
      if (journal.length === 0) return "Library history has not been acknowledged";
      for (const thread of related) {
        // Include uncaptured events, not just the outbox: replication can defer a snapshot or
        // restart before scanning it. Reorders still count because compaction can replace a
        // deferred milestone with one; visits never change saved history.
        const history = (yield* sql<{
          queued_sequence: number;
          acknowledged_sequence: number;
          current_sequence: number;
          pending_entries: number;
        }>`SELECT queued_sequence,acknowledged_sequence,
          (SELECT COALESCE(MAX(sequence),0) FROM orchestration_events
            WHERE application_event_version=2 AND aggregate_kind='thread'
              AND stream_id=${thread.id}
              AND event_type NOT IN ('thread.visited','thread.marked-unread')) AS current_sequence,
          (SELECT COUNT(*) FROM fork_library_source_outbox
            WHERE thread_id=${thread.id}) AS pending_entries
          FROM fork_library_source_threads WHERE thread_id=${thread.id}`)[0];
        if (
          history === undefined ||
          history.pending_entries > 0 ||
          history.acknowledged_sequence <
            Math.max(history.queued_sequence, history.current_sequence)
        )
          return "Library history has not been acknowledged";
        const pending = yield* sql`SELECT 1 FROM orchestration_v2_effect_outbox
          WHERE thread_id=${thread.id} AND status NOT IN ('succeeded', 'cancelled') LIMIT 1`;
        if (pending.length > 0) return "Library conversation effects are still pending";
      }
      const rows = yield* sql<{ payload_json: string }>`SELECT payload_json
        FROM orchestration_v2_projection_provider_sessions WHERE status != 'stopped'`;
      const sessions = yield* Effect.forEach(rows, (row) => decodeCleanupSession(row.payload_json));
      if (
        sessions.some((session) =>
          locations.some(
            (root) =>
              pathKey(root) === pathKey(path.resolve(session.cwd)) ||
              inside(root, path.resolve(session.cwd)),
          ),
        )
      )
        return "provider session is still open in the Library copy";
      for (const root of locations) {
        const processReason = yield* managedProjectProcessReason(root);
        if (processReason !== null) return processReason;
      }
    }
    return null;
  });

  const containsProjectRoot = Effect.fn("StorageCleanup.containsProjectRoot")(function* (
    worktreePath: string,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
  ) {
    for (const project of projects) {
      const projectPath = path.resolve(project.workspaceRoot);
      if (pathKey(projectPath) === pathKey(worktreePath) || inside(worktreePath, projectPath))
        return true;
      const realPath = yield* fs
        .realPath(projectPath)
        .pipe(Effect.orElseSucceed(() => projectPath));
      if (pathKey(realPath) === pathKey(worktreePath) || inside(worktreePath, realPath))
        return true;
    }
    return false;
  });

  // fork: project-lifecycle
  const pruneEmptyProjectFolder = Effect.fn("StorageCleanup.pruneEmptyProjectFolder")(function* (
    directory: string,
    roots: ReadonlyArray<string>,
  ) {
    if (!roots.some((root) => pathKey(path.dirname(directory)) === pathKey(root))) return;
    if (yield* containsProjectRoot(directory, yield* projectStore.listShells())) return;
    if (pathKey(yield* fs.realPath(directory)) !== pathKey(directory)) return;
    yield* Effect.tryPromise(() => NodeFSP.rmdir(directory)).pipe(Effect.ignore);
  });

  const reportOrphanWorktrees = Effect.fn("StorageCleanup.reportOrphanWorktrees")(function* (
    roots: ReadonlyArray<string>,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
    entries: StorageCleanupReportEntry[],
  ) {
    const rows = yield* sql<{ worktreePath: string }>`
      SELECT DISTINCT json_extract(payload_json, '$.worktreePath') AS "worktreePath"
      FROM orchestration_v2_projection_threads
      WHERE json_extract(payload_json, '$.worktreePath') IS NOT NULL
    `.pipe(NodeSqliteClient.readOnly);
    const referenced = new Set<string>();
    for (const row of rows) {
      const resolved = path.resolve(row.worktreePath);
      referenced.add(pathKey(resolved));
      referenced.add(
        pathKey(yield* fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved))),
      );
    }
    const referencedAncestors = new Set<string>();
    for (let ancestor of referenced) {
      while (roots.some((root) => inside(root, ancestor))) {
        ancestor = pathKey(path.dirname(ancestor));
        referencedAncestors.add(ancestor);
      }
    }
    const projectRoots = (yield* Effect.forEach(
      yield* Effect.filter(projects, (project) =>
        fs.exists(path.resolve(project.workspaceRoot)).pipe(Effect.orElseSucceed(() => true)),
      ),
      (project) => {
        const resolved = path.resolve(project.workspaceRoot);
        return fs.realPath(resolved).pipe(
          Effect.orElseSucceed(() => resolved),
          Effect.map((realPath) => [resolved, realPath]),
        );
      },
    )).flat();
    const inProject = (target: string, managedRoot: string) =>
      projectRoots.some(
        (root) =>
          !inside(root, managedRoot) && (pathKey(root) === pathKey(target) || inside(root, target)),
      );
    const directories = Effect.fnUntraced(function* (parent: string, managedRoot: string) {
      if (inProject(parent, managedRoot)) return [];
      const result: string[] = [];
      for (const name of yield* fs.readDirectory(parent).pipe(Effect.orElseSucceed(() => []))) {
        const target = path.join(parent, name);
        if (!inside(parent, target) || inProject(target, managedRoot)) continue;
        const directory = yield* Effect.gen(function* () {
          if (pathKey(yield* fs.realPath(target)) !== pathKey(target)) return false;
          return (yield* fs.stat(target)).type === "Directory";
        }).pipe(Effect.orElseSucceed(() => false));
        if (directory) result.push(target);
      }
      return result;
    });
    // Let the first walk time out and cache unmeasurable folders; later walks share the remaining budget.
    const now = yield* Clock.currentTimeMillis;
    const measurementDeadline = now + 30_000;
    let firstMeasurement = true;
    const reported = new Set<string>();
    const report = Effect.fnUntraced(
      function* (worktreePath: string) {
        const key = pathKey(worktreePath);
        if (
          reported.has(key) ||
          referenced.has(key) ||
          referencedAncestors.has(key) ||
          projectRoots.some((root) => pathKey(root) === key || inside(worktreePath, root))
        )
          return;
        const modified = Option.getOrNull((yield* fs.stat(worktreePath)).mtime);
        if (modified !== null && modified.getTime() > now - ORPHAN_WORKTREE_GRACE_MS) return;
        const gitPath = path.join(worktreePath, ".git");
        const linked = (yield* fs.exists(gitPath)) && (yield* fs.stat(gitPath)).type === "File";
        reported.add(key);
        const remaining = measurementDeadline - (yield* Clock.currentTimeMillis);
        if (!orphanSizes.has(key) && (firstMeasurement || remaining > 0)) {
          const measured = yield* measureWorktree(worktreePath).pipe(
            firstMeasurement ? Effect.asSome : Effect.timeoutOption(remaining),
          );
          firstMeasurement = false;
          if (Option.isSome(measured)) orphanSizes.set(key, measured.value);
        }
        const bytes = orphanSizes.get(key) ?? null;
        // fork: project-lifecycle
        const canRemove = linked && (yield* orphanRemovalReason(worktreePath, roots)) === null;
        entries.push({
          // fork: project-lifecycle
          ...(canRemove ? { canRemove: true } : {}),
          kind: "worktree",
          outcome: "kept",
          reason: linked
            ? "No thread uses this worktree"
            : "No thread uses this folder, and it isn't a git worktree",
          path: worktreePath,
          projectPath: null,
          threadId: null,
          threadTitle: null,
          bytes,
          files: null,
        });
      },
      Effect.orElseSucceed(() => undefined),
    );
    for (const root of roots) {
      // Worktrees can be <root>/<repository>/<branch> or explicitly <root>/<name>.
      for (const projectDirectory of yield* directories(root, root)) {
        yield* Effect.gen(function* () {
          if (referenced.has(pathKey(projectDirectory))) return;
          const gitPath = path.join(projectDirectory, ".git");
          if (yield* fs.exists(gitPath)) {
            if ((yield* fs.stat(gitPath)).type === "File") yield* report(projectDirectory);
            return;
          }
          for (const worktreePath of yield* directories(projectDirectory, root)) {
            yield* report(worktreePath);
          }
          // fork: project-lifecycle -- rmdir cannot remove a folder that acquired new files.
          yield* pruneEmptyProjectFolder(projectDirectory, roots);
        }).pipe(Effect.orElseSucceed(() => undefined));
      }
    }
    for (const key of orphanSizes.keys()) {
      if (!reported.has(key)) orphanSizes.delete(key);
    }
  });

  // Use two small Git reads: statusDetailsLocal also diffs and counts for every worktree.
  const branchChanged = Effect.fn("StorageCleanup.branchChanged")(function* (
    cwd: string,
    branch: string | null,
  ) {
    const failure = (detail: string) =>
      new GitCommandError({
        operation: "StorageCleanup.branchChanged",
        command: "git",
        cwd,
        detail,
      });
    // Return null for missing/non-repository cwd; force untranslated git diagnostics for matching.
    const read = Effect.fnUntraced(function* (args: string[], allowedExitCode?: number) {
      const result = yield* git
        .execute({
          operation: "StorageCleanup.branchChanged",
          cwd,
          args,
          env: { LC_ALL: "C" },
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.flatMap(fs.exists(cwd), (exists) =>
              exists ? Effect.fail(error) : Effect.succeed(null),
            ),
          ),
        );
      if (result === null) return null;
      if (result.exitCode === 0 || result.exitCode === allowedExitCode) return result;
      if (isNonRepositoryGitStderr(result.stderr)) return null; // fork: git-gitfile-errors
      return yield* failure(
        result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 1000) || "command failed",
      );
    });
    const index = yield* read(["rev-parse", "--git-path", "index"]);
    if (index === null) return true;
    if (yield* fs.exists(`${path.resolve(cwd, index.stdout.trim())}.lock`))
      return yield* failure(
        "Git index is locked. Status will resume when the index lock is removed.",
      );
    // Detached HEAD exits 1; full refs avoid shortening when a tag shares the branch name.
    const head = yield* read(["symbolic-ref", "--quiet", "HEAD"], 1);
    if (head === null) return true;
    const ref = head.exitCode === 0 ? head.stdout.trim() : "";
    const name = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length).trim() : null;
    return (name?.startsWith("(") ? null : name) !== branch;
  });

  const localChangesReason = Effect.fn("StorageCleanup.localChangesReason")(function* (
    cwd: string,
    rules: LocalFileRules, // fork: project-lifecycle
  ) {
    const status = yield* git.execute({
      operation: "StorageCleanup.localChanges",
      cwd,
      args: [
        "status",
        "--porcelain=v1",
        "-z",
        "--ignore-submodules=none",
        rules.worktreeKeepWhen === "tracked-changes"
          ? "--untracked-files=no"
          : "--untracked-files=all",
      ],
      maxOutputBytes: 64 * 1024,
    });
    if (status.stdoutTruncated) return "local changes exceed the inspection limit";
    const records = status.stdout.split("\0").filter(Boolean);
    let count = 0;
    for (let i = 0; i < records.length; i++) {
      count++;
      if (/^[RC]|^.[RC]/.test(records[i]!)) i++;
    }
    if (count > 0) return `has uncommitted changes (${count} ${count === 1 ? "file" : "files"})`;
    if (rules.worktreeKeepWhen !== "any-local-files" && rules.worktreeKeepWhen !== "landed")
      return null; // fork: project-lifecycle
    const ignored = yield* git.execute({
      operation: "StorageCleanup.ignoredFiles",
      cwd,
      args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      maxOutputBytes: 64 * 1024,
    });
    if (ignored.stdoutTruncated) return "ignored files exceed the inspection limit";
    // fork: project-lifecycle
    if (rules.worktreeKeepWhen === "landed") {
      // A linked worktree's own top-level .t3/ is T3 Code's dev home (see
      // packages/shared/src/devHome.ts): a sandbox seeded from real state that never feeds back,
      // nested test repositories included.
      const listing =
        rules.devHomeRoot === cwd
          ? ignored.stdout
              .split("\0")
              .filter((entry) => entry !== ".t3/")
              .join("\0")
          : ignored.stdout;
      const entry = yield* landedIgnoredFileBlocker(cwd, listing).pipe(
        Effect.provideService(GitVcsDriver.GitVcsDriver, git),
        Effect.provideService(FileSystem.FileSystem, fs), // fork: file-placement
        Effect.provideService(Path.Path, path), // fork: file-placement
      );
      return entry === null ? null : `has ignored local files such as ${entry}`;
    }
    const file = ignored.stdout
      .split("\0")
      .find((entry) => entry !== "" && !/(^|\/)node_modules\/$/.test(entry));
    return file === undefined ? null : `has ignored files (${file})`;
  });

  // fork: project-lifecycle -- manual orphan removal keeps every safety gate, independent of retention settings.
  const orphanRemovalReason = Effect.fn("StorageCleanup.orphanRemovalReason")(
    function* (cwd: string, roots: ReadonlyArray<string>) {
      const real = yield* fs.realPath(cwd);
      if (pathKey(real) !== pathKey(cwd) || !roots.some((root) => inside(root, real)))
        return "Outside the managed worktree folder or a symbolic link";
      const owner = yield* HostProcess.UserId;
      if (owner !== undefined && Option.getOrNull((yield* fs.stat(real)).uid) !== owner)
        return "Worktree is owned by another user";
      if (yield* containsProjectRoot(real, yield* projectStore.listShells()))
        return "Contains a project checkout";
      if ((yield* fs.stat(path.join(real, ".git"))).type !== "File") return "Not a linked worktree";
      if (yield* SetupMarker.exists(real)) return "Workspace preparation is pending";
      const references = yield* sql<{
        worktreePath: string;
      }>`SELECT DISTINCT json_extract(payload_json, '$.worktreePath') AS "worktreePath" FROM orchestration_v2_projection_threads WHERE json_extract(payload_json, '$.worktreePath') IS NOT NULL`;
      for (const reference of references) {
        const other = yield* fs
          .realPath(reference.worktreePath)
          .pipe(Effect.orElseSucceed(() => path.resolve(reference.worktreePath)));
        if (pathKey(other) === pathKey(real) || inside(real, other) || inside(other, real))
          return "A conversation uses this worktree";
      }
      if (hasTerminal(real)) return "Open terminal";
      const libraryReason = yield* libraryCleanupBlocker(real, yield* Clock.currentTimeMillis);
      if (libraryReason !== null) return libraryReason;
      const sessions = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM orchestration_v2_projection_provider_sessions WHERE status != 'stopped'`;
      for (const row of sessions) {
        const session = yield* decodeCleanupSession(row.payload_json);
        if (
          (pathKey(session.cwd) === pathKey(real) || inside(real, session.cwd)) &&
          (yield* providerSessions.isLive(session.id))
        )
          return "Provider session is still open";
      }
      yield* assertScratchUnmounted(real);
      const branch = yield* git.execute({
        operation: "StorageCleanup.orphanBranch",
        cwd: real,
        args: ["symbolic-ref", "--quiet", "HEAD"],
      });
      if (!branch.stdout.trim())
        return "Keep detached work until its commits are saved on a branch";
      const changes = yield* localChangesReason(real, { worktreeKeepWhen: "any-local-files" });
      if (changes !== null) return changes;
      const submodules = yield* git.execute({
        operation: "StorageCleanup.orphanSubmodules",
        cwd: real,
        args: ["submodule", "status", "--recursive"],
      });
      if (submodules.stdout.trim() || submodules.stdoutTruncated)
        return "Worktree contains submodules";
      return yield* managedProjectProcessReason(real);
    },
    Effect.orElseSucceed(() => "Could not safely inspect this worktree"),
  );

  const submoduleRemoval = Effect.fn("StorageCleanup.submoduleRemoval")(
    // fork: project-lifecycle
    function* (cwd: string, rules: LocalFileRules) {
      const inspect = (args: string[], maxOutputBytes = 64 * 1024) =>
        git.execute({
          operation: "StorageCleanup.submodules",
          cwd,
          args,
          maxOutputBytes,
        });
      const admin = yield* inspect(["rev-parse", "--absolute-git-dir"]);
      if (admin.stdoutTruncated || admin.stderrTruncated)
        return { force: false, reason: "submodule inspection exceeded the limit" };
      const modules = path.join(admin.stdout.replace(/\n$/, ""), "modules");
      const stored = yield* fs.exists(modules);
      if (!stored && !(yield* fs.exists(path.join(cwd, ".gitmodules"))))
        return { force: false, reason: null };
      const populated = yield* inspect([
        "submodule",
        "foreach",
        "--recursive",
        "--quiet",
        'printf "%s\\0" "$toplevel/$sm_path"',
      ]);
      if (populated.stdoutTruncated || populated.stderrTruncated)
        return { force: false, reason: "submodule inspection exceeded the limit" };
      const paths = populated.stdout.split("\0").filter(Boolean);
      const pending = [modules];
      for (const submodule of paths) {
        const directory = yield* inspect(["-C", submodule, "rev-parse", "--absolute-git-dir"]);
        if (directory.stdoutTruncated || directory.stderrTruncated)
          return { force: false, reason: "submodule inspection exceeded the limit" };
        pending.push(directory.stdout.replace(/\n$/, ""));
      }
      const visited = new Set<string>();
      while (pending.length > 0) {
        const directory = pending.pop()!;
        if (!(yield* fs.exists(directory))) continue;
        const canonical = yield* fs.realPath(directory);
        if (visited.has(canonical)) continue;
        visited.add(canonical);
        if (visited.size > 10_000)
          return { force: false, reason: "submodule inspection exceeded the limit" };
        if ((yield* fs.stat(directory)).type !== "Directory")
          return { force: false, reason: "submodule repository could not be inspected" };
        if (yield* fs.exists(path.join(directory, "HEAD"))) {
          const unpushed = yield* inspect([
            "--git-dir",
            directory,
            "--work-tree",
            cwd,
            "rev-list",
            "--max-count=1",
            "HEAD",
            "--all",
            "--reflog",
            "--not",
            "--remotes",
          ]);
          if (unpushed.stdoutTruncated || unpushed.stderrTruncated)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          if (unpushed.stdout.trim() !== "")
            return { force: false, reason: "submodule has commits not on a remote-tracking ref" };
          pending.push(path.join(directory, "modules"));
        } else {
          for (const name of yield* fs.readDirectory(directory))
            pending.push(path.join(directory, name));
        }
      }
      // Check files after walking stored history to shorten the gap before forced removal.
      for (const submodule of paths) {
        const changes = yield* localChangesReason(submodule, rules);
        if (changes !== null) return { force: false, reason: `submodule ${changes}` };
      }
      const force = stored || paths.length > 0;
      if (force && rules.worktreeKeepWhen !== "tracked-changes") {
        const root = yield* fs.realPath(cwd);
        // Git status and foreach omit files inside deinitialized gitlink directories.
        const populatedPaths = new Set(paths.map(pathKey));
        const unchecked: string[] = [];
        for (const repository of [root, ...paths]) {
          const index = yield* inspect(
            ["-C", repository, "ls-files", "--stage", "-z"],
            16 * 1024 * 1024,
          );
          if (index.stdoutTruncated || index.stderrTruncated)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          for (const entry of index.stdout.split("\0")) {
            if (!entry.startsWith("160000 ")) continue;
            const submodule = path.resolve(repository, entry.slice(entry.indexOf("\t") + 1));
            if (!inside(root, submodule))
              return { force: false, reason: "submodules could not be inspected" };
            if (!populatedPaths.has(pathKey(submodule)) && (yield* fs.exists(submodule)))
              unchecked.push(submodule);
          }
        }
        let inspected = unchecked.length;
        while (unchecked.length > 0) {
          if (inspected > 10_000)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          const target = unchecked.pop()!;
          if (
            (yield* fs.realPath(target)) !== path.resolve(target) ||
            (yield* fs.stat(target)).type !== "Directory"
          )
            return { force: false, reason: "submodule has local files" };
          if (
            rules.worktreeKeepWhen === "landed" // fork: project-lifecycle
              ? regenerableIgnoredPath(path.basename(target)) // fork: project-lifecycle
              : path.basename(target) === "node_modules"
          )
            continue;
          const names = yield* fs.readDirectory(target);
          inspected += names.length;
          for (const name of names) unchecked.push(path.join(target, name));
        }
      }
      return { force, reason: null };
    },
    Effect.orElseSucceed(() => ({ force: false, reason: "submodules could not be inspected" })),
  );

  const cleanupGit = Effect.fn("StorageCleanup.cleanupGit")(function* (
    cwd: string,
    args: string[],
    command: string,
  ) {
    const result = yield* git.execute({
      operation: "StorageCleanup.cleanupGit",
      cwd,
      args,
      allowNonZeroExit: true,
      timeoutMs: 300_000,
    });
    if (result.exitCode !== 0 || result.stdoutTruncated)
      // fork: project-lifecycle
      return yield* new GitCommandError({
        operation: "StorageCleanup.cleanupGit",
        command,
        cwd,
        detail: result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 1000) || "command failed",
      });
    return result; // fork: project-lifecycle
  });

  // fork: project-lifecycle -- compare-and-delete at the verified head, so a branch that moved or
  // is still checked out elsewhere survives. Failures keep the branch and explain why.
  const deleteLandedBranch = Effect.fn("StorageCleanup.deleteLandedBranch")(
    function* (input: {
      readonly repositoryCwd: string;
      readonly worktreePath: string;
      readonly branch: string;
      readonly defaultBranch: string;
      readonly verifiedHead: string;
      readonly holders: ReadonlyArray<OrchestrationV2ThreadShell["id"]>;
    }) {
      const { repositoryCwd, branch, verifiedHead } = input;
      // A managed worktree can check out the default branch itself while the root sits elsewhere.
      if (branch === input.defaultBranch) return "branch kept because it is the default branch";
      // Removal can take minutes, and a thread that started on this path meanwhile needs the branch.
      const holders = (yield* projections.getThreadWorktreePaths({ includeArchived: true }))
        .filter((entry) => path.resolve(entry.worktreePath) === input.worktreePath)
        .map((entry) => entry.threadId);
      if (
        holders.length !== input.holders.length ||
        holders.some((threadId) => !input.holders.includes(threadId))
      )
        return "branch kept because the threads using it changed during cleanup";
      // Continuing a thread recreates a missing branch at the parent of its latest ready checkpoint
      // (restoreWorktree), so that parent must be the head being deleted. Same selection as there.
      for (const threadId of holders) {
        const saved = yield* projections.getCheckpointContext(threadId);
        const scopes = new Set(
          saved.checkpointScopes
            .filter(
              (scope) =>
                scope.kind === "root_run" && path.resolve(scope.cwd) === input.worktreePath,
            )
            .map((scope) => scope.id),
        );
        const checkpoint = saved.checkpoints
          .filter((checkpoint) => checkpoint.status === "ready" && scopes.has(checkpoint.scopeId))
          .toSorted((left, right) => (right.appRunOrdinal ?? 0) - (left.appRunOrdinal ?? 0))[0];
        const parent =
          checkpoint === undefined
            ? null
            : yield* git.execute({
                operation: "StorageCleanup.landedCheckpointParent",
                cwd: repositoryCwd,
                args: ["rev-parse", "--verify", "--quiet", `${checkpoint.ref}^^{commit}`],
                allowNonZeroExit: true,
              });
        if (parent === null || parent.exitCode !== 0)
          return "branch kept because a thread has no checkpoint to restore it from";
        if (parent.stdout.trim() !== verifiedHead)
          return "branch kept because its latest checkpoint is older than the branch";
      }
      const ref = `refs/heads/${branch}`;
      const worktrees = yield* git.execute({
        operation: "StorageCleanup.landedBranchWorktrees",
        cwd: repositoryCwd,
        args: ["worktree", "list", "--porcelain"],
        maxOutputBytes: 1024 * 1024,
      });
      if (worktrees.stdoutTruncated) return "branch kept because its worktrees could not be listed";
      if (worktrees.stdout.split(/\r?\n/).includes(`branch ${ref}`))
        return "branch kept because another worktree has it checked out";
      const deleted = yield* git.execute({
        operation: "StorageCleanup.deleteLandedBranch",
        cwd: repositoryCwd,
        args: ["update-ref", "-d", ref, verifiedHead],
        allowNonZeroExit: true,
      });
      if (deleted.exitCode !== 0) {
        const current = yield* git.execute({
          operation: "StorageCleanup.landedBranchHead",
          cwd: repositoryCwd,
          args: ["rev-parse", "--verify", "--quiet", ref],
          allowNonZeroExit: true,
        });
        if (current.exitCode !== 0) return "branch was already deleted";
        return current.stdout.trim() === verifiedHead
          ? `branch kept (${deleted.stderr.trim().split(/\r?\n/)[0] || "update-ref failed"})`
          : "branch kept because it moved after the check";
      }
      // Matches `git branch -d`, which also drops the branch's upstream configuration.
      yield* git.execute({
        operation: "StorageCleanup.landedBranchConfig",
        cwd: repositoryCwd,
        args: ["config", "--remove-section", `branch.${branch}`],
        allowNonZeroExit: true,
      });
      return "branch deleted";
    },
    Effect.catch((error) => Effect.succeed(`branch kept (${cleanupFailureReason(error)})`)),
  );

  // fork: project-lifecycle -- a checkout release ends the live provider sessions working in the
  // worktree, which the thread's next message resumes. None ends while a thread using it runs.
  const releaseIdleSessions = Effect.fn("StorageCleanup.releaseIdleSessions")(function* (
    worktreePath: string,
    now: number,
  ) {
    const rows = yield* sql<{ payload_json: string }>`
      SELECT payload_json FROM orchestration_v2_projection_provider_sessions
      WHERE status != 'stopped'
    `.pipe(NodeSqliteClient.readOnly);
    const sessions = yield* Effect.filter(
      yield* Effect.forEach(rows, (row) => decodeCleanupSession(row.payload_json)),
      (session) => {
        const cwd = path.resolve(session.cwd);
        return cwd === worktreePath || inside(worktreePath, cwd)
          ? providerSessions.isLive(session.id)
          : Effect.succeed(false);
      },
    );
    for (const session of sessions) {
      const users = yield* sql<{ threadId: ThreadId }>`
        SELECT DISTINCT thread_id AS "threadId" FROM orchestration_v2_projection_provider_threads
        WHERE provider_session_id = ${session.id} AND thread_id IS NOT NULL
      `.pipe(NodeSqliteClient.readOnly);
      for (const user of users) {
        const shell = yield* projections.getThreadShell(user.threadId);
        if (shell !== null && !threadWorkspaceIdle(shell, now))
          return "a thread using its provider session is running";
      }
    }
    for (const session of sessions)
      yield* providerSessions.release({
        providerSessionId: session.id,
        reason: "manual_shutdown",
        detail: "Checkout released.",
      });
    return null;
  });

  const cleanWorktrees = Effect.fn("StorageCleanup.cleanWorktrees")(function* (
    serverSettings: ServerSettings,
    now: number,
    entries: StorageCleanupReportEntry[],
    // fork: project-lifecycle -- a checkout release judges only this thread's worktree.
    releaseThreadId?: ThreadId,
  ) {
    const releasing = releaseThreadId !== undefined; // fork: project-lifecycle
    if (!releasing && !anyWorktreePolicy(serverSettings, worktreeCleanupEnabled)) return; // fork: project-lifecycle
    const roots: Array<string> = [];
    for (const directory of managedWorktreesDirectories(
      serverSettings,
      config.worktreesDir,
      path,
      yield* HostProcess.HomeDirectory,
    )) {
      const root = yield* fs.exists(directory).pipe(
        Effect.flatMap((exists) => (exists ? fs.realPath(directory) : Effect.succeed(null))),
        Effect.orElseSucceed(() => null),
      );
      if (root !== null && !isFilesystemRoot(root, path)) roots.push(root);
    }
    const deletedRows = yield* sql<{ payload_json: string; workspaceRoot: string }>`
          SELECT t.payload_json, p.workspace_root AS "workspaceRoot"
          FROM orchestration_v2_projection_threads t
          JOIN projection_projects p ON p.project_id = t.project_id
          WHERE t.deleted_at IS NOT NULL
        `.pipe(NodeSqliteClient.readOnly);
    const deletedThreads = (yield* Effect.forEach(deletedRows, (row) =>
      decodeCleanupThread(row.payload_json).pipe(
        Effect.map((thread) => ({ ...thread, workspaceRoot: row.workspaceRoot })),
      ),
    )).filter((thread) => thread.worktreePath !== null && thread.branch !== null);
    const snapshot = yield* readThreads();
    // fork: project-lifecycle -- failed refreshes are remembered too (an Exit replays its
    // result), so a sweep fetches each repository's default ref at most once.
    const refreshedDefaultRefs = new Map<string, Effect.Effect<void, GitCommandError>>();
    const defaultBranches = new Map<string, string | null>();
    // fork: project-lifecycle -- shared by the opt-in unchanged and merged rules, which refresh the
    // default branch first. Null when the remote default branch cannot be identified.
    const defaultBranchIntegration = Effect.fn("StorageCleanup.defaultBranchIntegration")(
      function* (repositoryCwd: string, worktreePath: string, headSha: string) {
        const remote = yield* git.resolvePrimaryRemoteName(repositoryCwd);
        const defaultBranchKey = `${repositoryCwd}\0${remote}`;
        let branch = defaultBranches.get(defaultBranchKey);
        if (branch === undefined) {
          branch = yield* git.resolveDefaultBranchName(repositoryCwd, remote);
          // Without a local HEAD ref, only the remote can identify its default;
          // a conventional name may be a feature branch.
          if (branch === null) {
            branch = yield* git
              .execute({
                operation: "StorageCleanup.resolveDefaultBranch",
                cwd: repositoryCwd,
                args: ["ls-remote", "--symref", "--", remote, "HEAD"],
                timeoutMs: 20_000,
              })
              .pipe(
                Effect.map(
                  (result) => /^ref: refs\/heads\/(.+)\tHEAD\r?$/m.exec(result.stdout)?.[1] ?? null,
                ),
                Effect.orElseSucceed(() => null),
              );
          }
          defaultBranches.set(defaultBranchKey, branch);
        }
        if (branch === null) return null;
        const defaultRef = `refs/remotes/${remote}/${branch}`;
        const refreshKey = `${repositoryCwd}\0${defaultRef}`;
        let refreshed = refreshedDefaultRefs.get(refreshKey);
        if (refreshed === undefined) {
          refreshed = yield* Effect.exit(
            git.fetchRemoteTrackingBranch({
              cwd: repositoryCwd,
              remoteName: remote,
              remoteBranch: branch,
            }),
          );
          refreshedDefaultRefs.set(refreshKey, refreshed);
        }
        yield* refreshed;
        const base = yield* git.resolveCommit({ cwd: worktreePath, revision: defaultRef });
        const ancestor = yield* git.execute({
          operation: "StorageCleanup.integratedBranch",
          cwd: worktreePath,
          args: ["merge-base", "--is-ancestor", headSha, base.commitSha],
          allowNonZeroExit: true,
        });
        return { branch, integrated: ancestor.exitCode === 0 };
      },
    );
    // fork: project-lifecycle -- the landing rule is on by default, so it never contacts the
    // remote: a background fetch can prompt for SSH key approval or stall. It reads the default
    // branch as the user's own fetch, pull or push last recorded it. Null when that is unknown.
    const localDefaultBranches = new Map<string, { remote: string; branch: string } | null>();
    const landedOnDefaultBranch = Effect.fn("StorageCleanup.landedOnDefaultBranch")(function* (
      repositoryCwd: string,
      worktreePath: string,
      headSha: string,
    ) {
      let target = localDefaultBranches.get(repositoryCwd);
      if (target === undefined) {
        const remote = yield* git
          .resolvePrimaryRemoteName(repositoryCwd)
          .pipe(Effect.orElseSucceed(() => null));
        const branch =
          remote === null ? null : yield* git.resolveDefaultBranchName(repositoryCwd, remote);
        target = remote === null || branch === null ? null : { remote, branch };
        localDefaultBranches.set(repositoryCwd, target);
      }
      if (target === null) return null;
      const base = yield* git.execute({
        operation: "StorageCleanup.landedDefaultRef",
        cwd: worktreePath,
        args: [
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/remotes/${target.remote}/${target.branch}^{commit}`,
        ],
        allowNonZeroExit: true,
      });
      if (base.exitCode !== 0) return null;
      const ancestor = yield* git.execute({
        operation: "StorageCleanup.landedBranch",
        cwd: worktreePath,
        args: ["merge-base", "--is-ancestor", headSha, base.stdout.trim()],
        allowNonZeroExit: true,
      });
      return { branch: target.branch, landed: ancestor.exitCode === 0 };
    });
    const groups = Map.groupBy(
      snapshot.threads.filter((thread) => thread.worktreePath !== null),
      (thread) => path.resolve(thread.worktreePath!),
    );
    const deletedByPath = Map.groupBy(deletedThreads, (thread) =>
      path.resolve(thread.worktreePath!),
    );
    const candidates = [
      ...[...groups].map(
        ([worktreePath, group]) =>
          // A deleted thread still owns the worktree its remaining subagents share,
          // but only deletion cleanup acts on it; otherwise the live rules apply.
          deletedByPath
            .get(worktreePath)
            ?.find(
              (deleted) =>
                resolveWorktreeCleanup(serverSettings, deleted.projectId).worktreeOnDelete &&
                worktreeOwner([deleted, ...group]) === deleted,
            ) ??
          worktreeOwners(group)?.[0] ?? // fork: project-lifecycle
          group[0]!,
      ),
      ...deletedThreads.filter((thread) => !groups.has(path.resolve(thread.worktreePath!))),
    ];
    // fork: project-lifecycle
    const judged = releasing
      ? snapshot.threads.filter(
          (thread) => thread.id === releaseThreadId && thread.worktreePath !== null,
        )
      : candidates;
    for (const thread of judged) {
      const settings = resolveWorktreeCleanup(serverSettings, thread.projectId);
      if (!releasing && !worktreeCleanupEnabled(settings)) continue; // fork: project-lifecycle
      const worktreePath = path.resolve(thread.worktreePath!);
      const group = groups.get(worktreePath) ?? [];
      const activityAt = Math.max(...group.map(storageCleanupActivityAt));
      const deleted = "workspaceRoot" in thread;
      const members = deleted ? [thread, ...group] : group;
      const project = deleted
        ? { workspaceRoot: thread.workspaceRoot }
        : snapshot.projects.find((entry) => entry.id === thread.projectId);
      const entry: StorageCleanupReportEntry = {
        kind: "worktree",
        outcome: "kept",
        reason: "",
        path: worktreePath,
        projectPath: project?.workspaceRoot ?? null,
        threadId: thread.id,
        threadTitle: thread.title,
        bytes: null,
        files: null,
      };
      const keep = (reason: string) => entries.push({ ...entry, reason: sentence(reason) });
      yield* Effect.gen(function* () {
        if (!(yield* fs.exists(worktreePath)))
          return releasing ? keep("checkout is already released") : undefined; // fork: project-lifecycle
        // fork: project-lifecycle -- landed work needs every owner settled or archived. Subagent
        // chains follow their owners, as settled retention does. Deleted holders are gone from the
        // group, so a deleted thread's worktree qualifies. A release needs neither.
        const deciders = worktreeOwners(group) ?? group;
        const unfinished = deciders.filter(
          (holder) => holder.settledOverride !== "settled" && holder.archivedAt == null,
        ).length;
        const landing = releasing || (settings.worktreeOnLand && unfinished === 0);
        const unfinishedReason =
          deciders.length > 1
            ? `${unfinished} of ${deciders.length} threads are not settled or archived`
            : "thread is not settled or archived";
        // fork: project-lifecycle -- skip the guard chain while the landing rule is the only one on
        // and cannot apply yet.
        if (!landing && !worktreeCleanupEnabled({ ...settings, worktreeOnLand: false }))
          return keep(unfinishedReason);
        const libraryReason = yield* libraryCleanupBlocker(worktreePath, now);
        if (libraryReason !== null) return keep(libraryReason);
        if (deleted && !settings.worktreeOnDelete && !landing) return keep("no rules apply"); // fork: project-lifecycle
        // fork: project-lifecycle -- owners all settled on this branch release a shared worktree.
        const settled =
          !deleted &&
          !releasing &&
          settings.worktreeOnSettle &&
          deciders.every((holder) => holder.settledOverride === "settled") &&
          group.every(
            (holder) =>
              storageCleanupThreadIdle(holder, now) &&
              holder.branch === thread.branch &&
              holder.projectId === thread.projectId,
          );
        // fork: project-lifecycle -- releasing is the user's explicit request.
        if (!releasing && group.some((holder) => holder.pinnedAt != null))
          return keep("thread is pinned");
        if (members.length > 1 && !settled && !landing && worktreeOwner(members) === undefined)
          // fork: project-lifecycle -- landed shared worktrees are released once every holder is done.
          return keep(`shared by ${members.length} threads`);
        // fork: project-lifecycle
        if (yield* SetupMarker.exists(worktreePath))
          return keep("workspace preparation is pending");
        if (project === undefined) return keep("project is unavailable");
        if (
          thread.branch === null ||
          !group.every((member) => storageCleanupThreadIdle(member, now))
        )
          return keep("thread is running or has pending work");
        if (group.some((member) => member.branch !== thread.branch))
          return keep("a subagent thread's branch differs from this worktree's branch");
        if (hasTerminal(worktreePath)) return keep("open terminal");
        // Compare canonical roots while allowing symlinked parents, never symlinked worktree directories.
        const realPath = yield* fs.realPath(worktreePath);
        const realParent = yield* fs.realPath(path.dirname(worktreePath));
        if (realPath !== path.join(realParent, path.basename(worktreePath)))
          return keep("worktree is a symbolic link");
        // fork: mini-native-retention
        const owner = yield* HostProcess.UserId;
        if (owner !== undefined && Option.getOrNull((yield* fs.stat(realPath)).uid) !== owner)
          return keep("worktree is owned by another user");
        yield* assertScratchUnmounted(realPath);
        if (!roots.some((root) => inside(root, realPath)))
          return keep("outside the managed worktree folder");
        if (yield* containsProjectRoot(worktreePath, [project, ...snapshot.projects]))
          return keep("contains a project checkout");
        if ((yield* fs.stat(path.join(worktreePath, ".git"))).type !== "File")
          return keep("not a linked worktree");
        if (yield* branchChanged(worktreePath, thread.branch))
          return keep("repository or branch changed");
        // fork: project-lifecycle -- landing is checked first: its branch deletion wins over rules
        // that keep the branch, a landed head is already published on the default branch, and the
        // landing rule's own file protection depends on it.
        const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
        let landedOn: string | null = null;
        let landingReason: string | null = null;
        if (landing) {
          const checked = yield* Effect.result(
            landedOnDefaultBranch(
              path.resolve(project.workspaceRoot),
              worktreePath,
              head.commitSha,
            ),
          );
          if (checked._tag === "Failure")
            landingReason = `could not check whether it landed (${cleanupFailureReason(checked.failure)})`;
          else if (checked.success === null) landingReason = "default branch is unknown locally";
          else if (checked.success.landed) landedOn = checked.success.branch;
          else landingReason = `has commits not on ${checked.success.branch}`;
        }
        // fork: project-lifecycle -- otherwise only the deletion rule handles deleted threads, and
        // only landed work is released.
        if (((deleted && !settings.worktreeOnDelete) || releasing) && landedOn === null)
          return keep(landingReason ?? "no rules apply");
        // Settlement never discards local data, even if older cleanup rules allow it.
        const fileRules = settled
          ? { ...settings, worktreeKeepWhen: "any-local-files" as const }
          : landedOn !== null && settings.worktreeKeepWhen !== "any-local-files" // fork: project-lifecycle
            ? { worktreeKeepWhen: "landed" as const, devHomeRoot: worktreePath } // fork: project-lifecycle
            : settings;
        const changes = yield* localChangesReason(worktreePath, fileRules);
        if (changes !== null) return keep(changes);
        // fork: project-lifecycle -- settle cleanup runs only after the settle script finished.
        if (
          !settled && // fork: project-lifecycle
          group.some(
            (member) =>
              member.settledAt !== null &&
              now - Math.max(DateTime.toEpochMillis(member.updatedAt), activityAt) <
                SETTLE_SCRIPT_GRACE_MS,
          )
        )
          return keep("settled moments ago");
        // fork: project-lifecycle -- HEAD is resolved before the landing check
        const old =
          !deleted &&
          settings.worktreeAfterDays !== null &&
          activityAt < now - settings.worktreeAfterDays * DAY_MS;
        // fork: project-lifecycle -- a settled release requires the branch head to be published.
        if (settled && landedOn === null) {
          const upstream = yield* git.execute({
            operation: "StorageCleanup.publishedBranch",
            cwd: worktreePath,
            args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            allowNonZeroExit: true,
          });
          if (upstream.exitCode !== 0) return keep("branch has no published upstream");
          const remote = yield* git.execute({
            operation: "StorageCleanup.upstreamRemote",
            cwd: worktreePath,
            args: ["config", "--get", `branch.${thread.branch}.remote`],
            allowNonZeroExit: true,
          });
          const remoteName = remote.stdout.trim();
          if (remote.exitCode !== 0 || remoteName === "" || remoteName === ".")
            return keep("branch has no published upstream");
          yield* cleanupGit(worktreePath, ["fetch", "--prune", "--", remoteName], "git fetch");
          const published = yield* git.execute({
            operation: "StorageCleanup.publishedHead",
            cwd: worktreePath,
            args: ["merge-base", "--is-ancestor", head.commitSha, "@{upstream}"],
            allowNonZeroExit: true,
          });
          if (published.exitCode !== 0) return keep("branch has unpublished commits");
        }
        const settledFor =
          deleted || thread.settledAt === null
            ? null
            : now - Math.max(DateTime.toEpochMillis(thread.settledAt), activityAt);
        const settledDays = settledFor === null ? null : Math.floor(settledFor / DAY_MS);
        const settledElapsed = // fork: project-lifecycle
          settledFor !== null &&
          settings.worktreeSettledAfterDays !== null &&
          settledFor >= settings.worktreeSettledAfterDays * DAY_MS;
        let eligible =
          landedOn !== null ||
          (deleted && settings.worktreeOnDelete) ||
          old ||
          settled ||
          settledElapsed; // fork: project-lifecycle
        let removalReason =
          landedOn !== null // fork: project-lifecycle
            ? `${releasing ? "checkout released; " : ""}landed on ${landedOn}` // fork: project-lifecycle
            : deleted
              ? "thread was deleted"
              : settled // fork: project-lifecycle
                ? "all threads settled; branch is published"
                : old
                  ? `inactive for ${Math.floor((now - activityAt) / DAY_MS)} days`
                  : `settled for ${settledDays} days`;
        if (!eligible && (settings.worktreeUnchanged || settings.worktreeOnMerge)) {
          // fork: project-lifecycle -- refreshed, unlike the landing check's local-only result.
          const integration = yield* defaultBranchIntegration(
            path.resolve(project.workspaceRoot),
            worktreePath,
            head.commitSha,
          );
          if (integration === null) return keep("default branch is unavailable");
          const { branch, integrated } = integration; // fork: project-lifecycle
          eligible = integrated && settings.worktreeUnchanged;
          if (eligible) removalReason = "no commits beyond the default branch";
          if (!eligible && settings.worktreeOnMerge && thread.branch !== null) {
            const pullRequest = yield* gitManager.branchPullRequest(
              { cwd: worktreePath, branch: thread.branch },
              { refresh: true },
            );
            eligible = storageCleanupPullRequestMerged(pullRequest, {
              branch: thread.branch,
              defaultBranch: branch,
              headSha: head.commitSha,
              integrated,
            });
            if (eligible) removalReason = "pull request was merged";
          }
        }
        if (!eligible)
          return keep(
            landingReason ?? // fork: project-lifecycle
              (!deleted && settings.worktreeAfterDays !== null
                ? `inactive for ${Math.floor((now - activityAt) / DAY_MS)} of ${settings.worktreeAfterDays} days`
                : settings.worktreeSettledAfterDays !== null
                  ? settledFor === null
                    ? "not settled"
                    : `settled for ${settledDays} of ${settings.worktreeSettledAfterDays} days`
                  : settings.worktreeOnMerge
                    ? "not merged"
                    : settings.worktreeOnLand && !settings.worktreeUnchanged // fork: project-lifecycle
                      ? unfinishedReason
                      : "has commits beyond the default branch"),
          );
        // Re-read this path's threads and sessions so new activity cancels removal; full per-worktree snapshots take seconds.
        const blockedSinceCheck = Effect.fnUntraced(function* () {
          // fork: library-projects
          const libraryReason = yield* libraryCleanupBlocker(worktreePath, now);
          if (libraryReason !== null) return libraryReason;
          const latestProjects = yield* projectStore.listShells();
          if (yield* containsProjectRoot(worktreePath, [project, ...latestProjects]))
            return "contains a project checkout";
          const latest = (yield* projections.getThreadWorktreePaths({
            includeArchived: true,
          })).filter((entry) => path.resolve(entry.worktreePath) === worktreePath);
          if (hasTerminal(worktreePath)) return "open terminal";
          if (deleted) {
            // fork: project-lifecycle -- either rule that found the deleted thread's worktree.
            const rules = resolveWorktreeCleanup(
              yield* settingsService.getSettings,
              thread.projectId,
            );
            if (
              !(rules.worktreeOnDelete || (landedOn !== null && rules.worktreeOnLand)) // fork: project-lifecycle
            )
              return "thread or cleanup settings changed since check";
            // Durable deletion cleanup must succeed or be explicitly cancelled before removing its checkout.
            const pendingCleanup = yield* sql`
              SELECT 1 FROM orchestration_v2_effect_outbox
              WHERE thread_id = ${thread.id} AND status NOT IN ('succeeded', 'cancelled') LIMIT 1
            `.pipe(NodeSqliteClient.readOnly);
            if (pendingCleanup.length > 0) return "thread deletion is still pending";
          }
          const latestShells = yield* Effect.forEach(latest, (entry) =>
            projections.getThreadShell(entry.threadId),
          );
          const latestGroup = latestShells.filter((shell) => shell !== null);
          const latestOwner = worktreeOwner(deleted ? [thread, ...latestGroup] : latestGroup);
          // fork: project-lifecycle
          if (!releasing && latestGroup.some((shell) => shell.pinnedAt != null))
            return "thread is pinned";
          if (
            latestGroup.length !== group.length ||
            // fork: project-lifecycle -- settled or landed holders need no single owner.
            (!settled &&
              landedOn === null &&
              (latestOwner?.id !== thread.id || latestOwner?.branch !== thread.branch)) ||
            latestGroup.some((shell) => {
              const previous = group.find((member) => member.id === shell.id);
              const decides = deciders.some((decider) => decider.id === shell.id); // fork: project-lifecycle
              return (
                previous === undefined ||
                shell.branch !== thread.branch ||
                shell.projectId !== previous.projectId || // fork: project-lifecycle
                (settled && decides && shell.settledOverride !== "settled") || // fork: project-lifecycle
                (landedOn !== null && // fork: project-lifecycle
                  !releasing && // fork: project-lifecycle
                  decides && // fork: project-lifecycle
                  shell.settledOverride !== "settled" && // fork: project-lifecycle
                  shell.archivedAt == null) || // fork: project-lifecycle
                !Equal.equals(shell.settledAt, previous.settledAt) ||
                (shell.settledAt !== null && !Equal.equals(shell.updatedAt, previous.updatedAt)) ||
                !storageCleanupThreadIdle(shell, now) ||
                path.resolve(shell.worktreePath!) !== worktreePath ||
                storageCleanupActivityAt(shell) !== storageCleanupActivityAt(previous)
              );
            })
          )
            return "thread activity or shared worktree changed since check";
          // fork: project-lifecycle
          for (const holder of latestGroup) {
            const effects = yield* sql`SELECT 1 FROM orchestration_v2_effect_outbox
            WHERE thread_id = ${holder.id} AND status NOT IN ('succeeded', 'cancelled') LIMIT 1`;
            if (effects.length > 0) return "thread effects are still pending";
          }
          // Sessions can outlive their run and can be shared across app threads.
          const sessionRows = yield* sql<{ payload_json: string }>`
            SELECT payload_json FROM orchestration_v2_projection_provider_sessions
            WHERE status != 'stopped'
          `.pipe(NodeSqliteClient.readOnly);
          const sessions = yield* Effect.forEach(sessionRows, (row) =>
            decodeCleanupSession(row.payload_json),
          );
          // Ready persisted sessions may have released their runtime; only live sessions protect the path.
          for (const session of sessions) {
            const cwd = path.resolve(session.cwd);
            if (
              (cwd === worktreePath || inside(worktreePath, cwd)) &&
              (yield* providerSessions.isLive(session.id))
            )
              return "provider session is still open";
          }
          return null;
        });
        // fork: project-lifecycle
        if (releasing) {
          const busy = yield* releaseIdleSessions(worktreePath, now);
          if (busy !== null) return keep(busy);
        }
        const blocked = yield* blockedSinceCheck();
        if (blocked !== null) return keep(blocked);
        const bytes = yield* measureWorktree(worktreePath);
        const blockedWhileMeasuring = yield* blockedSinceCheck();
        if (blockedWhileMeasuring !== null) return keep(blockedWhileMeasuring);
        if (yield* branchChanged(worktreePath, thread.branch))
          return keep("repository or branch changed since check");
        if (
          (yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" })).commitSha !==
          head.commitSha
        )
          return keep("commit changed since check");
        const finalChanges = yield* localChangesReason(worktreePath, fileRules); // fork: project-lifecycle
        if (finalChanges !== null) return keep(finalChanges);
        const current = resolveWorktreeCleanup(
          yield* settingsService.getSettings,
          thread.projectId,
        );
        if (
          Object.keys(settings).some(
            (key) =>
              current[key as keyof typeof settings] !== settings[key as keyof typeof settings],
          )
        )
          return keep("settings changed since check");
        // Clean only untracked files. Ordinary worktrees retain Git's final tracked-edit check.
        if (fileRules.worktreeKeepWhen === "tracked-changes")
          // fork: project-lifecycle
          yield* cleanupGit(worktreePath, ["clean", "-ffdx"], "git clean");
        const submodules = yield* submoduleRemoval(worktreePath, fileRules); // fork: project-lifecycle
        if (submodules.reason !== null) return keep(submodules.reason);
        if (submodules.force) {
          const changes = yield* localChangesReason(worktreePath, fileRules); // fork: project-lifecycle
          if (changes !== null) return keep(changes);
        }
        // fork: project-lifecycle -- the default-on landing rule also waits for programs (dev
        // servers, editors, shells outside Loom) whose working directory is in the worktree.
        if (landedOn !== null) {
          const processReason = yield* managedProjectProcessReason(realPath);
          if (processReason !== null) return keep(processReason);
        }
        yield* assertScratchUnmounted(realPath);
        yield* removeLinkedWorktree({
          operation: "StorageCleanup.cleanupGit",
          cwd: project.workspaceRoot,
          worktreePath,
          // Git requires force for submodules; recursive checks above cannot make removal atomic.
          force: submodules.force,
          execute: git.execute,
          run: (args) => cleanupGit(project.workspaceRoot, [...args], "git worktree remove"),
        });
        // fork: project-lifecycle -- only the landing rule deletes the branch.
        const branchNote =
          landedOn === null || thread.branch === null
            ? null
            : yield* deleteLandedBranch({
                repositoryCwd: project.workspaceRoot,
                worktreePath,
                branch: thread.branch,
                defaultBranch: landedOn,
                verifiedHead: head.commitSha,
                holders: group.map((holder) => holder.id),
              });
        entries.push({
          ...entry,
          outcome: "removed",
          reason: sentence(branchNote === null ? removalReason : `${removalReason}; ${branchNote}`), // fork: project-lifecycle
          bytes,
        });
        yield* gitManager.invalidateStatus(project.workspaceRoot);
        // Preserve branch/path so ProviderTurnStartService can recreate the checkout on resume.
        // fork: project-lifecycle -- a deleted landed branch is recreated from the latest checkpoint.
        yield* Effect.logInfo("storage cleanup removed worktree", { threadId: thread.id });
      }).pipe(
        (effect) => withWorkspaceLease(worktreePath, effect),
        Effect.catch((error) =>
          Effect.gen(function* () {
            entries.push({
              ...entry,
              outcome: "failed",
              reason: cleanupFailureReason(error),
            });
            yield* Effect.logWarning("storage cleanup failed for worktree", {
              threadId: thread.id,
              error,
            });
          }),
        ),
      );
    }
    if (releasing) return; // fork: project-lifecycle
    yield* reportOrphanWorktrees(
      roots,
      yield* projectStore.list({ includeDeleted: true }),
      entries,
    );
  });

  let hasExplicitProjectSettlementPolicy = false; // fork: project-checkout-management

  // fork: project-lifecycle
  const cleanProjects = Effect.fn("StorageCleanup.cleanProjects")(function* (
    settings: ServerSettings["storageCleanup"],
    now: number,
    entries: StorageCleanupReportEntry[],
  ) {
    const snapshot = yield* readThreads();
    let foundExplicitSettlementPolicy = false;
    for (const project of snapshot.projects) {
      const cwd = path.resolve(project.workspaceRoot);
      const entry: StorageCleanupReportEntry = {
        kind: "project",
        outcome: "kept",
        reason: "",
        path: cwd,
        projectPath: null,
        threadId: null,
        threadTitle: project.title,
        bytes: null,
        files: null,
      };
      const keep = (reason: string) => entries.push({ ...entry, reason: sentence(reason) });
      yield* withWorkspaceLease(
        cwd,
        Effect.gen(function* () {
          const receipt = yield* readManagedProjectCheckout(cwd);
          if (receipt === null) return; // User-opened roots require explicit reviewed adoption.
          if (receipt.projectId !== null && receipt.projectId !== project.id)
            return keep("managed checkout belongs to another project");
          if (receipt.retention === "release-on-settle") foundExplicitSettlementPolicy = true;
          if (!(yield* fs.exists(cwd))) return;
          const projectPolicy = resolveManagedProjectRetention(receipt.retention, settings);
          if (receipt.retention === "keep") return keep("project folder is kept on this computer");
          if (projectPolicy.projectAfterDays === null && !projectPolicy.projectOnSettle) return;
          if (receipt.workspaceRoot !== cwd) return keep("project path is not canonical");
          if (receipt.removalPath !== null && (yield* fs.exists(receipt.removalPath)))
            return keep(`recovery files are retained in ${receipt.removalPath}`);
          const holders = snapshot.threads.filter((thread) => thread.projectId === project.id);
          const fileRules = {
            ...resolveWorktreeCleanup(yield* settingsService.getSettings, project.id),
            worktreeKeepWhen: "any-local-files" as const,
          };
          const blocked = Effect.fnUntraced(function* () {
            const libraryReason = yield* libraryCleanupBlocker(cwd, now);
            if (libraryReason !== null) return libraryReason;
            const latest = yield* readThreads();
            const currentProject = latest.projects.find((candidate) => candidate.id === project.id);
            if (currentProject === undefined || path.resolve(currentProject.workspaceRoot) !== cwd)
              return "project identity changed since check";
            const currentReceipt = yield* readManagedProjectCheckout(cwd);
            if (
              currentReceipt === null ||
              currentReceipt.projectId !== receipt.projectId ||
              currentReceipt.retention !== receipt.retention
            )
              return "project storage policy changed since check";
            if (
              currentReceipt.checkoutInode !== receipt.checkoutInode ||
              currentReceipt.gitInode !== receipt.gitInode ||
              currentReceipt.device !== receipt.device ||
              currentReceipt.uid !== receipt.uid ||
              currentReceipt.released !== receipt.released ||
              currentReceipt.repositoryIdentity.canonicalKey !==
                receipt.repositoryIdentity.canonicalKey
            )
              return "managed checkout identity changed since check";
            const policy = resolveManagedProjectRetention(
              currentReceipt.retention,
              (yield* settingsService.getSettings).storageCleanup,
            );
            if (
              policy.projectAfterDays !== projectPolicy.projectAfterDays ||
              policy.projectOnSettle !== projectPolicy.projectOnSettle
            )
              return "settings changed since check";
            const currentHolders = latest.threads.filter(
              (thread) => thread.projectId === project.id,
            );
            if (
              currentHolders.length !== holders.length ||
              currentHolders.some(
                (thread) =>
                  !holders.some(
                    (prior) =>
                      prior.id === thread.id &&
                      storageCleanupActivityAt(prior) === storageCleanupActivityAt(thread),
                  ),
              )
            )
              return "thread identity or activity changed since check";
            if (currentHolders.some((thread) => thread.pinnedAt != null)) return "thread is pinned";
            if (currentHolders.some((thread) => !threadWorkspaceIdle(thread, now)))
              return "thread is running or has pending work";
            if (hasTerminal(cwd)) return "open terminal";
            if (
              yield* containsProjectRoot(
                cwd,
                latest.projects.filter((candidate) => candidate.id !== project.id),
              )
            )
              return "contains another project checkout";
            const allSettled =
              currentHolders.length > 0 &&
              currentHolders.every(
                (thread) => thread.settledOverride === "settled" || thread.archivedAt != null,
              );
            const activity = Math.max(
              Date.parse(project.createdAt),
              ...currentHolders.map(storageCleanupActivityAt),
            );
            if (
              !(projectPolicy.projectOnSettle && allSettled) &&
              !(
                projectPolicy.projectAfterDays !== null &&
                activity < now - projectPolicy.projectAfterDays * DAY_MS
              )
            )
              return "project retention has not elapsed";
            if (yield* SetupMarker.exists(cwd)) return "workspace preparation is pending";
            for (const thread of currentHolders) {
              const pending = yield* sql`SELECT 1 FROM orchestration_v2_effect_outbox
              WHERE thread_id = ${thread.id} AND status NOT IN ('succeeded', 'cancelled') LIMIT 1`;
              if (pending.length > 0) return "thread effects are still pending";
            }
            const rows = yield* sql<{ payload_json: string }>`SELECT payload_json
            FROM orchestration_v2_projection_provider_sessions WHERE status != 'stopped'`;
            const sessions = yield* Effect.forEach(rows, (row) =>
              decodeCleanupSession(row.payload_json),
            );
            if (
              sessions.some(
                (session) =>
                  path.resolve(session.cwd) === cwd || inside(cwd, path.resolve(session.cwd)),
              )
            )
              return "provider session is still open";
            return yield* managedProjectProcessReason(cwd);
          });
          const initialBlock = yield* blocked();
          if (initialBlock !== null) return keep(initialBlock);
          yield* assertManagedProjectOwned(receipt);
          const changes = yield* localChangesReason(cwd, fileRules);
          if (changes !== null) return keep(changes);
          // Submodule worktrees can contain local/ignored files invisible to the
          // parent status. Their checkout/data lifecycle is not managed here.
          const tracked = (yield* cleanupGit(cwd, ["ls-files", "--stage"], "git files")).stdout;
          if (/^160000 /m.test(tracked)) return keep("repository contains submodules");
          const worktrees = (yield* cleanupGit(
            cwd,
            ["worktree", "list", "--porcelain"],
            "git worktrees",
          )).stdout;
          if (worktrees.split("\n").filter((line) => line.startsWith("worktree ")).length > 1)
            return keep("project has linked worktrees");
          // Fetch every publication remote into a private namespace. Local remote-tracking
          // refs alone are stale evidence, and custom fetch mappings must not hide branches.
          const origin = (yield* cleanupGit(
            cwd,
            ["remote", "get-url", "origin"],
            "git remote",
          )).stdout.trim();
          if (normalizeGitRemoteUrl(origin) !== receipt.repositoryIdentity.canonicalKey)
            return keep("repository identity changed since clone");
          const publication = yield* proveGitPublication((args) =>
            cleanupGit(cwd, args, "git publication").pipe(Effect.map((result) => result.stdout)),
          );
          if (!publication.published) return keep(publication.reason);
          const head = publication.head;
          const bytes = yield* measureWorktree(cwd);
          const recovery = yield* archiveManagedProjectCheckout(receipt, project.id);
          const archiveBytes = yield* measureWorktree(
            (yield* scratchArchivePaths(recovery.input)).archive,
          );
          const afterArchive = yield* blocked();
          if (afterArchive !== null) return keep(afterArchive);
          if ((yield* git.resolveCommit({ cwd, revision: "HEAD" })).commitSha !== head)
            return keep("commit changed since check");
          const finalChanges = yield* localChangesReason(cwd, fileRules);
          if (finalChanges !== null) return keep(finalChanges);
          yield* releaseManagedProjectCheckout(receipt, project.id, recovery.archive);
          entries.push({
            ...entry,
            outcome: "removed",
            reason: "Published checkout released; recovery archive saved",
            bytes:
              bytes === null || archiveBytes === null ? null : Math.max(0, bytes - archiveBytes),
          });
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            entries.push({ ...entry, outcome: "failed", reason: cleanupFailureReason(error) }),
          ),
        ),
      );
    }
    hasExplicitProjectSettlementPolicy = foundExplicitSettlementPolicy;
  });

  // fork: mini-native-retention
  const cleanScratch = Effect.fn("StorageCleanup.cleanScratch")(function* (
    retention: number | null,
    now: number,
    entries: StorageCleanupReportEntry[],
  ) {
    if (retention === null) return;
    const roots = new Set([
      path.resolve(config.baseDir, "scratch"),
      path.resolve(config.managedProjectsRoot ?? config.baseDir, "scratch"),
    ]);
    const snapshot = yield* readThreads();
    const groups = Map.groupBy(
      snapshot.threads.filter((thread) => thread.worktreePath !== null),
      (thread) => path.resolve(thread.worktreePath!),
    );
    for (const [cwd, holders] of groups) {
      const thread = holders[0]!;
      const project = snapshot.projects.find((candidate) => candidate.id === thread.projectId);
      if (
        project === undefined ||
        !roots.has(path.resolve(project.workspaceRoot)) ||
        path.dirname(cwd) !== path.resolve(project.workspaceRoot)
      )
        continue;
      const entry: StorageCleanupReportEntry = {
        kind: "scratch",
        outcome: "kept",
        reason: "",
        path: cwd,
        projectPath: project.workspaceRoot,
        threadId: thread.id,
        threadTitle: thread.title,
        bytes: null,
        files: null,
      };
      const keep = (reason: string) => entries.push({ ...entry, reason: sentence(reason) });
      yield* withWorkspaceLease(
        cwd,
        Effect.gen(function* () {
          if (!(yield* fs.exists(cwd))) return;
          const input = {
            scratchRoot: path.resolve(project.workspaceRoot),
            worktreePath: cwd,
            projectId: thread.projectId,
            threadId: thread.id,
          };
          const blocked = Effect.fnUntraced(function* () {
            const libraryReason = yield* libraryCleanupBlocker(cwd, now);
            if (libraryReason !== null) return libraryReason;
            const current = yield* readThreads();
            const latest = current.threads.filter(
              (holder) => holder.worktreePath !== null && path.resolve(holder.worktreePath) === cwd,
            );
            if ((yield* settingsService.getSettings).storageCleanup.scratchAfterDays !== retention)
              return "settings changed since check";
            if (
              latest.length !== holders.length ||
              latest.some(
                (holder) =>
                  !holders.some(
                    (prior) =>
                      prior.id === holder.id &&
                      prior.projectId === holder.projectId &&
                      storageCleanupActivityAt(prior) === storageCleanupActivityAt(holder),
                  ),
              )
            )
              return "thread identity or activity changed since check";
            if (latest.some((holder) => holder.pinnedAt != null)) return "thread is pinned";
            if (latest.some((holder) => !threadWorkspaceIdle(holder, now)))
              return "thread is running or has pending work";
            if (hasTerminal(cwd)) return "open terminal";
            if (
              latest.some((holder) => storageCleanupActivityAt(holder) >= now - retention * DAY_MS)
            )
              return "Scratch retention has not elapsed";
            if (yield* containsProjectRoot(cwd, current.projects))
              return "contains a project checkout";
            for (const holder of latest) {
              const pending = yield* sql`SELECT 1 FROM orchestration_v2_effect_outbox
              WHERE thread_id = ${holder.id} AND status NOT IN ('succeeded', 'cancelled') LIMIT 1`;
              if (pending.length > 0) return "thread effects are still pending";
            }
            const sessionRows = yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM orchestration_v2_projection_provider_sessions WHERE status != 'stopped'`;
            const sessions = yield* Effect.forEach(sessionRows, (row) =>
              decodeCleanupSession(row.payload_json),
            );
            if (
              sessions.some(
                (session) =>
                  path.resolve(session.cwd) === cwd || inside(cwd, path.resolve(session.cwd)),
              )
            )
              return "provider session is still open";
            return null;
          });
          if (holders.length > 1) return keep(`shared by ${holders.length} threads`);
          if (yield* SetupMarker.exists(cwd)) return keep("workspace preparation is pending");
          const before = yield* blocked();
          if (before !== null) return keep(before);
          const names = yield* fs.readDirectory(cwd);
          if (names.length > 0 && !names.includes(".git"))
            return keep("non-Git Scratch data is retained");
          if (
            names.includes(".git") &&
            (yield* fs.stat(path.join(cwd, ".git"))).type !== "Directory"
          )
            return keep("not an independent Scratch repository");
          const fileRules = {
            ...resolveWorktreeCleanup(yield* settingsService.getSettings, thread.projectId),
            worktreeKeepWhen: "any-local-files" as const,
          };
          if (names.length > 0) {
            const changes = yield* localChangesReason(cwd, fileRules);
            if (changes !== null) return keep(changes);
          }
          const bytes = yield* measureWorktree(cwd);
          const archivePath = (yield* scratchArchivePaths(input)).archive;
          const previousArchiveBytes = (yield* fs.exists(archivePath))
            ? yield* measureWorktree(archivePath)
            : 0;
          const archive = yield* archiveScratchCheckout(input);
          const archiveBytes = yield* measureWorktree(archivePath);
          const after = yield* blocked();
          if (after !== null) return keep(after);
          if (!(yield* scratchArchiveMatches(archive)))
            return keep("Scratch repository changed while archiving");
          if (archive.kind === "git") {
            const changes = yield* localChangesReason(cwd, fileRules);
            if (changes !== null) return keep(changes);
          }
          yield* scratchCheckoutOwned(input);
          const finalBlock = yield* blocked();
          if (finalBlock !== null) return keep(finalBlock);
          // The durable archive remains outside this folder. Its registered identity stays in
          // the projection so startup can restore commits, checkpoint refs and Git metadata.
          yield* assertScratchUnmounted(yield* fs.realPath(cwd));
          yield* fs.remove(cwd, { recursive: true });
          entries.push({
            ...entry,
            outcome: "removed",
            reason: `Inactive for ${retention} days; recovery archive saved`,
            bytes:
              bytes === null || archiveBytes === null || previousArchiveBytes === null
                ? null
                : Math.max(0, bytes + previousArchiveBytes - archiveBytes),
          });
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            entries.push({ ...entry, outcome: "failed", reason: cleanupFailureReason(error) }),
          ),
        ),
      );
    }
  });

  const cleanFiles = Effect.fn("StorageCleanup.cleanFiles")(function* (
    root: string,
    days: number | null,
    now: number,
    rotatedLogs: boolean,
    removed: { files: number; bytes: number },
  ) {
    if (days === null || !(yield* fs.exists(root))) return removed;
    const realRoot = yield* fs.realPath(root);
    // fork: retention-defaults
    const realParent = yield* fs.realPath(path.dirname(path.resolve(root)));
    // Parent aliases such as macOS /var are valid; the cleanup directory itself must not be a link.
    if (realRoot !== path.join(realParent, path.basename(root))) return removed;
    const visit = Effect.fn("StorageCleanup.visitFiles")(function* (
      directory: string,
    ): Effect.fn.Return<void, PlatformError | ServerSettingsError> {
      for (const name of yield* fs.readDirectory(directory)) {
        const target = path.join(directory, name);
        if ((yield* fs.realPath(target)) !== target || !inside(realRoot, target)) continue;
        const stat = yield* fs.stat(target);
        if (stat.type === "Directory" && rotatedLogs) {
          yield* visit(target);
        } else if (stat.type === "File" && (!rotatedLogs || /\.(?:log|ndjson)\.\d+$/.test(name))) {
          const modified = Option.getOrNull(stat.mtime);
          if (modified !== null && modified.getTime() < now - days * DAY_MS) {
            const current = (yield* settingsService.getSettings).storageCleanup;
            if ((rotatedLogs ? current.logsAfterDays : current.browserArtifactsAfterDays) !== days)
              return;
            yield* fs.remove(target);
            removed.files++;
            removed.bytes += Number(stat.size);
          }
        }
      }
    });
    yield* visit(realRoot);
    return removed;
  });

  // fork: library-launch-files
  const cleanGitMirrors = Effect.fn("StorageCleanup.cleanGitMirrors")(function* (
    cache: LibraryGitFetch.LibraryGitFetch["Service"],
    now: number,
  ) {
    const mirrors = yield* cache.mirrors;
    const environmentId = Option.isSome(environmentIdentity)
      ? yield* environmentIdentity.value.getEnvironmentId
      : null;
    const usedKeys = yield* libraryWorkspaces.receipts.pipe(
      Effect.flatMap((receipts) =>
        Effect.forEach(
          receipts
            .filter(
              ({ copy }) =>
                copy.state !== "released" &&
                (environmentId === null || copy.environmentId === environmentId),
            )
            .flatMap(({ project }) =>
              project.resources.flatMap(({ remoteUrl }) => remoteUrl ?? []),
            ),
          (remoteUrl) => cache.mirrorKey(remoteUrl),
        ),
      ),
      Effect.map((keys) => new Set(keys)),
      Effect.tapError((error) => Effect.logWarning("Library copies could not be read", { error })),
      Effect.orElseSucceed(() => null),
    );
    const unusedSince = now - GIT_MIRROR_UNUSED_DAYS * DAY_MS;
    return yield* Effect.forEach(mirrors, (mirror) => {
      const row = {
        path: mirror.path,
        remoteUrl: mirror.remoteUrl,
        bytes: mirror.bytes,
        lastUsedAt: mirror.lastUsedAt,
      };
      const keep = (reason: string) =>
        Effect.succeed<StorageCleanupGitMirror>({ ...row, outcome: "kept", reason });
      if (usedKeys === null) return keep("Library copies on this computer could not be checked");
      if (usedKeys.has(mirror.key)) return keep("A Library copy on this computer uses it");
      // removeMirror rechecks the use time itself, including an unknown one.
      if (mirror.lastUsedAt !== null && Date.parse(mirror.lastUsedAt) >= unusedSince)
        return keep(`Used in the last ${GIT_MIRROR_UNUSED_DAYS} days`);
      return cache
        .removeMirror({
          key: mirror.key,
          unusedSince: DateTime.formatIso(DateTime.makeUnsafe(unusedSince)),
        })
        .pipe(
          Effect.map((freed): StorageCleanupGitMirror =>
            freed === null
              ? { ...row, outcome: "kept", reason: "Used again during cleanup" }
              : {
                  ...row,
                  bytes: freed,
                  outcome: "removed",
                  reason: `Unused for ${GIT_MIRROR_UNUSED_DAYS} days and no Library copy on this computer uses it`,
                },
          ),
          Effect.catch((error) =>
            Effect.succeed<StorageCleanupGitMirror>({
              ...row,
              outcome: "failed",
              reason: cleanupFailureReason(error),
            }),
          ),
        );
    });
  });

  const reportRef = yield* SubscriptionRef.make<StorageCleanupReport | null>(null);
  const sweep = Effect.fn("StorageCleanup.sweep")(function* (
    trigger: StorageCleanupReport["trigger"],
  ) {
    const now = yield* Clock.currentTimeMillis;
    const serverSettings = yield* settingsService.getSettings;
    const settings = serverSettings.storageCleanup;
    const entries: StorageCleanupReportEntry[] = [];
    yield* cleanWorktrees(serverSettings, now, entries).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          entries.push({
            kind: "worktree",
            outcome: "failed",
            reason: cleanupFailureReason(error),
            path: null,
            projectPath: null,
            threadId: null,
            threadTitle: null,
            bytes: null,
            files: null,
          });
          yield* Effect.logWarning("worktree cleanup failed", { error });
        }),
      ),
    );
    // fork: project-lifecycle
    yield* cleanProjects(settings, now, entries).pipe(
      Effect.catch((error) => Effect.logWarning("Project cleanup failed", { error })),
    );
    // fork: mini-native-retention
    yield* cleanScratch(settings.scratchAfterDays, now, entries).pipe(
      Effect.catch((error) => Effect.logWarning("Scratch cleanup failed", { error })),
    );
    for (const category of [
      {
        kind: "browser-artifacts" as const,
        root: config.browserArtifactsDir,
        days: settings.browserArtifactsAfterDays,
        label: "browser artifacts",
      },
      {
        kind: "logs" as const,
        root: config.logsDir,
        days: settings.logsAfterDays,
        label: "rotated logs",
      },
    ]) {
      if (category.days === null) continue;
      const removed = { files: 0, bytes: 0 };
      yield* cleanFiles(category.root, category.days, now, category.kind === "logs", removed).pipe(
        Effect.map(({ files, bytes }) =>
          entries.push({
            kind: category.kind,
            outcome: files > 0 ? "removed" : "kept",
            reason: files === 0 ? "No expired files" : `Removed ${files} ${category.label}`,
            path: null,
            projectPath: null,
            threadId: null,
            threadTitle: null,
            bytes: files > 0 ? bytes : null,
            files: files > 0 ? files : null,
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            entries.push({
              kind: category.kind,
              outcome: "failed",
              reason: cleanupFailureReason(error),
              path: null,
              projectPath: null,
              threadId: null,
              threadTitle: null,
              bytes: removed.files > 0 ? removed.bytes : null,
              files: removed.files > 0 ? removed.files : null,
            });
            yield* Effect.logWarning("storage file cleanup failed", { kind: category.kind, error });
          }),
        ),
      );
    }
    // fork: library-launch-files
    const gitMirrors = Option.isNone(gitMirrorCache)
      ? undefined
      : yield* cleanGitMirrors(gitMirrorCache.value, now).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Git mirror cleanup failed", { error }).pipe(Effect.as(undefined)),
          ),
        );
    const counts = { removed: 0, kept: 0, failed: 0 };
    let bytesFreed = removedMirrorBytes(gitMirrors); // fork: library-launch-files
    for (const entry of entries) {
      counts[entry.outcome]++;
      if (entry.outcome !== "kept") bytesFreed += entry.bytes ?? 0;
    }
    const priority = (entry: StorageCleanupReportEntry) =>
      entry.outcome === "failed"
        ? 0
        : entry.outcome === "removed"
          ? 1
          : entry.kind === "worktree" && entry.threadId === null
            ? 2
            : 3;
    const latestReport: StorageCleanupReport = {
      trigger,
      startedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
      finishedAt: DateTime.formatIso(yield* DateTime.now),
      entries: entries.sort((a, b) => priority(a) - priority(b)).slice(0, REPORT_ENTRY_LIMIT),
      counts,
      bytesFreed,
      omittedCount: Math.max(0, entries.length - REPORT_ENTRY_LIMIT),
      ...(gitMirrors === undefined ? {} : { gitMirrors }), // fork: library-launch-files
    };
    yield* SubscriptionRef.set(reportRef, latestReport);
    return latestReport;
  });
  const worker = yield* makeStorageCleanupWorker(sweep); // fork: project-checkout-management

  const start = Effect.fn("StorageCleanup.start")(function* () {
    // fork: project-checkout-management
    let lastSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
    const settlementCleanupEnabled = () =>
      hasExplicitProjectSettlementPolicy ||
      lastSettings.storageCleanup.projectOnSettle ||
      anyWorktreePolicy(lastSettings, (rules) => rules.worktreeOnSettle);
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") {
          liveTerminals.clear();
          for (const terminal of event.terminals) noteTerminal(terminal);
        } else if (event.type === "upsert") {
          noteTerminal(event.terminal);
        } else {
          const threadTerminals = liveTerminals.get(event.threadId);
          threadTerminals?.delete(event.terminalId);
          if (threadTerminals?.size === 0) liveTerminals.delete(event.threadId);
        }
      }).pipe(
        // fork: project-lifecycle
        Effect.andThen(
          event.type !== "snapshot" &&
            (event.type !== "upsert" ||
              (event.terminal.status !== "running" && event.terminal.status !== "starting")) &&
            settlementCleanupEnabled()
            ? worker.requestSweep
            : Effect.void,
        ),
      ),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const changes = yield* settingsService.subscribeChanges;
    const events = engine.streamDomainEvents;
    // fork: project-checkout-management -- lastSettings is read at the top of start
    yield* forkParked(
      worker.requestSweep.pipe(
        // fork: project-checkout-management
        Effect.andThen(worker.drain),
        Effect.repeat(Schedule.spaced("1 hour")),
        Effect.asVoid,
      ),
    );
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        if (
          Equal.equals(settings.storageCleanup, lastSettings.storageCleanup) &&
          Equal.equals(settings.worktreeCleanup, lastSettings.worktreeCleanup) &&
          sameProjectWorktreePolicies(settings, lastSettings)
        )
          return Effect.void;
        lastSettings = settings;
        return worker.requestSweep; // fork: project-checkout-management
      }),
    );
    yield* forkParked(
      Stream.runForEach(events, (event) =>
        (event.type === "thread.deleted" ||
          // fork: project-lifecycle
          event.type === "thread.archived" ||
          event.type === "thread.unpinned" ||
          // Worktree settlement requests cleanup after its settle hook finishes.
          (event.type === "thread.settled" && event.payload.worktreePath === null) ||
          (event.type === "provider-session.updated" &&
            (event.payload.status === "stopped" || event.payload.status === "error"))) &&
        (settlementCleanupEnabled() ||
          lastSettings.storageCleanup.projectAfterDays !== null ||
          // fork: project-lifecycle -- the default-on landing rule waits for the startup,
          // settings and hourly sweeps, so ordinary thread events do not each start a sweep.
          anyWorktreePolicy(lastSettings, (rules) =>
            worktreeCleanupEnabled({ ...rules, worktreeOnLand: false }),
          ))
          ? worker.requestSweep
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Storage cleanup event stream failed", { cause }),
        ),
      ),
    );
  });
  // fork: project-lifecycle -- a manual result replaces its path's row in the latest report.
  const publishManualEntry = Effect.fn("StorageCleanup.publishManualEntry")(function* (
    entry: StorageCleanupReportEntry,
    startedAt: string,
  ) {
    const previous = yield* SubscriptionRef.get(reportRef);
    const updated = [entry, ...(previous?.entries ?? []).filter((row) => row.path !== entry.path)];
    const report: StorageCleanupReport = {
      trigger: "manual",
      startedAt,
      finishedAt: DateTime.formatIso(yield* DateTime.now),
      entries: updated,
      counts: {
        removed: updated.filter((row) => row.outcome === "removed").length,
        kept: updated.filter((row) => row.outcome === "kept").length,
        failed: updated.filter((row) => row.outcome === "failed").length,
      },
      omittedCount: previous?.omittedCount ?? 0,
      bytesFreed: updated.reduce(
        (sum, row) => sum + (row.outcome === "removed" ? (row.bytes ?? 0) : 0),
        removedMirrorBytes(previous?.gitMirrors), // fork: library-launch-files
      ),
      // fork: library-launch-files
      ...(previous?.gitMirrors === undefined ? {} : { gitMirrors: previous.gitMirrors }),
    };
    yield* SubscriptionRef.set(reportRef, report);
    return report;
  });
  // fork: project-lifecycle
  const removeOrphan = Effect.fn("StorageCleanup.removeOrphan")(
    function* (target: string) {
      const cwd = path.resolve(target);
      const now = DateTime.formatIso(yield* DateTime.now);
      const entries: StorageCleanupReportEntry[] = [];
      const settings = yield* settingsService.getSettings;
      const roots = yield* Effect.forEach(
        managedWorktreesDirectories(
          settings,
          config.worktreesDir,
          path,
          yield* HostProcess.HomeDirectory,
        ),
        (root) => fs.realPath(root).pipe(Effect.orElseSucceed(() => null)),
      );
      const managed = roots.filter(
        (root): root is string => root !== null && !isFilesystemRoot(root, path),
      );
      let entry: StorageCleanupReportEntry = {
        kind: "worktree",
        outcome: "kept",
        reason: "This worktree is not an orphan eligible for removal",
        path: cwd,
        projectPath: null,
        threadId: null,
        threadTitle: null,
        bytes: null,
        files: null,
      };
      yield* withWorkspaceLease(
        cwd,
        Effect.gen(function* () {
          yield* reportOrphanWorktrees(managed, yield* projectStore.listShells(), entries);
          const reviewed = entries.find((candidate) => candidate.path === cwd);
          if (!reviewed) return;
          entry = reviewed;
          const reason = yield* orphanRemovalReason(cwd, managed);
          if (reason !== null) {
            entry = { ...entry, reason, canRemove: false };
            return;
          }
          yield* cleanupGit(cwd, ["worktree", "remove", "--", cwd], "git worktree remove");
          entry = {
            ...entry,
            outcome: "removed",
            reason: "Removed clean orphan worktree; its branch is preserved",
            canRemove: false,
          };
          yield* pruneEmptyProjectFolder(path.dirname(cwd), managed).pipe(Effect.ignore);
        }),
      ).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            entry = {
              ...entry,
              outcome: "failed",
              reason: "Could not safely remove this worktree. Refresh and try again.",
              canRemove: false,
            };
          }),
        ),
      );
      return yield* publishManualEntry(entry, now);
    },
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.provideService(ServerConfig.ServerConfig, config),
  );
  // fork: project-lifecycle -- the landing rule for one thread's worktree, on the user's request.
  const releaseCheckout = Effect.fn("StorageCleanup.releaseCheckout")(
    function* (threadId: ThreadId) {
      const startedAt = DateTime.formatIso(yield* DateTime.now);
      const thread = yield* projections.getThreadShell(threadId);
      if (thread === null)
        return yield* new ProjectLifecycleError({
          reason: "not-found",
          message: "This thread no longer exists.",
        });
      const noCheckout = new ProjectLifecycleError({
        reason: "not-found",
        message: "This thread has no checkout to release.",
      });
      if (thread.worktreePath === null) return yield* noCheckout;
      const entries: StorageCleanupReportEntry[] = [];
      yield* cleanWorktrees(
        yield* settingsService.getSettings,
        yield* Clock.currentTimeMillis,
        entries,
        threadId,
      );
      const entry = entries.find((row) => row.threadId === threadId);
      if (entry === undefined) return yield* noCheckout;
      yield* publishManualEntry(entry, startedAt);
      return entry;
    },
    Effect.mapError((error) =>
      isProjectLifecycleError(error)
        ? error
        : new ProjectLifecycleError({
            reason: "command-failed",
            message: `Could not release this checkout (${cleanupFailureReason(error)}).`,
          }),
    ),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.provideService(ServerConfig.ServerConfig, config),
  );
  yield* start();
  return StorageCleanup.of({
    // fork: project-lifecycle
    removeOrphan,
    releaseCheckout,
    requestSweep: worker.requestSweep,
    runNow: worker.runNow,
    latestReport: SubscriptionRef.get(reportRef),
    reports: SubscriptionRef.changes(reportRef),
    drain: worker.drain,
  });
});

// fork: library-projects
export const layer = Layer.effect(StorageCleanup, make).pipe(
  Layer.provide(LibraryWorkspaceStore.layer),
);
