import {
  appendBrowsePathSegment,
  getBrowseParentPath,
  isFilesystemBrowseQuery,
  isWindowsPlatform,
} from "@t3tools/client-runtime/state/projects";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@t3tools/shared/path";

/** The first candidate that names a folder on the computer, or null. A relative path has no base. */
export function folderPickerStart(
  candidates: ReadonlyArray<string | null | undefined>,
  platform: string,
): string | null {
  for (const candidate of candidates) {
    const path = candidate?.trim() ?? "";
    if (isFilesystemBrowseQuery(path, platform) && !isExplicitRelativePath(path)) return path;
  }
  return null;
}

/**
 * Splits text typed into the filter of `folder` into the folder to browse and the filter left over.
 * A full path moves to its folder; a relative one such as `src/` or `../` moves from `folder`.
 */
export function typedFolderFilter(
  folder: string,
  text: string,
  platform: string,
): { readonly folder: string; readonly filter: string } {
  const windows = isWindowsPlatform(platform);
  const end = windows
    ? Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"))
    : text.lastIndexOf("/");
  if (end < 0) return { folder, filter: text };
  const head = text.slice(0, end + 1);
  const filter = text.slice(end + 1);
  if (head.startsWith("/") || head.startsWith("~/") || (windows && isWindowsAbsolutePath(head))) {
    return { folder: head, filter };
  }
  let next = folder;
  for (const segment of head.split(windows ? /[\\/]/ : "/")) {
    if (segment === "" || segment === ".") continue;
    next =
      segment === ".."
        ? (getBrowseParentPath(next) ?? next)
        : appendBrowsePathSegment(next, segment);
  }
  return { folder: next, filter };
}

/** Folders whose names start with `filter`, ignoring case, with hidden ones after the rest. */
export function hiddenFoldersLast<T extends { readonly name: string }>(
  entries: ReadonlyArray<T>,
  filter: string,
): T[] {
  const prefix = filter.toLowerCase();
  const matches = entries.filter((entry) => entry.name.toLowerCase().startsWith(prefix));
  return [
    ...matches.filter((entry) => !entry.name.startsWith(".")),
    ...matches.filter((entry) => entry.name.startsWith(".")),
  ];
}
