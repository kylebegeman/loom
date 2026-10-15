import styles from "./workspace.module.css";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { RotateCcwIcon } from "lucide-react";
import type { ScadParameter } from "@t3tools/contracts/fork";
import { Input } from "~/components/ui/input";
import { observeResize } from "~/lib/observeResize";
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
import { copyValue } from "./copyValue";
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
import { clampSteps, parameterRange, scrubSteps, scrubValue as stepValue } from "./nameScrub";

/** Holds an automatic render while a drag is under way. */
export type HoldRender = (held: boolean) => void;

/**
 * Reports a drag's start and end to `onHold` once each, and ends it if the control unmounts
 * mid-drag, so a filtered or collapsed row cannot leave renders held.
 */
function useHold(onHold: HoldRender | undefined) {
  const latest = useRef(onHold),
    active = useRef(false);
  useLayoutEffect(() => {
    latest.current = onHold;
  });
  useEffect(
    () => () => {
      if (active.current) latest.current?.(false);
      active.current = false;
    },
    [],
  );
  return useCallback((held: boolean) => {
    if (active.current === held) return;
    active.current = held;
    latest.current?.(held);
  }, []);
}

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

/** A shown value that copies itself, without digit grouping, when clicked. */
export function CopyValue({
  text,
  label,
  children,
}: {
  text: string;
  label?: string;
  children?: ReactNode;
}) {
  const shown = useRef<HTMLSpanElement>(null);
  return (
    <button
      type="button"
      className={styles["model-copy-value"]}
      aria-label={label ?? `Copy ${text}`}
      onClick={(event) => {
        event.stopPropagation();
        void copyValue(text, shown.current);
      }}
    >
      <span ref={shown}>{children ?? text}</span>
    </button>
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
    return observeResize([track, ...track.children], place);
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
  onHold,
}: {
  value: number;
  range: ScrubRange;
  label: string;
  axis?: string;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Told when a drag starts and ends, so a render waits for the release. */
  onHold?: HoldRender;
}) {
  const hold = useHold(onHold);
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
        hold(true);
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
        hold(false);
        if (current && !current.moved) setEditing(true);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
        hold(false);
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

const AXES = ["X", "Y", "Z"];

function ParameterControl({
  parameter,
  value,
  onChange,
  onHold,
}: {
  parameter: ScadParameter;
  value: string;
  onChange: (value: string) => void;
  onHold: HoldRender | undefined;
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
        {...(onHold ? { onHold } : {})}
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
              {...(onHold ? { onHold } : {})}
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

export const SCRUB_NAME_HINT = "Drag sideways to change; Shift is faster, Alt finer.";

/**
 * Drag sideways to move a value along its step grid, as a parameter's name does. The automatic
 * render is held for the drag, and `takeChanged` tells a following click whether the drag
 * changed the value, so a plain press can do something else.
 */
export function useNameScrub({
  value,
  range,
  onChange,
  onHold,
}: {
  value: number;
  range: ScrubRange;
  onChange: (value: number) => void;
  onHold: HoldRender | undefined;
}) {
  const hold = useHold(onHold),
    drag = useRef<{ id: number; x: number; steps: number; start: number } | null>(null),
    latest = useRef(value),
    changed = useRef(false),
    [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    hold(false);
  };
  return {
    dragging,
    takeChanged: () => {
      const was = changed.current;
      changed.current = false;
      return was;
    },
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, steps: 0, start: value };
        changed.current = false;
        setDragging(true);
        hold(true);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        current.steps = clampSteps(
          current.steps +
            scrubSteps(event.clientX - current.x, { fast: event.shiftKey, fine: event.altKey }),
          current.start,
          range,
        );
        current.x = event.clientX;
        const next = stepValue(current.start, current.steps, range);
        if (next === latest.current) return;
        changed.current = true;
        onChange(next);
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
    },
  };
}

/**
 * A number parameter's name as a scrub handle: dragging it sideways steps the value, 4 px a
 * step, ten times faster with Shift and slower with Alt. The value field stays the keyboard
 * route, so the handle itself is not focusable.
 */
function ScrubName({
  label,
  value,
  range,
  onChange,
  onHold,
}: {
  label: string;
  value: number;
  range: ScrubRange;
  onChange: (value: number) => void;
  onHold: HoldRender | undefined;
}) {
  const scrub = useNameScrub({ value, range, onChange, onHold });
  return (
    <span
      className={styles["model-param-label"]}
      data-scrub=""
      data-dragging={scrub.dragging || undefined}
      {...scrub.handlers}
    >
      {label}
    </span>
  );
}

/**
 * Focuses a parameter row's control. A changed row starts with its reset button, which must not
 * take the focus: Enter or Space there would throw the value away.
 */
export function focusParameterControl(row: Element | null | undefined) {
  row
    ?.querySelector("[data-parameter-control]")
    ?.querySelector<HTMLElement>('[role="slider"], [role="switch"], input, button')
    ?.focus();
}

/** One customizer row: change marker that resets, label, control and optional description. */
export function ParameterRow({
  parameter,
  value,
  baseline,
  onChange,
  onHold,
}: {
  parameter: ScadParameter;
  value: string;
  baseline: string;
  onChange: (value: string) => void;
  /** Told while a scrub is under way, so an automatic render waits for the release. */
  onHold?: HoldRender;
}) {
  const label = parameterLabel(parameter.name);
  const changed = value !== baseline;
  const vector = parameter.kind === "vector" ? vectorParameterValue(value) : null;
  const number = Number(value);
  const scrubbable =
    parameter.kind === "number" && !parameter.options?.length && Number.isFinite(number);
  const renamed = label.toLowerCase() !== parameter.name.replace(/_/g, " ").toLowerCase();
  return (
    <div
      className={styles["model-param"]}
      data-parameter={parameter.name}
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
      {scrubbable ? (
        <Tip label={renamed ? `${parameter.name}. ${SCRUB_NAME_HINT}` : SCRUB_NAME_HINT}>
          <ScrubName
            label={label}
            value={number}
            range={parameterRange(parameter)}
            onChange={(next) => onChange(String(next))}
            onHold={onHold}
          />
        </Tip>
      ) : renamed ? (
        <Tip label={parameter.name}>
          <span className={styles["model-param-label"]}>{label}</span>
        </Tip>
      ) : (
        <span className={styles["model-param-label"]}>{label}</span>
      )}
      <div className={styles["model-param-control"]} data-parameter-control="">
        <ParameterControl parameter={parameter} value={value} onChange={onChange} onHold={onHold} />
      </div>
      {parameter.description && (
        <p className={styles["model-param-description"]}>{parameter.description}</p>
      )}
    </div>
  );
}
