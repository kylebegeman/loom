import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRightIcon, SearchIcon, XIcon } from "lucide-react";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import k from "./inspector.module.css";
import ws from "./workspace.module.css";

/** A row action that stays quiet until its row is hovered or focused. */
export const revealTool = `${ws.tool} ${k.revealTool}`;

/**
 * Building blocks for inspector tabs. A tab is a fixed `Bar` (search, filters), a scrolling
 * `Scroll` of `Section`s, and an optional `Footer` for the commit action, so the primary
 * action never scrolls out of reach.
 */
export const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** One write at a time per tab, with its failure kept beside the control that caused it. */
export function useWrite(fallback = "The change could not be saved.") {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const run = async (write: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await write();
      return true;
    } catch (cause) {
      setError(errorText(cause, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function Bar({ children }: { children: ReactNode }) {
  return <div className={k.bar}>{children}</div>;
}
export function Scroll({ children }: { children: ReactNode }) {
  return <div className={k.scroll}>{children}</div>;
}
export function Footer({ children }: { children: ReactNode }) {
  return <div className={k.footer}>{children}</div>;
}

export function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={k.section} aria-label={title}>
      <header className={k.sectionHead}>
        <h3>{title}</h3>
        {count !== undefined && <span className={k.count}>{count}</span>}
        {action && <span className={k.sectionAction}>{action}</span>}
      </header>
      {children}
    </section>
  );
}

/** A collapsible group whose summary is a full-width row. Native details stay cheap at scale. */
export function Group({
  title,
  meta,
  lead,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  lead?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={k.group} open={defaultOpen}>
      <summary>
        <ChevronRightIcon className={k.groupChevron} aria-hidden="true" />
        {lead}
        <span className={k.groupTitle}>{title}</span>
        {meta !== undefined && <span className={k.count}>{meta}</span>}
      </summary>
      <div className={k.groupBody}>{children}</div>
    </details>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={k.empty}>
      <span className={k.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      {children && <div className={k.emptyText}>{children}</div>}
      {action && <div className={k.emptyAction}>{action}</div>}
    </div>
  );
}

export type Tone = "error" | "warning" | "success" | "info" | "neutral";
export function Stats({ children }: { children: ReactNode }) {
  return <div className={k.stats}>{children}</div>;
}
/** A number with its label. With `onClick` it is a filter, pressed while applied. */
export function Stat({
  label,
  value,
  tone = "neutral",
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={k.statValue}>{value}</span>
      <span className={k.statLabel}>
        {tone !== "neutral" && <span className={k.dot} data-tone={tone} aria-hidden="true" />}
        {label}
      </span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={k.stat}
      data-tone={tone}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {body}
    </button>
  ) : (
    <div className={k.stat} data-tone={tone}>
      {body}
    </div>
  );
}

export function Notice({
  tone = "neutral",
  icon,
  children,
  action,
  role,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className={k.notice} data-tone={tone} role={role}>
      {icon && (
        <span className={k.noticeIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      <div className={k.noticeText}>{children}</div>
      {action && <div className={k.noticeAction}>{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={k.segment}>
      <ToggleGroup
        aria-label={label}
        value={value === null ? [] : [value]}
        onValueChange={(next) => {
          const option = options.find((o) => o.value === next[0]);
          if (option) onChange(option.value);
        }}
      >
        {options.map((o) => (
          <Toggle key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={k.search}>
      <SearchIcon aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          }
        }}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")}>
          <XIcon />
        </button>
      )}
    </label>
  );
}

/** A chip that applies something, with an optional remove control beside it. */
export function Chip({
  children,
  pressed,
  disabled,
  onClick,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className={k.chip} data-pressed={pressed || undefined}>
      {onClick ? (
        <button type="button" aria-pressed={pressed} onClick={onClick}>
          {children}
        </button>
      ) : (
        <span>{children}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className={k.chipRemove}
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
        >
          <XIcon />
        </button>
      )}
    </span>
  );
}

export function Range({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number | "any" | undefined;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const fill = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <input
      type="range"
      className={k.range}
      aria-label={label}
      min={min}
      max={max}
      step={step ?? "any"}
      value={value}
      disabled={disabled}
      style={{ "--fill": `${fill}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={k.field}>
      <label className={k.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className={k.fieldHint}>{hint}</p>}
    </div>
  );
}

export function Log({ title, text, open }: { title: string; text: string; open?: boolean }) {
  return (
    <details className={k.disclosure} open={open}>
      <summary>
        <ChevronRightIcon className={k.groupChevron} aria-hidden="true" />
        {title}
      </summary>
      <pre className={k.log}>{text}</pre>
    </details>
  );
}
