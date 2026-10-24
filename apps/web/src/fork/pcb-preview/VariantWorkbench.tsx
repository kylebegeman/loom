import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { PcbVariant, type PcbParameters, type PcbWorkspace } from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { pcb } from "./state";
import { runModelCommand as runPcbCommand } from "../model-preview-3d/state";
import { errorText, Notice, Section, Segmented, Field, Log } from "./InspectorKit";
import {
  BOARD_COLUMNS,
  SWEEP_LIMIT,
  VARIANT_LIMIT,
  generateCandidates,
  sortVariants,
  sweepValues,
  variantStat,
  type SortKey,
  type Value,
  type SweepInput,
} from "./sweep";
import { svgThumbnail } from "./variantImages";
import { runVariantBatch, type VariantRequest } from "./variantBatch";
import { VariantCompare } from "./VariantCompare";
import { formatLengths, formatLength, formatArea } from "./length";
import { useLengthUnit } from "./preferences";
import styles from "./VariantWorkbench.module.css";
const decodeVariant = Schema.decodeUnknownSync(PcbVariant);
export function VariantWorkbench({
  threadRef,
  designId,
  schema,
  data,
  currentValues,
  sourceHash,
  executionAllowed,
  canSave,
  mutate,
  onUse,
  request,
  onRequestConsumed,
}: {
  threadRef: ScopedThreadRef;
  designId: string;
  schema: PcbParameters;
  data: PcbWorkspace;
  currentValues: Record<string, Value>;
  sourceHash: string | null;
  executionAllowed: boolean;
  canSave: boolean;
  mutate: (change: (data: PcbWorkspace) => PcbWorkspace) => Promise<unknown>;
  onUse: (values: Record<string, Value>) => void;
  request?: VariantRequest | null | undefined;
  onRequestConsumed?: (() => void) | undefined;
}) {
  const allowed = useAtomValue(pcb.renderVariant.permissionAtom(threadRef.environmentId));
  const canRender = allowed && executionAllowed && canSave;
  const [view, setView] = useState<"grid" | "table">("grid"),
    [sort, setSort] = useState<SortKey>("name"),
    [direction, setDirection] = useState<"asc" | "desc">("asc"),
    [selected, setSelected] = useState<string[]>([]),
    [name, setName] = useState(""),
    [sweep, setSweep] = useState(false),
    [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false),
    [progress, setProgress] = useState<{ index: number; total: number; id: string } | null>(null),
    [compare, setCompare] = useState<[PcbVariant, PcbVariant] | null>(null);
  const generation = useRef(0),
    active = useRef<string | null>(null),
    running = useRef(false),
    latest = useRef(data),
    consumed = useRef<string | null>(null);
  useLayoutEffect(() => {
    latest.current = data;
  }, [data]);
  const units = useLengthUnit();
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, designId },
  };
  const cancel = () => {
    generation.current++;
    const id = active.current;
    active.current = null;
    running.current = false;
    if (id)
      void runPcbCommand(pcb.cancelVariant, {
        ...target,
        input: { ...target.input, variantId: id },
      }).catch(() => undefined);
  };
  const renderFingerprint = useRef("");
  const sessionKey = JSON.stringify([designId, schema.sourceHash, sourceHash, canRender]);
  const cleanup = useEffectEvent(() => {
    if (running.current && renderFingerprint.current !== sessionKey)
      setError("The circuit source or permissions changed. Render again to update the variants.");
    cancel();
    setProgress(null);
  });
  useEffect(() => {
    const key = sessionKey;
    return () => {
      if (key) cleanup();
    };
  }, [sessionKey]);
  const perform = async (operation: () => Promise<unknown>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    // The async wrapper routes a synchronous throw from `operation` to the catch handler.
    return (async () => {
      await operation();
      return true;
    })()
      .catch((e: unknown) => {
        setError(errorText(e, "Could not save variants."));
        return false;
      })
      .finally(() => setSaving(false));
  };
  const savePatch = (variant: PcbVariant, patch: Partial<PcbVariant>) =>
    mutate((current) => ({
      ...current,
      variants: current.variants.map((v) =>
        v.id === variant.id && JSON.stringify(v.values) === JSON.stringify(variant.values)
          ? { ...v, ...patch }
          : v,
      ),
    }));
  const render = async (
    ids: readonly string[],
    options: { collectImages?: boolean; candidates?: readonly PcbVariant[] } = {},
  ) => {
    if (!canRender || running.current)
      throw new Error(
        "Allow circuit code and workspace/terminal permissions before rendering variants.",
      );
    const variants =
      options.candidates ??
      ids
        .map((id) => latest.current.variants.find((v) => v.id === id))
        .filter((v): v is PcbVariant => !!v);
    if (!variants.length) return new Map<string, string>();
    const token = ++generation.current;
    running.current = true;
    renderFingerprint.current = sessionKey;
    setError(null);
    const images = new Map<string, string>();
    return runVariantBatch({
      variants,
      current: () => generation.current === token,
      progress: (index, variant) => {
        active.current = variant.id;
        setProgress({ index, total: variants.length, id: variant.id });
      },
      render: (variant) =>
        runPcbCommand(pcb.renderVariant, {
          ...target,
          input: {
            ...target.input,
            variantId: variant.id,
            values: variant.values,
            expectedSourceHash: schema.sourceHash,
          },
        }),
      read: async (result) => {
        const svg = (
          await runPcbCommand(pcb.readSheet, {
            environmentId: threadRef.environmentId,
            input: {
              threadId: threadRef.threadId,
              renderKey: result.renderKey,
              sheetId: result.sheet!.id,
            },
          })
        ).svg;
        if (options.collectImages) images.set(result.variantId, svg);
        return svg;
      },
      thumbnail: svgThumbnail,
      save: savePatch,
    })
      .then(() => (generation.current === token ? images : new Map<string, string>()))
      .finally(() => {
        if (generation.current === token) {
          running.current = false;
          active.current = null;
          setProgress(null);
        }
      });
  };
  const renderButton = (ids: readonly string[]) => {
    void render(ids).catch((e) => setError(errorText(e, "Could not render variants.")));
  };
  const handleRequest = useEffectEvent((value: VariantRequest) => {
    onRequestConsumed?.();
    if (value.action === "sweep") setSweep(true);
    else
      renderButton(
        value.ids ??
          data.variants
            .filter((v) => !v.thumbnail || v.renderedRevision !== sourceHash)
            .map((v) => v.id),
      );
  });
  useEffect(() => {
    if (request && consumed.current !== request.id) {
      consumed.current = request.id;
      handleRequest(request);
    }
  }, [request]);
  const add = (
    rows: readonly { name: string; values: Record<string, Value> }[],
    renderAfter = false,
  ) =>
    perform(async () => {
      const token = generation.current;
      const additions = rows.map((v) =>
        decodeVariant({ ...v, id: randomUUID(), sourceHash: schema.sourceHash }),
      );
      await mutate((current) => {
        if (current.variants.length + additions.length > VARIANT_LIMIT)
          throw new Error("Delete variants to add more.");
        return { ...current, variants: [...current.variants, ...additions] };
      });
      if (renderAfter && canRender && generation.current === token)
        void render(
          additions.map((v) => v.id),
          { candidates: additions },
        ).catch((e) => setError(errorText(e, "Could not render variants.")));
    });
  const loadSvg = async (variant: PcbVariant) => {
    const token = generation.current;
    if (variant.render) {
      try {
        return (
          await runPcbCommand(pcb.readSheet, {
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, ...variant.render },
          })
        ).svg;
      } catch (e) {
        if (!(e && typeof e === "object" && "reason" in e && e.reason === "render-not-found"))
          throw e;
      }
    }
    if (generation.current !== token) throw new Error("Variant comparison cancelled.");
    if (!canRender)
      throw new Error(
        "Allow circuit code and terminal permission to rebuild an evicted candidate.",
      );
    const images = await render([variant.id], { collectImages: true });
    const svg = images.get(variant.id);
    if (!svg) throw new Error("The candidate did not produce a drawing.");
    return svg;
  };
  const selectedVariants = data.variants.filter((v) => selected.includes(v.id));
  const toggle = (id: string) =>
    setSelected((values) =>
      values.includes(id) ? values.filter((v) => v !== id) : [...values, id],
    );
  const remove = (ids: readonly string[]) =>
    perform(async () => {
      await mutate((current) => ({
        ...current,
        variants: current.variants.filter((v) => !ids.includes(v.id)),
      }));
      setSelected((values) => values.filter((v) => !ids.includes(v)));
    });
  const disabled = saving || !!progress || compare !== null;
  const commonActions = (variant: PcbVariant) => (
    <details>
      <summary>Actions</summary>
      <div className={styles.toolbar}>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || !canSave}
          onClick={() => onUse({ ...variant.values })}
        >
          Use these values
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || !canRender}
          onClick={() => renderButton([variant.id])}
        >
          Render{variant.thumbnail ? " again" : ""}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || !canSave || data.variants.length >= VARIANT_LIMIT}
          onClick={() =>
            void add([
              { name: `${variant.name} copy`.slice(0, 200), values: { ...variant.values } },
            ])
          }
        >
          Duplicate
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled || !canSave}
          onClick={() => void remove([variant.id])}
        >
          Delete
        </Button>
        <Field label="Rename variant">
          <Input
            key={variant.name}
            size="sm"
            defaultValue={variant.name}
            maxLength={200}
            disabled={disabled || !canSave}
            onBlur={(e) => {
              const value = e.currentTarget.value.trim();
              if (value && value !== variant.name)
                void perform(() => savePatch(variant, { name: value }));
              else e.currentTarget.value = variant.name;
            }}
          />
        </Field>
      </div>
    </details>
  );
  const status = (v: PcbVariant) =>
    progress?.id === v.id
      ? "Rendering"
      : v.error
        ? "Build failed"
        : v.thumbnail
          ? v.renderedRevision !== sourceHash
            ? "Out of date"
            : "Rendered"
          : "Queued";
  const boardKeys = (Object.keys(BOARD_COLUMNS) as (keyof typeof BOARD_COLUMNS)[]).filter((key) =>
    data.variants.some((v) => v.stats?.board[key] !== undefined),
  );
  const columns: { key: Exclude<SortKey, "name">; label: string }[] = [
    { key: "width", label: "Width" },
    { key: "height", label: "Height" },
    { key: "area", label: "Area" },
    { key: "components", label: "Parts" },
    { key: "issues", label: "Issues" },
    ...boardKeys.map((key) => ({ key, label: BOARD_COLUMNS[key] })),
  ];
  const statText = (v: PcbVariant, key: Exclude<SortKey, "name">) => {
    const value = variantStat(v, key);
    return value === null
      ? "Unavailable"
      : key === "area"
        ? formatArea(value, units)
        : key === "width" || key === "height" || key.endsWith("Mm")
          ? formatLength(value, units)
          : String(value);
  };
  const ordered = sortVariants(data.variants, sort, direction);
  return (
    <Section title="Variants" count={data.variants.length}>
      {!executionAllowed && (
        <Notice>Allow circuit code from the drawing to render variants.</Notice>
      )}
      {!allowed && (
        <Notice>Rendering variants needs terminal permission on this environment.</Notice>
      )}
      {!canSave && <Notice>Workspace write permission is required to save editor changes.</Notice>}
      {data.variants.length >= VARIANT_LIMIT && <Notice>Delete variants to add more.</Notice>}
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && canSave)
            void add([{ name: name.trim(), values: currentValues }]).then((saved) => {
              if (saved) setName("");
            });
        }}
      >
        <Input
          size="sm"
          aria-label="Variant name"
          placeholder="Save these values as…"
          maxLength={200}
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          size="xs"
          variant="outline"
          type="submit"
          disabled={disabled || !canSave || !name.trim() || data.variants.length >= VARIANT_LIMIT}
        >
          Save variant
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || !canSave || data.variants.length >= VARIANT_LIMIT}
          onClick={() => setSweep(true)}
        >
          Sweep
        </Button>
      </form>
      {!data.variants.length && (
        <p className={styles.note}>
          Save the current values as a variant, or sweep one or two parameters to compare designs
          side by side.
        </p>
      )}
      {data.variants.length > 0 && (
        <>
          <div className={styles.toolbar}>
            <Segmented
              label="Variant view"
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: "Grid" },
                { value: "table", label: "Table" },
              ]}
            />
            <label>
              Sort{" "}
              <select
                className={styles.select}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="name">Name</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setDirection((v) => (v === "asc" ? "desc" : "asc"))}
            >
              {direction === "asc" ? "Ascending" : "Descending"}
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={disabled || !canRender}
              onClick={() => renderButton(data.variants.map((v) => v.id))}
            >
              Render all
            </Button>
          </div>
          {selectedVariants.length > 0 && (
            <div className={styles.toolbar}>
              <span>{selectedVariants.length} selected</span>
              <Button
                variant="outline"
                size="xs"
                disabled={disabled || selectedVariants.length !== 2}
                onClick={() => setCompare([selectedVariants[0]!, selectedVariants[1]!])}
              >
                Compare
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={disabled || !canRender}
                onClick={() => renderButton(selected)}
              >
                Render selection
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={disabled || !canSave}
                onClick={() => void remove(selected)}
              >
                Delete selection
              </Button>
              <Button variant="ghost" size="xs" disabled={disabled} onClick={() => setSelected([])}>
                Clear selection
              </Button>
            </div>
          )}
          {progress && (
            <div role="status" className={styles.toolbar}>
              <span>
                Rendering {progress.index + 1} of {progress.total}
              </span>
              <progress value={progress.index} max={progress.total} />
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  cancel();
                  setProgress(null);
                }}
              >
                Cancel
              </Button>
            </div>
          )}
          {view === "grid" ? (
            <div className={styles.grid}>
              {ordered.map((v) => (
                <article key={v.id} className={styles.card}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Select ${v.name}`}
                      checked={selected.includes(v.id)}
                      onChange={() => toggle(v.id)}
                    />{" "}
                    {v.name}
                  </label>
                  {v.thumbnail ? (
                    <img
                      className={styles.preview}
                      src={v.thumbnail}
                      alt={`Board candidate ${v.name}`}
                    />
                  ) : (
                    <div className={styles.placeholder}>{status(v)}</div>
                  )}
                  <p className={styles.note}>
                    {status(v)}
                    {v.origin === "agent" ? "; proposed by agent" : ""}
                  </p>
                  {v.stats && (
                    <p className={styles.note}>
                      {formatLengths([v.stats.widthMm, v.stats.heightMm], units)},{" "}
                      {v.stats.components} parts, {v.stats.errors + v.stats.warnings} issues
                    </p>
                  )}
                  {v.error && <Log title="View log" text={v.error} />}
                  {commonActions(v)}
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Status</th>
                    {columns.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`Select ${v.name}`}
                            checked={selected.includes(v.id)}
                            onChange={() => toggle(v.id)}
                          />{" "}
                          {v.name}
                          {v.origin === "agent" ? " (agent)" : ""}
                        </label>
                      </td>
                      <td>
                        {status(v)}
                        {v.error && <Log title="View log" text={v.error} />}
                      </td>
                      {columns.map((c) => (
                        <td key={c.key}>{statText(v, c.key)}</td>
                      ))}
                      <td>{commonActions(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}
      {sweep && (
        <SweepDialog
          key={JSON.stringify([schema.sourceHash, schema.parameters])}
          schema={schema}
          base={currentValues}
          available={VARIANT_LIMIT - data.variants.length}
          disabled={!canSave || saving}
          add={(rows) => add(rows, true)}
          close={() => setSweep(false)}
        />
      )}
      {compare && (
        <VariantCompare
          variants={[
            data.variants.find((v) => v.id === compare[0].id) ?? compare[0],
            data.variants.find((v) => v.id === compare[1].id) ?? compare[1],
          ]}
          load={loadSvg}
          close={() => {
            cancel();
            setProgress(null);
            setCompare(null);
          }}
        />
      )}
    </Section>
  );
}
function SweepDialog({
  schema,
  base,
  available,
  disabled,
  add,
  close,
}: {
  schema: PcbParameters;
  base: Record<string, Value>;
  available: number;
  disabled: boolean;
  add: (rows: { name: string; values: Record<string, Value> }[]) => Promise<boolean | undefined>;
  close: () => void;
}) {
  const [rows, setRows] = useState([
    {
      id: "first",
      key: schema.parameters[0]!.key,
      from: "",
      to: "",
      count: "3",
      text: "",
      choices: null as Value[] | null,
    },
  ]);
  const axes = [];
  let error: string | null = null,
    count = 1;
  try {
    for (const row of rows) {
      const parameter = schema.parameters.find((p) => p.key === row.key)!;
      const initial = typeof base[parameter.key] === "number" ? (base[parameter.key] as number) : 0;
      const input: SweepInput = parameter.choices
        ? (row.choices ?? parameter.choices.slice(0, SWEEP_LIMIT))
        : parameter.type === "number"
          ? {
              from: row.from.trim() ? Number(row.from) : (parameter.min ?? initial),
              to: row.to.trim()
                ? Number(row.to)
                : (parameter.max ?? initial + 2 * (parameter.step ?? 1)),
              count: Number(row.count),
            }
          : row.text || String(base[parameter.key] ?? "");
      const values = sweepValues(parameter, input);
      count *= values.length;
      axes.push({ parameter, values });
    }
  } catch (e) {
    error = errorText(e, "Choose sweep values.");
  }
  let candidates: { name: string; values: Record<string, Value> }[] = [];
  if (!error)
    try {
      candidates = generateCandidates(base, axes);
    } catch (e) {
      error = errorText(e, "Invalid sweep.");
    }
  const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((values) => values.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup>
        <DialogTitle>Sweep circuit parameters</DialogTitle>
        <div className={styles.axes}>
          {rows.map((row, index) => {
            const p = schema.parameters.find((p) => p.key === row.key)!;
            return (
              <div key={row.id} className={styles.axis}>
                <label>
                  Parameter {index + 1}
                  <select
                    className={styles.select}
                    value={row.key}
                    onChange={(e) =>
                      update(index, {
                        key: e.target.value,
                        from: "",
                        to: "",
                        text: "",
                        choices: null,
                      })
                    }
                  >
                    {schema.parameters.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                {p.choices ? (
                  <div>
                    {p.choices.map((value) => (
                      <label key={String(value)}>
                        <input
                          type="checkbox"
                          checked={(row.choices ?? p.choices!.slice(0, SWEEP_LIMIT)).includes(
                            value,
                          )}
                          onChange={(e) => {
                            const choices = row.choices ?? p.choices!.slice(0, SWEEP_LIMIT);
                            update(index, {
                              choices: e.target.checked
                                ? [...choices, value]
                                : choices.filter((v) => v !== value),
                            });
                          }}
                        />{" "}
                        {String(value)}{" "}
                      </label>
                    ))}
                  </div>
                ) : p.type === "boolean" ? (
                  <p>Both off and on</p>
                ) : p.type === "number" ? (
                  <div className={styles.toolbar}>
                    {(["from", "to", "count"] as const).map((key) => (
                      <Field
                        key={key}
                        label={key === "count" ? "Count" : key === "from" ? "From" : "To"}
                      >
                        <Input
                          size="sm"
                          type="number"
                          value={row[key]}
                          min={key === "count" ? 2 : p.min}
                          max={key === "count" ? SWEEP_LIMIT : p.max}
                          step={key === "count" ? 1 : (p.step ?? "any")}
                          placeholder={String(
                            key === "from"
                              ? (p.min ?? base[p.key])
                              : key === "to"
                                ? (p.max ?? Number(base[p.key]) + 2 * (p.step ?? 1))
                                : 3,
                          )}
                          onChange={(e) => update(index, { [key]: e.target.value })}
                        />
                      </Field>
                    ))}
                  </div>
                ) : (
                  <Field label="Comma-separated values">
                    <Input
                      size="sm"
                      value={row.text}
                      placeholder={String(base[p.key] ?? "")}
                      onChange={(e) => update(index, { text: e.target.value })}
                    />
                  </Field>
                )}
                {index === 1 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setRows((values) => values.slice(0, 1))}
                  >
                    Remove second parameter
                  </Button>
                )}
              </div>
            );
          })}
          {rows.length < 2 && schema.parameters.length > 1 && (
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                setRows((values) => [
                  ...values,
                  {
                    ...values[0]!,
                    id: "second",
                    key: schema.parameters.find((p) => p.key !== values[0]!.key)!.key,
                    from: "",
                    to: "",
                    text: "",
                    choices: null,
                  },
                ])
              }
            >
              Add second parameter
            </Button>
          )}
          <p role="status">
            Makes {count} variants. Up to {SWEEP_LIMIT} per sweep.
          </p>
          {(error || count > available) && (
            <Notice tone="warning">{error ?? "Delete variants to add more."}</Notice>
          )}
          <div className={styles.toolbar}>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || !!error || count > available}
              onClick={() => {
                void add(candidates).then((saved) => {
                  if (saved) close();
                });
              }}
            >
              Make {count} variants
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
