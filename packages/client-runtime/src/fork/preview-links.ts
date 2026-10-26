import {
  PREVIEW_LINKS_WS_METHODS as P,
  type PreviewLink,
  type PreviewLinksSetup,
  type PreviewPage,
  type PreviewPageAction,
  type PreviewPageKind,
} from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

export interface PreviewLibraryStatus {
  readonly label: string;
  readonly detail: string;
  readonly problem: boolean;
}

/**
 * Whether browsers outside Loom sign in to this computer's previews through its Library. Null while
 * previews are off, and from servers that predate the state.
 */
export function previewLibraryStatus(setup: PreviewLinksSetup): PreviewLibraryStatus | null {
  const library = setup.library;
  switch (library?.state) {
    case undefined:
    case "off":
      return null;
    case "registered":
      return {
        label: "Registered",
        detail: "Browsers outside Loom sign in through your Library.",
        problem: false,
      };
    case "registering":
      return {
        label: "Registering",
        detail: "Telling your Library about this computer's preview addresses.",
        problem: false,
      };
    case "not-connected":
      return {
        label: "Not connected",
        detail:
          "This computer has no Library, so other browsers are asked to open links from Loom.",
        problem: false,
      };
    case "unsupported":
      return {
        label: "Not supported",
        detail:
          "Your Library cannot sign browsers in to previews, so other browsers are asked to open links from Loom.",
        problem: false,
      };
    case "error":
      return {
        label: "Not registered",
        detail: library.message ?? "Your Library did not register this computer's previews.",
        problem: true,
      };
  }
}

/** Preview links belong to the computer that serves the port; every request stays on that host. */
export function createPreviewLinksAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const snapshot = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "loom:preview-links",
    tag: P.watch,
  });
  const pagesRevisionOf = (result: AsyncResult.AsyncResult<{ pagesRevision?: number }, unknown>) =>
    Option.getOrUndefined(AsyncResult.value(result))?.pagesRevision;
  // How far the computer's pages revision moved since this registry first saw it. Starting from
  // zero rather than the raw revision keeps the snapshot's first arrival from reading the list a
  // second time. Servers without a revision hold this at zero.
  const pagesChanges = Atom.family((environmentId: EnvironmentId) => {
    const firstSeen = new WeakMap<AtomRegistry.AtomRegistry, number>();
    return Atom.make((get) => {
      const revision = pagesRevisionOf(get(snapshot({ environmentId, input: {} })));
      if (revision === undefined) return 0;
      const first = firstSeen.get(get.registry) ?? revision;
      firstSeen.set(get.registry, first);
      return revision - first;
    });
  });
  // Pages live in the Library and the computer only relays, so the computer's links snapshot
  // carries a revision that moves when this computer publishes or changes a page.
  const pages = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:preview-pages",
    tag: P.pagesList,
    refreshTrigger: ({ environmentId }) => pagesChanges(environmentId),
  });
  return {
    snapshot,
    configure: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-configure",
      tag: P.configure,
    }),
    share: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-share",
      tag: P.share,
    }),
    open: createEnvironmentRpcCommand(runtime, { label: "loom:preview-links-open", tag: P.open }),
    extend: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-extend",
      tag: P.extend,
    }),
    revoke: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-revoke",
      tag: P.revoke,
    }),
    restore: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-restore",
      tag: P.restore,
    }),
    revokeAll: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-revoke-all",
      tag: P.revokeAll,
    }),
    signOutBrowsers: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-links-sign-out",
      tag: P.signOutBrowsers,
    }),
    pages,
    updatePage: createEnvironmentRpcCommand(runtime, {
      label: "loom:preview-pages-update",
      tag: P.pagesUpdate,
      // A refused change usually means the page moved on elsewhere (it expired, or another
      // client ended it), so the list refetches after failures too. A server that pushes a pages
      // revision already brings the list back, so only older ones need the refetch here.
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => {
          if (pagesRevisionOf(registry.get(snapshot({ environmentId, input: {} }))) === undefined)
            registry.refresh(pages({ environmentId, input: {} }));
        }),
    }),
  };
}

// Web and mobile describe links and pages with the same words.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Whole units, rounded down: `3h 12m`, `45m`, `2d 4h`. */
export function formatPreviewDuration(ms: number): string {
  if (ms < MINUTE_MS) return "under a minute";
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)}m`;
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/** The agent names the folder relative to the workspace root, so `./dist/` and `dist` read alike. */
function folderLabel(path: string): string {
  const relative = path
    .trim()
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");
  return relative === "" || relative === "." ? "Workspace root folder" : `Folder ${relative}`;
}

/** A container runs for hours at most, so the day is named only when its stop crosses midnight. */
function containerStopLabel(stopsAt: number, now: number, locale: string | undefined): string {
  // @effect-diagnostics-next-line globalDate:off
  const stop = new Date(stopsAt);
  const time = stop.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  // @effect-diagnostics-next-line globalDate:off
  if (stop.toDateString() === new Date(now).toDateString()) return time;
  return `${stop.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
}

