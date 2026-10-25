import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProfileReadiness,
  LibraryProject,
  LibraryProjectProfile,
  LibraryRepositoryHealth,
  LibraryThreadSummary,
  LibraryToolCheck,
  LibraryWorkingCopy,
  MiniWorkerReadiness,
} from "@t3tools/contracts/fork";

const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** Where a resource sits inside a copy, matching how the server resolves it against the root. */
const resourcePath = (rootPath: string, relativePath: string) =>
  relativePath === "." ? normalizePath(rootPath) : `${normalizePath(rootPath)}/${relativePath}`;

/**
 * Reuse only the chosen host and current resource scope, including explicit copy identity.
 * `resourceIds` lists the selected components, or is null for the whole project. A copy counts
 * only while each selected repository still sits where the project now places it.
 */
export const libraryCopiesForScope = (
  project: LibraryProject,
  copies: readonly LibraryWorkingCopy[],
  environmentId: EnvironmentId | null,
  resourceIds: readonly string[] | null,
): LibraryWorkingCopy[] => {
  const repositories = project.resources.filter((resource) => resource.kind !== "link");
  if (
    project.archived ||
    !environmentId ||
    (resourceIds !== null &&
      (new Set(resourceIds).size !== resourceIds.length ||
        (resourceIds.length === 0 && repositories.length > 0) ||
        resourceIds.some((id) => !repositories.some((resource) => resource.id === id))))
  )
    return [];
  const required = repositories.filter(
    (resource) => resourceIds === null || resourceIds.includes(resource.id),
  );
  return copies.filter(
    (copy) =>
      copy.projectId === project.id &&
      copy.environmentId === environmentId &&
      copy.state === "ready" &&
      copy.registered !== false &&
      (repositories.length > 0 || copy.repositories.length === 0) &&
      required.every((resource) =>
        copy.repositories.some(
          (repository) =>
            repository.resourceId === resource.id &&
            normalizePath(repository.path) === resourcePath(copy.rootPath, resource.relativePath),
        ),
      ),
  );
};

/** A computer that might run the conversation, as the caller sees it right now. */
export interface LibraryLaunchComputer {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** Connected now. Only online computers can be preselected. */
  readonly online: boolean;
  /** Computers that cannot run agents are never candidates. */
  readonly supportsExecution: boolean;
  /** Threads running on this computer now, across every project. */
  readonly workingThreads: number;
}

/** A ready copy that covers the requested scope, for example from `libraryCopiesForScope`. */
export interface LibraryLaunchCopy {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  /** Health the Library published for this copy, if any. Live health wins over it. */
  readonly health?: LibraryCopyHealth | undefined;
}

/** A conversation of this project, enough to know where it was last used. */
export interface LibraryLaunchThread {
  readonly environmentId: EnvironmentId;
  readonly workingCopyId: string | null;
  readonly updatedAt: string;
}

/** A Mini worker registered on a computer, with what its last check reported. */
export interface LibraryLaunchMiniWorker {
  /** The computer the worker is registered on. Its conversations send long jobs there. */
  readonly environmentId: EnvironmentId;
  readonly readiness: MiniWorkerReadiness;
}

/**
 * Whether a computer has the project's required tools. `unknown` covers a computer that was
 * not checked, is offline or cannot check, so it ranks as if the project required nothing.
 */
export type LibraryLaunchReadiness = "ready" | "not-ready" | "unknown";

/**
 * How current a copy is. `up-to-date` is not behind, `unknown` has no health yet, `stale` is
 * behind, and `broken` has a missing or non-Git folder. Uncommitted files never change it: a copy
 * someone works in nearly always has some, so they are only reported as `changed`.
 */
export type LibraryLaunchFreshness = "up-to-date" | "unknown" | "stale" | "broken";

interface LibraryLaunchCandidateBase {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly online: boolean;
  /** Most recent use of this project on this computer. */
  readonly lastUsedAt: string | null;
  readonly workingThreads: number;
  readonly readiness: LibraryLaunchReadiness;
  /** Required tools that fail on this computer, for example ["Xcode missing"]. Also in `reasons`. */
  readonly toolProblems: readonly string[];
  /** Short, plain reasons in display order, for example ["online", "up to date"]. */
  readonly reasons: readonly string[];
}

