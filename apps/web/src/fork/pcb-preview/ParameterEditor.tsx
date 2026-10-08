import { randomUUID } from "~/lib/utils";
import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { CheckIcon, FileDiffIcon, RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { PcbApplyParametersResult, PcbParameter, PcbWorkspace } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import { runModelCommand as runPcbCommand } from "../model-preview-3d/state";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { OperationStatus } from "./OperationStatus";
import {
  Bar,
  Chip,
  EmptyState,
  errorText,
  Footer,
  Notice,
  Range,
  Scroll,
  SearchField,
  Section,
  Segmented,
  useWrite,
} from "./InspectorKit";
import { diffHunks, lineDiff } from "./diff";
import { ToolButton } from "./ToolButton";
import k from "./inspector.module.css";

type Value = string | number | boolean;
const SEARCH_AFTER = 8;

export function ParameterEditor({
  threadRef,
  designId,
  data,
  canSave,
  onSave,
  onRemove,
}: {
  threadRef: ScopedThreadRef;
  designId: string;
  data: PcbWorkspace;
  canSave: boolean;
  onSave: (variant: PcbWorkspace["variants"][number]) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}) {
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, designId },
  };
  const result = useAtomValue(pcb.parameters(target)),
    schema = asyncValue(result);
  const [values, setValues] = useState<Record<string, Value>>({}),
    [review, setReview] = useState<PcbApplyParametersResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [name, setName] = useState(""),
    [query, setQuery] = useState("");
  const write = useWrite("The variant could not be saved.");
  if (!schema)
    return (
      <Scroll>
        {result.waiting || result._tag === "Initial" ? (
          <OperationStatus label="Reading circuit parameters" />
        ) : (
          <Notice tone="error" role="alert">
            {asyncError(result)}
          </Notice>
        )}
      </Scroll>
    );
  if (!schema.parameters.length)
    return (
      <Scroll>
        <EmptyState icon={<SlidersHorizontalIcon />} title="No editable parameters">
          <p>
            Add a schema beside the tscircuit source, named{" "}
            <code className={k.mono}>{designId}.parameters.json</code>, and mark each editable
            literal with a unique <code className={k.mono}>{"/* loom:param key */"}</code>.
          </p>
          <p>Ask the agent to define the schema for this circuit.</p>
        </EmptyState>
      </Scroll>
    );
  const baseline = (p: PcbParameter) => schema.values?.[p.key] ?? p.default;
  const current = (p: PcbParameter) => values[p.key] ?? baseline(p);
  const changed = schema.parameters.filter((p) => current(p) !== baseline(p));
  const edit = (next: Record<string, Value>) => {
    setValues(next);
    setReview(null);
    setError(null);
  };
  const apply = async (preview: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const output = await runPcbCommand(pcb.applyParameters, {
        ...target,
        input: {
          ...target.input,
          values: Object.fromEntries(changed.map((p) => [p.key, current(p)])),
          expectedSourceHash: schema.sourceHash,
          preview,
          revision: randomUUID(),
        },
      });
      setReview(output);
      if (output.applied) appAtomRegistry.refresh(pcb.parameters(target));
    } catch (e) {
      setError(errorText(e, "Parameters could not apply."));
    } finally {
      setBusy(false);
    }
  };
  const snapshot = () => Object.fromEntries(schema.parameters.map((p) => [p.key, current(p)]));
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? schema.parameters.filter((p) =>
        `${p.label} ${p.key} ${p.description}`.toLowerCase().includes(needle),
      )
    : schema.parameters;
  const hunks = review ? diffHunks(lineDiff(review.previous, review.source)) : [];
  return (
    <>
      {schema.parameters.length > SEARCH_AFTER && (
        <Bar>
          <SearchField
            label="Filter parameters"
            placeholder="Filter parameters"
            value={query}
            onChange={setQuery}
          />
        </Bar>
      )}
      <Scroll>
        <Section title="Variants" count={data.variants.length || undefined}>
          {data.variants.length > 0 && (
            <div className={k.chips}>
              {data.variants.map((variant) => (
                <Chip
                  key={variant.id}
                  pressed={schema.parameters.every((p) => variant.values[p.key] === current(p))}
                  onClick={() =>
                    edit(
                      Object.fromEntries(
                        Object.entries(variant.values).filter(([key]) =>
                          schema.parameters.some((p) => p.key === key),
                        ),
                      ),
                    )
                  }
                  onRemove={() => void write.run(() => onRemove(variant.id))}
                  removeLabel={`Remove variant ${variant.name}`}
                  disabled={busy || write.busy || !canSave}
                >
                  {variant.name}
                </Chip>
              ))}
            </div>
          )}
          <form
            className={k.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSave || !name.trim()) return;
              void write
                .run(() =>
                  onSave({
                    id: randomUUID(),
                    name: name.trim(),
                    sourceHash: schema.sourceHash,
                    values: snapshot(),
                  }),
                )
                .then((saved) => saved && setName(""));
            }}
          >
            <Input
              size="sm"
              aria-label="Variant name"
              placeholder="Save these values as…"
              disabled={write.busy}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!canSave || !name.trim() || write.busy}
            >
              Save variant
            </Button>
          </form>
          {write.error && (
            <p role="alert" className={k.error}>
              {write.error}
            </p>
          )}
        </Section>
        <Section title="Parameters" count={schema.parameters.length}>
          <div className={k.paramList}>
            {shown.map((p) => (
              <ParameterRow
                key={p.key}
                parameter={p}
                value={current(p)}
                modified={current(p) !== baseline(p)}
                onChange={(value) => edit({ ...values, [p.key]: value })}
                onReset={() => {
                  const { [p.key]: _, ...rest } = values;
                  edit(rest);
                }}
              />
            ))}
            {!shown.length && <p className={k.hint}>No parameter matches “{query}”.</p>}
          </div>
        </Section>
        {busy && <OperationStatus label="Preparing circuit source" />}
        {error && (
          <p role="alert" className={k.error}>
            {error}
          </p>
        )}
        {review && (
          <Section
            title={review.applied ? "Applied to source" : "Source change"}
            count={`${hunks.filter((l) => l?.kind === "added").length} lines`}
          >
            {review.applied && (
              <Notice tone="success" icon={<CheckIcon />}>
                The circuit source now uses these values. The preview rebuilds on its own.
              </Notice>
            )}
            {hunks.length ? (
              <div className={k.diff} role="table" aria-label="Source change">
                {hunks.map((line, i) =>
                  line ? (
                    <div
                      key={`${line.kind}:${line.line}`}
                      className={k.diffLine}
                      data-kind={line.kind}
                      role="row"
                    >
                      <span className={k.diffNumber} aria-hidden="true">
                        {line.line}
                      </span>
                      <span className={k.diffSign} aria-hidden="true">
                        {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
                      </span>
                      <code role="cell">{line.text || " "}</code>
                    </div>
                  ) : (
                    <div
                      key={`gap:${hunks[i - 1]?.line ?? 0}`}
                      className={k.diffGap}
                      aria-hidden="true"
                    >
                      ⋯
                    </div>
                  ),
                )}
              </div>
            ) : (
              <p className={k.hint}>The source already uses these values.</p>
            )}
          </Section>
        )}
      </Scroll>
      {(changed.length > 0 || (review && !review.applied)) && (
        <Footer>
          <span className={k.footerStatus}>
            <span className={k.dot} data-tone="warning" aria-hidden="true" />
            {changed.length} change{changed.length === 1 ? "" : "s"}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => edit({})}>
            Reset
          </Button>
          {review && !review.applied ? (
            <Button size="sm" disabled={busy} onClick={() => void apply(false)}>
              <CheckIcon />
              Apply to source
            </Button>
          ) : (
            <Button size="sm" disabled={busy || !changed.length} onClick={() => void apply(true)}>
              <FileDiffIcon />
              Review change
            </Button>
          )}
        </Footer>
      )}
    </>
  );
}

