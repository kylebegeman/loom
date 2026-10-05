import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { BracesIcon, CodeIcon, HashIcon, HeadingIcon, LayersIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { filterOutline, moveOutlineSelection, nearestOutlineSymbol } from "./filter";
import type { OutlineResult, OutlineSymbol } from "./outline";

export function OutlineSymbolIcon({ kind }: { readonly kind: OutlineSymbol["kind"] }) {
  const Icon =
    kind === "heading"
      ? HeadingIcon
      : kind === "function" || kind === "method"
        ? CodeIcon
        : kind === "constant" || kind === "variable"
          ? HashIcon
          : kind === "module"
            ? LayersIcon
            : BracesIcon;
  return <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />;
}

export function FileOutlineList(props: {
  readonly result: OutlineResult;
  readonly revealLine: number | null;
  readonly revealRequestId: number;
  readonly focusRequestId: number;
  readonly onJump: (symbol: OutlineSymbol) => void;
  readonly onReturnToFile: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<{ id: string | null; request: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<LegendListRef | null>(null);
  const id = useId();
  const rows = useMemo(
    () => filterOutline(props.result.symbols, filter),
    [filter, props.result.symbols],
  );
  const current = nearestOutlineSymbol(props.result.symbols, props.revealLine);
  const selectedId =
    selection?.request === props.revealRequestId ? selection.id : (current?.id ?? null);
  const setSelectedId = (id: string | null) => setSelection({ id, request: props.revealRequestId });
  const selectedIndex = Math.max(
    0,
    rows.findIndex(({ symbol }) => symbol.id === selectedId),
  );
  const selected = rows[selectedIndex]?.symbol;
  const rowId = (index: number) => id + "-symbol-" + index;

  useEffect(() => {
    if (props.focusRequestId > 0) inputRef.current?.focus();
  }, [props.focusRequestId]);
  const selectedSymbolId = selected?.id;
  useEffect(() => {
    if (selectedSymbolId === undefined) return;
    const row = document.getElementById(id + "-symbol-" + selectedIndex);
    if (row) row.scrollIntoView({ block: "nearest" });
    else void listRef.current?.scrollIndexIntoView({ index: selectedIndex, animated: false });
  }, [id, selectedSymbolId, selectedIndex]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      if ((event.key === "Home" || event.key === "End") && event.target === inputRef.current)
        return;
      const index = moveOutlineSelection(selectedIndex, rows.length, event.key);
      setSelectedId(rows[index]?.symbol.id ?? null);
    } else if (event.key === "Enter") {
      if (selected) props.onJump(selected);
    } else if (event.key === "Escape") {
      if (filter) setFilter("");
      else props.onReturnToFile();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const renderRow = (index: number) => {
    const row = rows[index]!;
    const { symbol } = row;
    return (
      <Tooltip key={symbol.id}>
        <TooltipTrigger
          render={
            <button
              id={rowId(index)}
              type="button"
              role="option"
              aria-selected={symbol.id === selected?.id}
              aria-current={symbol.id === current?.id ? "location" : undefined}
              aria-posinset={index + 1}
              aria-setsize={rows.length}
              tabIndex={index === selectedIndex ? 0 : -1}
              aria-label={
                symbol.name + (symbol.detail ? " " + symbol.detail : "") + ", line " + symbol.line
              }
              className={cn(
                "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-sm pe-2 text-start text-xs hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                symbol.id === selected?.id && "bg-muted",
                !row.matched && "text-muted-foreground",
              )}
              style={{ paddingInlineStart: 8 + symbol.depth * 12 }}
              onFocus={() => setSelectedId(symbol.id)}
              onClick={() => {
                setSelectedId(symbol.id);
                props.onJump(symbol);
              }}
            >
              <OutlineSymbolIcon kind={symbol.kind} />
              <span className="truncate">{symbol.name}</span>
              {symbol.detail ? (
                <span className="truncate text-2xs text-muted-foreground">{symbol.detail}</span>
              ) : null}
              <span className="ms-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
                {symbol.line}
              </span>
            </button>
          }
        />
        <TooltipPopup>
          {symbol.name}
          {symbol.detail ? " " + symbol.detail : ""}, line {symbol.line}
        </TooltipPopup>
      </Tooltip>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="shrink-0 px-2 pb-2">
        <Input
          ref={inputRef}
          size="compact"
          placeholder="Filter symbols"
          aria-label="Filter symbols"
          role="combobox"
          aria-expanded
          aria-autocomplete="list"
          aria-controls={id}
          aria-activedescendant={selected ? rowId(selectedIndex) : undefined}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setSelectedId(null);
          }}
        />
      </div>
      {rows.length === 0 ? (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          {filter ? 'No symbols match "' + filter + '".' : "No symbols found in this file."}
        </p>
      ) : (
        <div
          id={id}
          role="listbox"
          aria-label="File symbols"
          className="flex min-h-0 flex-1 flex-col"
        >
          {rows.length > 300 ? (
            <LegendList
              ref={listRef}
              data={rows}
              recycleItems={false}
              keyExtractor={(row) => row.symbol.id}
              extraData={selected?.id}
              renderItem={({ index }) => renderRow(index)}
              estimatedItemSize={28}
              drawDistance={280}
              className="min-h-0 flex-1 overflow-x-hidden overscroll-y-contain"
            />
          ) : (
            <ScrollArea radius="none" viewportTabIndex={-1}>
              <div className="px-1 pb-2">{rows.map((_, index) => renderRow(index))}</div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
