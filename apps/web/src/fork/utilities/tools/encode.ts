import { decodeJwt, decodeProtectedHeader, type JWTPayload } from "jose";

import {
  booleanOption,
  error,
  ok,
  stringOption,
  type UtilityOption,
  type UtilityOptionValues,
  type UtilityOutputField,
  type UtilityResult,
  type UtilityRunInput,
  type UtilityToolImpl,
} from "../types";
import { base64ToBytes, bytesToBase64, bytesToHex, utf8Bytes } from "./bytes";
import { MAX_OUTPUT_BYTES } from "./limits";
import { formatLocal, isValidTimeZone } from "./time";

const ENCODE = "encode";
const DECODE = "decode";

const directionOption = (encodeLabel: string, decodeLabel: string): UtilityOption => ({
  kind: "select",
  id: "direction",
  label: "Direction",
  choices: [
    { value: ENCODE, label: encodeLabel },
    { value: DECODE, label: decodeLabel },
  ],
  defaultValue: ENCODE,
});

const isDecoding = (options: UtilityOptionValues) =>
  stringOption(options, "direction", ENCODE) === DECODE;

const swapDirection = (options: UtilityOptionValues): UtilityOptionValues => ({
  ...options,
  direction: isDecoding(options) ? ENCODE : DECODE,
});

/** 1-based and counted in code points, so an emoji before the problem counts once. */
const position = (text: string, index: number) => Array.from(text.slice(0, index)).length + 1;

// With the u flag a well-formed pair is one code point, so only unpaired halves match.
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** TextEncoder silently writes a lone surrogate as U+FFFD, so decoding will not give it back. */
function surrogateWarnings(text: string): ReadonlyArray<string> {
  return LONE_SURROGATE.test(text)
    ? ["The text has a broken Unicode character (a lone surrogate), encoded as U+FFFD."]
    : [];
}

// ignoreBOM keeps a leading U+FEFF, so decoding gives back exactly what was encoded.
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

const BASE64_CHARACTER = /[A-Za-z0-9+/_-]/;
const INVALID_BASE64_LENGTH = "Not valid base64: invalid padding or length.";

/**
 * Why `base64ToBytes` would refuse `text` from `start` on, or null. Positions count from the
 * start of `text`, so a header prefix the caller skipped still counts.
 */
function base64Problem(text: string, start = 0): string | null {
  let data = 0;
  let padding = 0;
  for (let index = start; index < text.length; index++) {
    const character = text.charAt(index);
    if (padding === 0 && BASE64_CHARACTER.test(character)) data++;
    else if (character === "=") padding++;
    else if (!/\s/.test(character)) {
      return `Not valid base64: unexpected character at position ${position(text, index)}.`;
    }
  }
  const badPadding = padding > 2 || (padding > 0 && (data + padding) % 4 !== 0);
  return data % 4 === 1 || badPadding ? INVALID_BASE64_LENGTH : null;
}

function decodeBase64(text: string): UtilityResult {
  const problem = base64Problem(text);
  const bytes = problem === null ? base64ToBytes(text) : null;
  if (bytes === null) return error(problem ?? INVALID_BASE64_LENGTH);
  const decoded = decodeUtf8(bytes);
  if (decoded === null) {
    return ok(
      [{ label: "Hex", value: bytesToHex(bytes), monospace: true }],
      ["The bytes are not UTF-8 text; showing hex."],
    );
  }
  return ok([{ label: "Text", value: decoded }]);
}

/** Offset of the first byte that does not start a valid UTF-8 sequence, or -1. */
function firstInvalidUtf8(bytes: Uint8Array): number {
  if (decodeUtf8(bytes) !== null) return -1;
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index] ?? 0;
    const length = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
    if (length > 1 && decodeUtf8(bytes.subarray(index, index + length)) === null) return index;
    index += length;
  }
  return -1;
}

const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;
const STRAY_PERCENT = /%(?![0-9A-Fa-f]{2})/;

