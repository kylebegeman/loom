import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import type { SitesSnapshot } from "@t3tools/contracts/fork";
import { cn } from "~/lib/utils";
import { HeroTexture, ProjectGlow } from "../project-library/ProjectIdentity";
import { SITE_THUMBNAIL_SANDBOX, siteFrameUrl } from "./framing";
import { SiteMark, siteHost } from "./SiteHealth";

type Site = SitesSnapshot["sites"][number];

/** The app's own origin, which a framed site must never share. */
const APP_ORIGIN = typeof window === "undefined" ? "" : window.location.origin;

/**
 * Loading a site runs its own scripts in a whole renderer, so only a few live frames load at once.
 * Cards render worst first, so the sites most worth seeing load first. A frame frees its place once
 * it has loaded and settled, or after `LIVE_FRAME_GIVE_UP_MS` if it never does, so the next card
 * waiting can start and every card gets its preview in turn.
 */
const MAX_LIVE_THUMBNAIL_LOADS = 6;
/** Room for the page's own startup work after `load`, before the next frame starts loading. */
const LIVE_FRAME_SETTLE_MS = 1_000;
/** A frame that neither loads nor fails, like a hung server, stops holding up the queue. */
const LIVE_FRAME_GIVE_UP_MS = 15_000;

const liveFrames = {
  granted: new Set<symbol>(),
  queue: [] as symbol[],
  listeners: new Set<() => void>(),
};

function notifyLiveFrames() {
  for (const listener of liveFrames.listeners) listener();
}

function requestLiveFrame(token: symbol) {
  if (liveFrames.granted.size < MAX_LIVE_THUMBNAIL_LOADS) liveFrames.granted.add(token);
  else liveFrames.queue.push(token);
  notifyLiveFrames();
}

function releaseLiveFrame(token: symbol) {
  liveFrames.queue = liveFrames.queue.filter((entry) => entry !== token);
  if (liveFrames.granted.delete(token)) {
    const next = liveFrames.queue.shift();
    if (next) liveFrames.granted.add(next);
  }
  notifyLiveFrames();
}

function subscribeLiveFrames(listener: () => void) {
  liveFrames.listeners.add(listener);
  return () => {
    liveFrames.listeners.delete(listener);
  };
}

/**
 * Whether this thumbnail may start its frame. It waits in line for a load slot, holds it until
 * `settle` is called, and from then on keeps its frame without taking a slot.
 */
function useLiveFrameTurn() {
  const [token] = useState(() => Symbol("site-thumbnail"));
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled) return;
    requestLiveFrame(token);
    return () => releaseLiveFrame(token);
  }, [settled, token]);
  const granted = useSyncExternalStore(
    subscribeLiveFrames,
    () => liveFrames.granted.has(token),
    () => false,
  );
  return { started: granted || settled, settle: () => setSettled(true) };
}

const seenCallbacks = new Map<Element, () => void>();
let seenObserver: IntersectionObserver | null = null;

function observeSeen(element: Element, onSeen: () => void) {
  seenObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = seenCallbacks.get(entry.target);
      seenCallbacks.delete(entry.target);
      seenObserver?.unobserve(entry.target);
      callback?.();
    }
  });
  seenCallbacks.set(element, onSeen);
  seenObserver.observe(element);
  return () => {
    seenCallbacks.delete(element);
    seenObserver?.unobserve(element);
    if (seenCallbacks.size === 0) {
      seenObserver?.disconnect();
      seenObserver = null;
    }
  };
}

/**
 * Whether an element has ever been on screen. It never turns back off, so work started for a card,
 * such as its traffic read or its frame, is not thrown away and repeated when it scrolls past.
 */
export function useSeen() {
  const [element, setElement] = useState<Element | null>(null);
  // Without an observer there is no way to wait, so everything counts as seen.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !element) return;
    return observeSeen(element, () => setSeen(true));
  }, [element, seen]);
  return [setElement, seen] as const;
}

function savesData() {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * The top of a site's card: its live front page when `live` is on, otherwise a still made from its
 * mark on the site's color. The card's body carries the name and address, so the still does not.
 * A live frame is only ever a picture. It loads once the card is on screen and its turn comes,
 * never takes focus or pointer input, and sends no referrer.
 */
export function SiteThumbnail({
  site,
  live,
}: {
  readonly site: Pick<Site, "url" | "name" | "active">;
  readonly live: boolean;
}) {
  const [ref, seen] = useSeen();
  const frameUrl = siteFrameUrl(site.url, undefined, APP_ORIGIN);
  return (
    <div
      ref={ref}
      className={cn(
        "pointer-events-none relative isolate aspect-16/10 w-full overflow-hidden border-b border-border/70 bg-(--project-color)/5 transition-[filter,opacity] duration-200 dark:bg-(--project-color)/8",
        !site.active &&
          "opacity-70 grayscale group-hover/card:opacity-100 group-hover/card:grayscale-0",
      )}
    >
      <ThumbnailStill url={site.url} />
      {/* Keyed by address, so an edited address waits for its own turn to load. */}
      {live && seen && frameUrl && !savesData() ? (
        <LiveThumbnail key={frameUrl} src={frameUrl} host={siteHost(site.url)} />
      ) : null}
    </div>
  );
}

function ThumbnailStill({ url }: { readonly url: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <ProjectGlow strength="strong" />
      <HeroTexture />
      <SiteMark url={url} size="2xl" />
    </div>
  );
}

function LiveThumbnail({ src, host }: { readonly src: string; readonly host: string }) {
  const turn = useLiveFrameTurn();
  return turn.started ? <ThumbnailFrame src={src} host={host} onSettled={turn.settle} /> : null;
}

/**
 * The frame lays the page out at four times the card's size and draws it at a quarter, so the
 * card shows the site's desktop layout without measuring anything.
 */
function ThumbnailFrame({
  src,
  host,
  onSettled,
}: {
  readonly src: string;
  readonly host: string;
  readonly onSettled: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const settle = useEffectEvent(onSettled);
  useEffect(() => {
    const timer = window.setTimeout(
      () => settle(),
      loaded ? LIVE_FRAME_SETTLE_MS : LIVE_FRAME_GIVE_UP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [loaded]);
  return (
    <iframe
      src={src}
      title={`${host} preview`}
      sandbox={SITE_THUMBNAIL_SANDBOX}
      referrerPolicy="no-referrer"
      tabIndex={-1}
      aria-hidden
      inert
      onLoad={() => setLoaded(true)}
      className={cn(
        "pointer-events-none absolute top-0 left-0 h-[400%] w-[400%] origin-top-left scale-25 border-0 bg-white scheme-light transition-opacity duration-150",
        loaded ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
