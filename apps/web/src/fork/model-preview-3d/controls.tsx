import styles from "./workspace.module.css";
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { RotateCcwIcon } from "lucide-react";
import type { ScadParameter } from "@t3tools/contracts/fork";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { Switch } from "~/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import {
  displayParameterValue,
  parameterLabel,
  stringParameterValue,
  vectorParameterValue,
} from "./params";
import {
  SCRUB_DRAG_THRESHOLD,
  formatScrub,
  scrubFill,
  scrubValue,
  stepScrub,
  typedScrub,
  type ScrubRange,
} from "./scrub";

/** Tooltip with an optional keyboard shortcut, for icon buttons and compact labels. */
export function Tip({
  label,
  kbd,
  side,
  children,
}: {
  label: string;
  kbd?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side={side}>
        <span className="flex items-center gap-2">
          {label}
          {kbd && <Kbd>{kbd}</Kbd>}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

export function Chip({
  tone,
  children,
}: {
  tone?: "primary" | "warning" | "success";
  children: ReactNode;
}) {
  return (
    <span className={styles["model-chip"]} data-tone={tone}>
      {children}
    </span>
  );
}

export function SectionHead({
  title,
  count,
  children,
}: {
  title: string;
  count?: number | undefined;
  children?: ReactNode;
}) {
  return (
    <div className={styles["model-section-head"]}>
      <h3>{title}</h3>
      {!!count && <span>{count}</span>}
      <div className="flex-1" />
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className={styles["model-empty-note"]}>{children}</div>;
}

/** Inline rename field. Enter or blur saves, Escape cancels; `null` means unchanged. */
export function RenameInput({
  value,
  label,
  onDone,
}: {
  value: string;
  label: string;
  onDone: (name: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = ref.current?.value.trim() ?? "";
    onDone(save && next && next !== value ? next : null);
  };
  return (
    <input
      ref={ref}
      className={styles["model-rename"]}
      aria-label={label}
      defaultValue={value}
      maxLength={100}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
    />
  );
}

/** Editable heading for a detail view. Blur or Enter saves a changed, non-empty name. */
export function TitleInput({
  value,
  label,
  onSave,
}: {
  value: string;
  label: string;
  onSave: (name: string) => void;
}) {
  return (
    <input
      key={value}
      className={styles["model-title-input"]}
      aria-label={label}
      defaultValue={value}
      maxLength={100}
      onBlur={(event) => {
        const next = event.target.value.trim();
        if (next && next !== value) onSave(next);
        else event.target.value = value;
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") event.currentTarget.value = value;
        if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
}

/**
 * Places a sliding thumb under the selected item of a track. The track gets
 * `--model-thumb-x` and `--model-thumb-w`, and `data-thumb` once the first position is set,
 * so the thumb animates between choices but not when it first appears.
 */
export function useSlidingThumb<T extends HTMLElement>(selector: string, selected: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const track = ref.current;
    if (!track) return;
    const place = () => {
      const item = track.querySelector<HTMLElement>(selector);
      if (!item || !item.offsetWidth) return;
      track.style.setProperty("--model-thumb-x", `${item.offsetLeft}px`);
      track.style.setProperty("--model-thumb-w", `${item.offsetWidth}px`);
      if (!track.dataset.thumb) requestAnimationFrame(() => (track.dataset.thumb = "ready"));
    };
    place();
    // Labels that appear on selection and panel resizes move the selected item.
    const observer = new ResizeObserver(place);
    observer.observe(track);
    for (const child of track.children) observer.observe(child);
    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new selection moves the thumb.
  }, [selector, selected]);
  return ref;
}

/** Pill segmented control for two to four short choices. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const ref = useSlidingThumb<HTMLDivElement>('[aria-checked="true"]', value);
  const index = options.findIndex((option) => option.value === value);
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={styles["model-segmented"]}
      onKeyDown={(event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        const next = (Math.max(index, 0) + step + options.length) % options.length;
        onChange(options[next]!.value);
        event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
      }}
    >
      <span className={styles["model-segmented-thumb"]} aria-hidden hidden={index < 0} />
      {options.map((option, position) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={position === Math.max(index, 0) ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Number field that scrubs on horizontal drag, becomes a text field on click or Enter,
 * and steps with the arrow keys (Shift for ten steps, or for fine dragging).
 */
export function Scrub({
  value,
  range,
  label,
  axis,
  unit,
  disabled,
  onChange,
}: {
  value: number;
  range: ScrubRange;
  label: string;
  axis?: string;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    drag = useRef<{ x: number; start: number; moved: boolean; width: number } | null>(null),
    latest = useRef(value),
    seed = useRef<string | null>(null);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    if (!editing || !input.current) return;
    input.current.focus();
    // A digit typed on the focused field starts the new value instead of being lost.
    if (seed.current !== null) input.current.value = seed.current;
    else input.current.select();
    seed.current = null;
  }, [editing]);
  const finishEdit = (save: boolean) => {
    // Enter and Escape unmount the input, which fires one more blur.
    if (!input.current) return;
    const typed = Number.parseFloat(input.current.value);
    setEditing(false);
    ref.current?.focus();
    if (save && Number.isFinite(typed)) {
      const next = typedScrub(typed, range);
      if (next !== latest.current) onChange(next);
    }
  };
  const fill = scrubFill(value, range);
  return (
    <div
      ref={ref}
      className={styles["model-scrub"]}
      data-dragging={dragging || undefined}
      data-editing={editing || undefined}
      data-disabled={disabled || undefined}
      tabIndex={editing || disabled ? -1 : 0}
      role="slider"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={range.min ?? undefined}
      aria-valuemax={range.max ?? undefined}
      aria-disabled={disabled || undefined}
      onPointerDown={(event) => {
        if (editing || disabled || event.button !== 0) return;
        event.preventDefault();
        ref.current?.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          start: value,
          moved: false,
          width: event.currentTarget.clientWidth,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current) return;
        const dx = event.clientX - current.x;
        if (!current.moved && Math.abs(dx) < SCRUB_DRAG_THRESHOLD) return;
        if (!current.moved) {
          current.moved = true;
          setDragging(true);
        }
        const next = scrubValue(current.start, dx, current.width, range, event.shiftKey);
        if (next !== latest.current) onChange(next);
      }}
      onPointerUp={() => {
        const current = drag.current;
        drag.current = null;
        setDragging(false);
        if (current && !current.moved) setEditing(true);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (editing || disabled) return;
        const direction = (
          { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 } as Record<string, 1 | -1>
        )[event.key];
        if (direction) {
          event.preventDefault();
          event.stopPropagation();
          onChange(stepScrub(value, direction, range, event.shiftKey));
        } else if (event.key === "Enter" || /^[\d.-]$/.test(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          seed.current = event.key === "Enter" ? null : event.key;
          setEditing(true);
        }
      }}
    >
      {fill !== null && (
        <div className={styles["model-scrub-fill"]} style={{ width: `${fill * 100}%` }} />
      )}
      {axis && <span className={styles["model-scrub-axis"]}>{axis}</span>}
      {editing ? (
        <input
          ref={input}
          inputMode="decimal"
          aria-label={label}
          defaultValue={formatScrub(value, range.step)}
          onBlur={() => finishEdit(true)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") finishEdit(true);
            if (event.key === "Escape") finishEdit(false);
          }}
        />
      ) : (
        <>
          <span>{formatScrub(value, range.step)}</span>
          {unit && !axis && <span className={styles["model-scrub-unit"]}>{unit}</span>}
        </>
      )}
    </div>
  );
}

/** Scrub range for a numeric customizer parameter. Unbounded fields step by the default's precision. */
export function parameterRange(parameter: ScadParameter): ScrubRange {
  if (parameter.range)
    return {
      min: parameter.range.min,
      max: parameter.range.max,
      step: parameter.range.step ?? 1,
    };
  const sample = vectorParameterValue(parameter.defaultValue) ?? [Number(parameter.defaultValue)];
  return { min: null, max: null, step: sample.every(Number.isInteger) ? 1 : 0.1 };
}

const AXES = ["X", "Y", "Z"];

function ParameterControl({
  parameter,
  value,
  onChange,
}: {
  parameter: ScadParameter;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = parameterLabel(parameter.name);
  if (parameter.options?.length) {
    if (parameter.options.length <= 3)
      return (
        <Segmented
          label={label}
          options={parameter.options}
          value={value}
          onChange={(next) => onChange(next)}
        />
      );
    return (
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        items={parameter.options}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {parameter.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    );
  }
  if (parameter.kind === "boolean")
    return (
      <Switch
        size="sm"
        aria-label={label}
        checked={value === "true"}
        onCheckedChange={(next) => onChange(String(next))}
      />
    );
  const number = Number(value);
  if (parameter.kind === "number" && Number.isFinite(number))
    return (
      <Scrub
        label={label}
        value={number}
        range={parameterRange(parameter)}
        onChange={(next) => onChange(String(next))}
      />
    );
  const vector = parameter.kind === "vector" ? vectorParameterValue(value) : null;
  if (vector)
    return (
      <div className={styles["model-vector"]} data-count={Math.min(vector.length, 4)}>
        {vector.map((coordinate, index) => {
          const axis = vector.length <= 3 ? AXES[index]! : String(index + 1);
          return (
            <Scrub
              // oxlint-disable-next-line react/no-array-index-key -- Vector components are positional.
              key={index}
              axis={axis}
              label={`${label} ${axis}`}
              value={coordinate}
              range={parameterRange(parameter)}
              onChange={(next) => {
                const updated = [...vector];
                updated[index] = next;
                onChange(JSON.stringify(updated));
              }}
            />
          );
        })}
      </div>
    );
  return (
    <Input
      aria-label={label}
      size="sm"
      value={parameter.kind === "string" ? stringParameterValue(value) : value}
      onChange={(event) =>
        onChange(
          parameter.kind === "string" ? JSON.stringify(event.target.value) : event.target.value,
        )
      }
    />
  );
}

/** One customizer row: change marker that resets, label, control and optional description. */
export function ParameterRow({
  parameter,
  value,
  baseline,
  onChange,
}: {
  parameter: ScadParameter;
  value: string;
  baseline: string;
  onChange: (value: string) => void;
}) {
  const label = parameterLabel(parameter.name);
  const changed = value !== baseline;
  const vector = parameter.kind === "vector" ? vectorParameterValue(value) : null;
  return (
    <div
      className={styles["model-param"]}
      data-changed={changed || undefined}
      data-wide={(vector && vector.length > 2) || undefined}
    >
      {changed ? (
        <Tip label={`Reset to ${displayParameterValue(parameter, baseline)}`}>
          <button
            type="button"
            className={styles["model-param-reset"]}
            aria-label={`Reset ${label}`}
            onClick={() => onChange(baseline)}
          >
            <RotateCcwIcon />
          </button>
        </Tip>
      ) : (
        <span />
      )}
      {label.toLowerCase() === parameter.name.replace(/_/g, " ").toLowerCase() ? (
        <span className={styles["model-param-label"]}>{label}</span>
      ) : (
        <Tip label={parameter.name}>
          <span className={styles["model-param-label"]}>{label}</span>
        </Tip>
      )}
      <div className={styles["model-param-control"]}>
        <ParameterControl parameter={parameter} value={value} onChange={onChange} />
      </div>
      {parameter.description && (
        <p className={styles["model-param-description"]}>{parameter.description}</p>
      )}
    </div>
  );
}