export type LibraryLaunchCandidate =
  | (LibraryLaunchCandidateBase & {
      readonly kind: "copy";
      readonly copyId: string;
      readonly freshness: LibraryLaunchFreshness;
      /** Repositories in scope behind their upstream, summed. */
      readonly behind: number;
      /** Uncommitted files in scope, summed. */
      readonly changed: number;
      /** The health this candidate was ranked with, live or published. */
      readonly health: LibraryCopyHealth | null;
    })
  | (LibraryLaunchCandidateBase & { readonly kind: "get-copy" })
  /**
   * A Mini worker for long jobs, reached through the computer it is registered on. It is listed
   * after every computer and never preselected: a conversation still starts on a computer.
   */
  | (LibraryLaunchCandidateBase & {
      readonly kind: "mini";
      readonly workerId: string;
      /** Job slots free now. */
      readonly freeSlots: number;
    });

export interface LibraryLaunchRanking {
  /** Best first. Offline computers stay listed, after every online one, and Mini workers last. */
  readonly candidates: readonly LibraryLaunchCandidate[];
  /** The top candidate when it may be chosen for the user, otherwise null. */
  readonly preselected: LibraryLaunchCandidate | null;
}

const FRESHNESS_ORDER: Record<LibraryLaunchFreshness, number> = {
  "up-to-date": 0,
  unknown: 1,
  stale: 2,
  broken: 3,
};

