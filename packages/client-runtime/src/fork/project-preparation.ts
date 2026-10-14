import type {
  EnvironmentId,
  ProjectCloneSnapshot,
  ProjectCloneStartInput,
  ProjectId,
  RepositoryIdentity,
} from "@t3tools/contracts";
import type { ProjectCheckoutPreview, WorkspaceHandoffOffer } from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";
import { getCloneDestinationPath, getCloneDirectoryName } from "../operations/projects.ts";

export interface ProjectPreparationProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly workspaceRoot: string;
  readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
}
export interface ProjectPreparationHost {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly canClone: boolean;
  readonly newProjectsRoot: string | null | undefined;
}
export type ProjectPreparationSource =
  | {
      readonly ready: true;
      readonly source: "handoff" | "checkout";
      readonly remoteUrl: string;
      readonly repositoryKey: string;
    }
  | { readonly ready: false; readonly reason: string };

const repositoryKey = (remote: string) => canonicalRepositoryKey(normalizeGitRemoteUrl(remote));
const unsafeCharacters = /[\s\p{Cc}\p{Cf}]/u;

/** Normalize numeric host spellings even for SSH, without resolving DNS or contacting the host. */
function machineLocalHostname(hostname: string): boolean {
  let host: string;
  try {
    host = new URL(`http://${hostname}/`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return true;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === "[::]" ||
    host === "[::1]" ||
    host === "[::ffff:0:0]" ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]+\]$/.test(host)
  );
}

