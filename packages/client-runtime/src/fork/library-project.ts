import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_PROJECT_COLORS,
  type LibraryProject,
  type LibraryProjectColor,
  type LibraryResource,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

/** Hosts whose `/owner/repo` URLs are clonable repositories rather than reference pages. */
const REPOSITORY_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"]);
const SSH_REMOTE = /^(?:ssh:\/\/)?git@([^:/\s]+)[:/]([^\s]+?)(?:\.git)?\/?$/u;

type ParsedResource = Omit<LibraryResource, "id">;

const lastSegment = (path: string) => path.split("/").findLast(Boolean) ?? "";

function folderFor(name: string, existing: readonly LibraryResource[]) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^[-.]+|-+$/gu, "") || "repository";
  const taken = new Set(
    existing.filter((entry) => entry.kind !== "link").map((entry) => entry.relativePath),
  );
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  return candidate;
}

function repository(
  name: string,
  remoteUrl: string,
  existing: readonly LibraryResource[],
): ParsedResource {
  return {
    kind: "repository",
    title: name,
    url: null,
    remoteUrl,
    relativePath: folderFor(name, existing),
    defaultBranch: null,
  };
}

/**
 * Turn whatever someone pasted into a project resource. Repository hosting URLs and git
 * remotes become clonable repositories; any other web address becomes a reference link.
 */
export function libraryResourceFromInput(
  input: string,
  existing: readonly LibraryResource[] = [],
): ParsedResource | null {
  const value = input.trim();
  if (!value || /[\s\p{Cc}]/u.test(value)) return null;
  const ssh = SSH_REMOTE.exec(value);
  if (ssh) {
    const name = lastSegment(ssh[2]!);
    return name ? repository(name, value, existing) : null;
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || !url.hostname.includes(".")) return null;
  const host = url.hostname.replace(/^www\./u, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const gitPath = url.pathname.endsWith(".git");
  if ((REPOSITORY_HOSTS.has(host) && segments.length === 2) || gitPath) {
    const name = lastSegment(url.pathname).replace(/\.git$/u, "");
    if (name) {
      const remote = gitPath
        ? url.href
        : `${url.protocol}//${url.host}/${segments[0]}/${segments[1]}`;
      return repository(name, remote, existing);
    }
  }
  return {
    kind: "link",
    title: host,
    url: url.href,
    remoteUrl: null,
    relativePath: "",
    defaultBranch: null,
  };
}

/** A short, recognizable location for a resource: `owner/repo`, a host and path, or a folder. */
export function libraryResourceLocation(resource: LibraryResource) {
  if (resource.kind === "link") {
    try {
      const url = new URL(resource.url ?? "");
      const path = url.pathname.replace(/\/$/u, "");
      return `${url.hostname.replace(/^www\./u, "")}${path}`;
    } catch {
      return resource.url ?? "";
    }
  }
  if (!resource.remoteUrl) return `Local folder ${resource.relativePath}`;
  const ssh = SSH_REMOTE.exec(resource.remoteUrl);
  if (ssh) return ssh[2]!;
  try {
    const url = new URL(resource.remoteUrl);
    const host = url.hostname.replace(/^www\./u, "");
    const path = url.pathname.replace(/^\/|\.git$|\/$/gu, "");
    return REPOSITORY_HOSTS.has(host) ? path : `${host}/${path}`;
  } catch {
    return resource.remoteUrl;
  }
}

/** Copies someone can work in now or is waiting on. Removed copies live in the history. */
export function libraryActiveCopies(copies: readonly LibraryWorkingCopy[]) {
  return copies.filter((copy) => copy.state !== "released" && copy.registered !== false);
}

export type LibraryProjectEvent =
  | { readonly kind: "created"; readonly at: string }
  | {
      readonly kind: "copy-added" | "copy-removed" | "copy-failed";
      readonly at: string;
      readonly copy: LibraryWorkingCopy;
      readonly environmentId: EnvironmentId;
    };

/**
 * The project's history, newest first, derived from the records the Library keeps: when
 * the project began, and when copies arrived on or left each computer.
 */
export function libraryProjectTimeline(
  project: Pick<LibraryProject, "createdAt">,
  copies: readonly LibraryWorkingCopy[],
): readonly LibraryProjectEvent[] {
  const events: LibraryProjectEvent[] = [{ kind: "created", at: project.createdAt }];
  for (const copy of copies) {
    const base = { copy, environmentId: copy.environmentId };
    events.push({ kind: "copy-added", at: copy.createdAt, ...base });
    if (copy.state === "released" || copy.registered === false)
      events.push({ kind: "copy-removed", at: copy.updatedAt, ...base });
    else if (copy.state === "failed")
      events.push({ kind: "copy-failed", at: copy.updatedAt, ...base });
  }
  // Within one instant the outcome reads first, above the arrival that led to it.
  const rank = { "copy-removed": 0, "copy-failed": 0, "copy-added": 1, created: 2 } as const;
  return [...events].sort((a, b) => b.at.localeCompare(a.at) || rank[a.kind] - rank[b.kind]);
}

// Slate stays a deliberate choice: automatic colors should tell projects apart.
const AUTOMATIC_PROJECT_COLORS = LIBRARY_PROJECT_COLORS.filter((color) => color !== "slate");

/** The saved color, or a stable one derived from the id so a project never changes hue unasked. */
export function libraryProjectColor(
  project: Pick<LibraryProject, "id" | "color">,
): LibraryProjectColor {
  if (project.color) return project.color;
  let hash = 0;
  for (const char of project.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AUTOMATIC_PROJECT_COLORS[hash % AUTOMATIC_PROJECT_COLORS.length]!;
}

/** One or two letters that stand in for a project wherever its name is too long to show. */
export function libraryProjectInitials(title: string) {
  const words = title
    .trim()
    .split(/[\s_\-./]+/u)
    .filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0]?.slice(0, 1) ?? "");
  return letters.toLocaleUpperCase() || "?";
}

export type LibraryPathParts = {
  /** The folders above the last one, with a home directory shortened to `~`. Empty at a root. */
  readonly parent: string;
  /** The folder a person recognizes the path by. */
  readonly name: string;
};

const HOME_PREFIX = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)(?=$|[\\/])/u;

/** Splits an absolute path so the folder name leads and the home directory reads as `~`. */
export function libraryPathParts(path: string): LibraryPathParts {
  const trimmed = path.replace(/[\\/]+$/u, "") || path;
  const shortened = trimmed.replace(HOME_PREFIX, "~");
  const separator = Math.max(shortened.lastIndexOf("/"), shortened.lastIndexOf("\\"));
  if (separator < 0) return { parent: "", name: shortened };
  return { parent: shortened.slice(0, separator + 1), name: shortened.slice(separator + 1) };
}
