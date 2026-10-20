import { BotDefinitionInput, type BotRun } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

/** Each run's reply is cut to this many bytes, so a few long replies cannot crowd out the rest. */
export const SUGGEST_RESULT_MAX_BYTES = 4096;
export const SUGGEST_DOWN_RUNS = 10;
export const SUGGEST_UP_RUNS = 5;

export const SUGGEST_EDIT_REQUEST = `You are improving a reusable bot: a fixed brief that runs again and again with different inputs.

Below are the bot as JSON, runs a person marked as bad, and runs they marked as good. Work out what the bad runs have in common that the brief allowed or caused, and change the brief so later runs avoid it without losing what made the good runs good.

You may change only these fields:

- "instructions": the brief. Refer to each input as {{name}}, using the parameter names. Prefer a focused change over a rewrite.
- "description": only if it no longer describes what the bot does.
- "parameters": only if a run failed because an input was missing or the wrong type. Each parameter is {"name","label","description","type","required"}.

Do not run tools, read files or change anything. Reply with only a JSON object holding the fields you changed, with no prose before or after it.`;

const encodeDefinition = Schema.encodeSync(Schema.fromJsonString(BotDefinitionInput));

const capBytes = (text: string, max: number) => {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return text;
  return `${new TextDecoder().decode(bytes.slice(0, max)).replace(/\uFFFD$/u, "")}\n(cut)`;
};

const describeRun = (run: BotRun, index: number) => {
  const reply = run.result === null ? "(no reply)" : capBytes(run.result, SUGGEST_RESULT_MAX_BYTES);
  const outcome = run.verdict == null ? run.status : `${run.status}, ${run.verdict.verdict}`;
  return [
    `### Run ${index + 1} (${outcome})`,
    `Inputs: ${JSON.stringify(run.inputs)}`,
    ...(run.note == null ? [] : [`Their note: ${run.note}`]),
    ...(run.error === null ? [] : [`Error: ${run.error}`]),
    `Reply:\n${reply}`,
  ].join("\n");
};

/** The question a suggestion asks the bot's model, with the rated runs it learns from. */
export const suggestEditPrompt = (
  definition: BotDefinitionInput,
  down: ReadonlyArray<BotRun>,
  up: ReadonlyArray<BotRun>,
) =>
  [
    SUGGEST_EDIT_REQUEST,
    `## Bot\n\n${encodeDefinition(definition)}`,
    `## Bad runs\n\n${down.map(describeRun).join("\n\n")}`,
    ...(up.length === 0 ? [] : [`## Good runs\n\n${up.map(describeRun).join("\n\n")}`]),
  ].join("\n\n");
