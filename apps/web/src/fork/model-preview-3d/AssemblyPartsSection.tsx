import { useEffect, useEffectEvent, useRef, useState, type MouseEvent } from "react";
import { EllipsisIcon, EyeIcon, EyeOffIcon, FocusIcon, Trash2Icon } from "lucide-react";
import {
  isSourceFormat,
  modelFormatOf,
  type AssemblyPart,
  type ScadParameters,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "~/components/ui/menu";
import { EmptyNote, ParameterRow, TitleInput } from "./controls";
import { OperationStatus } from "./OperationStatus";
import { parameterValues, validParameterLiteral } from "./params";
import {
  ASSEMBLY_AXES,
  assemblyNudge,
  parseAssemblyTransform,
  type AssemblyAxis,
} from "./assemblyEditing";
import type { AssemblyInspectorProps } from "./AssemblyInspector";
import styles from "./AssemblyInspector.module.css";

const COLORS = [
  ["Slate", "#8291a8"],
  ["Blue", "#6d9ad5"],
  ["Teal", "#6caaa4"],
  ["Green", "#83ac79"],
  ["Gold", "#c4a96b"],
  ["Coral", "#ca8b7e"],
  ["Violet", "#a08fbf"],
  ["White", "#d8d9dc"],
] as const;

function TransformFields({
  part,
  rotation,
  disabled,
  onApply,
  onPreview,
}: {
  part: AssemblyPart;
  rotation: boolean;
  disabled: boolean;
  onApply: AssemblyInspectorProps["onApply"];
  onPreview: AssemblyInspectorProps["onPreview"];
}) {
  const key = rotation ? "rotation" : "position";
  const [values, setValues] = useState(part[key].map(String));
  const current = useRef(values);
  const change = (index: number, value: string) => {
    const next = current.current.map((old, axis) => (axis === index ? value : old));
    current.current = next;
    setValues(next);
    const parsed = parseAssemblyTransform(next, rotation);
    if (parsed) onPreview({ ...part, [key]: parsed });
  };
  const commit = () => {
    const parsed = parseAssemblyTransform(current.current, rotation);
    if (!parsed) {
      current.current = part[key].map(String);
      setValues(current.current);
      onPreview(null);
      return;
    }
    if (parsed.some((value, axis) => value !== part[key][axis]))
      void onApply([{ op: "update-part", id: part.id, [key]: parsed }]);
    else onPreview(null);
  };
  const nudge = (axis: AssemblyAxis, direction: 1 | -1, event: MouseEvent<HTMLButtonElement>) =>
    void onApply([assemblyNudge(part, axis, direction, rotation, event)]);
  return (
    <div className={styles.section}>
      <h4>{rotation ? "Rotation (degrees)" : "Position (mm)"}</h4>
      <div className={styles.fields}>
        {ASSEMBLY_AXES.map((axis, index) => (
          <div key={axis} className={styles.field}>
            <label htmlFor={`assembly-${part.id}-${key}-${axis}`}>{axis.toUpperCase()}</label>
            <Input
              id={`assembly-${part.id}-${key}-${axis}`}
              aria-label={`${part.name} ${key} ${axis.toUpperCase()}`}
              size="sm"
              type="number"
              step={rotation ? 15 : 1}
              min={rotation ? -360 : -100000}
              max={rotation ? 360 : 100000}
              value={values[index] ?? ""}
              disabled={disabled}
              onChange={(event) => change(index, event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  current.current = part[key].map(String);
                  setValues(current.current);
                  onPreview(null);
                  event.currentTarget.blur();
                } else if (event.key === "Enter") event.currentTarget.blur();
                else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  void onApply([
                    assemblyNudge(part, axis, event.key === "ArrowUp" ? 1 : -1, rotation, event),
                  ]);
                }
              }}
            />
            <div className={styles.nudge}>
              <Button
                variant="ghost-muted"
                size="xs"
                aria-label={`Decrease ${key} ${axis.toUpperCase()}`}
                disabled={disabled}
                onClick={(event) => nudge(axis, -1, event)}
              >
                −
              </Button>
              <Button
                variant="ghost-muted"
                size="xs"
                aria-label={`Increase ${key} ${axis.toUpperCase()}`}
                disabled={disabled}
                onClick={(event) => nudge(axis, 1, event)}
              >
                +
              </Button>
            </div>
          </div>
        ))}
      </div>
      {!rotation && (
        <p className={styles.note}>Nudge 1 mm. Hold Shift for 10 mm or Alt for 0.1 mm.</p>
      )}
      {rotation && (
        <div className={styles.row}>
          {ASSEMBLY_AXES.map((axis, index) => (
            <Button
              key={axis}
              variant="outline"
              size="xs"
              disabled={disabled}
              onClick={() => {
                const rotateBy: [number, number, number] = [0, 0, 0];
                rotateBy[index] = 90;
                void onApply([{ op: "move-part", id: part.id, rotateBy }]);
              }}
            >
              Turn {axis.toUpperCase()} 90°
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function AlignPart({
  part,
  parts,
  disabled,
  onApply,
}: {
  part: AssemblyPart;
  parts: readonly AssemblyPart[];
  disabled: boolean;
  onApply: AssemblyInspectorProps["onApply"];
}) {
  const [to, setTo] = useState("origin"),
    [axis, setAxis] = useState<AssemblyAxis>("z"),
    [mode, setMode] = useState<"min" | "center" | "max" | "after" | "before">("min"),
    [offset, setOffset] = useState("0");
  const validOffset =
    offset.trim() && Number.isFinite(Number(offset)) && Math.abs(Number(offset)) <= 100000;
  return (
    <div className={styles.section}>
      <div className={styles.row}>
        <h4>Placement</h4>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() =>
            void onApply([{ op: "align", id: part.id, to: "origin", axis: "z", mode: "min" }])
          }
        >
          Drop to bed
        </Button>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (validOffset)
            void onApply([{ op: "align", id: part.id, to, axis, mode, offsetMm: Number(offset) }]);
        }}
      >
        <label className={styles.formLabel}>
          Align to
          <select
            className={styles.select}
            aria-label="Align to part"
            value={to}
            disabled={disabled}
            onChange={(event) => setTo(event.target.value)}
          >
            <option value="origin">Origin</option>
            {parts
              .filter((candidate) => candidate.id !== part.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </label>
        <label className={styles.formLabel}>
          Axis
          <select
            className={styles.select}
            aria-label="Alignment axis"
            value={axis}
            disabled={disabled}
            onChange={(event) => setAxis(event.target.value as AssemblyAxis)}
          >
            {ASSEMBLY_AXES.map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.formLabel}>
          Faces
          <select
            className={styles.select}
            aria-label="Alignment faces"
            value={mode}
            disabled={disabled}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="min">Minimum faces</option>
            <option value="center">Centres</option>
            <option value="max">Maximum faces</option>
            <option value="after">After / on top</option>
            <option value="before">Before / below</option>
          </select>
        </label>
        <label className={styles.formLabel}>
          Offset (mm)
          <Input
            size="sm"
            aria-label="Alignment offset in mm"
            type="number"
            value={offset}
            disabled={disabled}
            onChange={(event) => setOffset(event.target.value)}
          />
        </label>
        <div className={styles.full}>
          <Button type="submit" variant="outline" size="xs" disabled={disabled || !validOffset}>
            Align part
          </Button>
        </div>
      </form>
    </div>
  );
}

function PartParameters({
  part,
  disabled,
  loadParameters,
  onApply,
}: {
  part: AssemblyPart;
  disabled: boolean;
  loadParameters: NonNullable<AssemblyInspectorProps["loadParameters"]>;
  onApply: AssemblyInspectorProps["onApply"];
}) {
  const [data, setData] = useState<ScadParameters | null>(null),
    [error, setError] = useState<string | null>(null),
    [values, setValues] = useState<Record<string, string>>({ ...part.parameters });
  const latest = useRef(values);
  const inspectPart = useEffectEvent(() => loadParameters(part));
  useEffect(() => {
    let active = true;
    void inspectPart()
      .then((next) => {
        if (active) setData(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  const commit = (next = latest.current) => {
    if (
      !data ||
      data.parameters.some(
        (parameter) =>
          !validParameterLiteral(parameter, next[parameter.name] ?? parameter.defaultValue),
      )
    )
      return;
    if (JSON.stringify(next) !== JSON.stringify(part.parameters))
      void onApply([{ op: "update-part", id: part.id, parameters: next }]);
  };
  const baseline = data
    ? parameterValues(
        data.parameters,
        part.parameterSet ? (data.setValues[part.parameterSet] ?? {}) : {},
      )
    : {};
  const current = data ? parameterValues(data.parameters, { ...baseline, ...values }) : {};
  return (
    <section className={styles.section}>
      <h4>Part parameters</h4>
      <p className={styles.note}>These values apply to this assembly.</p>
      {error ? (
        <p role="alert" className={`${styles.note} ${styles.warning}`}>
          {error}
        </p>
      ) : !data ? (
        <OperationStatus label="Reading part parameters" />
      ) : (
        <>
          <label className={styles.formLabel}>
            Parameter set
            <select
              aria-label="Part parameter set"
              className={styles.select}
              value={part.parameterSet ?? ""}
              disabled={disabled}
              onChange={(event) =>
                void onApply([
                  {
                    op: "update-part",
                    id: part.id,
                    parameterSet: event.target.value || null,
                    parameters: {},
                  },
                ])
              }
            >
              <option value="">Defaults</option>
              {data.sets.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={disabled} onPointerUp={() => commit()} onBlur={() => commit()}>
            {data.parameters.map((parameter) => (
              <ParameterRow
                key={parameter.name}
                parameter={parameter}
                value={current[parameter.name] ?? parameter.defaultValue}
                baseline={baseline[parameter.name] ?? parameter.defaultValue}
                onChange={(value) => {
                  const next = { ...latest.current, [parameter.name]: value };
                  latest.current = next;
                  setValues(next);
                  if (parameter.kind === "boolean" || parameter.options) commit(next);
                }}
              />
            ))}
          </fieldset>
          {!data.parameters.length && (
            <p className={styles.note}>No editable parameters in this source.</p>
          )}
          <div className={styles.row}>
            <Button variant="outline" size="xs" disabled={disabled} onClick={() => commit()}>
              Apply parameters
            </Button>
            <Button
              variant="ghost-muted"
              size="xs"
              disabled={disabled}
              onClick={() =>
                void onApply([
                  { op: "update-part", id: part.id, parameters: {}, parameterSet: null },
                ])
              }
            >
              Reset
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function AssemblyPartsSection(props: AssemblyInspectorProps) {
  const { snapshot, selectedId, onSelect, onApply, readOnly, busy, errors, report } = props;
  const parts = snapshot.assembly.parts,
    selected = parts.find((part) => part.id === selectedId),
    disabled = readOnly || busy;
  return (
    <>
      <section className={styles.section} aria-label="Assembly parts">
        <div className={styles.row}>
          <h3>
            {parts.length} {parts.length === 1 ? "part" : "parts"}
          </h3>
        </div>
        {!parts.length ? (
          <EmptyNote>No parts yet. Add a part from this workspace.</EmptyNote>
        ) : (
          <ul className={styles.list}>
            {parts.map((part) => {
              const info = snapshot.parts.find((item) => item.id === part.id),
                failure = errors[part.id] ?? info?.error;
              const stats = props.partStats?.[part.id],
                checkedTriangles = report?.parts.find((item) => item.id === part.id)?.triangles;
              const state =
                failure ??
                (stats?.loading
                  ? "Loading..."
                  : stats?.triangles !== null && stats?.triangles !== undefined
                    ? `${stats.triangles.toLocaleString()} triangles`
                    : checkedTriangles !== undefined
                      ? `${checkedTriangles.toLocaleString()} triangles at last check`
                      : (info?.format?.toUpperCase() ?? "Waiting for preview"));
              return (
                <li
                  key={part.id}
                  className={styles.part}
                  data-selected={selectedId === part.id}
                  data-visible={part.visible}
                >
                  <button
                    className={styles.partSelect}
                    type="button"
                    aria-pressed={selectedId === part.id}
                    onClick={() => onSelect(selectedId === part.id ? null : part.id)}
                  >
                    <strong>
                      <span
                        className={styles.swatch}
                        style={{ background: part.color ?? "var(--muted)" }}
                      />{" "}
                      {part.name}
                    </strong>
                    <small>{part.path}</small>
                    <small className={failure ? styles.warning : undefined}>{state}</small>
                  </button>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`${part.visible ? "Hide" : "Show"} ${part.name}`}
                    aria-pressed={part.visible}
                    disabled={disabled}
                    onClick={() =>
                      void onApply([{ op: "update-part", id: part.id, visible: !part.visible }])
                    }
                  >
                    {part.visible ? <EyeIcon /> : <EyeOffIcon />}
                  </Button>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Isolate ${part.name}`}
                    aria-pressed={props.isolatedId === part.id}
                    onClick={() => props.onIsolate(props.isolatedId === part.id ? null : part.id)}
                  >
                    <FocusIcon />
                  </Button>
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          variant="ghost-muted"
                          size="icon-xs"
                          aria-label={`Actions for ${part.name}`}
                        >
                          <EllipsisIcon />
                        </Button>
                      }
                    />
                    <MenuPopup align="end">
                      <MenuItem onClick={() => onSelect(part.id)}>Rename and edit</MenuItem>
                      {props.onOpenPart && (
                        <MenuItem onClick={() => props.onOpenPart?.(part)}>Open part</MenuItem>
                      )}
                      <MenuItem
                        disabled={disabled}
                        onClick={() => void onApply([{ op: "remove-part", id: part.id }])}
                      >
                        <Trash2Icon />
                        Remove from assembly
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {selected && (
        <>
          <section className={styles.section}>
            <fieldset disabled={disabled}>
              <TitleInput
                value={selected.name}
                label="Part name"
                onSave={(name) => void onApply([{ op: "update-part", id: selected.id, name }])}
              />
            </fieldset>
            <div className={styles.palette}>
              {COLORS.map(([name, color]) => (
                <button
                  key={color}
                  type="button"
                  className={styles.color}
                  style={{ background: color }}
                  aria-label={`Colour ${selected.name} ${name}`}
                  aria-pressed={selected.color === color}
                  disabled={disabled}
                  onClick={() => void onApply([{ op: "update-part", id: selected.id, color }])}
                />
              ))}
            </div>
            <div className={styles.row}>
              <label className={styles.formLabel}>
                Custom colour
                <input
                  type="color"
                  aria-label="Custom part colour"
                  value={selected.color ?? "#8291a8"}
                  disabled={disabled}
                  onChange={(event) =>
                    void onApply([
                      {
                        op: "update-part",
                        id: selected.id,
                        color: event.target.value.toLowerCase(),
                      },
                    ])
                  }
                />
              </label>
              <Button
                variant="ghost-muted"
                size="xs"
                disabled={disabled || selected.color === null}
                onClick={() => void onApply([{ op: "update-part", id: selected.id, color: null }])}
              >
                File colour
              </Button>
            </div>
          </section>
          <TransformFields
            key={`${selected.id}-position-${selected.position.join()}`}
            part={selected}
            rotation={false}
            disabled={disabled}
            onApply={onApply}
            onPreview={props.onPreview}
          />
          <TransformFields
            key={`${selected.id}-rotation-${selected.rotation.join()}`}
            part={selected}
            rotation
            disabled={disabled}
            onApply={onApply}
            onPreview={props.onPreview}
          />
          <AlignPart
            key={selected.id}
            part={selected}
            parts={parts}
            disabled={disabled || props.canAlign === false}
            onApply={onApply}
          />
          {isSourceFormat(modelFormatOf(selected.path)) && props.loadParameters && (
            <PartParameters
              key={`${selected.id}-${snapshot.parts.find((item) => item.id === selected.id)?.revision ?? selected.path}-${JSON.stringify(selected.parameters)}-${selected.parameterSet}`}
              part={selected}
              disabled={disabled}
              loadParameters={props.loadParameters}
              onApply={onApply}
            />
          )}
        </>
      )}
    </>
  );
}
