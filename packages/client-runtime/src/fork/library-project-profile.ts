import type { EnvironmentId, ProjectId, ProjectScript } from "@t3tools/contracts";
import {
  LIBRARY_PROFILE_LIMITS,
  LIBRARY_TOOL_CATALOG,
  LibraryProjectProfileInput,
  LibrarySecretName,
  LibraryToolVersion,
  libraryProfileSecretValueField,
  libraryProfileSecretValueMessage,
  looksLikeSecretValue,
  type LibraryComputer,
  type LibraryProjectProfile,
  type LibraryRequiredTool,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

const isProfileInput = Schema.is(LibraryProjectProfileInput);
const isSecretName = Schema.is(LibrarySecretName);
const isToolVersion = Schema.is(LibraryToolVersion);

export function libraryToolLabel(id: string) {
  return LIBRARY_TOOL_CATALOG.find((tool) => tool.id === id)?.label ?? id;
}

/** A required tool as people read it, like `Node.js 22+`. */
export function libraryToolText(tool: LibraryRequiredTool) {
  return `${libraryToolLabel(tool.id)}${tool.minimumVersion ? ` ${tool.minimumVersion}+` : ""}`;
}

/** Sets or clears one tool's minimum version from what someone typed. */
export function libraryToolsWithVersion(
  tools: readonly LibraryRequiredTool[],
  id: string,
  input: string,
): LibraryRequiredTool[] {
  const minimumVersion = input.trim();
  return tools.map((entry) =>
    entry.id === id ? { id: entry.id, ...(minimumVersion ? { minimumVersion } : {}) } : entry,
  );
}

/**
 * Computers a project can prefer: each one that runs work, plus any already chosen, so a
 * computer that has since gone away can still be cleared.
 */
export function libraryProfileComputerIds(
  computers: readonly Pick<LibraryComputer, "environmentId" | "supportsExecution">[],
  selected: readonly EnvironmentId[],
): EnvironmentId[] {
  return [
    ...computers.filter((computer) => computer.supportsExecution).map((c) => c.environmentId),
    ...selected,
  ].filter((id, index, all) => all.indexOf(id) === index);
}

/**
 * Turns what someone typed, like `github token`, into an environment variable name, or null.
 * The raw text is checked too, since uppercasing a pasted token would hide its shape.
 */
export function librarySecretNameFromInput(input: string): string | null {
  if (looksLikeSecretValue(input)) return null;
  const name = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return isSecretName(name) && !looksLikeSecretValue(name) ? name : null;
}

/** A profile being edited, where a cleared field is undefined. */
export type LibraryProfileDraft = {
  readonly [K in keyof LibraryProjectProfileInput]?: LibraryProjectProfileInput[K] | undefined;
};

/**
 * Drops cleared fields and empty lists so a profile saves only what someone chose. Null means
 * there is nothing left to keep, which removes the profile.
 */
export function compactLibraryProfile(
  profile: LibraryProfileDraft,
): LibraryProjectProfileInput | null {
  const entries = Object.entries(profile).filter(
    ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
  );
  return entries.length ? (Object.fromEntries(entries) as LibraryProjectProfileInput) : null;
}

const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );

/**
 * What a save should send for an edited profile: undefined when it matches the saved one, so
 * the save keeps it untouched, otherwise the profile, or null to remove it.
 */
export function libraryProfileChange(
  draft: LibraryProfileDraft,
  saved: LibraryProjectProfile | undefined,
): LibraryProjectProfileInput | null | undefined {
  const profile = compactLibraryProfile(draft);
  const kept = saved ? compactLibraryProfile(saved) : null;
  return stableJson(profile) === stableJson(kept) ? undefined : profile;
}

/**
 * Why a profile cannot be saved, in words a person can act on, or null when it can. Entries
 * already in the saved profile are not checked for secrets again, the way the Library saves.
 */
export function libraryProfileProblem(
  profile: LibraryProjectProfileInput,
  saved?: LibraryProjectProfile,
): string | null {
  const secretField = libraryProfileSecretValueField(profile, saved);
  if (secretField) return libraryProfileSecretValueMessage(secretField);
  const tool = profile.requiredTools?.find(
    (entry) => entry.minimumVersion !== undefined && !isToolVersion(entry.minimumVersion),
  );
  if (tool) return `Use a plain version number for ${libraryToolLabel(tool.id)}, like 20 or 3.12.`;
  if (profile.secretNames?.some((name) => !isSecretName(name)))
    return "Secret names use capital letters, digits and underscores, like GITHUB_TOKEN.";
  if ((profile.scripts?.length ?? 0) > LIBRARY_PROFILE_LIMITS.scripts)
    return `A project keeps up to ${LIBRARY_PROFILE_LIMITS.scripts} scripts.`;
  return isProfileInput(profile) ? null : "This setup is too large to save.";
}

/** A local project on a copy's computer whose scripts can become the project's scripts. */
export type LibraryProfileScriptSource = {
  readonly copyId: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly scripts: readonly ProjectScript[];
};

/**
 * Every local project behind the given copies that has scripts, root folder first. A copy
 * points at local projects by environment and id, so one that is not loaded is skipped.
 */
export function libraryProfileScriptSources(
  copies: readonly LibraryWorkingCopy[],
  localProjects: readonly {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly title: string;
    readonly scripts: readonly ProjectScript[];
  }[],
): LibraryProfileScriptSource[] {
  const byRef = new Map(
    localProjects.map((entry) => [`${entry.environmentId}:${entry.id}`, entry]),
  );
  const seen = new Set<string>();
  return copies.flatMap((copy) =>
    [
      copy.rootLocalProjectId,
      ...copy.repositories.map((repository) => repository.localProjectId),
    ].flatMap((id) => {
      const ref = `${copy.environmentId}:${id}`;
      const entry = id ? byRef.get(ref) : undefined;
      if (!entry?.scripts.length || seen.has(ref)) return [];
      seen.add(ref);
      return [
        {
          copyId: copy.id,
          environmentId: entry.environmentId,
          projectId: entry.id,
          title: entry.title,
          scripts: entry.scripts.slice(0, LIBRARY_PROFILE_LIMITS.scripts),
        },
      ];
    }),
  );
}