/**
 * What Loom serves behind a link it started, such as `Folder dist`, or null for a port the user's
 * own server answers. Old servers send no backing, so their links stay plain port rows. An ended
 * container link drops its stop time: the container is already gone.
 */
export function previewLinkBackingLabel(
  link: PreviewLink,
  now: number,
  locale?: string,
): string | null {
  const { backing } = link;
  if (backing === undefined) return null;
  if (backing.kind === "folder") return folderLabel(backing.path);
  const container = `Container ${backing.image}`;
  const stopsAt = Date.parse(backing.stopsAt);
  if (link.state !== "open" || Number.isNaN(stopsAt)) return container;
  if (stopsAt <= now) return `${container}, stopping now`;
  return `${container}, stops ${containerStopLabel(stopsAt, now, locale)}`;
}

/** One quiet line in place of the list when the computer has no Library that serves pages. */
export const PREVIEW_PAGES_UNAVAILABLE_TEXT = "Your Library does not publish pages yet.";
export const PREVIEW_PAGES_EMPTY_TEXT =
  "No pages yet. An agent can publish a page it rendered, or a Dossier, from its thread.";

export const PREVIEW_PAGE_KIND_LABELS: Record<PreviewPageKind, string> = {
  html: "HTML",
  dossier: "Dossier",
};

/** An expired page closed when its lifetime ran out; the Library leaves `endedAt` unset then. */
const pageClosedAt = (page: PreviewPage) =>
  Date.parse(page.endedAt ?? page.expiresAt ?? page.createdAt);

/** The Library purges a closed page once its restore window passes, so after that it is gone. */
export function canRestorePreviewPage(page: PreviewPage, now: number): boolean {
  return (
    page.state !== "open" && page.restorableUntil !== null && Date.parse(page.restorableUntil) > now
  );
}

/**
 * Open pages newest first, then closed pages that can still be restored, most recently closed
 * first. A list fetched a while ago can hold pages whose restore window has since passed.
 */
export function visiblePreviewPages(
  pages: ReadonlyArray<PreviewPage>,
  now: number,
): ReadonlyArray<PreviewPage> {
  const open = pages
    .filter((page) => page.state === "open")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const closed = pages
    .filter((page) => canRestorePreviewPage(page, now))
    .sort((left, right) => pageClosedAt(right) - pageClosedAt(left));
  return [...open, ...closed];
}

export function previewPageTiming(page: PreviewPage, now: number): string {
  if (page.state === "open") {
    if (page.kept || page.expiresAt === null) return "Kept";
    const left = Date.parse(page.expiresAt) - now;
    return left <= 0 ? "Expiring now" : `Expires in ${formatPreviewDuration(left)}`;
  }
  const verb = page.state === "expired" ? "Expired" : "Ended";
  const ago = Math.max(0, now - pageClosedAt(page));
  const closed = ago < MINUTE_MS ? `${verb} just now` : `${verb} ${formatPreviewDuration(ago)} ago`;
  if (!canRestorePreviewPage(page, now) || page.restorableUntil === null) return closed;
  return `${closed} · Restorable for ${formatPreviewDuration(Date.parse(page.restorableUntil) - now)}`;
}

export function previewPageSummary(page: PreviewPage, now: number): string {
  return `${PREVIEW_PAGE_KIND_LABELS[page.kind]} · ${previewPageTiming(page, now)}`;
}

/** What a client can do with a page: open it, or change it through the computer. */
export type PreviewPageControl = "open" | PreviewPageAction;

export const PREVIEW_PAGE_CONTROL_LABELS: Record<PreviewPageControl, string> = {
  open: "Open",
  keep: "Keep",
  release: "Stop keeping",
  end: "End",
  restore: "Restore",
};

export interface PreviewPageControlAvailability {
  readonly control: PreviewPageControl;
  readonly enabled: boolean;
}

/**
 * The address comes from the Library through the computer, and web opens it from the app's own
 * origin, so a `javascript:` or app-scheme URL must never reach the browser.
 */
const isHttpsUrl = (url: string) => /^https:\/\/[^/?#]/i.test(url);

/** Opening needs no permission: the page asks the browser to sign in to the Library itself. */
export function previewPageControls(
  page: PreviewPage,
  canUpdate: boolean,
  now: number,
): ReadonlyArray<PreviewPageControlAvailability> {
  if (page.state === "open") {
    return [
      { control: "open", enabled: isHttpsUrl(page.url) },
      { control: page.kept ? "release" : "keep", enabled: canUpdate },
      { control: "end", enabled: canUpdate },
    ];
  }
  return [{ control: "restore", enabled: canUpdate && canRestorePreviewPage(page, now) }];
}
