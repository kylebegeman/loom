import { ChevronDown, ChevronRight } from "lucide-react";
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { cn } from "~/lib/utils";
import { recordPanelPick, usePanelPickerPreferences } from "./preferences";
import { panelActionDescription, rankPanelActions } from "./rank";
import type { PanelPickerAction, PanelPickerBrowserProfiles } from "./types";

const BROWSER_LABEL = "Browser";

interface Row {
  readonly key: string;
  readonly action: PanelPickerAction;
  /** Browser profile rows sit under the Browser row and are not recorded as recents. */
  readonly profile: boolean;
}

const profileRows = (browser: PanelPickerAction, profiles: PanelPickerBrowserProfiles): Row[] =>
  profiles.profiles.map((profile) => ({
    key: `browser-profile:${profile.id}`,
    profile: true,
    action: {
      label: `${BROWSER_LABEL}: ${profile.name}`,
      icon: browser.icon,
      shortcut: "",
      available: true,
      disabledReason: "",
      onClick: () => profiles.onOpenInProfile(profile.id),
    },
  }));

/**
 * Search plus a grouped list of surface actions: recent, available, then unavailable with
 * their reason. Every row calls the action's own `onClick`, so surfaces open exactly as
 * upstream opens them.
 */
export function PanelPickerList({
  inputRef,
  ...props
}: {
  readonly actions: ReadonlyArray<PanelPickerAction>;
  readonly browser?: PanelPickerBrowserProfiles | undefined;
  /** The launcher highlights nothing until hover or arrows; the popover starts on row one. */
  readonly mode: "launcher" | "popover";
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
  readonly onPicked?: (() => void) | undefined;
  readonly heading?: ReactNode;
}) {
  const listId = useId();
  const { recents } = usePanelPickerPreferences();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(props.mode === "popover" ? 0 : -1);
  const [browserExpanded, setBrowserExpanded] = useState(false);

  const browser = props.actions.find((action) => action.label === BROWSER_LABEL);
  const hasProfiles =
    browser !== undefined && browser.available && (props.browser?.profiles.length ?? 0) > 1;

  const groups = useMemo(() => {
    const searching = query.trim() !== "";
    const profiles =
      hasProfiles && browser && props.browser ? profileRows(browser, props.browser) : [];
    const toRows = (actions: ReadonlyArray<PanelPickerAction>) =>
      actions.flatMap((action): Row[] => {
        const row = { key: action.label, action, profile: false };
        return action === browser && browserExpanded && !searching ? [row, ...profiles] : [row];
      });
    // While searching, profile rows rank on their own ("browser work").
    const searchable = searching
      ? [...props.actions, ...profiles.map((row) => row.action)]
      : props.actions;
    const ranked = rankPanelActions(searchable, query, recents);
    const profileOf = (action: PanelPickerAction) => profiles.find((row) => row.action === action);
    const rowsFor = (actions: ReadonlyArray<PanelPickerAction>) =>
      searching
        ? actions.map(
            (action): Row => profileOf(action) ?? { key: action.label, action, profile: false },
          )
        : toRows(actions);
    return [
      { label: "Recent", rows: rowsFor(ranked.recent) },
      { label: "Panels", rows: rowsFor(ranked.panels) },
      { label: "Unavailable", rows: rowsFor(ranked.unavailable) },
    ].filter((group) => group.rows.length > 0);
  }, [browser, browserExpanded, hasProfiles, props.actions, props.browser, query, recents]);

  const selectable = groups.flatMap((group) => group.rows).filter((row) => row.action.available);
  const highlightIndex = selectable.length === 0 ? -1 : Math.min(highlight, selectable.length - 1);
  const highlighted = selectable[highlightIndex];

  // The launcher focuses its list, not the search field, so upstream's surface letters
  // (a window listener that skips typing contexts) keep opening surfaces directly.
  const focusOnMount = useCallback(
    (node: HTMLDivElement | null) => {
      if (props.mode === "launcher") node?.focus();
    },
    [props.mode],
  );

  const pick = (row: Row) => {
    if (!row.profile) recordPanelPick(row.action.label);
    row.action.onClick();
    props.onPicked?.();
  };

  const changeQuery = (next: string) => {
    setQuery(next);
    setHighlight(next.trim() === "" && props.mode === "launcher" ? -1 : 0);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const inInput = event.target instanceof HTMLInputElement;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (selectable.length === 0) return;
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const from = highlightIndex === -1 && step === -1 ? 0 : highlightIndex;
        setHighlight((from + step + selectable.length) % selectable.length);
        return;
      }
      case "ArrowRight":
      case "ArrowLeft": {
        // Only with an empty search, where the caret has nowhere to move.
        if (!hasProfiles || query !== "" || highlighted?.action !== browser) return;
        event.preventDefault();
        setBrowserExpanded(event.key === "ArrowRight");
        return;
      }
      case "Enter": {
        if (!highlighted) return;
        event.preventDefault();
        pick(highlighted);
        return;
      }
      case "Escape": {
        if (query === "") return;
        // Clear first; the next Escape closes the popover.
        event.preventDefault();
        event.stopPropagation();
        changeQuery("");
        return;
      }
    }
    // Launcher focus sits on the list so upstream's surface letters keep working; any other
    // printable key starts a search.
    if (inInput || event.key.length !== 1) return;
    const input = event.currentTarget.querySelector("input");
    if (!input) return;
    event.preventDefault();
    input.focus();
    if (event.key !== "/") changeQuery(query + event.key);
  };

  return (
    <div
      ref={focusOnMount}
      tabIndex={props.mode === "launcher" ? 0 : undefined}
      aria-label={props.mode === "launcher" ? "Open a panel" : undefined}
      className="flex min-h-0 flex-col gap-2 outline-none"
      onKeyDown={handleKeyDown}
    >
      {props.heading}
      <div className="relative">
        <Input
          nativeInput
          ref={inputRef}
          type="search"
          size="sm"
          role="combobox"
          aria-label="Search panels"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={highlighted ? `${listId}-${highlighted.key}` : undefined}
          placeholder="Search panels"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
        />
        {props.mode === "launcher" && query === "" ? (
          <span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        ) : null}
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label="Panels"
        className={cn(
          "flex min-h-0 flex-col gap-2 overflow-y-auto",
          props.mode === "popover" && "max-h-80",
        )}
      >
        {groups.length === 0 ? (
          <p className="px-2.5 py-2 text-muted-foreground text-sm">
            No panels match <span className="font-medium text-foreground">{query.trim()}</span>.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="flex flex-col">
              <div className="px-2.5 pb-1 font-medium text-muted-foreground text-xs">
                {group.label}
              </div>
              {group.rows.map((row) => {
                const active = row === highlighted;
                const description = row.action.available
                  ? panelActionDescription(row.action)
                  : row.action.disabledReason;
                const Icon = row.action.icon;
                const expandable = hasProfiles && row.action === browser && query.trim() === "";
                return (
                  <div
                    key={`${group.label}:${row.key}`}
                    id={`${listId}-${row.key}`}
                    role="option"
                    aria-selected={active}
                    aria-disabled={!row.action.available || undefined}
                    onMouseEnter={() => {
                      if (row.action.available) setHighlight(selectable.indexOf(row));
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (row.action.available) pick(row);
                    }}
                    className={cn(
                      "flex min-h-8 items-center gap-2.5 rounded-(--control-radius) px-2.5 py-1 text-left text-sm",
                      row.profile && "ps-8",
                      row.action.available ? "cursor-pointer" : "cursor-default opacity-50",
                      active && "bg-accent/60",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{row.action.label}</span>
                      {description ? (
                        <span className="truncate text-muted-foreground text-xs">
                          {description}
                        </span>
                      ) : null}
                    </span>
                    {expandable ? (
                      <Button
                        aria-label={
                          browserExpanded ? "Hide browser profiles" : "Show browser profiles"
                        }
                        aria-expanded={browserExpanded}
                        size="icon-xs"
                        variant="ghost-muted"
                        onClick={(event) => {
                          event.stopPropagation();
                          setBrowserExpanded((expanded) => !expanded);
                        }}
                      >
                        {browserExpanded ? <ChevronDown /> : <ChevronRight />}
                      </Button>
                    ) : null}
                    {row.action.shortcut ? <Kbd>{row.action.shortcut}</Kbd> : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
