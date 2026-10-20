import { UTILITY_TOOL_META } from "./registry-meta";
import { CHMOD_TOOLS } from "./tools/chmod";
import { CIDR_TOOLS } from "./tools/cidr";
import { CONVERT_TOOLS } from "./tools/convert";
import { CRON_TOOLS } from "./tools/cron";
import { ENCODE_TOOLS } from "./tools/encode";
import { GENERATE_TOOLS } from "./tools/generate";
import { HASH_TOOLS } from "./tools/hash";
import { checkInputSize, limitResult } from "./tools/limits";
import { REGEX_TOOLS } from "./tools/regexMatch";
import { TEXT_TOOLS } from "./tools/text";
import { WEB_TOOLS } from "./tools/web";
import {
  defaultOptions,
  error,
  type UtilityResult,
  type UtilityRunInput,
  type UtilityTool,
  type UtilityToolImpl,
} from "./types";

export const UTILITY_IMPLEMENTATIONS: Readonly<Record<string, UtilityToolImpl>> = {
  ...ENCODE_TOOLS,
  ...HASH_TOOLS,
  ...GENERATE_TOOLS,
  ...CONVERT_TOOLS,
  ...CRON_TOOLS,
  ...CHMOD_TOOLS,
  ...TEXT_TOOLS,
  ...REGEX_TOOLS,
  ...WEB_TOOLS,
  ...CIDR_TOOLS,
};

/** Metadata order is list order; a tool without an implementation is left out, not shown broken. */
export const UTILITY_TOOLS: ReadonlyArray<UtilityTool> = UTILITY_TOOL_META.flatMap((meta) => {
  const impl = UTILITY_IMPLEMENTATIONS[meta.id];
  return impl ? [{ ...meta, ...impl }] : [];
});

export const findUtilityTool = (id: string) => UTILITY_TOOLS.find((tool) => tool.id === id) ?? null;

/**
 * Every run goes through here: the size limit first, the user's options over the defaults,
 * a thrown error shown as an error rather than a blank panel, and the output cap last.
 */
export function runUtilityTool(
  tool: UtilityTool,
  action: "run" | "generate",
  input: UtilityRunInput,
): UtilityResult | null {
  const transform = action === "run" ? tool.run : tool.generate;
  if (!transform) return null;
  const tooLarge = checkInputSize(input.text, input.second);
  if (tooLarge) return tooLarge;
  try {
    return limitResult(
      transform({ ...input, options: { ...defaultOptions(tool.options), ...input.options } }),
    );
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause));
  }
}
