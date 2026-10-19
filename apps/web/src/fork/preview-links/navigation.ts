import {
  EnvironmentAuthorizationError,
  type EnvironmentId,
  type PreviewRuntime,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  PreviewLinksError,
  looksLikePreviewLinkUrl,
  type PreviewLink,
  type PreviewLinkEntry,
  type PreviewLinkOpenInput,
  type PreviewLinkShareInput,
  type PreviewLinksErrorReason,
} from "@t3tools/contracts/fork";
import { isLoopbackHost, normalizePreviewUrl } from "@t3tools/shared/preview";
import * as Schema from "effect/Schema";
import { appPreviewNavigationDeps } from "./navigationDeps";

export interface PreviewNavigationRequest {
  readonly url: string;
  /** The thread's environment, whose computer serves its loopback ports. */
  readonly environmentId: EnvironmentId;
  /** Where the page renders: `server` draws it on the environment's computer. */
  readonly runtime: PreviewRuntime | undefined;
}

export interface PreviewNavigationDeps {
  /** Connected environments whose server shares preview links. */
  readonly previewLinkEnvironments: () => ReadonlyArray<EnvironmentId>;
  /** True when this client reaches the environment's loopback, or cannot tell yet. */
  readonly reachesLoopback: (environmentId: EnvironmentId) => boolean;
  /** The URL on the environment's private network address, or null when that does not apply. */
  readonly privateNetworkUrl: (environmentId: EnvironmentId, url: URL) => string | null;
  readonly environmentLabel: (environmentId: EnvironmentId) => string;
  readonly share: (
    environmentId: EnvironmentId,
    input: PreviewLinkShareInput,
  ) => Promise<PreviewLink>;
  readonly open: (
    environmentId: EnvironmentId,
    input: PreviewLinkOpenInput,
  ) => Promise<PreviewLinkEntry>;
  readonly reportFailure: (message: string) => void;
}

/** The gateway serves its own pages here, such as the single-use entry. */
const RESERVED_PATH_PREFIX = "/__loom/";

/** Path, query and fragment to land on. A stale entry or gateway page lands on the root. */
export function landingPath(url: URL): string {
  return url.pathname.startsWith(RESERVED_PATH_PREFIX)
    ? "/"
    : `${url.pathname}${url.search}${url.hash}`;
}

export function portOf(url: URL): number {
  return Number(url.port || (url.protocol === "https:" ? 443 : 80));
}

const isPreviewLinksError = Schema.is(PreviewLinksError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

export function previewLinksErrorReason(error: unknown): PreviewLinksErrorReason | null {
  return isPreviewLinksError(error) ? error.reason : null;
}

export const notConfiguredMessage = (label: string) =>
  `Preview links are not set up on ${label}. Set them up in Settings > Previews to open its ports from here.`;

export const noAccessMessage = (label: string) =>
  `This connection cannot share ports on ${label}. Open the port from that computer, or pair with preview access.`;

export const unreachableMessage = (label: string) =>
  `Ports on ${label} are not reachable from this device. Set up preview links in Settings > Previews to open them.`;

const parseUrl = (url: string): URL | null => {
  try {
    return new URL(normalizePreviewUrl(url));
  } catch {
    return null;
  }
};

/** The thread's environment first: it most likely serves a link its agent posted. */
export function linkOwnerCandidates(
  preferred: EnvironmentId,
  environments: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<EnvironmentId> {
  return environments.includes(preferred)
    ? [preferred, ...environments.filter((environmentId) => environmentId !== preferred)]
    : environments;
}

async function openLinkUrl(
  deps: PreviewNavigationDeps,
  request: PreviewNavigationRequest,
  url: URL,
): Promise<string> {
  const path = landingPath(url);
  for (const environmentId of linkOwnerCandidates(
    request.environmentId,
    deps.previewLinkEnvironments(),
  )) {
    let entry: PreviewLinkEntry;
    try {
      entry = await deps.open(environmentId, { link: url.href, path });
    } catch (error) {
      const reason = previewLinksErrorReason(error);
      // Another computer, one without links set up, or one this client cannot ask.
      if (reason === null || reason === "not-found" || reason === "not-configured") continue;
      throw error;
    }
    // A browser drawn on the link's own computer skips the tunnel and its sign-in.
    return request.runtime === "server" && environmentId === request.environmentId
      ? `http://localhost:${entry.link.port}${path}`
      : entry.url;
  }
  // No connected computer owns it, so it is somebody else's page.
  return request.url;
}

async function shareLoopbackUrl(
  deps: PreviewNavigationDeps,
  request: PreviewNavigationRequest,
  url: URL,
): Promise<string> {
  const { environmentId } = request;
  const label = () => deps.environmentLabel(environmentId);
  if (!deps.previewLinkEnvironments().includes(environmentId)) {
    // As before links existed: a typed address on a private network stays as typed (a WSL
    // backend answers on this computer's localhost), and discovered ports arrive already mapped.
    if (deps.privateNetworkUrl(environmentId, url) !== null) return request.url;
    throw new Error(unreachableMessage(label()));
  }
  let entry: PreviewLinkEntry;
  try {
    const link = await deps.share(environmentId, { port: portOf(url) });
    entry = await deps.open(environmentId, { link: link.id, path: landingPath(url) });
  } catch (error) {
    const denied = isAuthorizationError(error);
    if (!denied && previewLinksErrorReason(error) !== "not-configured") throw error;
    const mapped = deps.privateNetworkUrl(environmentId, url);
    if (mapped !== null) return mapped;
    throw new Error(denied ? noAccessMessage(label()) : notConfiguredMessage(label()), {
      cause: error,
    });
  }
  return entry.url;
}

/**
 * The URL a preview should load so the viewer reaches what the thread's computer serves.
 * A loopback port on a computer this client cannot reach becomes a preview link, and a
 * preview link becomes a fresh single-use entry. Anything else is returned unchanged.
 */
export async function resolvePreviewNavigationWith(
  deps: PreviewNavigationDeps,
  request: PreviewNavigationRequest,
): Promise<string> {
  const url = parseUrl(request.url);
  if (url === null) return request.url;
  if (looksLikePreviewLinkUrl(url.href)) return openLinkUrl(deps, request, url);
  if (!isLoopbackHost(url.hostname)) return request.url;
  if (request.runtime === "server" || deps.reachesLoopback(request.environmentId)) {
    return request.url;
  }
  return shareLoopbackUrl(deps, request, url);
}

export const resolvePreviewNavigation = (request: PreviewNavigationRequest) =>
  resolvePreviewNavigationWith(appPreviewNavigationDeps, request);

const failureMessage = (error: unknown) =>
  error instanceof Error && error.message.length > 0
    ? error.message
    : "The preview could not be opened.";

/** For seams: the URL to load, or null once the failure has been shown. */
export async function navigablePreviewUrlWith(
  deps: PreviewNavigationDeps,
  request: PreviewNavigationRequest,
): Promise<string | null> {
  try {
    return await resolvePreviewNavigationWith(deps, request);
  } catch (error) {
    deps.reportFailure(failureMessage(error));
    return null;
  }
}

export const navigablePreviewUrl = (request: PreviewNavigationRequest) =>
  navigablePreviewUrlWith(appPreviewNavigationDeps, request);

/** For upstream seams, which keep each change to one line: a thread's preview URL to load. */
export const navigablePreviewUrlFor = (
  threadRef: ScopedThreadRef,
  url: string,
  runtime: PreviewRuntime | undefined,
) => navigablePreviewUrl({ url, environmentId: threadRef.environmentId, runtime });