/** Why `decodeURI` or `decodeURIComponent` threw, pointing at the first bad escape. */
function percentProblem(text: string): string {
  const stray = STRAY_PERCENT.exec(text);
  const strayIndex = stray?.index ?? text.length;
  // Each character's bytes must sit in one run of escapes, so the first run that is not
  // UTF-8 holds the culprit, unless a stray % comes before it.
  for (const run of text.matchAll(PERCENT_RUN)) {
    if (run.index > strayIndex) break;
    const bytes = Uint8Array.from(run[0].split("%").slice(1), (hex) => Number.parseInt(hex, 16));
    const bad = firstInvalidUtf8(bytes);
    if (bad !== -1) {
      return `The percent-escapes at position ${position(text, run.index + bad * 3)} are not valid UTF-8.`;
    }
  }
  if (stray) {
    return `The % at position ${position(text, stray.index)} is not followed by two hex digits.`;
  }
  return "The text is not valid percent-encoding.";
}

function encodeUrl(text: string, full: boolean): UtilityResult {
  const surrogate = LONE_SURROGATE.exec(text);
  if (surrogate) {
    return error(
      `The text has a broken Unicode character (a lone surrogate) at position ${position(text, surrogate.index)}.`,
    );
  }
  return ok([
    { label: "Encoded", value: full ? encodeURI(text) : encodeURIComponent(text), monospace: true },
  ]);
}

function decodeUrl(text: string, full: boolean): UtilityResult {
  try {
    return ok([{ label: "Decoded", value: full ? decodeURI(text) : decodeURIComponent(text) }]);
  } catch {
    return error(percentProblem(text));
  }
}

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

// A Map, so "&constructor;" cannot reach Object.prototype. Characters that are invisible or
// look like ASCII are escapes in braces, which the formatter leaves alone.
const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", "\u{A0}"],
  ["copy", "©"],
  ["reg", "®"],
  ["trade", "™"],
  ["hellip", "…"],
  // oxlint-disable-next-line t3code/no-em-dash-copy -- An entity table, not copy: `&mdash;` must decode to the character.
  ["mdash", "\u{2014}"],
  ["ndash", "\u{2013}"],
  ["lsquo", "\u{2018}"],
  ["rsquo", "\u{2019}"],
  ["ldquo", "\u{201C}"],
  ["rdquo", "\u{201D}"],
  ["laquo", "«"],
  ["raquo", "»"],
  ["bull", "•"],
  ["middot", "·"],
  ["deg", "°"],
  ["plusmn", "±"],
  ["times", "×"],
  ["divide", "÷"],
  ["euro", "€"],
  ["pound", "£"],
  ["yen", "¥"],
  ["cent", "¢"],
  ["sect", "§"],
  ["para", "¶"],
]);

const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => HTML_ESCAPES.get(character) ?? character);

/** Anything this table cannot decode stays exactly as written. */
function decodeHtml(text: string): string {
  return text.replace(
    ENTITY,
    (entity, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name !== undefined) return NAMED_ENTITIES.get(name) ?? entity;
      const code =
        hex === undefined ? Number.parseInt(decimal ?? "", 10) : Number.parseInt(hex, 16);
      const valid = code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : entity;
    },
  );
}

const SIMPLE_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

/**
 * Validates a JSON string body by hand because `JSON.parse` errors do not say which escape is
 * wrong, and their wording differs between engines. Surrounding quotes are optional.
 */
