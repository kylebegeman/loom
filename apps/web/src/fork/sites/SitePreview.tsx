import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SitesSnapshot } from "@t3tools/contracts/fork";
import {
  AppWindowIcon,
  ArrowUpRightIcon,
  ListIcon,
  MonitorIcon,
  RotateCwIcon,
  SmartphoneIcon,
  TabletIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { LIBRARY_OUTLINE, LibraryEmpty } from "../project-library/LibraryControls";
import { SITE_PREVIEW_SANDBOX, siteFrameUrl } from "./framing";
import { SiteMark, siteHost, sitePath } from "./SiteHealth";

type Site = SitesSnapshot["sites"][number];

/** The widths a site is commonly read at, each with the height of a typical screen. */
export const PREVIEW_DEVICES = {
  desktop: { label: "Desktop", width: 1280, height: 800, icon: MonitorIcon },
  tablet: { label: "Tablet", width: 834, height: 1112, icon: TabletIcon },
  phone: { label: "Phone", width: 390, height: 844, icon: SmartphoneIcon },
} as const;
export type PreviewDevice = keyof typeof PREVIEW_DEVICES;
const DEVICE_ORDER: readonly PreviewDevice[] = ["desktop", "tablet", "phone"];
const isPreviewDevice = (value: unknown): value is PreviewDevice =>
  typeof value === "string" && value in PREVIEW_DEVICES;

/** The route keeps a preview path to this length. */
const MAX_PATH_LENGTH = 2048;
const MAX_MENU_PAGES = 10;
/** Long enough for a heavy page on a slow network, short enough that a stuck stage gets a way out. */
const SLOW_LOAD_MS = 15_000;

/**
 * How a device's viewport fits a stage `stageWidth` wide: rendered at its own width so the site
 * lays out as it would on that screen, then scaled down, never up, to the room there is.
 */
export function previewStageLayout(
  stageWidth: number,
  device: { readonly width: number; readonly height: number },
) {
  const scale = stageWidth > 0 ? Math.min(1, stageWidth / device.width) : 1;
  return {
    scale,
    width: Math.floor(device.width * scale),
    height: Math.floor(device.height * scale),
  };
}

export type PreviewPathResult =
  | { readonly ok: true; readonly path: string | undefined }
  | { readonly ok: false; readonly reason: string };

/**
 * Reads what someone typed into the preview's address field as a page on the site: a path, a
 * query, a pasted address on the site, or the host followed by a path. The site's own address
 * comes back as no path, so the route stays clean. Anything that leaves the site is refused with
 * a reason.
 */
export function normalizePreviewPath(input: string, siteUrl: string): PreviewPathResult {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return { ok: false, reason: "This site's address is not valid." };
  }
  const text = input.trim();
  if (!text) return { ok: true, path: undefined };
  let target: URL;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(text)) target = new URL(text);
    else if (text.startsWith("//")) target = new URL(`${site.protocol}${text}`);
    else if (/^[/?#]/.test(text)) target = new URL(text, site.origin);
    else {
      const host = text.split(/[/?#]/, 1)[0]!.toLowerCase();
      target =
        host === site.host.toLowerCase()
          ? new URL(`${site.protocol}//${text}`)
          : new URL(`/${text}`, site.origin);
    }
  } catch {
    return { ok: false, reason: "That is not a page address." };
  }
  if (target.origin !== site.origin) {
    return { ok: false, reason: `The preview stays on ${site.host}.` };
  }
  const path = `${target.pathname}${target.search}${target.hash}`;
  if (path.length > MAX_PATH_LENGTH) return { ok: false, reason: "That address is too long." };
  return { ok: true, path: path === `${site.pathname}${site.search}` ? undefined : path };
}

const appOrigin = () => (typeof window === "undefined" ? "" : window.location.origin);

function unframedReason(siteUrl: string) {
  try {
    const url = new URL(siteUrl);
    if (url.origin === appOrigin()) {
      return `${url.host} is this app's own address, and the app is never shown inside itself.`;
    }
  } catch {
    // An address that does not parse is described below like any other non-web address.
  }
  return "Only web addresses can be previewed.";
}

/**
 * A live view of the site at a chosen screen width, like a browser window: an address bar for
 * the page, then the page itself. The frame mounts only while this view is open, since every
 * load runs the site's own scripts and counts as a visit.
 */
export function SitePreview({
  site,
  path,
  device,
  pages,
  onPathChange,
  onDeviceChange,
}: {
  readonly site: Site;
  readonly path: string | undefined;
  readonly device: PreviewDevice;
  /** The site's most read pages, offered as quick destinations. */
  readonly pages?: readonly string[] | undefined;
  readonly onPathChange: (path: string | undefined) => void;
  readonly onDeviceChange: (device: PreviewDevice) => void;
}) {
  const frameUrl = siteFrameUrl(site.url, path, appOrigin());
  const framed = frameUrl !== null;
  const preset = PREVIEW_DEVICES[device];
  const host = siteHost(site.url);
  const shown = frameUrl ? siteHost(frameUrl) : host;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [reloads, setReloads] = useState(0);
  const [frameLoads, setFrameLoads] = useState({ key: "", count: 0 });
  const [slowFrame, setSlowFrame] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const frameKey = `${reloads}:${frameUrl}`;
  const loads = frameLoads.key === frameKey ? frameLoads.count : 0;
  const loaded = loads > 0;
  // A cross-origin frame's address can't be read, but each page it moves to fires another load.
  // Moves inside a single-page app fire none, so this catches links and redirects, not every move.
  const moved = loads > 1;
  const typed = path ?? sitePath(site.url);
  // Measured, not animated: the frame rescales only when the stage itself changes size.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resize observer that measures the preview stage width to scale the frame
  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!framed || !element) return;
    return observeResize(element, (entries) => {
      const width = entries.at(-1)?.contentRect.width ?? 0;
      if (width > 0) setStageWidth(width);
    });
  }, [framed]);
  // A refused or stuck frame never says so, so a long wait is the only signal there is.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer that flags the iframe as slow when it has not loaded in time
  useEffect(() => {
    if (!framed || loaded) return;
    const timer = window.setTimeout(() => setSlowFrame(frameKey), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [framed, frameKey, loaded]);
  const layout = previewStageLayout(stageWidth, preset);
  const slow = !loaded && slowFrame === frameKey;
  const reload = () => setReloads((count) => count + 1);
  const go = (next: string | undefined) => {
    setAddressError(null);
    if (next === path) reload();
    else onPathChange(next);
  };

  if (!frameUrl) {
    return (
      <LibraryEmpty
        icon={AppWindowIcon}
        title="This site can't be previewed here"
        action={
          <Button
            shape="pill"
            variant="outline"
            render={<a href={site.url} target="_blank" rel="noreferrer" />}
          >
            <ArrowUpRightIcon />
            Open in new tab
          </Button>
        }
      >
        {unframedReason(site.url)}
      </LibraryEmpty>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <section
        aria-label={`Live preview of ${host}`}
        className={cn(LIBRARY_OUTLINE, "flex min-w-0 flex-col overflow-hidden")}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <Button
            shape="pill"
            size="icon-sm"
            variant="ghost"
            aria-label={moved ? `Back to ${typed}` : "Reload preview"}
            onClick={reload}
          >
            <RotateCwIcon />
          </Button>
          <div className="min-w-48 flex-1">
            <PreviewAddress
              key={`${path ?? ""}:${moved}`}
              siteUrl={site.url}
              path={path}
              moved={moved}
              onGo={go}
              onInvalid={setAddressError}
            />
          </div>
          {pages?.length ? <PagesMenu siteUrl={site.url} pages={pages} onPick={go} /> : null}
          <ToggleGroup
            shape="pill"
            variant="segmented"
            aria-label="Preview width"
            value={[device]}
            onValueChange={(next) => {
              const value = next[0];
              if (isPreviewDevice(value)) onDeviceChange(value);
            }}
          >
            {DEVICE_ORDER.map((key) => {
              const option = PREVIEW_DEVICES[key];
              return (
                <ToggleGroupItem
                  key={key}
                  value={key}
                  aria-label={`${option.label}, ${option.width} pixels wide`}
                >
                  <option.icon />
                  <span className="hidden lg:inline">{option.label}</span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          <Button
            shape="pill"
            size="sm"
            variant="outline"
            render={<a href={frameUrl} target="_blank" rel="noreferrer" />}
          >
            <ArrowUpRightIcon />
            Open in new tab
          </Button>
        </div>
        {moved ? (
          <p
            role="status"
            className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
          >
            The preview moved to another page. Reload and Open in new tab still go to{" "}
            <span className="font-mono text-foreground/80">{typed}</span>.
          </p>
        ) : null}
        {addressError ? (
          <p
            role="alert"
            className="border-b border-border px-3 py-1.5 text-xs text-destructive-foreground"
          >
            {addressError}
          </p>
        ) : null}
        <div
          ref={stageRef}
          className="flex min-w-0 justify-center bg-muted/40 p-3 sm:p-4 dark:bg-accent/20"
        >
          <div
            className={cn(
              "relative shrink-0 overflow-hidden bg-background shadow-sm ring-1 ring-border",
              device === "desktop" ? "rounded-lg" : "rounded-3xl",
            )}
            style={{ width: layout.width, height: layout.height }}
          >
            {loaded ? null : (
              <div
                role="status"
                className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-4 text-center"
              >
                <SiteMark url={site.url} size="lg" />
                <p className="max-w-full truncate text-xs text-muted-foreground">
                  {slow ? `Still loading ${shown}` : `Loading ${shown}`}
                </p>
                {slow ? (
                  <Button
                    shape="pill"
                    size="xs"
                    variant="outline"
                    render={<a href={frameUrl} target="_blank" rel="noreferrer" />}
                  >
                    <ArrowUpRightIcon />
                    Open in new tab
                  </Button>
                ) : null}
              </div>
            )}
            {/* Keyed by address as well as reloads, so a new page is a new frame rather than a
                navigation inside the old one, which would add entries to the app's own history. */}
            <iframe
              key={frameKey}
              src={frameUrl}
              title={`Live preview of ${shown}`}
              sandbox={SITE_PREVIEW_SANDBOX}
              referrerPolicy="no-referrer"
              onLoad={() =>
                setFrameLoads((current) => ({
                  key: frameKey,
                  count: current.key === frameKey ? current.count + 1 : 1,
                }))
              }
              className={cn(
                "absolute top-0 left-0 block border-0 transition-opacity duration-150 motion-reduce:transition-none",
                loaded ? "opacity-100" : "opacity-0",
              )}
              style={{
                width: preset.width,
                height: preset.height,
                transform: `scale(${layout.scale})`,
                transformOrigin: "0 0",
              }}
            />
          </div>
        </div>
      </section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <p className="min-w-0 flex-1 basis-80">
          Some sites refuse to be shown inside other apps. If the stage stays blank, use Open in new
          tab. Each load here counts as a visit in this site's traffic.
        </p>
        <p className="tabular-nums">
          {preset.width} × {preset.height}
          {layout.scale < 1 ? `, shown at ${Math.round(layout.scale * 100)}%` : ""}
        </p>
      </div>
    </div>
  );
}

const originHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The address bar: the site's host stays fixed, so only the page on it can change. */
function PreviewAddress({
  siteUrl,
  path,
  moved,
  onGo,
  onInvalid,
}: {
  readonly siteUrl: string;
  readonly path: string | undefined;
  /** The frame has left `path`, for a page this bar cannot read, so it shows none. */
  readonly moved: boolean;
  readonly onGo: (path: string | undefined) => void;
  readonly onInvalid: (reason: string | null) => void;
}) {
  const host = originHost(siteUrl);
  const current = moved ? "" : (path ?? sitePath(siteUrl));
  const [draft, setDraft] = useState(current);
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const result = normalizePreviewPath(draft, siteUrl);
        setInvalid(!result.ok);
        if (result.ok) onGo(result.path);
        else onInvalid(result.reason);
      }}
    >
      <InputGroup shape="pill">
        <InputGroupAddon>
          <span className="max-w-40 truncate font-mono text-xs text-muted-foreground">{host}</span>
        </InputGroupAddon>
        <InputGroupInput
          value={draft}
          size="sm"
          font="mono"
          spellCheck={false}
          autoComplete="off"
          aria-label={`Page on ${host} to preview`}
          aria-invalid={invalid || undefined}
          placeholder={moved ? "Page changed inside the preview" : "/"}
          onChange={(event) => {
            setDraft(event.target.value);
            if (invalid) {
              setInvalid(false);
              onInvalid(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || draft === current) return;
            event.preventDefault();
            setDraft(current);
            setInvalid(false);
            onInvalid(null);
          }}
        />
      </InputGroup>
    </form>
  );
}

function PagesMenu({
  siteUrl,
  pages,
  onPick,
}: {
  readonly siteUrl: string;
  readonly pages: readonly string[];
  readonly onPick: (path: string | undefined) => void;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="ghost" />}>
        <ListIcon />
        Pages
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        <MenuGroup>
          <MenuGroupLabel>Most read</MenuGroupLabel>
          {pages.slice(0, MAX_MENU_PAGES).map((page) => (
            <MenuItem
              key={page}
              onClick={() => {
                const result = normalizePreviewPath(page, siteUrl);
                onPick(result.ok ? result.path : undefined);
              }}
            >
              <span className="max-w-72 truncate font-mono text-xs">{page}</span>
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
