import type { LibraryResource } from "@t3tools/contracts/fork";

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
