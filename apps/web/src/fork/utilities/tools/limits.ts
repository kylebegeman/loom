import { error, type UtilityResult } from "../types";

export const MAX_INPUT_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const TRUNCATION_MARKER = "\n[Output truncated]";
export const OUTPUT_TRUNCATED_WARNING = "Output truncated";

/** UTF-8 length without allocating, so oversized input is refused before any real work. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(text.charCodeAt(index + 1))) {
      bytes += 4;
      index++;
    } else bytes += 3; // BMP, or a lone surrogate, which TextEncoder writes as U+FFFD.
  }
  return bytes;
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The input-size error for any input over the limit, or null. */
export function checkInputSize(...inputs: ReadonlyArray<string>): UtilityResult | null {
  let total = 0;
  for (const input of inputs) {
    // Each UTF-16 unit is at most 3 bytes, so short inputs skip the count entirely.
    if (input.length * 3 <= MAX_INPUT_BYTES - total) {
      total += input.length * 3;
      continue;
    }
    total += utf8ByteLength(input);
    if (total > MAX_INPUT_BYTES) return error("Input is larger than 1 MiB.");
  }
  return null;
}

/**
 * Caps a value at MAX_OUTPUT_BYTES of UTF-8, marker included, cutting only between code
 * points.
 */
export function truncateOutput(value: string): {
  readonly value: string;
  readonly truncated: boolean;
} {
  if (value.length * 3 <= MAX_OUTPUT_BYTES || utf8ByteLength(value) <= MAX_OUTPUT_BYTES)
    return { value, truncated: false };
  const budget = MAX_OUTPUT_BYTES - utf8ByteLength(TRUNCATION_MARKER);
  let bytes = 0;
  let end = 0;
  while (end < value.length) {
    const code = value.charCodeAt(end);
    const pair = code >= 0xd800 && code <= 0xdbff && isLowSurrogate(value.charCodeAt(end + 1));
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes + size > budget) break;
    bytes += size;
    end += pair ? 2 : 1;
  }
  return { value: value.slice(0, end) + TRUNCATION_MARKER, truncated: true };
}

/** Applies the output cap to every field and says so once. */
export function limitResult(result: UtilityResult): UtilityResult {
  if (result.kind === "error") return result;
  let truncated = false;
  const fields = result.fields.map((field) => {
    const capped = truncateOutput(field.value);
    if (!capped.truncated) return field;
    truncated = true;
    return { ...field, value: capped.value };
  });
  if (!truncated) return result;
  return {
    kind: "ok",
    fields,
    warnings: [...(result.warnings ?? []), OUTPUT_TRUNCATED_WARNING],
  };
}