function ParameterRow({
  parameter: p,
  value,
  modified,
  onChange,
  onReset,
}: {
  parameter: PcbParameter;
  value: Value;
  modified: boolean;
  onChange: (value: Value) => void;
  onReset: () => void;
}) {
  const id = useId();
  const typed = (raw: string) => (p.type === "number" ? Number(raw) : raw);
  const number = (
    <NumberField
      id={id}
      size="sm"
      value={Number(value)}
      min={p.min}
      max={p.max}
      step={p.step}
      onValueChange={(next) => {
        if (next !== null && Number.isFinite(next)) onChange(next);
      }}
    >
      <NumberFieldGroup>
        <NumberFieldInput aria-label={p.label} />
      </NumberFieldGroup>
    </NumberField>
  );
  return (
    <div className={k.param} data-modified={modified || undefined}>
      <div className={k.paramHead}>
        <label htmlFor={id}>{p.label}</label>
        {p.unit && <span className={k.paramUnit}>{p.unit}</span>}
        {modified && <span className={k.dot} data-tone="warning" aria-label="Changed" />}
        <ToolButton
          className={k.paramReset}
          label={`Reset ${p.label}`}
          disabled={!modified}
          onClick={onReset}
        >
          <RotateCcwIcon />
        </ToolButton>
      </div>
      {p.choices ? (
        p.choices.length <= 4 ? (
          <Segmented
            label={p.label}
            value={String(value)}
            onChange={(next) => onChange(typed(next))}
            options={p.choices.map((c) => ({ value: String(c), label: String(c) }))}
          />
        ) : (
          <Select
            value={String(value)}
            onValueChange={(next) => {
              if (next !== null) onChange(typed(next));
            }}
            items={p.choices.map((c) => ({ value: String(c), label: String(c) }))}
          >
            <SelectTrigger id={id} size="sm" aria-label={p.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {p.choices.map((c) => (
                <SelectItem key={String(c)} value={String(c)}>
                  {String(c)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )
      ) : p.type === "boolean" ? (
        <div className={k.paramSwitch}>
          <Switch
            id={id}
            size="sm"
            aria-label={p.label}
            checked={Boolean(value)}
            onCheckedChange={(next) => onChange(next)}
          />
          <span>{value ? "On" : "Off"}</span>
        </div>
      ) : p.type === "number" ? (
        p.min !== undefined && p.max !== undefined ? (
          <div className={k.paramRange}>
            <Range
              label={`${p.label} slider`}
              min={p.min}
              max={p.max}
              step={p.step}
              value={Number(value)}
              onChange={onChange}
            />
            {number}
          </div>
        ) : (
          number
        )
      ) : (
        <Input
          id={id}
          size="sm"
          aria-label={p.label}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {p.description && <p className={k.fieldHint}>{p.description}</p>}
    </div>
  );
}
