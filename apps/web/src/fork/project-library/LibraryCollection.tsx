import { Link, type LinkProps } from "@tanstack/react-router";
import { LayoutGridIcon, ListIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { HeroTexture, ProjectGlow } from "./ProjectIdentity";

export type LibraryLayout = "cards" | "list";

/** The Cards and List switch every Library collection shares, so it sits in the same place. */
export function LibraryLayoutToggle({
  value,
  onChange,
}: {
  readonly value: LibraryLayout;
  readonly onChange: (layout: LibraryLayout) => void;
}) {
  return (
    <ToggleGroup
      shape="pill"
      aria-label="Layout"
      variant="segmented"
      value={[value]}
      onValueChange={(next) => {
        const layout = next[0];
        if (layout === "cards" || layout === "list") onChange(layout);
      }}
    >
      <ToggleGroupItem value="cards" aria-label="Cards">
        <LayoutGridIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List">
        <ListIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * A card in a Library collection: an outline that warms to the item's color on hover. Pair it with
 * `ProjectWash` and a stretched `LibraryCardTarget`, so the whole card opens its item.
 */
export const LIBRARY_CARD =
  "group/card relative isolate flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3.5 transition-[border-color,box-shadow] duration-200 hover:border-(--project-color)/35 hover:shadow-lg/5 has-focus-visible:border-(--project-color)/35";

/** The grid Library cards share, so Projects, Bots and Sites wrap at the same widths. */
export const LIBRARY_CARD_GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";

/**
 * The card's own way in: a real link stretched under its content, so a card opens in a new tab
 * like Projects' cards. Controls inside sit above it with `relative`.
 */
export function LibraryCardTarget({
  label,
  ...link
}: { readonly label: string } & Pick<LinkProps, "to" | "params" | "search">) {
  return (
    <Link
      {...link}
      aria-label={label}
      className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    />
  );
}

/**
 * The one filled surface on a Library item's page, after the Projects hero: the item's color
 * pooled in one corner, a dot grid fading out of the other, its mark, name, state and actions.
 */
export function LibraryHero({
  tile,
  title,
  meta,
  actions,
  children,
  footer,
}: {
  readonly tile: ReactNode;
  readonly title: ReactNode;
  /** One line of state and facts under the title. */
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  /** A description or brief, indented under the title. */
  readonly children?: ReactNode;
  /** The item's vital signs along the hero's foot, divided from the rest by a hairline. */
  readonly footer?: ReactNode;
}) {
  return (
    <header className="relative isolate overflow-hidden rounded-3xl border border-border bg-card shadow-xs/5">
      <ProjectGlow strength="strong" />
      <HeroTexture />
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          {tile}
          <div className="min-w-0 flex-1 basis-60 space-y-2 pt-0.5">
            <h1 className="wrap-anywhere text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
              {title}
            </h1>
            {meta ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs tabular-nums text-muted-foreground">
                {meta}
              </div>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-1.5 pt-1">{actions}</div> : null}
        </div>
        {/* Indented to the title, past a 2xl tile and its gap. */}
        {children ? <div className="min-w-0 sm:ps-21">{children}</div> : null}
      </div>
      {footer ? (
        <div className="border-t border-border/70 bg-background/40 px-5 py-3 sm:px-6 dark:bg-background/20">
          {footer}
        </div>
      ) : null}
    </header>
  );
}

/**
 * One vital sign in a hero's foot: a small label over its reading. Readings stay in text ink; any
 * color rides on the mark beside them.
 */
export function LibraryVital({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="flex h-5 items-center text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** The row of vitals a hero's foot holds. */
export function LibraryVitals({ children }: { readonly children: ReactNode }) {
  return <dl className="flex flex-wrap gap-x-8 gap-y-3">{children}</dl>;
}
