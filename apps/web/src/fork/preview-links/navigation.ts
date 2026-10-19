import {
  isUnreachableLoopback,
  navigablePreviewUrlWith,
  parsePreviewNavigationUrl,
  previewLinkEntryUrlWith,
  previewNavigationFailureMessage,
  resolvePreviewNavigationWith,
  type PreviewNavigationDeps,
  type PreviewNavigationRequest,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId, PreviewRuntime, ScopedThreadRef } from "@t3tools/contracts";
import { looksLikePreviewLinkUrl } from "@t3tools/contracts/fork";
import { ensureLocalApi } from "~/localApi";
import { appPreviewNavigationDeps } from "./navigationDeps";
import { openInSystemBrowser } from "./systemBrowser";

export const resolvePreviewNavigation = (request: PreviewNavigationRequest) =>
  resolvePreviewNavigationWith(appPreviewNavigationDeps, request);

export const navigablePreviewUrl = (request: PreviewNavigationRequest) =>
  navigablePreviewUrlWith(appPreviewNavigationDeps, request);

export const previewLinkEntryUrl = (link: string) =>
  previewLinkEntryUrlWith(appPreviewNavigationDeps, link);

/** For upstream seams, which keep each change to one line: a thread's preview URL to load. */
export const navigablePreviewUrlFor = (
  threadRef: ScopedThreadRef,
  url: string,
  runtime: PreviewRuntime | undefined,
) => navigablePreviewUrl({ url, environmentId: threadRef.environmentId, runtime });

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
  const parsed = parsePreviewNavigationUrl(url);
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
    appPreviewNavigationDeps.reportFailure(previewNavigationFailureMessage(error));
  }
}

/** For the preview's buttons that open it in the system browser, which cannot show a failure. */
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
  const parsed = parsePreviewNavigationUrl(url);
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
