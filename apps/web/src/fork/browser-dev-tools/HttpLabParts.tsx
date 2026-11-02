import { useId, type ReactNode } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

export function LabSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  compact = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      disabled={disabled}
      items={options}
    >
      <SelectTrigger size={compact ? "compact" : "sm"} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function LabTabs<T extends string>({
  label,
  value,
  items,
  onChange,
  children,
}: {
  label: string;
  value: T;
  items: readonly { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label={label}
        className="flex min-w-0 gap-1 overflow-x-auto border-b border-border px-3 py-2"
      >
        {items.map((item, index) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`${id}-${item.value}`}
            aria-selected={value === item.value}
            aria-controls={`${id}-panel`}
            tabIndex={value === item.value ? 0 : -1}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              value === item.value
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % items.length
                  : event.key === "ArrowLeft"
                    ? (index + items.length - 1) % items.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              onChange(items[next]!.value);
              document.getElementById(`${id}-${items[next]!.value}`)?.focus();
            }}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 ? (
              <span className="rounded bg-muted px-1.5 text-3xs tabular-nums text-muted-foreground">
                {item.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${value}`}
        tabIndex={0}
        className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {children}
      </div>
    </div>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-12 shrink-0 items-center justify-center rounded px-1 py-0.5 font-mono text-3xs font-semibold",
        method === "GET"
          ? "bg-success/10 text-success"
          : method === "DELETE"
            ? "bg-destructive/10 text-destructive"
            : method === "POST"
              ? "bg-info/10 text-info"
              : "bg-warning/10 text-warning-foreground",
      )}
    >
      {method}
    </span>
  );
}

export function LabCodeEditor({
  label,
  value,
  onChange,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const lines = value.split("\n").length;
  return (
    <div className="flex min-w-0 bg-code font-mono text-xs leading-6">
      <div
        aria-hidden="true"
        className="max-h-80 w-11 shrink-0 select-none overflow-hidden border-r border-border/60 py-3 text-right text-muted-foreground/60"
      >
        {Array.from({ length: Math.max(8, Math.min(lines, 3000)) }, (_, i) => (
          <div className="pr-3" key={i}>
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        aria-label={label}
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        disabled={disabled}
        placeholder={placeholder}
        className="min-h-54 max-h-80 min-w-0 flex-1 resize-y bg-transparent px-4 py-3 leading-6 outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          const gutter = e.currentTarget.previousElementSibling;
          if (gutter) gutter.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Tab" ||
            event.shiftKey ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          const field = event.currentTarget;
          const start = field.selectionStart;
          const end = field.selectionEnd;
          onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
          queueMicrotask(() => field.setSelectionRange(start + 2, start + 2));
        }}
      />
    </div>
  );
}