const timestamp = (value: string | null) => {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const later = (left: string | null, right: string) =>
  timestamp(right) > timestamp(left) ? right : (left ?? right);

/** Health for the repositories in scope; `resourceIds` null means the whole copy. */
function scopedRepositories(
  health: LibraryCopyHealth,
  resourceIds: readonly string[] | null,
): readonly LibraryRepositoryHealth[] {
  return resourceIds === null
    ? health.repositories
    : health.repositories.filter((repository) => resourceIds.includes(repository.resourceId));
}

/** Freshness and counts of a copy's in-scope repositories. Missing health reads as unknown. */
export function libraryLaunchFreshness(
  health: LibraryCopyHealth | null,
  resourceIds: readonly string[] | null,
): {
  readonly freshness: LibraryLaunchFreshness;
  readonly behind: number;
  readonly changed: number;
} {
  if (health === null) return { freshness: "unknown", behind: 0, changed: 0 };
  const repositories = scopedRepositories(health, resourceIds);
  let behind = 0;
  let changed = 0;
  let broken = false;
  let unreadable = false;
  for (const repository of repositories) {
    if (repository.error === "missing" || repository.error === "not-a-repository") broken = true;
    else if (repository.error !== undefined) unreadable = true;
    else {
      behind += repository.behind ?? 0;
      changed += repository.uncommittedFiles;
    }
  }
  const freshness: LibraryLaunchFreshness = broken
    ? "broken"
    : behind > 0
      ? "stale"
      : unreadable || repositories.length === 0
        ? "unknown"
        : "up-to-date";
  return { freshness, behind, changed };
}

/** "Xcode missing" or "Go 1.21 (needs 1.24)". */
const toolProblemReason = (check: LibraryToolCheck) =>
  check.status === "outdated"
    ? `${check.label} ${check.version ?? "too old"} (needs ${check.minimumVersion ?? "newer"})`
    : `${check.label} missing`;

/**
 * Whether a computer's checks pass, with the checks that fail. Only a missing or outdated tool
 * fails; a check that could not run stays out of it, as does a computer with no checks at all.
 */
export function libraryLaunchReadiness(readiness: LibraryProfileReadiness | null): {
  readonly readiness: LibraryLaunchReadiness;
  readonly problems: readonly LibraryToolCheck[];
} {
  if (readiness === null) return { readiness: "unknown", problems: [] };
  const problems = readiness.checks.filter(
    (check) => check.status === "missing" || check.status === "outdated",
  );
  if (problems.length > 0) return { readiness: "not-ready", problems };
  return {
    readiness: readiness.checks.some((check) => check.status === "ok") ? "ready" : "unknown",
    problems,
  };
}

/**
 * Whether a Mini worker may take this project's long jobs: the profile allows Mini, the worker
 * reports ready, and it reports none of the profile's required tools as missing. A worker only
 * reports the tools its toolsets know, so a tool it never mentions is not checked here.
 */
export function libraryLaunchMiniEligible(
  profile: Pick<LibraryProjectProfile, "allowMini" | "requiredTools"> | null | undefined,
  readiness: MiniWorkerReadiness,
): boolean {
  if (profile?.allowMini !== true || readiness.status !== "ready") return false;
  return !(profile.requiredTools ?? []).some((tool) => readiness.missingTools.includes(tool.id));
}

function freshnessReason(freshness: LibraryLaunchFreshness, behind: number, changed: number) {
  switch (freshness) {
    case "up-to-date":
      return changed > 0 ? `${changed} changed` : "up to date";
    case "unknown":
      return "not checked";
    case "broken":
      return "folder missing";
    case "stale":
      return [behind > 0 ? `${behind} behind` : null, changed > 0 ? `${changed} changed` : null]
        .filter((part) => part !== null)
        .join(", ");
  }
}

/**
 * Order every computer that could start this project's conversation, best first:
 * online before offline, a copy covering the scope before getting one, up to date before
 * unchecked before behind, the computer used most recently for this project, then the one with
 * the fewest working threads. A computer whose checks show a required tool missing or too old
 * ranks after every online computer that passes or was not checked. Remaining ties fall to label,
 * computer and copy id, so the order never depends on input order. Live health wins over health
 * the Library published. Mini workers the profile allows come last and are never preselected.
 */
export function rankLibraryLaunchCandidates(input: {
  readonly computers: readonly LibraryLaunchComputer[];
  readonly copies: readonly LibraryLaunchCopy[];
  readonly threads: readonly LibraryLaunchThread[];
  /** The selected components, or null for the whole project. */
  readonly resourceIds: readonly string[] | null;
  /** Health read now on each copy's computer, keyed by copy id. */
  readonly liveHealth?: ReadonlyMap<string, LibraryCopyHealth> | undefined;
  /** Required-tool checks read on each computer, keyed by computer. Absent means not known. */
  readonly readiness?: ReadonlyMap<EnvironmentId, LibraryProfileReadiness> | undefined;
  /** The project's setup: which tools it requires and whether Mini may run its jobs. */
  readonly profile?: Pick<LibraryProjectProfile, "allowMini" | "requiredTools"> | undefined;
  /** Mini workers on the listed computers, offered only when the profile allows Mini. */
  readonly miniWorkers?: readonly LibraryLaunchMiniWorker[] | undefined;
}): LibraryLaunchRanking {
  const computerLastUsed = new Map<EnvironmentId, string>();
  const copyLastUsed = new Map<string, string>();
  for (const thread of input.threads) {
    computerLastUsed.set(
      thread.environmentId,
      later(computerLastUsed.get(thread.environmentId) ?? null, thread.updatedAt),
    );
    if (thread.workingCopyId !== null)
      copyLastUsed.set(
        thread.workingCopyId,
        later(copyLastUsed.get(thread.workingCopyId) ?? null, thread.updatedAt),
      );
  }
  const mostRecentUse = [...computerLastUsed.values()].reduce<string | null>(later, null);

  const candidates: LibraryLaunchCandidate[] = [];
  for (const computer of input.computers) {
    if (!computer.supportsExecution) continue;
    const lastUsedAt = computerLastUsed.get(computer.environmentId) ?? null;
    const checked = input.readiness?.get(computer.environmentId);
    const { readiness, problems } = libraryLaunchReadiness(
      checked?.environmentId === computer.environmentId ? checked : null,
    );
    const toolProblems = problems.map(toolProblemReason);
    const base = {
      environmentId: computer.environmentId,
      label: computer.label,
      online: computer.online,
      lastUsedAt,
      workingThreads: computer.workingThreads,
      readiness,
      toolProblems,
    };
    const context = [
      ...toolProblems,
      ...(lastUsedAt !== null && lastUsedAt === mostRecentUse ? ["used last"] : []),
      ...(computer.online && computer.workingThreads > 0
        ? [`${computer.workingThreads} working`]
        : []),
    ];
    const copies = input.copies.filter((copy) => copy.environmentId === computer.environmentId);
    if (copies.length === 0) {
      candidates.push({
        ...base,
        kind: "get-copy",
        reasons: [computer.online ? "online" : "offline", "no copy yet", ...context],
      });
      continue;
    }
    for (const copy of copies) {
      const live = input.liveHealth?.get(copy.id);
      const published = copy.health?.copyId === copy.id ? copy.health : undefined;
      const health = live?.copyId === copy.id ? live : (published ?? null);
      const { freshness, behind, changed } = libraryLaunchFreshness(health, input.resourceIds);
      candidates.push({
        ...base,
        kind: "copy",
        copyId: copy.id,
        freshness,
        behind,
        changed,
        health,
        reasons: [
          computer.online ? "online" : "offline",
          freshnessReason(freshness, behind, changed),
          ...context,
        ],
      });
    }
  }

  const kindOrder = (candidate: LibraryLaunchCandidate) =>
    candidate.kind === "copy" ? 0 : candidate.kind === "get-copy" ? 1 : 2;
  const readinessOrder = (candidate: LibraryLaunchCandidate) =>
    candidate.readiness === "not-ready" ? 1 : 0;
  const freshnessOrder = (candidate: LibraryLaunchCandidate) =>
    candidate.kind === "copy" ? FRESHNESS_ORDER[candidate.freshness] : 0;
  const copyId = (candidate: LibraryLaunchCandidate) =>
    candidate.kind === "copy" ? candidate.copyId : "";
  candidates.sort(
    (left, right) =>
      Number(right.online) - Number(left.online) ||
      readinessOrder(left) - readinessOrder(right) ||
      kindOrder(left) - kindOrder(right) ||
      freshnessOrder(left) - freshnessOrder(right) ||
      timestamp(right.lastUsedAt) - timestamp(left.lastUsedAt) ||
      left.workingThreads - right.workingThreads ||
      timestamp(copyLastUsed.get(copyId(right)) ?? null) -
        timestamp(copyLastUsed.get(copyId(left)) ?? null) ||
      left.label.localeCompare(right.label) ||
      left.environmentId.localeCompare(right.environmentId) ||
      copyId(left).localeCompare(copyId(right)),
  );
  // Offline computers, broken copies and computers missing a required tool stay listed honestly
  // but are never chosen for the user.
  const preselected =
    candidates.find(
      (candidate) =>
        candidate.online &&
        candidate.readiness !== "not-ready" &&
        !(candidate.kind === "copy" && candidate.freshness === "broken"),
    ) ?? null;
  return { candidates: [...candidates, ...miniCandidates(input)], preselected };
}

/**
 * Rank a Library project's computers for a scope, counting only copies that cover it and only
 * this project's conversations. The project's profile decides required tools and Mini.
 */
export function rankLibraryProjectLaunch(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly computers: readonly LibraryLaunchComputer[];
  readonly threads: readonly LibraryThreadSummary[];
  /** The selected components, or null for the whole project. */
  readonly resourceIds: readonly string[] | null;
  readonly liveHealth?: ReadonlyMap<string, LibraryCopyHealth> | undefined;
  readonly readiness?: ReadonlyMap<EnvironmentId, LibraryProfileReadiness> | undefined;
  readonly miniWorkers?: readonly LibraryLaunchMiniWorker[] | undefined;
}): LibraryLaunchRanking {
  return rankLibraryLaunchCandidates({
    computers: input.computers,
    copies: input.computers.flatMap((computer) =>
      libraryCopiesForScope(input.project, input.copies, computer.environmentId, input.resourceIds),
    ),
    threads: input.threads.filter(
      (thread) => thread.projectId === input.project.id && thread.deleted !== true,
    ),
    resourceIds: input.resourceIds,
    liveHealth: input.liveHealth,
    readiness: input.readiness,
    profile: input.project.profile,
    miniWorkers: input.miniWorkers,
  });
}

