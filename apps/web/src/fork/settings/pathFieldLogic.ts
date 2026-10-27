import { getBrowseDirectoryPath } from "@t3tools/client-runtime/state/projects";
import {
  isWindowsAbsolutePath,
  normalizeProjectPathForComparison,
  normalizeProjectPathForDispatch,
} from "@t3tools/shared/path";

export type PathFieldKind = "folder" | "file";

const BROWSABLE_PATH = /^(?:~(?:[\\/]|$)|\/|[A-Za-z]:[\\/]|\\\\)/;

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
