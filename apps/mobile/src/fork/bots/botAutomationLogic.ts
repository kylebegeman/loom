import type { BotDefinition, BotPipeline, BotTrigger } from "@t3tools/contracts/fork";
import { BOT_TRIGGER_EVENT_FIELDS } from "@t3tools/contracts/fork";
import { needsProject } from "@t3tools/client-runtime/fork";

export interface TriggerTestField {
  readonly key: string;
  readonly name: string;
  readonly value: string;
  readonly type: "string" | "number" | "boolean";
}

let testFieldKeys = 0;
export const newTriggerTestField = (name = ""): TriggerTestField => ({
  key: `event-field-${++testFieldKeys}`,
  name,
  value: "",
  type: "string",
});

export const initialTriggerTestFields = (
  trigger: Pick<BotTrigger, "event" | "mapping">,
): ReadonlyArray<TriggerTestField> =>
  [
    ...new Set(
      trigger.event.kind === "webhook"
        ? Object.values(trigger.mapping).flatMap((entry) => ("field" in entry ? [entry.field] : []))
        : BOT_TRIGGER_EVENT_FIELDS[trigger.event.kind],
    ),
  ].map((name) => newTriggerTestField(name));

export function triggerTestFields(
  fields: ReadonlyArray<Omit<TriggerTestField, "key">>,
): { readonly fields: Record<string, string | number | boolean> } | { readonly error: string } {
  const result = new Map<string, string | number | boolean>();
  for (const field of fields) {
    const name = field.name.trim();
    if (name === "") return { error: "Name every event field, or remove the empty field." };
    if (result.has(name)) return { error: `The event field ${name} appears more than once.` };
    if (field.type === "number") {
      const number = Number(field.value);
      if (field.value.trim() === "" || !Number.isFinite(number))
        return { error: `${name} needs a number.` };
      result.set(name, number);
    } else if (field.type === "boolean") result.set(name, field.value === "true");
    else result.set(name, field.value);
  }
  return { fields: Object.fromEntries(result) };
}

export const pipelineNeedsProject = (pipeline: BotPipeline, bots: ReadonlyArray<BotDefinition>) =>
  pipeline.steps.some((step) => {
    const bot = bots.find((candidate) => candidate.id === step.botId);
    return bot !== undefined && needsProject(bot);
  });