/** Allowed, ready Mini workers on online computers that can run work, by label. */
function miniCandidates(input: {
  readonly computers: readonly LibraryLaunchComputer[];
  readonly profile?: Pick<LibraryProjectProfile, "allowMini" | "requiredTools"> | undefined;
  readonly miniWorkers?: readonly LibraryLaunchMiniWorker[] | undefined;
}): LibraryLaunchCandidate[] {
  const candidates: LibraryLaunchCandidate[] = [];
  for (const worker of input.miniWorkers ?? []) {
    const host = input.computers.find(
      (computer) => computer.environmentId === worker.environmentId,
    );
    if (!host?.online || !host.supportsExecution) continue;
    if (!libraryLaunchMiniEligible(input.profile, worker.readiness)) continue;
    const freeSlots = Math.max(0, worker.readiness.slots - worker.readiness.active);
    candidates.push({
      kind: "mini",
      workerId: worker.readiness.workerId,
      freeSlots,
      environmentId: host.environmentId,
      label: worker.readiness.name,
      online: true,
      lastUsedAt: null,
      workingThreads: worker.readiness.active,
      readiness: "ready",
      toolProblems: [],
      reasons: [
        "for long jobs",
        `from ${host.label}`,
        `${freeSlots} ${freeSlots === 1 ? "slot" : "slots"} free`,
      ],
    });
  }
  return candidates.sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      left.environmentId.localeCompare(right.environmentId) ||
      (left.kind === "mini" && right.kind === "mini"
        ? left.workerId.localeCompare(right.workerId)
        : 0),
  );
}

/** "Mac Mini · online, up to date". */
export function libraryLaunchCandidateSummary(candidate: LibraryLaunchCandidate): string {
  return `${candidate.label} · ${candidate.reasons.join(", ")}`;
}
