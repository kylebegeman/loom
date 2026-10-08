import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { MinusIcon, PlusIcon, ScanIcon, ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { svgFrame } from "./geometry";
import { ToolButton } from "./ToolButton";
import styles from "./workspace.module.css";

export type ViewTransform = { x: number; y: number; scale: number };
export function zoomAround(
  view: ViewTransform,
  factor: number,
  x: number,
  y: number,
): ViewTransform {
  const scale = Math.min(32, Math.max(0.01, view.scale * factor));
  return {
    scale,
    x: x - ((x - view.x) * scale) / view.scale,
    y: y - ((y - view.y) * scale) / view.scale,
  };
}
export function fitDrawing(
  width: number,
  height: number,
  drawingWidth: number,
  drawingHeight: number,
): ViewTransform {
  const scale = Math.max(
    0.01,
    Math.min(
      32,
      (width - 48) / Math.max(1, drawingWidth),
      (height - 48) / Math.max(1, drawingHeight),
    ),
  );
  return { scale, x: (width - drawingWidth * scale) / 2, y: (height - drawingHeight * scale) / 2 };
}

export type PcbViewportHandle = {
  isReady: () => boolean;
  snapshot: () => ViewTransform;
  restore: (view: ViewTransform) => void;
  focus: (point: { x: number; y: number }) => void;
  fit: () => void;
  zoom: (factor: number) => void;
  pan: (point: { x: number; y: number }) => void;
  back: () => void;
  forward: () => void;
  capture: (full: boolean) => Promise<Blob>;
};
export function SvgViewport({
  svg,
  label,
  busy = false,
  kind = "pcb",
  children,
  layered = false,
  handle,
  onPick,
  overlays,
  onCamera,
  onReady,
  extra,
}: {
  svg: string;
  label: string;
  busy?: boolean;
  kind?: "pcb" | "schematic";
  children?: React.ReactNode;
  layered?: boolean;
  handle?: React.RefObject<PcbViewportHandle | null>;
  onPick?: ((point: { x: number; y: number }, snap: boolean) => void) | undefined;
  overlays?: React.ReactNode;
  onCamera?: (camera: ViewTransform) => void;
  onReady?: () => void;
  /** Extra controls appended to the floating navigation shelf. */
  extra?: React.ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null),
    imageLoaded = useRef(false),
    scene = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null),
    [loadError, setLoadError] = useState(false),
    [zoom, setZoom] = useState(100),
    [extent, setExtent] = useState({ width: 1, height: 1 });
  const view = useRef<ViewTransform>({ x: 0, y: 0, scale: 1 }),
    size = useRef({ width: 1, height: 1 }),
    drawing = useRef({ width: 1, height: 1 }),
    frame = useRef<number | null>(null),
    fitted = useRef(true),
    pendingFocus = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const history = useRef<ViewTransform[]>([]),
    position = useRef(-1),
    [nav, setNav] = useState({ back: false, forward: false });
  const remember = useCallback(() => {
    const v = { ...view.current };
    const last = history.current[position.current];
    if (
      last &&
      Math.abs(last.x - v.x) + Math.abs(last.y - v.y) + Math.abs(last.scale - v.scale) < 0.001
    )
      return;
    history.current = [...history.current.slice(0, position.current + 1), v].slice(-40);
    position.current = history.current.length - 1;
    setNav({ back: position.current > 0, forward: false });
    onCamera?.(v);
  }, [onCamera]);
  const paint = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (scene.current)
        scene.current.style.transform = `translate(${view.current.x}px, ${view.current.y}px) scale(${view.current.scale})`;
      setZoom(Math.round(view.current.scale * 100));
    });
  }, []);
  const fit = useCallback(() => {
    fitted.current = true;
    view.current = fitDrawing(
      size.current.width,
      size.current.height,
      drawing.current.width,
      drawing.current.height,
    );
    paint();
    remember();
  }, [paint, remember]);
  const restore = useCallback(
    (next: ViewTransform) => {
      if (!Object.values(next).every(Number.isFinite) || next.scale <= 0) return;
      view.current = { ...next };
      fitted.current = false;
      paint();
      remember();
    },
    [paint, remember],
  );
  const zoomBy = useCallback(
    (factor: number, x = size.current.width / 2, y = size.current.height / 2) => {
      fitted.current = false;
      view.current = zoomAround(view.current, factor, x, y);
      paint();
    },
    [paint],
  );
  const physical = useMemo(() => svgFrame(svg), [svg]);
  const focus = useCallback(
    (point: { x: number; y: number }) => {
      if (!physical) return;
      // Linked selection can arrive before the new sheet image has decoded.
      // Keep automatic fit until real dimensions are available.
      if (!imageLoaded.current) {
        pendingFocus.current = point;
        return;
      }
      pendingFocus.current = null;
      const px = ((point.x - physical.x) * drawing.current.width) / physical.width,
        py = ((point.y - physical.y) * drawing.current.height) / physical.height;
      restore({
        scale: view.current.scale,
        x: size.current.width / 2 - px * view.current.scale,
        y: size.current.height / 2 - py * view.current.scale,
      });
    },
    [physical, restore],
  );
  useEffect(() => {
    imageLoaded.current = false;
    const next = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    // Publish the newly allocated Blob URL; cleanup releases the external image resource.
    // eslint-disable-next-line react/set-state-in-effect
    setUrl(next);
    setLoadError(false);
    return () => URL.revokeObjectURL(next);
  }, [svg]);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      size.current = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (fitted.current) fit();
    });
    resize.observe(node);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoomBy(
        Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.025 : 0.002)),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(remember, 180);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      node.removeEventListener("wheel", wheel);
      clearTimeout(wheelTimer);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [fit, zoomBy, remember]);
  const navigate = useCallback(
    (delta: number) => {
      const target = position.current + delta;
      if (!history.current[target]) return;
      position.current = target;
      view.current = { ...history.current[target]! };
      fitted.current = false;
      paint();
      setNav({ back: target > 0, forward: target < history.current.length - 1 });
      onCamera?.(view.current);
    },
    [paint, onCamera],
  );
  const visibleLayersReady = () =>
    Array.from(
      scene.current?.querySelectorAll<HTMLImageElement>("img[data-layer-image]") ?? [],
    ).every(
      (img) =>
        Number(getComputedStyle(img).opacity) === 0 ||
        (img.dataset.layerLoading !== "true" && img.complete && img.naturalWidth > 0),
    );
  useImperativeHandle(
    handle,
    () => ({
      isReady: () => imageLoaded.current && !loadError && visibleLayersReady(),
      snapshot: () => ({ ...view.current }),
      restore,
      fit,
      zoom: (factor) => {
        zoomBy(factor);
        remember();
      },
      pan: (point) =>
        restore({ ...view.current, x: view.current.x + point.x, y: view.current.y + point.y }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      focus,
      capture: async (full) => {
        if (!imageLoaded.current || loadError)
          throw new Error("Wait for the drawing to load before capturing.");
        if (!visibleLayersReady())
          throw new Error("Wait for the visible layers to load before capturing.");
        const canvas = document.createElement("canvas"),
          context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas capture is unavailable.");
        const area = full ? drawing.current : size.current,
          factor = Math.min(2, 2400 / Math.max(area.width, area.height));
        canvas.width = Math.ceil(area.width * factor);
        canvas.height = Math.ceil(area.height * factor);
        context.scale(factor, factor);
        context.fillStyle = getComputedStyle(nodeOrBody(container.current)).backgroundColor;
        context.fillRect(0, 0, area.width, area.height);
        if (!full) {
          context.translate(view.current.x, view.current.y);
          context.scale(view.current.scale, view.current.scale);
        }
        for (const img of scene.current?.querySelectorAll<HTMLImageElement>("img") ?? []) {
          const opacity = Number(getComputedStyle(img).opacity);
          if (opacity === 0) continue;
          if (!img.complete || !img.naturalWidth)
            throw new Error("Wait for every visible layer to load before capturing.");
          context.globalAlpha = opacity;
          context.filter = getComputedStyle(img).filter;
          context.drawImage(img, 0, 0, drawing.current.width, drawing.current.height);
        }
        context.globalAlpha = 1;
        context.filter = "none";
        const overlay = scene.current?.querySelector("svg[data-overlays]");
        if (overlay) {
          const objectUrl = URL.createObjectURL(
            new Blob([serializeOverlay(overlay)], { type: "image/svg+xml" }),
          );
          try {
            const img = new Image();
            img.src = objectUrl;
            await img.decode();
            context.drawImage(img, 0, 0, drawing.current.width, drawing.current.height);
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        }
        return new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Could not capture drawing."))),
            "image/png",
          ),
        );
      },
    }),
    [navigate, restore, fit, focus, zoomBy, remember, loadError],
  );
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (drag && !drag.moved && onPick && physical) {
      const rect = event.currentTarget.getBoundingClientRect();
      onPick(
        {
          x:
            physical.x +
            (((event.clientX - rect.left - view.current.x) / view.current.scale) * physical.width) /
              drawing.current.width,
          y:
            physical.y +
            (((event.clientY - rect.top - view.current.y) / view.current.scale) * physical.height) /
              drawing.current.height,
        },
        !event.altKey,
      );
    }
    dragging.current = null;
    event.currentTarget.dataset.dragging = "false";
    remember();
  };
  return (
    <div
      ref={container}
      className={styles.viewport}
      tabIndex={0}
      data-kind={kind}
      data-loom-canvas
      role="group"
      aria-label={`${label}. Drag to pan, scroll to zoom, F to fit.`}
      aria-busy={busy}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) fit();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button,input,select"))
          return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        };
        event.currentTarget.dataset.dragging = "true";
      }}
      onPointerMove={(event) => {
        const drag = dragging.current;
        if (!drag || drag.id !== event.pointerId) return;
        const moved =
          drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
        if (moved) {
          fitted.current = false;
          view.current = {
            ...view.current,
            x: view.current.x + event.clientX - drag.x,
            y: view.current.y + event.clientY - drag.y,
          };
          paint();
        }
        dragging.current = { ...drag, x: event.clientX, y: event.clientY, moved };
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        dragging.current = null;
      }}
      onLostPointerCapture={() => {
        dragging.current = null;
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey)
          return;
        if (event.key === "+" || event.key === "=") zoomBy(1.25);
        else if (event.key === "-") zoomBy(0.8);
        else if (event.key.toLowerCase() === "f" || event.key === "0") fit();
        else if (event.key.startsWith("Arrow")) {
          const delta = event.shiftKey ? 100 : 30;
          fitted.current = false;
          view.current = {
            ...view.current,
            x:
              view.current.x +
              (event.key === "ArrowLeft" ? delta : event.key === "ArrowRight" ? -delta : 0),
            y:
              view.current.y +
              (event.key === "ArrowUp" ? delta : event.key === "ArrowDown" ? -delta : 0),
          };
          paint();
        } else return;
        remember();
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        ref={scene}
        className={styles.drawingScene}
        style={{ width: extent.width, height: extent.height }}
      >
        {url && (
          <img
            ref={image}
            alt={label}
            src={url}
            draggable={false}
            className={styles.drawing}
            style={{ opacity: layered ? 0 : 1 }}
            onLoad={(e) => {
              imageLoaded.current = true;
              drawing.current = {
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              };
              setExtent(drawing.current);
              if (fitted.current) fit();
              else paint();
              if (pendingFocus.current) focus(pendingFocus.current);
              onReady?.();
            }}
            onError={() => setLoadError(true)}
          />
        )}
        {children}
        {physical && (
          <svg
            data-overlays
            xmlns="http://www.w3.org/2000/svg"
            className={styles.overlays}
            width={extent.width}
            height={extent.height}
            viewBox={`${physical.x} ${physical.y} ${physical.width} ${physical.height}`}
          >
            {overlays}
          </svg>
        )}
      </div>
      {layered && (
        <div className={styles.layerLoading} role="status">
          Loading visible layers
        </div>
      )}
      {loadError && (
        <p className={styles.canvasError} role="alert">
          The drawing could not be displayed. Refresh the preview.
        </p>
      )}
      <div
        className={`${styles.shelf} ${styles.navShelf}`}
        role="toolbar"
        aria-label="Drawing navigation"
      >
        <ToolButton
          label="Back"
          hint="Previous position"
          disabled={!nav.back}
          onClick={() => navigate(-1)}
        >
          <ArrowLeftIcon />
        </ToolButton>
        <ToolButton
          label="Forward"
          hint="Next position"
          disabled={!nav.forward}
          onClick={() => navigate(1)}
        >
          <ArrowRightIcon />
        </ToolButton>
        <span className={styles.divider} />
        <ToolButton
          onClick={() => {
            zoomBy(0.8);
            remember();
          }}
          label="Zoom out"
          hint="Zoom out (-)"
        >
          <MinusIcon />
        </ToolButton>
        <span className={styles.zoomReadout} aria-label={`Zoom ${zoom} percent`}>
          {zoom}%
        </span>
        <ToolButton
          onClick={() => {
            zoomBy(1.25);
            remember();
          }}
          label="Zoom in"
          hint="Zoom in (+)"
        >
          <PlusIcon />
        </ToolButton>
        <ToolButton onClick={fit} label="Fit drawing" hint="Fit drawing (F)">
          <ScanIcon />
        </ToolButton>
        {extra && (
          <>
            <span className={styles.divider} />
            {extra}
          </>
        )}
      </div>
    </div>
  );
}
const nodeOrBody = (node: HTMLElement | null) => node ?? document.body;

function serializeOverlay(overlay: Element) {
  const clone = overlay.cloneNode(true) as Element;
  const source = [overlay, ...overlay.querySelectorAll("*")];
  const target = [clone, ...clone.querySelectorAll("*")];
  for (let i = 0; i < source.length; i++) {
    const computed = getComputedStyle(source[i]!);
    for (const attr of ["stroke", "fill"])
      if (source[i]!.hasAttribute(attr))
        target[i]!.setAttribute(attr, computed.getPropertyValue(attr));
  }
  return new XMLSerializer().serializeToString(clone);
}
