import {
  BOTS_BATCH_MAX_ITEMS,
  type BotFinding,
  type BotInputs,
  type BotParameter,
  type BotPipelineStep,
  type BotRunStatus,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";

import { cutLabel } from "../batchSources.ts";
import { PLACEHOLDER, STRING_MAX, TEXT_MAX } from "../render.ts";

/** What an attempt keeps of its run or batch, for later steps' templates and the report. */
export interface StepOutput {
  readonly status: BotRunStatus;
  readonly verdict: BotVerdictValue | null;
  readonly summary: string | null;
  readonly findings: ReadonlyArray<BotFinding>;
  /** The reply, or the batch report for a fan-out step, cut to {@link OUTPUT_RESULT_MAX}. */
  readonly result: string | null;
  readonly error: string | null;
}

export const OUTPUT_RESULT_MAX = 20_000;

const STEP_FIELDS = ["result", "verdict", "summary", "findings"] as const;
export type StepField = (typeof STEP_FIELDS)[number];
const ITEM_FIELDS = ["title", "detail", "path", "line"] as const;
type ItemField = (typeof ITEM_FIELDS)[number];

export type Reference =
  | { readonly kind: "input"; readonly name: string }
  | { readonly kind: "step"; readonly stepId: string; readonly field: StepField }
  | { readonly kind: "item"; readonly field: ItemField | null }
  | { readonly kind: "round" };

const isStepField = (value: string): value is StepField =>
  (STEP_FIELDS as ReadonlyArray<string>).includes(value);
const isItemField = (value: string): value is ItemField =>
  (ITEM_FIELDS as ReadonlyArray<string>).includes(value);

/** Null for anything that is not a pipeline reference. */
export const parseReference = (inner: string): Reference | null => {
  const parts = inner.trim().split(".");
  const [head, second, third] = parts;
  if (head === "round" && parts.length === 1) return { kind: "round" };
  if (head === "item" && parts.length === 1) return { kind: "item", field: null };
  if (head === "item" && parts.length === 2 && second !== undefined && isItemField(second))
    return { kind: "item", field: second };
  if (head === "input" && parts.length === 2 && second) return { kind: "input", name: second };
  if (head === "steps" && parts.length === 3 && second && third !== undefined && isStepField(third))
    return { kind: "step", stepId: second, field: third };
  return null;
};

/** Every placeholder in a template, parsed, with the ones that are not references. */
export const templateReferences = (template: string) => {
  const references: Array<Reference> = [];
  const unknown: Array<string> = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const reference = parseReference(match[1] ?? "");
    if (reference === null) unknown.push(match[0]);
    else references.push(reference);
  }
  return { references, unknown };
};

/** A fan-out item: a finding of an earlier step, or one line of a text input. */
export type FanOutItem = BotFinding | string;

const location = (finding: BotFinding) =>
  finding.path === undefined
    ? ""
    : finding.line === undefined
      ? finding.path
      : `${finding.path}:${finding.line}`;

const findingLine = (finding: BotFinding) => {
  const where = location(finding);
  return `${finding.title}${where === "" ? "" : ` (${where})`}${finding.detail === "" ? "" : `: ${finding.detail}`}`;
};

export const renderFindings = (findings: ReadonlyArray<BotFinding>) =>
  findings.map((finding) => `- ${findingLine(finding)}`).join("\n");

const itemValue = (item: FanOutItem, field: ItemField | null): string => {
  if (typeof item === "string") return field === null || field === "title" ? item : "";
  switch (field) {
    case null:
      return findingLine(item);
    case "title":
      return item.title;
    case "detail":
      return item.detail;
    case "path":
      return item.path ?? "";
    case "line":
      return item.line === undefined ? "" : String(item.line);
  }
};

export interface TemplateContext {
  readonly inputs: BotInputs;
  /** The latest finished attempt of each step that has one. */
  readonly outputs: ReadonlyMap<string, StepOutput>;
  readonly item: FanOutItem | null;
  readonly round: number;
  /** A run a trigger started takes its inputs from the event, so they are untrusted too. */
  readonly inputsUntrusted: boolean;
}

