import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { isLibraryBranchName, type LibraryResource } from "@t3tools/contracts/fork";

export const isRepositoryResource = (resource: LibraryResource) => resource.kind !== "link";
export function resourceLink(resource: LibraryResource) {
  const value = resource.kind === "link" ? resource.url : resource.remoteUrl;
  if (!value || /[\p{Cc}\p{Cf}\\]/u.test(value)) return null;
  try {
    const parsed = new URL(value);
    return !parsed.username &&
      !parsed.password &&
      (parsed.protocol === "https:" || parsed.protocol === "http:")
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** Resource validation happens before dispatch; servers validate the authoritative boundary too. */
export function validateResources(resources: readonly LibraryResource[]) {
  const paths = new Set<string>();
  for (const resource of resources) {
    if (!resource.title.trim()) return "Give each resource a name.";
    if (resource.kind === "link") {
      if (!resourceLink(resource)) return "Reference links need an http or https URL.";
      continue;
    }
    if (resource.defaultBranch !== null && !isLibraryBranchName(resource.defaultBranch))
      return "Use a valid Git branch override, or follow the repository default.";
    const path = resource.relativePath.trim().toLowerCase();
    if (
      !path ||
      path.startsWith("/") ||
      /^[a-z]:/iu.test(path) ||
      /[\p{Cc}\p{Cf}]/u.test(path) ||
      path.includes("\\") ||
      (path !== "." && path.split("/").some((part) => !part || part === "." || part === ".."))
    )
      return "Use a relative repository folder without empty, dot, or parent segments.";
    if (
      [...paths].some(
        (existing) =>
          existing === "." ||
          path === "." ||
          existing === path ||
          existing.startsWith(`${path}/`) ||
          path.startsWith(`${existing}/`),
      )
    )
      return "Repository folders must be distinct and cannot contain one another.";
    paths.add(path);
  }
  return null;
}

/** Only explicit GitHub HTTPS/SSH remotes can select a Vault GitHub repository. */
export function libraryGitHubRepository(remoteUrl: string | null) {
  if (
    !remoteUrl ||
    !/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/(?:git@)?github\.com\/)/i.test(remoteUrl)
  )
    return null;
  const normalized = normalizeGitRemoteUrl(remoteUrl);
  const match = /^github\.com\/([a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100})$/.exec(normalized);
  return match?.[1] ?? null;
}