function unescapeJsonString(text: string): UtilityResult {
  const leading = text.length - text.trimStart().length;
  const quoted = text.charAt(leading) === '"';
  // Whitespace around a quoted literal is layout; without quotes it is part of the string.
  const start = quoted ? leading + 1 : 0;
  const limit = quoted ? text.trimEnd().length : text.length;
  let end = -1;
  for (let index = start; index < limit; index++) {
    const character = text.charAt(index);
    if (character === '"') {
      if (quoted && index === limit - 1) {
        end = index;
        break;
      }
      return error(`Unescaped double quote at position ${position(text, index)}.`);
    }
    if (text.charCodeAt(index) < 0x20) {
      return error(
        `Unescaped control character at position ${position(text, index)}. Use an escape such as \\n or \\t.`,
      );
    }
    if (character !== "\\") continue;
    if (index + 1 >= limit) return error("The text ends in the middle of an escape.");
    const next = text.charAt(index + 1);
    if (next === "u") {
      if (index + 6 > limit || !/^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))) {
        return error(
          `Invalid escape at position ${position(text, index)}: \\u needs four hex digits.`,
        );
      }
      index += 5;
    } else if (SIMPLE_ESCAPES.has(next)) {
      index += 1;
    } else {
      const shown = String.fromCodePoint(text.codePointAt(index + 1) ?? 0);
      return error(`Invalid escape \\${shown} at position ${position(text, index)}.`);
    }
  }
  if (quoted && end === -1) return error("The closing quote is missing.");
  try {
    const value: unknown = JSON.parse(`"${text.slice(start, quoted ? end : limit)}"`);
    if (typeof value === "string") return ok([{ label: "Text", value }]);
  } catch {
    // The scan above should rule this out; fall through to the general message.
  }
  return error("The text is not a valid JSON string.");
}

const AUTH_PREFIX = /^\s*(?:authorization\s*:\s*)?(?:basic\s+)?/i;

function encodeBasicAuth(text: string): UtilityResult {
  if (!text.includes(":")) {
    return error("Use user:password, with a colon between the user name and the password.");
  }
  const value = `Basic ${bytesToBase64(utf8Bytes(text))}`;
  const warnings = [...surrogateWarnings(text)];
  if (/[\r\n]/.test(text)) warnings.push("The credentials contain a line break, encoded too.");
  return ok(
    [
      { label: "Header value", value, monospace: true },
      { label: "Header", value: `Authorization: ${value}`, monospace: true },
    ],
    warnings,
  );
}

function decodeBasicAuth(text: string): UtilityResult {
  const start = AUTH_PREFIX.exec(text)?.[0].length ?? 0;
  if (text.slice(start).trim() === "") {
    return error("Paste a Basic auth header or its base64 value.");
  }
  const problem = base64Problem(text, start);
  const bytes = problem === null ? base64ToBytes(text.slice(start)) : null;
  if (bytes === null) return error(problem ?? INVALID_BASE64_LENGTH);
  const credentials = decodeUtf8(bytes);
  if (credentials === null) return error("The decoded credentials are not UTF-8 text.");
  // RFC 7617: the user id cannot contain a colon, so the first one ends it.
  const colon = credentials.indexOf(":");
  if (colon === -1) return error("The decoded value has no colon, so it is not user:password.");
  return ok([
    { label: "Credentials", value: credentials, monospace: true },
    { label: "User", value: credentials.slice(0, colon) },
    { label: "Password", value: credentials.slice(colon + 1) },
  ]);
}

const BEARER_PREFIX = /^(?:authorization\s*:\s*)?bearer\s+/i;
const UNVERIFIED = "The signature is not verified.";
const TIME_CLAIMS = [
  { claim: "iat", label: "Issued at" },
  { claim: "nbf", label: "Not before" },
  { claim: "exp", label: "Expires" },
] as const;
// The range of Date, so toISOString cannot throw.
const MAX_DATE_MS = 8.64e15;
// Lenient like jose's own decoder, so both read the same JSON text.
const lenientUtf8 = new TextDecoder();

/**
 * The JSON text of one part, or why it cannot be a JWT header or payload. Checked here first
 * because jose's errors do not name the part, and its base64url decoding varies by engine:
 * without `Uint8Array.fromBase64` it falls back to atob, which also accepts + and /.
 */
