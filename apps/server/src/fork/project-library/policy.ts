import type { LibraryProject } from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";

/** Validate composition without scanning or creating any working files. */
export function validLibraryResources(
  resources: LibraryProject["resources"],
  options: { allowLocalRemotes?: boolean } = {},
): boolean {
  if (
    resources.length > 64 ||
    new Set(resources.map((resource) => resource.id)).size !== resources.length
  )
    return false;
  const paths: string[] = [];
  const repositories = new Set<string>();
  for (const resource of resources) {
    if (resource.kind === "link") {
      if (!resource.url || /[\p{Cc}\p{Cf}\\]/u.test(resource.url) || resource.remoteUrl !== null)
        return false;
      try {
        const url = new URL(resource.url);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          !url.hostname
        )
          return false;
      } catch {
        return false;
      }
      continue;
    }
    const path = resource.relativePath;
    if (
      /^[\\/]|^[a-z]:|[\\\p{Cc}\p{Cf}]/iu.test(path) ||
      (path !== "." && path.split("/").some((part) => part === "" || part === "." || part === ".."))
    )
      return false;
    const folded = path.toLowerCase();
    if (
      paths.some(
        (previous) =>
          previous === folded ||
          previous === "." ||
          folded === "." ||
          previous.startsWith(`${folded}/`) ||
          folded.startsWith(`${previous}/`),
      )
    )
      return false;
    paths.push(folded);
    if (resource.remoteUrl === null) continue;
    if (options.allowLocalRemotes && /^(?:file:\/\/|\/|[a-zA-Z]:[\\/])/.test(resource.remoteUrl)) {
      if (/[\p{Cc}\p{Cf}]/u.test(resource.remoteUrl)) return false;
      continue;
    }
    let remote = resource.remoteUrl;
    if (/[\s\p{Cc}\p{Cf}\\]/u.test(remote)) return false;
    const scp = /^([a-zA-Z0-9._-]+)@([^@:/]+):([^?#]+)$/.exec(remote);
    if (scp) remote = `ssh://${scp[1]}@${scp[2]}/${scp[3]}`;
    try {
      const url = new URL(remote);
      const host = new URL(`http://${url.hostname}/`).hostname.toLowerCase().replace(/\.$/, "");
      if (
        !["https:", "ssh:"].includes(url.protocol) ||
        url.password ||
        url.search ||
        url.hash ||
        (url.username && (url.protocol !== "ssh:" || !/^[a-zA-Z0-9._-]+$/.test(url.username)))
      )
        return false;
      if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "0.0.0.0" ||
        host.startsWith("127.") ||
        ["[::]", "[::1]", "[::ffff:0:0]"].includes(host) ||
        host.startsWith("[::ffff:7f")
      )
        return false;
      const segments = url.pathname.split("/").filter(Boolean);
      if (
        segments.length < 2 ||
        /[\p{Cc}\p{Cf}\\]/u.test(decodeURIComponent(url.pathname)) ||
        (host === "github.com" && segments.length !== 2)
      )
        return false;
    } catch {
      return false;
    }
    const key = canonicalRepositoryKey(normalizeGitRemoteUrl(remote));
    if (repositories.has(key)) return false;
    repositories.add(key);
  }
  return true;
}
