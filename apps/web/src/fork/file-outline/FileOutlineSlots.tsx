import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ListTreeIcon } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { FileSurfaceAction } from "~/components/files/fileSurfaceChrome";
import { Spinner } from "~/components/ui/spinner";
import { useRightPanelStore } from "~/rightPanelStore";
import { FileOutlineList } from "./FileOutlineList";
import { outlineLanguageForPath, type OutlineResult } from "./outline";
import { outlineFor } from "./outlineCache";
import { useFileOutlineStore } from "./store";
import "./file-outline.css";

interface OutlineSlotProps {
  readonly threadRef: ScopedThreadRef;
  readonly relativePath: string | null;
  readonly contents: string | null;
  readonly truncated: boolean;
}

export function LoomFileOutlineToggle(props: OutlineSlotProps) {
  const open = useFileOutlineStore((state) => state.open);
  const threadKey = scopedThreadKey(props.threadRef);
  const supported =
    props.relativePath !== null && outlineLanguageForPath(props.relativePath) !== null;
  useEffect(() => {
    const path = props.relativePath;
    if (!supported || path === null || props.contents === null) {
      if (path !== null) useFileOutlineStore.getState().unpublish(threadKey, path);
      return;
    }
    useFileOutlineStore.getState().publish(threadKey, {
      threadRef: props.threadRef,
      path,
      contents: props.contents,
      truncated: props.truncated,
    });
  }, [props.contents, props.relativePath, props.threadRef, props.truncated, supported, threadKey]);
  useEffect(() => {
    const path = props.relativePath;
    return () => {
      if (path !== null) useFileOutlineStore.getState().unpublish(threadKey, path);
    };
  }, [props.relativePath, threadKey]);
  if (!supported) return null;
  return (
    <FileSurfaceAction
      label={open ? "Hide outline" : "Show outline"}
      pressed={open}
      onPress={() => useFileOutlineStore.getState().toggle()}
    >
      <ListTreeIcon className="size-3.5" />
    </FileSurfaceAction>
  );
}

function OutlineContent(
  props: OutlineSlotProps & {
    readonly relativePath: string;
    readonly revealLine: number | null;
    readonly revealRequestId: number;
    readonly error: string | null;
  },
) {
  const deferred = useDeferredValue(props.contents);
  const [parsed, setParsed] = useState<{ path: string; result: OutlineResult | null } | null>(null);
  const focusRequestId = useFileOutlineStore((state) => state.focusRequestId);
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (deferred === null) return;
    const timer = window.setTimeout(() => {
      setParsed({ path: props.relativePath, result: outlineFor(props.relativePath, deferred) });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [deferred, props.relativePath]);
  const result =
    props.contents !== null && parsed?.path === props.relativePath ? parsed.result : null;
  const returnToFile = () => {
    const file = asideRef.current?.previousElementSibling;
    if (!(file instanceof HTMLElement)) return;
    const editor = file.querySelector("diffs-container")?.shadowRoot;
    const target =
      editor?.querySelector<HTMLElement>("textarea, [contenteditable=true], [tabindex]") ??
      file.querySelector<HTMLElement>("textarea, [contenteditable=true], [tabindex]");
    if (target) target.focus();
    else {
      file.tabIndex = -1;
      file.focus();
    }
  };
  return (
    <aside
      ref={asideRef}
      data-loom-file-outline
      aria-label="File outline"
      className="flex min-h-0 min-w-0 shrink-0 flex-col border-l border-border/60 bg-background"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="font-medium">Outline</span>
        {result ? (
          <span className="text-2xs tabular-nums text-muted-foreground">
            {result.symbols.length}
          </span>
        ) : null}
      </div>
      {props.truncated ? (
        <p className="px-3 pb-2 text-2xs text-muted-foreground">Outline covers the first 1 MB.</p>
      ) : null}
      {result?.capped ? (
        <p className="px-3 pb-2 text-2xs text-muted-foreground">Showing the first 2,000 symbols.</p>
      ) : null}
      {props.error && props.contents === null ? (
        <p role="status" className="px-3 text-xs text-muted-foreground">
          Outline unavailable until the file can be loaded.
        </p>
      ) : result ? (
        <FileOutlineList
          key={props.relativePath}
          result={result}
          revealLine={props.revealLine}
          revealRequestId={props.revealRequestId}
          focusRequestId={focusRequestId}
          onJump={(symbol) =>
            useRightPanelStore.getState().openFile(props.threadRef, props.relativePath, symbol.line)
          }
          onReturnToFile={returnToFile}
        />
      ) : (
        <div
          role="status"
          aria-label="Loading outline"
          className="flex items-center justify-center p-4"
        >
          <Spinner size="sm" />
        </div>
      )}
    </aside>
  );
}

export function LoomFileOutlineColumn(
  props: OutlineSlotProps & {
    readonly revealLine: number | null;
    readonly revealRequestId: number;
    readonly error: string | null;
  },
) {
  const open = useFileOutlineStore((state) => state.open);
  if (!open || props.relativePath === null || outlineLanguageForPath(props.relativePath) === null)
    return null;
  return <OutlineContent {...props} relativePath={props.relativePath} />;
}
