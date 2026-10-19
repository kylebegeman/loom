import {
  EnvironmentAuthorizationError,
  type EnvironmentId,
  type PreviewRuntime,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  PREVIEW_LINK_GATEWAY_PATH,
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
import { ensureLocalApi } from "~/localApi";
import { appPreviewNavigationDeps } from "./navigationDeps";
import { openInSystemBrowser } from "./systemBrowser";

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

/** Path, query and fragment to land on. A stale entry or gateway page lands on the root. */
export function landingPath(url: URL): string {
  return url.pathname.startsWith(PREVIEW_LINK_GATEWAY_PATH)
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
  preferred: EnvironmentId | null,
  environments: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<EnvironmentId> {
  return preferred !== null && environments.includes(preferred)
    ? [preferred, ...environments.filter((environmentId) => environmentId !== preferred)]
    : environments;
}

/** The URL that opens a link through the computer serving it, or null when none connected does. */
async function openLinkUrl(
  deps: PreviewNavigationDeps,
  url: URL,
  preferred: EnvironmentId | null,
  runtime: PreviewRuntime | undefined,
): Promise<string | null> {
  const path = landingPath(url);
  for (const environmentId of linkOwnerCandidates(preferred, deps.previewLinkEnvironments())) {
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
    return runtime === "server" && environmentId === preferred
      ? `http://localhost:${entry.link.port}${path}`
      : entry.url;
  }
  return null;
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
  if (looksLikePreviewLinkUrl(url.href)) {
    // No connected computer owns it, so it is somebody else's page.
    return (await openLinkUrl(deps, url, request.environmentId, request.runtime)) ?? request.url;
  }
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

/**
 * For a link opened outside any thread, such as in the system browser: a fresh entry from
 * whichever connected computer serves it, the link itself when none does, or null once the
 * failure has been shown.
 */
export async function previewLinkEntryUrlWith(
  deps: PreviewNavigationDeps,
  link: string,
): Promise<string | null> {
  const url = parseUrl(link);
  if (url === null) return link;
  try {
    return (await openLinkUrl(deps, url, null, undefined)) ?? link;
  } catch (error) {
    deps.reportFailure(failureMessage(error));
    return null;
  }
}

export const previewLinkEntryUrl = (link: string) =>
  previewLinkEntryUrlWith(appPreviewNavigationDeps, link);

/** For upstream seams, which keep each change to one line: a thread's preview URL to load. */
export const navigablePreviewUrlFor = (
  threadRef: ScopedThreadRef,
  url: string,
  runtime: PreviewRuntime | undefined,
) => navigablePreviewUrl({ url, environmentId: threadRef.environmentId, runtime });

const isUnreachableLoopback = (
  deps: PreviewNavigationDeps,
  environmentId: EnvironmentId,
  url: URL,
) => isLoopbackHost(url.hostname) && !deps.reachesLoopback(environmentId);

/**
 * Opens an address from the environment's computer in the system browser. A preview link, or a
 * loopback port this client cannot reach, first needs an entry, so it opens through a window
 * taken while the click still counts as a user gesture. Anything else opens as it always did.
 * Rejects only when the browser could not be opened; a failed entry was already shown.
 */
export function openEnvironmentUrlExternallyWith(
  deps: PreviewNavigationDeps,
  environmentId: EnvironmentId | undefined,
  url: string,
): Promise<void> {
  const parsed = parseUrl(url);
  if (
    environmentId !== undefined &&
    parsed !== null &&
    (looksLikePreviewLinkUrl(parsed.href) || isUnreachableLoopback(deps, environmentId, parsed))
  ) {
    return openInSystemBrowser(() =>
      navigablePreviewUrlWith(deps, { url, environmentId, runtime: undefined }),
    );
  }
  return ensureLocalApi().shell.openExternal(url);
}

/** For upstream seams that open a thread's address in the system browser. */
export const openEnvironmentUrlExternally = (
  environmentId: EnvironmentId | undefined,
  url: string,
) => openEnvironmentUrlExternallyWith(appPreviewNavigationDeps, environmentId, url);

async function openShowingFailure(environmentId: EnvironmentId, url: string): Promise<void> {
  try {
    await openEnvironmentUrlExternally(environmentId, url);
  } catch (error) {
    appPreviewNavigationDeps.reportFailure(failureMessage(error));
  }
}

/** For the preview's "Open in browser", which has nowhere else to show a failure. */
export const openPreviewInSystemBrowser = (threadRef: ScopedThreadRef, url: string) =>
  openShowingFailure(threadRef.environmentId, url);

/**
 * For a chat link the browser would open natively, which would load a loopback port this client
 * cannot reach. True when it took the click to open a preview link instead.
 */
export function takeUnreachableLoopbackClick(
  event: { preventDefault(): void; stopPropagation(): void },
  environmentId: EnvironmentId | undefined,
  url: string,
): boolean {
  const parsed = parseUrl(url);
  if (
    environmentId === undefined ||
    parsed === null ||
    !isUnreachableLoopback(appPreviewNavigationDeps, environmentId, parsed)
  ) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  void openShowingFailure(environmentId, url);
  return true;
}
