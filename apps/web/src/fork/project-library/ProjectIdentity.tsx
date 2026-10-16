import type { CSSProperties } from "react";
import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import {
  LIBRARY_PROJECT_COLORS,
  type LibraryProject,
  type LibraryProjectColor,
} from "@t3tools/contracts/fork";
import {
  libraryPathParts,
  libraryProjectColor,
  libraryProjectInitials,
} from "@t3tools/client-runtime/fork";
import { CheckIcon, CopyIcon, SparklesIcon } from "lucide-react";
import { EnvironmentMachineIcon } from "~/components/EnvironmentMachineIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { useEnvironmentMachines } from "~/state/environments";

export const PROJECT_COLOR_NAMES: Record<LibraryProjectColor, string> = {
  plum: "Plum",
  red: "Red",
  orange: "Orange",
  gold: "Gold",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  slate: "Slate",
};

/** Scopes `--project-color` so tiles, dots and tints under it share one themed ink. */
export function projectColorStyle(color: LibraryProjectColor): CSSProperties {
  return { "--project-color": `var(--project-${color})` } as CSSProperties;
}

const TILE_SIZES = {
  sm: "size-6 rounded-md text-3xs",
  md: "size-8 rounded-lg text-xs",
  lg: "size-11 rounded-xl text-base",
} as const;

/**
 * A project's monogram on its color, the quickest way to find it in a list. `neutral` is for
 * drafts, whose automatic color isn't known until the Library assigns an id.
 */
export function ProjectTile({
  project,
  size = "md",
  neutral = false,
}: {
  readonly project: Pick<LibraryProject, "id" | "title" | "color">;
  readonly size?: keyof typeof TILE_SIZES;
  readonly neutral?: boolean;
}) {
  return (
    <span
      aria-hidden
      style={neutral ? undefined : projectColorStyle(libraryProjectColor(project))}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center font-semibold tracking-tight transition-colors duration-150",
        neutral
          ? "bg-muted text-muted-foreground dark:bg-accent"
          : "bg-(--project-color)/13 text-(--project-color) dark:bg-(--project-color)/16",
        TILE_SIZES[size],
      )}
    >
      {libraryProjectInitials(project.title)}
    </span>
  );
}

export function ProjectColorDot({
  color,
  className,
}: {
  readonly color: LibraryProjectColor;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      style={projectColorStyle(color)}
      className={cn("inline-block size-2 shrink-0 rounded-full bg-(--project-color)", className)}
    />
  );
}

/**
 * Picks one of the shared project colors. "Automatic" keeps the stable color derived from
 * the project, so nobody has to choose one before the project feels distinct.
 */
export function ProjectColorPicker({
  value,
  automatic,
  disabled,
  onChange,
}: {
  readonly value: LibraryProjectColor | undefined;
  /** The color Automatic resolves to, when the project already has an id. */
  readonly automatic?: LibraryProjectColor;
  readonly disabled?: boolean;
  readonly onChange: (color: LibraryProjectColor | null) => void;
}) {
  const swatch =
    "group/swatch inline-flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60";
  const fill = (selected: boolean) =>
    cn(
      "inline-flex size-5 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow duration-150",
      selected
        ? "ring-2 ring-(--project-color)"
        : "group-hover/swatch:ring-2 group-hover/swatch:ring-(--project-color)/35",
    );
  return (
    <div
      role="radiogroup"
      aria-label="Project color"
      className="flex flex-wrap items-center gap-1.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={!value}
        aria-label={automatic ? `Automatic (${PROJECT_COLOR_NAMES[automatic]})` : "Automatic"}
        disabled={disabled}
        style={projectColorStyle(automatic ?? "slate")}
        className={swatch}
        onClick={() => onChange(null)}
      >
        <span
          className={cn(
            fill(!value),
            automatic
              ? "bg-(--project-color)/16 text-(--project-color)"
              : "bg-muted text-muted-foreground dark:bg-accent",
          )}
        >
          <SparklesIcon aria-hidden className="size-3" />
        </span>
      </button>
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      {LIBRARY_PROJECT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={PROJECT_COLOR_NAMES[color]}
          disabled={disabled}
          style={projectColorStyle(color)}
          className={swatch}
          onClick={() => onChange(color)}
        >
          <span className={cn(fill(value === color), "bg-(--project-color)")}>
            {value === color ? (
              <CheckIcon aria-hidden className="size-3 text-background" strokeWidth={3} />
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Shows where a folder lives the way people read it: home as `~`, the folder name in full
 * and its parents faded and truncated first. The full path and a copy action stay one hover away.
 */
export function PathLabel({
  path,
  className,
}: {
  readonly path: string;
  readonly className?: string;
}) {
  const parts = libraryPathParts(path);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "path", timeout: 1500 });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Copy path ${path}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              copyToClipboard(path);
            }}
            className={cn(
              "group/path relative z-10 inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-xs outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        <span className="flex min-w-0 items-baseline">
          <span className="min-w-0 truncate text-muted-foreground/80">{parts.parent}</span>
          <span className="shrink-0 text-foreground/90">{parts.name}</span>
        </span>
        {isCopied ? (
          <CheckIcon aria-hidden className="size-3 shrink-0 text-success-foreground" />
        ) : (
          <CopyIcon
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/path:opacity-100 group-focus-visible/path:opacity-100"
          />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top" variant="code">
        {isCopied ? "Copied" : path}
      </TooltipPopup>
    </Tooltip>
  );
}

/** A computer named the way the rest of Loom names it, with its machine shape. */
export function ComputerLabel({
  environmentId,
  label,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly className?: string;
}) {
  const machines = useEnvironmentMachines();
  const kind: EnvironmentMachineKind = machines.get(environmentId) ?? "server";
  return (
    <span
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <EnvironmentMachineIcon aria-hidden kind={kind} className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
