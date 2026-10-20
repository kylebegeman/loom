import { error, ok, stringOption, type UtilityToolImpl } from "../types";

export const REGEX_MAX_MATCHES = 1000;

// Compiling costs up to tens of milliseconds per KiB of pattern (a class of many
// `\p{RGI_Emoji}` under `v`, for example), so a 1 MiB pattern would block the page for
// seconds. Longer patterns are compiled only by the worker, under its time limit.
const MAX_MAIN_THREAD_PATTERN_LENGTH = 1000;

// V8 aborts the whole process, not just the worker, when it compiles lookarounds or
// alternations nested a few thousand deep: about 100 bytes of stack per level. This bound
// stays far below that on any thread stack, and real patterns nest a handful of levels.
const MAX_GROUP_DEPTH = 500;

const FLAGS = "dgimsuvy";
const FLAG_LIST = "d, g, i, m, s, u, v and y";

/** A user-facing message for flags `RegExp` would reject, or null when they are valid. */
export function validateFlags(flags: string): string | null {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!FLAGS.includes(flag)) return `Unknown flag "${flag}". Flags can be ${FLAG_LIST}.`;
    if (seen.has(flag)) return `The "${flag}" flag is repeated.`;
    seen.add(flag);
  }
  if (seen.has("u") && seen.has("v")) return "The u and v flags cannot be used together.";
  return null;
}

/**
 * `new RegExp` parses without matching, so it cannot backtrack; its cost grows with the
 * pattern's length, which is why `run` bounds that before compiling on the main thread.
 */
export function compileRegex(
  pattern: string,
  flags: string,
): { readonly regex: RegExp } | { readonly error: string } {
  const flagError = validateFlags(flags);
  if (flagError) return { error: flagError };
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (cause) {
    const unsupported = unsupportedFlag(flags);
    if (unsupported) return { error: `This browser does not support the "${unsupported}" flag.` };
    return { error: `Invalid regular expression: ${syntaxReason(cause, pattern, flags)}.` };
  }
  if (groupDepthExceeds(pattern, MAX_GROUP_DEPTH))
    return { error: `Groups nested more than ${MAX_GROUP_DEPTH} levels deep are not supported.` };
  return { regex };
}

// Runs after a successful compile, so parentheses balance and none hide in a `v` class.
function groupDepthExceeds(pattern: string, limit: number): boolean {
  let depth = 0;
  let inClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "\\") index++;
    else if (inClass) inClass = char !== "]";
    else if (char === "[") inClass = true;
    else if (char === "(") {
      depth++;
      if (depth > limit) return true;
    } else if (char === ")") depth--;
  }
  return false;
}

const canonicalFlags = (flags: string) =>
  [...FLAGS].filter((flag) => flags.includes(flag)).join("");

// Older engines lack `d` or `v`; their constructor error would otherwise read as a pattern error.
function unsupportedFlag(flags: string): string | null {
  for (const flag of flags) if (!isSupportedFlag(flag)) return flag;
  return null;
}

function isSupportedFlag(flag: string): boolean {
  try {
    return new RegExp("", flag).flags.includes(flag);
  } catch {
    return false;
  }
}

/**
 * Engines word this differently. V8 says "Invalid regular expression: /(/g: Unterminated
 * group", Safari "Invalid regular expression: missing )", Firefox "unterminated
 * parenthetical". The pattern is already on screen, so keep only the reason.
 */
function syntaxReason(cause: unknown, pattern: string, flags: string): string {
  let reason = cause instanceof Error ? cause.message : String(cause);
  const prefix = "Invalid regular expression: ";
  if (reason.startsWith(prefix)) reason = reason.slice(prefix.length);
  // V8 prints the flags in canonical order rather than as typed.
  const literal = `/${pattern}/${canonicalFlags(flags)}: `;
  if (reason.startsWith(literal)) reason = reason.slice(literal.length);
  else if (reason.startsWith("/") && reason.includes(": "))
    reason = reason.slice(reason.lastIndexOf(": ") + 2);
  reason = reason.trim().replace(/\.$/, "");
  if (reason === "") return "the pattern could not be parsed";
  // Lowercase a leading capital so it reads as one sentence, but leave acronyms alone.
  return /^[A-Z][a-z]/.test(reason) ? reason.charAt(0).toLowerCase() + reason.slice(1) : reason;
}