function readJwtPart(
  name: "header" | "payload",
  part: string,
): { readonly json: string } | { readonly problem: string } {
  if (part === "") return { problem: `The JWT ${name} is empty.` };
  const bytes = /^[A-Za-z0-9_-]+={0,2}$/.test(part) ? base64ToBytes(part) : null;
  if (bytes === null) return { problem: `The JWT ${name} is not valid base64url.` };
  const json = lenientUtf8.decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { problem: `The JWT ${name} is not valid JSON.` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { problem: `The JWT ${name} is not a JSON object.` };
  }
  return { json };
}

const isJsonWhitespace = (character: string) =>
  character === " " || character === "\t" || character === "\n" || character === "\r";

/** Index just past the string literal that opens at `start`. */
function jsonStringEnd(json: string, start: number): number {
  let index = start + 1;
  while (index < json.length) {
    const character = json.charAt(index);
    if (character === '"') return index + 1;
    index += character === "\\" ? 2 : 1;
  }
  return json.length;
}

/**
 * Two-space layout of valid JSON, working on the text because a parse and stringify round
 * trip rounds integers past 2^53, turns 1e400 into null, drops repeated keys and recurses,
 * so a deeply nested token would overflow the stack. Indentation grows with the square of
 * the depth, so it stops once past the output cap and lets the registry truncate.
 */
function indentJson(json: string): string {
  let out = "";
  let depth = 0;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (let index = 0; index < json.length && out.length <= MAX_OUTPUT_BYTES; index++) {
    const character = json.charAt(index);
    if (character === '"') {
      const end = jsonStringEnd(json, index);
      out += json.slice(index, end);
      index = end - 1;
    } else if (character === "{" || character === "[") {
      let next = index + 1;
      while (isJsonWhitespace(json.charAt(next))) next++;
      // Empty containers stay on one line, as JSON.stringify writes them.
      if (json.charAt(next) === (character === "{" ? "}" : "]")) {
        out += character + json.charAt(next);
        index = next;
      } else {
        depth++;
        out += character + newline();
      }
    } else if (character === "}" || character === "]") {
      depth--;
      out += newline() + character;
    } else if (character === ",") {
      out += `,${newline()}`;
    } else if (character === ":") {
      out += ": ";
    } else if (!isJsonWhitespace(character)) {
      out += character;
    }
  }
  return out;
}

function decodeJwtToken(input: UtilityRunInput): UtilityResult {
  // Tokens pasted from logs often arrive with their header prefix or wrapped across lines.
  const token = input.text.trim().replace(BEARER_PREFIX, "").replace(/\s+/g, "");
  const parts = token.split(".");
  if (parts.length !== 3) {
    return error(`A JWT has three parts separated by dots; this has ${parts.length}.`);
  }
  const header = readJwtPart("header", parts[0] ?? "");
  if ("problem" in header) return error(header.problem);
  const body = readJwtPart("payload", parts[1] ?? "");
  if ("problem" in body) return error(body.problem);
  let payload: JWTPayload;
  try {
    // jose keeps the final say, so a token it rejects is never shown as decoded.
    decodeProtectedHeader(token);
    payload = decodeJwt(token);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return error(`Not a valid JWT: ${detail}.`);
  }

  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone : "UTC";
  const now = input.now();
  const fields: Array<UtilityOutputField> = [
    { label: "Header", value: indentJson(header.json), monospace: true },
    { label: "Payload", value: indentJson(body.json), monospace: true },
  ];
  const warnings = [UNVERIFIED];
  for (const { claim, label } of TIME_CLAIMS) {
    // jose types these claims as numbers but does not check them.
    const seconds: unknown = payload[claim];
    if (seconds === undefined) continue;
    const ms = typeof seconds === "number" ? seconds * 1000 : Number.NaN;
    if (!(Math.abs(ms) <= MAX_DATE_MS)) {
      warnings.push(`The ${claim} claim is not a time in seconds.`);
      continue;
    }
    let status = "";
    // RFC 7519: a token is expired at its exp instant, and valid from its nbf instant.
    if (claim === "exp" && now >= ms) {
      status = ", expired";
      warnings.push("The token has expired.");
    } else if (claim === "nbf" && now < ms) {
      status = ", not yet valid";
      warnings.push("The token is not valid yet.");
    }
    const when = `${new Date(ms).toISOString()} (${formatLocal(ms, timeZone)})`;
    fields.push({ label, value: `${when}${status}` });
  }
  return ok(fields, warnings);
}

