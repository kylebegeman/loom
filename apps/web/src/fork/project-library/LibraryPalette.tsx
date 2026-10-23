import { useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ArrowLeftIcon, ChevronRightIcon, CircleIcon, CheckIcon } from "lucide-react";
import { CommandPaletteContent } from "~/components/CommandPaletteContent";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { CommandPaletteResults } from "~/components/CommandPaletteResults";
import type { CommandPaletteActionItem } from "~/components/CommandPalette.logic";
import { CommandDialog, CommandDialogPopup } from "~/components/ui/command";

export interface LibraryPaletteItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly terms?: readonly string[] | undefined;
  readonly icon?: ReactNode;
  readonly next?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly select: () => void;
}

export function LibraryPaletteDialog({
  children,
  onClose,
  title,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly title: string;
}) {
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CommandDialogPopup
        aria-label={title}
        data-command-palette="true"
        onBackdropPointerDown={onClose}
      >
        {children}
      </CommandDialogPopup>
    </CommandDialog>
  );
}

/** Uses the original palette's input, results, keyboard behavior and footer on every setup page. */
export function LibraryPaletteView({
  title,
  placeholder,
  query,
  onQueryChange,
  items,
  onBack,
  onClose,
  busy = false,
  readOnly = false,
  filter = true,
  message,
  error,
  children,
  footerHints,
}: {
  readonly footerHints?: ReactNode;
  readonly title: string;
  readonly placeholder: string;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly items: readonly LibraryPaletteItem[];
  readonly onBack?: (() => void) | undefined;
  readonly onClose: () => void;
  readonly busy?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly filter?: boolean | undefined;
  readonly message?: string | null | undefined;
  readonly error?: string | null | undefined;
  readonly children?: ReactNode;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const term = query.trim().toLocaleLowerCase();
  const visible = items.filter(
    (item) =>
      !filter ||
      [item.title, item.description ?? "", ...(item.terms ?? [])].some((value) =>
        value.toLocaleLowerCase().includes(term),
      ),
  );
  const enabled = visible.filter((item) => !item.disabled && !busy);
  const selected = enabled.find((item) => item.id === highlighted) ?? enabled[0];
  const actions: CommandPaletteActionItem[] = visible.map((item) => ({
    kind: "action",
    value: item.id,
    title: item.title,
    description: item.description,
    searchTerms: item.terms ?? [],
    icon: item.icon ?? <CircleIcon className="size-4" />,
    disabled: busy || item.disabled === true,
    titleTrailingContent: item.selected ? (
      <CheckIcon className="ml-auto size-4 text-muted-foreground" />
    ) : item.next ? (
      <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
    ) : undefined,
    run: async () => {
      item.select();
    },
  }));
  return (
    <CommandPaletteContent
      mode="none"
      value={query}
      onValueChange={(value) => {
        if (!busy && !readOnly) {
          setHighlighted(null);
          onQueryChange(value);
        }
      }}
      items={enabled.map((item) => item.id)}
      onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
      footerActionLabel="Select"
      footerHints={footerHints}
      showBackHint={!!onBack}
      escapeLabel={onBack ? "Back" : "Close"}
      inputAccessory={
        onBack ? (
          <button
            type="button"
            aria-label="Back"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              onBack();
              event.currentTarget.parentElement?.querySelector("input")?.focus();
            }}
            className="absolute start-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        ) : undefined
      }
      inputProps={{
        placeholder,
        "aria-label": placeholder,
        disabled: busy,
        readOnly,
        ...(onBack
          ? {
              startAddon: <span className="size-4" />,
            }
          : {}),
        onKeyDown: (event) => {
          if (event.nativeEvent.isComposing || busy) return;
          if (
            event.key === "Enter" ||
            event.key === "Escape" ||
            (event.key === "Backspace" && query === "" && onBack)
          ) {
            // Base UI otherwise clicks its active row after our Enter handler runs.
            (
              event as typeof event & { preventBaseUIHandler?: () => void }
            ).preventBaseUIHandler?.();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            (onBack ?? onClose)();
          } else if (event.key === "Backspace" && query === "" && onBack) {
            event.preventDefault();
            event.stopPropagation();
            onBack();
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            selected?.select();
          }
        },
      }}
    >
      {message ? (
        <p role="status" className="px-4 py-2 text-xs text-muted-foreground break-words">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {children}
      <CommandPaletteResults
        groups={actions.length ? [{ value: "library-setup", label: title, items: actions }] : []}
        highlightedItemValue={selected?.id ?? null}
        isActionsOnly
        keybindings={keybindings}
        emptyStateMessage={busy ? "Working..." : "No matches. Try another search."}
        onExecuteItem={(item) => {
          const action = enabled.find((entry) => entry.id === item.value);
          action?.select();
        }}
      />
    </CommandPaletteContent>
  );
}
