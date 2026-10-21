import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { newProjectFolderName } from "@t3tools/shared/path";
import { libraryCopiesForScope } from "@t3tools/shared/fork/library-launch";
import { Input } from "~/components/ui/input";
import { LibraryField } from "./LibraryControls";
import { ProfileReadiness } from "./ProfileReadiness";

type LaunchFilesInput = {
  readonly project: LibraryProject;
  readonly environmentId: EnvironmentId | null;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly resourceId?: string | null;
  readonly resourceIds?: readonly string[] | null;
  readonly copyId?: string | null;
  readonly allowReopen?: boolean;
};

/** Whole-project launches must not quietly keep repositories removed from the project. */
export function libraryLaunchCopyMatchesScope(
  project: LibraryProject,
  copy: LibraryWorkingCopy,
  resourceId: string | null,
  resourceIds: readonly string[] | null = resourceId === null ? null : [resourceId],
) {
  return (
    (resourceIds !== null ||
      copy.repositories.length ===
        project.resources.filter((resource) => resource.kind !== "link").length) &&
    libraryCopiesForScope(
      project,
      [
        {
          ...copy,
          state: "ready",
          registered:
            copy.state === "released" && copy.ownership === "managed" && copy.recovery
              ? true
              : copy.registered,
        },
      ],
      copy.environmentId,
      resourceIds,
    ).length > 0
  );
}

/** Released managed files are restored from their archive, never recreated by preparation. */
export function libraryLaunchRetainedCopy(input: LaunchFilesInput) {
  const matches = input.copies.filter(
    (copy) =>
      copy.environmentId === input.environmentId &&
      copy.ownership === "managed" &&
      (!input.copyId || copy.id === input.copyId) &&
      ((copy.state === "released" && input.allowReopen !== false) ||
        (copy.state === "ready" && copy.keepOnComputer !== false)) &&
      libraryLaunchCopyMatchesScope(
        input.project,
        copy,
        input.resourceId ?? null,
        input.resourceIds,
      ),
  );
  return matches.length === 1 ? matches[0]! : null;
}

const normalizedRoot = (root: string) => {
  const portable = root.trim().replace(/\\/g, "/");
  const prefix = portable.match(/^(?:[a-z]:|\/\/[^/]+\/[^/]+|\/)/i)?.[0] ?? "";
  const parts: string[] = [];
  for (const part of portable.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized =
    `${prefix}${prefix && !prefix.endsWith("/") ? "/" : ""}${parts.join("/")}`.replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
};
const containsRoot = (parent: string, child: string) => {
  const normalizedParent = normalizedRoot(parent);
  const normalizedChild = normalizedRoot(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
};

export const libraryLaunchPathOverlaps = (left: string, right: string) =>
  containsRoot(left, right) || containsRoot(right, left);

/** Scope changes get a separate versioned folder, preserving every previous workspace. */
export function libraryLaunchRootPath(
  input: LaunchFilesInput & {
    readonly newProjectsRoot: string | undefined;
  },
) {
  const retained = libraryLaunchRetainedCopy(input);
  if (retained) return retained.rootPath;
  const occupied = input.copies.filter((copy) => copy.environmentId === input.environmentId);
  const previous = occupied
    .filter((copy) => copy.projectId === input.project.id)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!input.newProjectsRoot && !previous) return "";
  const name = newProjectFolderName(input.project.title);
  const separator = input.newProjectsRoot?.includes("\\") ? "\\" : "/";
  let base = input.newProjectsRoot
    ? `${input.newProjectsRoot.replace(/[\\/]+$/, "")}${separator}${name}`
    : previous!.rootPath;
  const overlaps = (candidate: string) =>
    occupied.some((copy) => libraryLaunchPathOverlaps(copy.rootPath, candidate));
  if (!overlaps(base)) return base;
  // A configured projects folder may itself be inside old work. Use that work's sibling.
  const ancestor = occupied
    .filter((copy) => containsRoot(copy.rootPath, base))
    .toSorted((left, right) => left.rootPath.length - right.rootPath.length)[0];
  if (
    ancestor &&
    (!normalizedRoot(ancestor.rootPath) || /^[a-z]:$/i.test(normalizedRoot(ancestor.rootPath)))
  )
    return "";
  if (ancestor && normalizedRoot(ancestor.rootPath) !== normalizedRoot(base)) {
    base = ancestor.rootPath.replace(/[\\/]+$/, "");
  }
  const versioned = `${base}-v${input.project.revision}`;
  let candidate = versioned;
  let suffix = 2;
  while (overlaps(candidate)) candidate = `${versioned}-${suffix++}`;
  return candidate;
}

/** Starting the conversation prepares files in place, with a location override when needed. */
export function LaunchGetCopy({
  environmentId,
  project,
  hostLabel,
  rootPath,
  temporary,
  disabled,
  needsExistingFolder,
  onRootPathChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: LibraryProject;
  readonly hostLabel: string;
  readonly rootPath: string;
  readonly temporary: boolean;
  readonly disabled: boolean;
  readonly needsExistingFolder: boolean;
  readonly onRootPathChange: (path: string) => void;
}) {
  const [editingLocation, setEditingLocation] = useState(needsExistingFolder || !rootPath);
  const location = (
    <LibraryField label="Folder">
      <Input
        font="mono"
        value={rootPath}
        placeholder="/path/to/project"
        disabled={disabled}
        onChange={(event) => {
          setEditingLocation(true);
          onRootPathChange(event.target.value);
        }}
      />
    </LibraryField>
  );
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Starting prepares project files on {hostLabel}.{" "}
        {temporary
          ? "New files are temporary unless you keep them."
          : "Remove the files when you finish; your project and conversations stay available."}
      </p>
      <details
        className="text-sm text-muted-foreground"
        open={editingLocation || !rootPath}
        onToggle={(event) => setEditingLocation(event.currentTarget.open)}
      >
        <summary className="cursor-pointer break-words">
          Files location{rootPath ? `: ${rootPath}` : ""}
        </summary>
        <div className="mt-2">{location}</div>
      </details>
      {needsExistingFolder ? (
        <p className="text-xs text-muted-foreground">
          This project includes a local repository. Use a folder that already contains it, or reopen
          its saved files.
        </p>
      ) : null}
      <ProfileReadiness environmentId={environmentId} project={project} />
    </div>
  );
}