const stepValue = (output: StepOutput | undefined, field: StepField): string => {
  if (output === undefined) return "";
  switch (field) {
    case "result":
      return output.result ?? "";
    case "verdict":
      return output.verdict ?? "";
    case "summary":
      return output.summary ?? "";
    case "findings":
      return renderFindings(output.findings);
  }
};

/**
 * Fills a template. A reference to a step that has not run yet, such as a later step inside a
 * loop in its first round, renders empty; a placeholder that is not a reference stays as written.
 */
export const renderTemplate = (template: string, context: TemplateContext) => {
  let untrusted = false;
  const value = template.replace(PLACEHOLDER, (match, inner: string) => {
    const reference = parseReference(inner);
    if (reference === null) return match;
    switch (reference.kind) {
      case "input": {
        if (context.inputsUntrusted) untrusted = true;
        const input = context.inputs[reference.name];
        return input === undefined ? "" : String(input);
      }
      case "step":
        untrusted = true;
        return stepValue(context.outputs.get(reference.stepId), reference.field);
      case "item":
        untrusted = true;
        return context.item === null ? "" : itemValue(context.item, reference.field);
      case "round":
        return String(context.round);
    }
  });
  return { value, untrusted };
};

const CUT_MARK = "\n[cut]";

export interface RenderedInputs {
  readonly values: Readonly<Record<string, string>>;
  /** Parameters whose value came from a step's output, an item or a trigger's event. */
  readonly untrusted: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

/** Renders a step's inputs and cuts each to its parameter's limit, noting what was cut. */
export const renderStepInputs = (
  step: Pick<BotPipelineStep, "inputs">,
  parameters: ReadonlyArray<BotParameter>,
  context: TemplateContext,
): RenderedInputs => {
  const values: Record<string, string> = {};
  const untrusted: Array<string> = [];
  const notes: Array<string> = [];
  for (const [name, template] of Object.entries(step.inputs)) {
    const parameter = parameters.find((candidate) => candidate.name === name);
    const rendered = renderTemplate(template, context);
    const max = parameter?.type === "text" ? TEXT_MAX : STRING_MAX;
    let value = rendered.value;
    if (value.length > max) {
      value = `${value.slice(0, max - CUT_MARK.length)}${CUT_MARK}`;
      notes.push(`${parameter?.label ?? name} was cut to ${max} characters.`);
    }
    values[name] = value;
    if (rendered.untrusted) untrusted.push(name);
  }
  return { values, untrusted, notes };
};

/** One item per finding, or per non-empty line of a text input, at most a batch's worth. */
export const fanOutItems = (from: string, context: TemplateContext) => {
  const reference = parseReference(from.trim().replace(/^\{\{|\}\}$/g, ""));
  const all: ReadonlyArray<FanOutItem> =
    reference?.kind === "step" && reference.field === "findings"
      ? (context.outputs.get(reference.stepId)?.findings ?? [])
      : reference?.kind === "input"
        ? String(context.inputs[reference.name] ?? "")
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "")
        : [];
  return {
    items: all.slice(0, BOTS_BATCH_MAX_ITEMS),
    notes:
      all.length > BOTS_BATCH_MAX_ITEMS
        ? [`Only the first ${BOTS_BATCH_MAX_ITEMS} of ${all.length} items ran.`]
        : [],
  };
};

/** The batch row's label for an item: its `itemLabel` template, else its title or line. */
export const itemLabel = (
  step: Pick<BotPipelineStep, "forEach">,
  item: FanOutItem,
  context: TemplateContext,
) => {
  const template = step.forEach?.itemLabel;
  const label =
    template === undefined
      ? itemValue(item, "title")
      : renderTemplate(template, { ...context, item }).value;
  return cutLabel(label.trim() === "" ? itemValue(item, null) : label);
};

/** "fix-tests" reads as "Fix tests". */
export const stepLabel = (stepId: string) => {
  const words = stepId.replaceAll("-", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};