/** Network remotes reuse the chosen host's saved credentials. Local paths never cross machines. */
function networkRemote(remote: string): string | null {
  if (remote.trim() !== remote || remote.length === 0 || unsafeCharacters.test(remote)) return null;
  if (remote.includes("://")) {
    try {
      const url = new URL(remote);
      if (
        !["http:", "https:", "ssh:", "git:"].includes(url.protocol) ||
        !url.hostname ||
        machineLocalHostname(url.hostname) ||
        url.pathname === "/" ||
        url.pathname === ""
      )
        return null;
      if (url.password || url.search || url.hash || (url.protocol !== "ssh:" && url.username))
        return null;
      return remote;
    } catch {
      return null;
    }
  }
  // Git's SCP syntax has a public SSH username; it contains no reusable source credential.
  const scp = /^[^@:/\\]+@([^@:/\\]+):[^?#\\]+$/.exec(remote);
  return scp && !machineLocalHostname(scp[1]!) ? remote : null;
}

/** Only an actual checkout review or published handoff offer establishes the source remote. */
export function projectPreparationSource(input: {
  readonly offer?: Pick<WorkspaceHandoffOffer, "remoteUrl" | "repositoryKey"> | null;
  readonly checkout?: Pick<ProjectCheckoutPreview, "repositoryIdentity" | "state"> | null;
}): ProjectPreparationSource {
  if (!input.offer && input.checkout?.state === "blocked")
    return {
      ready: false,
      reason: "Resolve this checkout's storage review before preparing another copy.",
    };
  const origin = input.checkout?.repositoryIdentity;
  const remote =
    input.offer?.remoteUrl ??
    (origin?.locator.remoteName === "origin" ? origin.locator.remoteUrl : null);
  if (remote === null || remote === undefined)
    return {
      ready: false,
      reason: "Review this project's origin on its current computer before preparing another copy.",
    };
  const safe = networkRemote(remote);
  if (safe === null)
    return {
      ready: false,
      reason:
        "Use a network Git remote without embedded credentials or query tokens. Local-only addresses and repository paths cannot be prepared on another computer.",
    };
  const key = repositoryKey(safe);
  if (input.offer && repositoryKey(input.offer.repositoryKey) !== key)
    return {
      ready: false,
      reason: "The published offer and repository remote no longer match. Review the source again.",
    };
  if (!input.offer && origin?.origin && repositoryKey(origin.origin.canonicalKey) !== key)
    return {
      ready: false,
      reason:
        "This review names an upstream repository. Review the checkout's actual origin before preparing its fork.",
    };
  return {
    ready: true,
    source: input.offer ? "handoff" : "checkout",
    remoteUrl: safe,
    repositoryKey: key,
  };
}

const pathKey = (path: string) => {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
};
const absoluteFolder = (value: string): boolean => {
  if (value.length === 0 || value.trim() !== value || /[\p{Cc}\p{Cf}]/u.test(value)) return false;
  if (!(value.startsWith("/") || /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\")))
    return false;
  const segments = value.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  if (/^[a-z]:[\\/]?$/i.test(value) || value === "/" || /^[/\\]{2}[^/\\]+[/\\]?$/i.test(value))
    return false;
  return true;
};

/** The proposal is editable. Never silently suffix a collision into another checkout. */
export function getProjectPreparationDestination(input: {
  readonly newProjectsRoot: string | null | undefined;
  readonly remoteUrl: string;
}): string | null {
  if (!input.newProjectsRoot || !absoluteFolder(input.newProjectsRoot)) return null;
  const name = getCloneDirectoryName(input.remoteUrl);
  if (!name || name === "." || name === "..") return null;
  return getCloneDestinationPath(input.newProjectsRoot, name);
}

const projectRepositoryKey = (project: ProjectPreparationProject) => {
  const identity = project.repositoryIdentity;
  return identity ? repositoryKey(identity.origin?.canonicalKey ?? identity.canonicalKey) : null;
};
/** Show each matching physical copy without substituting upstream grouping for actual origin. */
export function matchingProjectPreparationCopies<
  TProject extends ProjectPreparationProject,
>(input: {
  readonly source: ProjectPreparationSource;
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<TProject>;
}): TProject[] {
  if (!input.source.ready) return [];
  const sourceKey = repositoryKey(input.source.repositoryKey);
  return input.projects.filter(
    (project) =>
      project.environmentId === input.environmentId && projectRepositoryKey(project) === sourceKey,
  );
}

export type ProjectPreparationPlan =
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "existing"; readonly project: ProjectPreparationProject }
  | {
      readonly kind: "create";
      readonly environmentId: EnvironmentId;
      readonly input: ProjectCloneStartInput;
    };

/** One explicit computer choice and one stable project ID, passed to the existing clone command. */
export function buildProjectPreparationPlan(input: {
  readonly source: ProjectPreparationSource;
  readonly host: ProjectPreparationHost;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly createdAt: string;
  readonly destinationPath?: string | null;
  readonly projects: ReadonlyArray<ProjectPreparationProject>;
  readonly clones?: ReadonlyArray<ProjectCloneSnapshot>;
}): ProjectPreparationPlan {
  if (!input.source.ready) return { kind: "blocked", reason: input.source.reason };
  if (
    networkRemote(input.source.remoteUrl) === null ||
    repositoryKey(input.source.remoteUrl) !== repositoryKey(input.source.repositoryKey)
  )
    return {
      kind: "blocked",
      reason: "Review the source remote again before preparing this project.",
    };
  if (!input.host.connected)
    return {
      kind: "blocked",
      reason: "Connect the selected computer before preparing this project.",
    };
  if (!input.host.canClone)
    return {
      kind: "blocked",
      reason: "Source control write permission is required on the selected computer.",
    };
  const projects = input.projects.filter(
    (project) => project.environmentId === input.host.environmentId,
  );
  const matching = matchingProjectPreparationCopies({
    source: input.source,
    environmentId: input.host.environmentId,
    projects,
  });
  if (matching.length === 1) return { kind: "existing", project: matching[0]! };
  if (matching.length > 1)
    return {
      kind: "blocked",
      reason: "This computer has several matching checkouts. Choose the existing copy to use.",
    };
  const path =
    input.destinationPath ??
    getProjectPreparationDestination({
      newProjectsRoot: input.host.newProjectsRoot,
      remoteUrl: input.source.remoteUrl,
    });
  if (!path || !absoluteFolder(path))
    return {
      kind: "blocked",
      reason: "Choose an absolute destination folder on the selected computer.",
    };
  if (projects.some((project) => project.id === input.projectId))
    return {
      kind: "blocked",
      reason:
        "This preparation already created a project record. Inspect its folder and progress before retrying.",
    };
  if (projects.some((project) => pathKey(project.workspaceRoot) === pathKey(path)))
    return {
      kind: "blocked",
      reason: "Another project already uses this destination. Choose a different folder.",
    };
  if (
    input.clones?.some(
      (clone) =>
        clone.projectId === input.projectId || pathKey(clone.destinationPath) === pathKey(path),
    )
  )
    return {
      kind: "blocked",
      reason:
        "A clone already owns this destination or request. Open its progress instead of starting it again.",
    };
  if (
    input.title.trim().length === 0 ||
    /[\p{Cc}\p{Cf}]/u.test(input.title) ||
    !Number.isFinite(Date.parse(input.createdAt))
  )
    return {
      kind: "blocked",
      reason: "Review the project name and preparation details before starting.",
    };
  return {
    kind: "create",
    environmentId: input.host.environmentId,
    input: {
      projectId: input.projectId,
      title: input.title.trim(),
      createdAt: input.createdAt,
      remoteUrl: input.source.remoteUrl,
      destinationPath: path,
    },
  };
}

export type ProjectPreparationRecovery = {
  readonly state: "idle" | "running" | "ready" | "retry" | "cancelled" | "inspect";
  readonly message: string;
  readonly canRetryTrackedClone: boolean;
};

/** A lost response or host restart is evidence to inspect, never permission to erase or clone again. */
export function getProjectPreparationRecovery(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly repositoryKey: string;
  readonly expectedDestinationPath?: string;
  readonly projects: ReadonlyArray<ProjectPreparationProject>;
  readonly clones: ReadonlyArray<ProjectCloneSnapshot>;
}): ProjectPreparationRecovery {
  const clone = input.clones.find((snapshot) => snapshot.projectId === input.projectId);
  const project = input.projects.find(
    (record) => record.environmentId === input.environmentId && record.id === input.projectId,
  );
  const expectedRepositoryKey = repositoryKey(input.repositoryKey);
  const knownRepositoryKey = project ? projectRepositoryKey(project) : null;
  if (knownRepositoryKey !== null && knownRepositoryKey !== expectedRepositoryKey)
    return {
      state: "inspect",
      message:
        "The saved project's actual origin changed. Inspect its folder before continuing or retrying this clone.",
      canRetryTrackedClone: false,
    };
  if (
    input.expectedDestinationPath !== undefined &&
    ((clone && pathKey(clone.destinationPath) !== pathKey(input.expectedDestinationPath)) ||
      (project && pathKey(project.workspaceRoot) !== pathKey(input.expectedDestinationPath)))
  )
    return {
      state: "inspect",
      message:
        "The project or clone folder no longer matches the saved destination. Inspect it before continuing or retrying this request.",
      canRetryTrackedClone: false,
    };
  if (clone && repositoryKey(clone.remoteUrl) !== expectedRepositoryKey)
    return {
      state: "inspect",
      message:
        "This request's clone names another repository. Inspect it before continuing; do not reuse its completed state for this project.",
      canRetryTrackedClone: false,
    };
  if (clone?.phase === "running")
    return {
      state: "running",
      message:
        "Preparing this project on the selected computer. Its project record is already saved.",
      canRetryTrackedClone: false,
    };
  if (clone?.phase === "done")
    return {
      state: "ready",
      message:
        "The checkout is ready. Move work separately to review provider and workspace setup.",
      canRetryTrackedClone: false,
    };
  if (clone?.phase === "failed" || clone?.phase === "cancelled")
    return {
      state: clone.phase === "failed" ? "retry" : "cancelled",
      message:
        "The tracked clone stopped. Review its error and use the existing clone Retry control; other local files are not removed automatically.",
      canRetryTrackedClone: true,
    };
  if (project)
    return knownRepositoryKey === expectedRepositoryKey
      ? {
          state: "ready",
          message:
            "The saved project matches this repository. Open it or review Move work to check readiness.",
          canRetryTrackedClone: false,
        }
      : {
          state: "inspect",
          message:
            "The project record was saved but clone progress is unavailable. Inspect its folder before retrying; do not remove partial or existing files automatically.",
          canRetryTrackedClone: false,
        };
  return {
    state: "idle",
    message:
      "No saved project or clone is visible. Refresh this computer before retrying an interrupted request.",
    canRetryTrackedClone: false,
  };
}
