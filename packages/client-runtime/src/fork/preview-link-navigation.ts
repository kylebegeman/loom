import {
  EnvironmentAuthorizationError,
  type EnvironmentId,
  type PreviewRuntime,
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
  /**
   * True when a loopback address on a private network connection may already reach the
   * computer, as a WSL backend answers on its Windows host's localhost. False maps it to the
   * private network address instead.
   */
  readonly keepsTypedLoopbackOnPrivateNetwork: boolean;
  readonly environmentLabel: (environmentId: EnvironmentId) => string;
  /** Where this client sets up preview links, as failure messages name it. */
  readonly settingsPath: string;
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

function portOf(url: URL): number {
  return Number(url.port || (url.protocol === "https:" ? 443 : 80));
}

const isPreviewLinksError = Schema.is(PreviewLinksError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

function previewLinksErrorReason(error: unknown): PreviewLinksErrorReason | null {
  return isPreviewLinksError(error) ? error.reason : null;
}

const notConfiguredMessage = (label: string, settingsPath: string) =>
  `Preview links are not set up on ${label}. Set them up in ${settingsPath} to open its ports from here.`;

const noAccessMessage = (label: string) =>
  `This connection cannot share ports on ${label}. Open the port from that computer, or pair with preview access.`;

const unreachableMessage = (label: string, settingsPath: string) =>
  `Ports on ${label} are not reachable from this device. Set up preview links in ${settingsPath} to open them.`;

/** A URL as typed or posted, including schemeless addresses such as `localhost:5173`. */
export const parsePreviewNavigationUrl = (url: string): URL | null => {
  try {
    return new URL(normalizePreviewUrl(url));
  } catch {
    return null;
  }
};

/** True for a loopback port on a computer this client cannot reach. */
export const isUnreachableLoopback = (
  deps: PreviewNavigationDeps,
  environmentId: EnvironmentId,
  url: URL,
) => isLoopbackHost(url.hostname) && !deps.reachesLoopback(environmentId);

/** The thread's environment first: it most likely serves a link its agent posted. */
function linkOwnerCandidates(
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
    const mapped = deps.privateNetworkUrl(environmentId, url);
    if (mapped === null) throw new Error(unreachableMessage(label(), deps.settingsPath));
    return deps.keepsTypedLoopbackOnPrivateNetwork ? request.url : mapped;
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
    throw new Error(
      denied ? noAccessMessage(label()) : notConfiguredMessage(label(), deps.settingsPath),
      { cause: error },
    );
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
  const url = parsePreviewNavigationUrl(request.url);
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

export const previewNavigationFailureMessage = (error: unknown) =>
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
    deps.reportFailure(previewNavigationFailureMessage(error));
    return null;
  }
}

/**
 * For a link opened outside any thread, such as in the system browser: a fresh entry from
 * whichever connected computer serves it, the link itself when none does, or null once the
 * failure has been shown.
 */
export async function previewLinkEntryUrlWith(
  deps: PreviewNavigationDeps,
  link: string,
): Promise<string | null> {
  const url = parsePreviewNavigationUrl(link);
  if (url === null) return link;
  try {
    return (await openLinkUrl(deps, url, null, undefined)) ?? link;
  } catch (error) {
    deps.reportFailure(previewNavigationFailureMessage(error));
    return null;
  }
}
