import { useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CircleIcon,
  CheckIcon,
} from "lucide-react";
import { CommandPaletteContent } from "~/components/CommandPaletteContent";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { CommandPaletteResults } from "~/components/CommandPaletteResults";
import type { CommandPaletteActionItem } from "~/components/CommandPalette.logic";
import { CommandDialog, CommandDialogPopup } from "~/components/ui/command";
import { needsLibrarySignIn } from "@t3tools/client-runtime/fork";
import { LibrarySignInLink } from "./LibrarySignInLink";

const NO_HIGHLIGHT = { id: null, choice: null } as const;

export interface LibraryPaletteItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  /**
   * Shown in place of the description but never searched. Enter takes the first match, so text
   * that many rows share, such as the computer a start runs on, must not decide which row leads.
   */
  readonly summary?: string | undefined;
  readonly terms?: readonly string[] | undefined;
  readonly icon?: ReactNode;
  readonly next?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly select: () => void;
  /** What Enter does on this row, named in the footer while the row is highlighted. */
  readonly enterLabel?: string | undefined;
  /** A second step reached from the row's chevron or Right Arrow, while Enter runs `select`. */
  readonly options?: (() => void) | undefined;
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
  /** Replaces the keys the footer names, for pages whose keys do not follow the rows. */
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
  // Base UI also moves the highlight itself (reason "none"): to the first row on open and after
  // typing, and to whatever row lands under its index when rows change. Only keyboard and pointer
  // make a choice. Base UI also clears the highlight on blur and restores it on focus, so switching
  // windows must not forget the choice.
  const [highlight, setHighlight] = useState<{
    readonly id: string | null;
    readonly choice: string | null;
  }>(NO_HIGHLIGHT);
  const term = query.trim().toLocaleLowerCase();
  const visible = items.filter(
    (item) =>
      !filter ||
      [item.title, item.description ?? "", ...(item.terms ?? [])].some((value) =>
        value.toLocaleLowerCase().includes(term),
      ),
  );
  const enabled = visible.filter((item) => !item.disabled && !busy);
  // Without a choice, Enter runs the first row only while it is enabled, so a disabled primary
  // action, such as Create before a name, never hands Enter to the row below it.
  const lead = enabled[0] === visible[0] ? enabled[0] : undefined;
  const selected =
    enabled.find(
      (item) => item.id === highlight.id && (lead !== undefined || item.id === highlight.choice),
    ) ?? lead;
  const actions: CommandPaletteActionItem[] = visible.map((item) => ({
    kind: "action",
    value: item.id,
    title: item.title,
    description: item.summary ?? item.description,
    searchTerms: item.terms ?? [],
    icon: item.icon ?? <CircleIcon className="size-4" />,
    disabled: busy || item.disabled === true,
    titleTrailingContent: item.selected ? (
      <CheckIcon className="ml-auto size-4 text-muted-foreground" />
    ) : item.options ? (
      // Keyboard users reach this with Right Arrow. Base UI commits the row on click, so the
      // chevron stops the click before it reaches the row.
      <span
        aria-hidden
        onClick={(event) => {
          event.stopPropagation();
          if (!busy && !item.disabled) item.options?.();
        }}
        className="-my-1 ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ChevronRightIcon className="size-4" />
      </span>
    ) : item.next ? (
      <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
    ) : undefined,
    run: async () => {
      item.select();
    },
  }));
  const enterLabel = selected?.enterLabel ?? "Select";
  const escapeLabel = onBack ? "Back" : "Close";
  return (
    <CommandPaletteContent
      mode="none"
      value={query}
      onValueChange={(value) => {
        if (!busy && !readOnly) {
          setHighlight(NO_HIGHLIGHT);
          onQueryChange(value);
        }
      }}
      items={enabled.map((item) => item.id)}
      // Base UI would otherwise pre-highlight the first enabled row under a disabled lead, and the
      // first arrow press would then skip that row. Off, arrows also pass through no highlight, the
      // state the palette opened in, when wrapping between the last and first rows.
      autoHighlight={lead ? "always" : false}
      onItemHighlighted={(value, { reason }) => {
        const id = typeof value === "string" ? value : null;
        setHighlight((previous) => ({ id, choice: reason === "none" ? previous.choice : id }));
      }}
      footerActionLabel={enterLabel}
      // The default footer has no Right Arrow hint, so a row with options lists every key.
      footerHints={
        footerHints ??
        (selected?.options ? (
          <>
            <KbdGroup>
              <Kbd>
                <ArrowUpIcon />
              </Kbd>
              <Kbd>
                <ArrowDownIcon />
              </Kbd>
              <span>Navigate</span>
            </KbdGroup>
            <KbdGroup>
              <Kbd>Enter</Kbd>
              <span>{enterLabel}</span>
            </KbdGroup>
            <KbdGroup>
              <Kbd>
                <ArrowRightIcon />
              </Kbd>
              <span>Options</span>
            </KbdGroup>
            {onBack ? (
              <KbdGroup>
                <Kbd>Backspace</Kbd>
                <span>Back</span>
              </KbdGroup>
            ) : null}
            <KbdGroup>
              <Kbd>Esc</Kbd>
              <span>{escapeLabel}</span>
            </KbdGroup>
          </>
        ) : undefined)
      }
      showBackHint={!!onBack}
      escapeLabel={escapeLabel}
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
          const input = event.currentTarget;
          const options =
            event.key === "ArrowRight" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            input.selectionStart === input.value.length &&
            input.selectionEnd === input.value.length
              ? selected?.options
              : undefined;
          if (options) {
            (
              event as typeof event & { preventBaseUIHandler?: () => void }
            ).preventBaseUIHandler?.();
            event.preventDefault();
            event.stopPropagation();
            options();
            return;
          }
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
        <div role="alert" className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
          <p className="text-destructive">{error}</p>
          {needsLibrarySignIn(error) ? <LibrarySignInLink onClick={onClose} /> : null}
        </div>
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