export const ENCODE_TOOLS = {
  base64: {
    input: "text",
    placeholder: "Text to encode, or base64 to decode",
    options: [
      directionOption("Encode", "Decode"),
      { kind: "toggle", id: "urlSafe", label: "URL-safe alphabet", defaultValue: false },
      { kind: "toggle", id: "padding", label: "Add padding", defaultValue: true },
    ],
    example: { text: "Hello, world! \u{1F44B}" },
    run: ({ text, options }) => {
      if (isDecoding(options)) return decodeBase64(text);
      const value = bytesToBase64(utf8Bytes(text), {
        urlSafe: booleanOption(options, "urlSafe", false),
        padding: booleanOption(options, "padding", true),
      });
      return ok([{ label: "Base64", value, monospace: true }], surrogateWarnings(text));
    },
    swap: swapDirection,
  },
  url: {
    input: "text",
    placeholder: "Text or URL",
    options: [
      directionOption("Encode", "Decode"),
      {
        kind: "select",
        id: "mode",
        label: "Mode",
        choices: [
          { value: "component", label: "Component" },
          { value: "full", label: "Full URL" },
        ],
        defaultValue: "component",
      },
    ],
    example: { text: "name=Ada Lovelace & role=café/admin" },
    run: ({ text, options }) => {
      const full = stringOption(options, "mode", "component") === "full";
      return isDecoding(options) ? decodeUrl(text, full) : encodeUrl(text, full);
    },
    swap: swapDirection,
  },
  html: {
    input: "text",
    placeholder: "Text to escape, or HTML to decode",
    options: [directionOption("Escape", "Decode")],
    example: { text: `<a href="/search?q=fish & chips">Tom's café</a>` },
    run: ({ text, options }) =>
      isDecoding(options)
        ? ok([{ label: "Decoded", value: decodeHtml(text) }])
        : ok([{ label: "Escaped", value: escapeHtml(text), monospace: true }]),
    swap: swapDirection,
  },
  "json-string": {
    input: "text",
    placeholder: 'Text to escape, or a "JSON string" to unescape',
    options: [directionOption("Escape", "Unescape")],
    example: { text: 'She said "hi"\n\tC:\\Users\\ada \u{1F44B}' },
    run: ({ text, options }) =>
      isDecoding(options)
        ? unescapeJsonString(text)
        : ok([{ label: "JSON string", value: JSON.stringify(text), monospace: true }]),
    swap: swapDirection,
  },
  "basic-auth": {
    input: "text",
    placeholder: "user:password, or an Authorization header to decode",
    options: [directionOption("Encode", "Decode")],
    example: { text: "aladdin:open sesame" },
    run: ({ text, options }) =>
      isDecoding(options) ? decodeBasicAuth(text) : encodeBasicAuth(text),
    swap: swapDirection,
  },
  jwt: {
    input: "text",
    inputLabel: "Token",
    placeholder: "eyJhbGciOi...",
    options: [],
    example: {
      text: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTcwMDAwMDAwMCwibmJmIjoxNzAwMDAwMDAwLCJleHAiOjIwMDAwMDAwMDB9.dqRtYZIV9_qokVnSuxXn7Bqgy8-sraBn2sbYdMemDv8",
    },
    run: decodeJwtToken,
  },
} satisfies Record<string, UtilityToolImpl>;
