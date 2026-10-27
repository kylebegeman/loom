import {
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
} from "@t3tools/client-runtime/state/projects";
import type { FilesystemBrowseEntry, FilesystemBrowseResult } from "@t3tools/contracts";
import {
  isWindowsAbsolutePath,
  normalizeProjectPathForComparison,
  normalizeProjectPathForDispatch,
} from "@t3tools/shared/path";

export type PathFieldKind = "folder" | "file";

const BROWSABLE_PATH = /^(?:~(?:[\\/]|$)|\/|[A-Za-z]:[\\/]|\\\\)/;

/**
 * The entries a folder palette lists for `filter`. Dot entries follow the others and, without
 * `showHidden`, appear only once the filter starts with ".".
 */
export function pathPickerEntries(
  entries: readonly FilesystemBrowseEntry[],
  {
    filter,
    files,
    showHidden,
  }: { readonly filter: string; readonly files: boolean; readonly showHidden: boolean },
) {
  const term = filter.toLocaleLowerCase();
  return entries
    .filter(
      (entry) =>
        (files || entry.kind !== "file") &&
        (showHidden || !entry.name.startsWith(".") || filter.startsWith(".")) &&
        entry.name.toLocaleLowerCase().includes(term),
    )
    .toSorted(
      (left, right) => Number(left.name.startsWith(".")) - Number(right.name.startsWith(".")),
    );
}

/** A browse that reached the computer but could not read the folder, unlike an offline one. */
export function isFolderReadFailure(failure: unknown) {
  return (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    failure._tag === "FilesystemBrowseError" &&
    "failure" in failure &&
    failure.failure === "read_directory_failed"
  );
}

function folderName(value: string) {
  const name = value.trim();
  return name === "" || name === "." || name === ".." ? null : name;
}

function browsedFolder(browsePath: string) {
  if (getBrowseParentPath(browsePath) === null) return null;
  const path = normalizeProjectPathForDispatch(browsePath);
  const name = folderName(getBrowseLeafPathSegment(path));
  return name === null ? null : { path, name };
}

/**
 * The browse that shows whether the browsed folder exists: its parent, narrowed to its name. Null
 * for a root, where there is nothing to ask.
 */
export function pathPickerParentProbe(browsePath: string) {
  return browsedFolder(browsePath)?.path ?? null;
}

// Names that differ only in case count as taken: most Macs and Windows PCs treat them as one.
function listsName(listing: FilesystemBrowseResult, name: string) {
  const lower = name.toLowerCase();
  return listing.entries.some((entry) => entry.name.toLowerCase() === lower);
}

function childPath(parent: string, name: string) {
  if (hasTrailingPathSeparator(parent)) return `${parent}${name}`;
  return `${parent}${isWindowsAbsolutePath(parent) ? "\\" : "/"}${name}`;
}

/**
 * The folder a typed path names when a listing proves nothing is there yet, or null. `browsed`
 * lists the folder the path is typed into, files included. When that folder could not be read,
 * `parent` is the `pathPickerParentProbe` listing, which shows whether the folder itself is missing.
 */
export function pathPickerNewFolder({
  browsePath,
  filter,
  browsed,
  parent,
}: {
  readonly browsePath: string;
  readonly filter: string;
  readonly browsed: FilesystemBrowseResult | null;
  readonly parent: FilesystemBrowseResult | null;
}) {
  const name = filter === "" ? "" : folderName(filter);
  if (name === null) return null;
  if (browsed !== null) {
    return name === "" || listsName(browsed, name) ? null : childPath(browsed.parentPath, name);
  }
  const folder = browsedFolder(browsePath);
  if (parent === null || folder === null || listsName(parent, folder.name)) return null;
  const missing = childPath(parent.parentPath, folder.name);
  return name === "" ? missing : childPath(missing, name);
}

/** The path of a file chosen under `root`, with `/` separators, or null when it is outside. */
export function pathWithinRoot(root: string, path: string): string | null {
  const base = normalizeProjectPathForComparison(root);
  const target = normalizeProjectPathForComparison(path);
  const windows = isWindowsAbsolutePath(base);
  const prefix = /[\\/]$/.test(base) ? base : `${base}${windows ? "\\" : "/"}`;
  if (!target.startsWith(prefix)) return null;
  const segments = normalizeProjectPathForDispatch(path)
    .slice(prefix.length)
    .split(windows ? /[\\/]+/ : /\/+/)
    .filter(Boolean);
  return segments.length === 0 || segments.includes("..") ? null : segments.join("/");
}

/** Where the browser opens: the chosen folder, a chosen file's folder, or `fallback`. */
export function pathFieldBrowseStart({
  value,
  kind,
  root,
  fallback,
}: {
  readonly value: string;
  readonly kind: PathFieldKind;
  readonly root?: string | undefined;
  readonly fallback: string;
}): string {
  const trimmed = value.trim();
  const separator = root !== undefined && isWindowsAbsolutePath(root) ? "\\" : "/";
  const absolute =
    root !== undefined && trimmed !== ""
      ? `${normalizeProjectPathForDispatch(root).replace(/[\\/]$/, "")}${separator}${trimmed.replaceAll("/", separator)}`
      : trimmed;
  if (!BROWSABLE_PATH.test(absolute)) return root ?? fallback;
  return kind === "file" ? getBrowseDirectoryPath(absolute) : absolute;
}