export interface RegexMatch {
  readonly index: number;
  /** Exclusive, in UTF-16 code units like `index`. */
  readonly end: number;
  readonly value: string;
  /** Capture groups by number: group 1 is at 0. Groups that did not take part are undefined. */
  readonly groups: ReadonlyArray<string | undefined>;
  readonly named: Readonly<Record<string, string | undefined>>;
  /** With the `d` flag only. Aligned with `groups`; the whole match is `index` to `end`. */
  readonly indices?: ReadonlyArray<readonly [number, number] | undefined>;
}

export type RegexMatchResult =
  | {
      readonly kind: "ok";
      readonly matches: ReadonlyArray<RegexMatch>;
      readonly truncated: boolean;
    }
  | { readonly kind: "error"; readonly message: string };

/**
 * Only the regex worker calls this: a pattern that backtracks catastrophically blocks
 * whatever thread runs it, and nothing can interrupt it.
 */
export function matchAll(
  pattern: string,
  flags: string,
  text: string,
  options: { readonly maxMatches: number },
): RegexMatchResult {
  const compiled = compileRegex(pattern, flags);
  if ("error" in compiled) return { kind: "error", message: compiled.error };
  const { regex } = compiled;
  const limit = Math.max(0, Math.floor(options.maxMatches));
  const found: Array<RegexMatch> = [];
  try {
    // `String.prototype.matchAll` throws without `g`; a single `exec` is what the pattern means then.
    const all = regex.global ? text.matchAll(regex) : [regex.exec(text)];
    for (const match of all) {
      if (match === null) break;
      if (found.length === limit) return { kind: "ok", matches: found, truncated: true };
      found.push(toMatch(match));
    }
  } catch (cause) {
    // V8 compiles on first use, so an oversized pattern fails here ("Regular expression too
    // large"), with a message that repeats the whole pattern.
    return { kind: "error", message: `Matching failed: ${syntaxReason(cause, pattern, flags)}.` };
  }
  return { kind: "ok", matches: found, truncated: false };
}

function toMatch(match: RegExpExecArray): RegexMatch {
  const value = match[0] ?? "";
  const index = match.index;
  const groups: Array<string | undefined> = [];
  for (let group = 1; group < match.length; group++) groups.push(match[group]);
  // Copied into a plain object: the engine's has a null prototype, and the reply is cloned.
  const named: Record<string, string | undefined> = { ...match.groups };
  const base = { index, end: index + value.length, value, groups, named };
  const indices = match.indices;
  if (!indices) return base;
  const spans: Array<readonly [number, number] | undefined> = [];
  for (let group = 1; group < indices.length; group++) {
    const span: readonly [number, number] | undefined = indices[group];
    spans.push(span ? [span[0], span[1]] : undefined);
  }
  return { ...base, indices: spans };
}

const EXAMPLE_TEXT = [
  "Ada Lovelace <ada@example.com>",
  "Grace Hopper <grace@navy.mil>",
  "Linus Torvalds <linus@kernel.org>",
].join("\n");

export const REGEX_TOOLS = {
  regex: {
    input: "two",
    inputLabel: "Pattern",
    secondInputLabel: "Test text",
    placeholder: "Pattern without the surrounding slashes",
    options: [{ kind: "text", id: "flags", label: "Flags", defaultValue: "g", placeholder: FLAGS }],
    example: {
      text: "(\\w+)@(?<host>[\\w.]+)",
      second: EXAMPLE_TEXT,
      options: { flags: "g" },
    },
    // Matching happens in the worker (RegexView); here the pattern is only checked.
    run: ({ text, options }) => {
      const flags = stringOption(options, "flags", "g");
      if (text.length > MAX_MAIN_THREAD_PATTERN_LENGTH) {
        const flagError = validateFlags(flags);
        if (flagError) return error(flagError);
        const literal = `/${text}/${canonicalFlags(flags)}`;
        return ok([{ label: "Pattern", value: literal, monospace: true }]);
      }
      const compiled = compileRegex(text, flags);
      if ("error" in compiled) return error(compiled.error);
      return ok([{ label: "Pattern", value: String(compiled.regex), monospace: true }]);
    },
  },
} satisfies Record<string, UtilityToolImpl>;
