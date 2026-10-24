import { initialRunValues } from "@t3tools/client-runtime/fork";
import type { BotDefinition, BotInputs, BotParameter } from "@t3tools/contracts/fork";

/**
 * What stops each input from being sent, by parameter name. The server checks too; this catches
 * a blank required field or a number that is not one before the round trip, since `runInputs`
 * would send "abc" as NaN.
 */
export function runInputErrors(
  parameters: readonly BotParameter[],
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const parameter of parameters) {
    if (parameter.type === "boolean") continue;
    const raw = values[parameter.name] ?? "";
    if (raw.trim() === "") {
      // A blank input is left out and the server fills in the default, so only one without a
      // default must be filled in.
      if (parameter.required && (parameter.default ?? "").trim() === "")
        errors[parameter.name] = "Fill this in to run.";
      continue;
    }
    if (parameter.type === "number" && !Number.isFinite(Number(raw.trim())))
      errors[parameter.name] = "Enter a number, such as 3 or 2.5.";
    else if (parameter.type === "choice" && !(parameter.choices ?? []).includes(raw))
      errors[parameter.name] = "Choose one of the options.";
  }
  return errors;
}

/** Takes the person to the first input, in form order, that stops the run. */
export function focusFirstInputError(
  parameters: readonly BotParameter[],
  errors: Readonly<Record<string, string>>,
  idOf: (name: string) => string,
) {
  const first = parameters.find((parameter) => errors[parameter.name] !== undefined);
  if (first) document.getElementById(idOf(first.name))?.focus();
}

/**
 * Form values for running a bot again with an earlier run's inputs. Inputs the bot has since
 * dropped are left out and named, and inputs it has since added keep their defaults.
 */
export function runValuesFrom(
  bot: Pick<BotDefinition, "parameters">,
  inputs: BotInputs,
): { readonly values: Record<string, string>; readonly dropped: readonly string[] } {
  const values = initialRunValues(bot);
  const names = new Set(bot.parameters.map((parameter) => parameter.name));
  for (const [name, value] of Object.entries(inputs))
    if (names.has(name)) values[name] = String(value);
  return {
    values,
    dropped: Object.keys(inputs).filter((name) => !names.has(name)),
  };
}

const DESCRIPTION_MAX = 160;

/** A bot's description short enough for a dialog's subtitle, cut at a word. */
export function shortDescription(text: string) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= DESCRIPTION_MAX) return trimmed;
  const cut = trimmed.slice(0, DESCRIPTION_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > DESCRIPTION_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}
