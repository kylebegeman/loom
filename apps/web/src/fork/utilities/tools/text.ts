import { booleanOption, error, ok, stringOption, type UtilityToolImpl } from "../types";
import { MAX_OUTPUT_BYTES, utf8ByteLength } from "./limits";

const JSON_INDENTS: Readonly<Record<string, string>> = {
  pretty2: "  ",
  pretty4: "    ",
  tabs: "\t",
  minify: "",
};

type JsonNode =
  | { readonly kind: "value"; readonly raw: string }
  | { readonly kind: "array"; readonly items: ReadonlyArray<JsonNode> }
  | { readonly kind: "object"; readonly entries: ReadonlyArray<JsonEntry> };

interface JsonEntry {
  /** The key as written, quotes and escapes included. */
  readonly key: string;
  readonly value: JsonNode;
}

const JSON_SPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const JSON_VALUE_END = new Set([...JSON_SPACE, 0x2c, 0x5d, 0x7d]);

/**
 * Reads text that JSON.parse has already accepted, keeping numbers, strings and keys exactly
 * as written. A JSON.parse round trip would round integers beyond 2^53 and move integer-like
 * keys to the front of their object. The length guards only stop a runaway loop.
 */
function readJson(text: string): JsonNode {
  let index = 0;
  const skipSpace = () => {
    while (index < text.length && JSON_SPACE.has(text.charCodeAt(index))) index++;
  };
  const readString = () => {
    const start = index++;
    while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
    index++;
    return text.slice(start, index);
  };
  const readNode = (): JsonNode => {
    skipSpace();
    const char = text[index];
    if (char === "[") {
      index++;
      const items: JsonNode[] = [];
      skipSpace();
      if (text[index] === "]") index++;
      else
        while (index < text.length) {
          items.push(readNode());
          skipSpace();
          if (text[index++] === "]") break;
        }
      return { kind: "array", items };
    }
    if (char === "{") {
      index++;
      const entries: JsonEntry[] = [];
      skipSpace();
      if (text[index] === "}") index++;
      else
        while (index < text.length) {
          skipSpace();
          const key = readString();
          index = text.indexOf(":", index) + 1;
          entries.push({ key, value: readNode() });
          skipSpace();
          if (text[index++] === "}") break;
        }
      return { kind: "object", entries };
    }
    if (char === '"') return { kind: "value", raw: readString() };
    const start = index;
    while (index < text.length && !JSON_VALUE_END.has(text.charCodeAt(index))) index++;
    return { kind: "value", raw: text.slice(start, index) };
  };
  return readNode();
}

const decodeKey = (key: string) => {
  const value: unknown = JSON.parse(key);
  return typeof value === "string" ? value : key;
};

/** Sorts by the decoded key, so an escaped key sorts with its plain spelling; duplicates keep their order. */
const sortEntries = (entries: ReadonlyArray<JsonEntry>) =>
  entries
    .map((entry) => ({ entry, name: decodeKey(entry.key) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ entry }) => entry);

/**
 * Lays out like `JSON.stringify(value, null, indent)`. Writing stops once the output passes
 * the output cap: deep nesting times wide arrays can otherwise reach gigabytes of indentation
 * from a 1 MiB input, and the registry truncates the result anyway.
 */
function writeJson(root: JsonNode, indent: string, sortKeys: boolean): string {
  const parts: string[] = [];
  let length = 0;
  const emit = (value: string) => {
    parts.push(value);
    length += value.length;
  };
  const colon = indent ? ": " : ":";
  const writeList = <T>(
    brackets: string,
    children: ReadonlyArray<T>,
    depth: number,
    writeChild: (child: T) => void,
  ) => {
    if (children.length === 0) return emit(brackets);
    const separator = indent ? `\n${indent.repeat(depth + 1)}` : "";
    emit(brackets.charAt(0));
    let first = true;
    for (const child of children) {
      if (length > MAX_OUTPUT_BYTES) break;
      emit(first ? separator : `,${separator}`);
      first = false;
      writeChild(child);
    }
    emit(indent ? `\n${indent.repeat(depth)}${brackets.charAt(1)}` : brackets.charAt(1));
  };
  const write = (node: JsonNode, depth: number): void => {
    if (node.kind === "value") emit(node.raw);
    else if (node.kind === "array")
      writeList("[]", node.items, depth, (item) => write(item, depth + 1));
    else
      writeList("{}", sortKeys ? sortEntries(node.entries) : node.entries, depth, (entry) => {
        emit(entry.key + colon);
        write(entry.value, depth + 1);
      });
  };
  write(root, 0);
  return parts.join("");
}

/** 1-based, counting UTF-16 units and treating `\n`, `\r\n` and `\r` as breaks, as V8 does. */
function lineAndColumn(text: string, position: number) {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(position, text.length);
  for (let index = 0; index < end; index++) {
    const code = text.charCodeAt(index);
    if (code === 0x0a || (code === 0x0d && text.charCodeAt(index + 1) !== 0x0a)) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, column: position - lineStart + 1 };
}

const sentence = (text: string) => {
  const trimmed = text.trim();
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
};

const invalidAt = (line: number, column: number, reason: string) =>
  `Invalid JSON at line ${line}, column ${column}: ${sentence(reason)}`;

/** Engines word parse errors differently; only some of them say where the error is. */
function describeJsonError(text: string, cause: unknown): string {
  const message = (cause instanceof Error ? cause.message : String(cause)).replace(
    /^JSON(?:\.parse| Parse error):\s*/,
    "",
  );
  // V8: "... in JSON at position 7", newer versions add " (line 1 column 8)".
  const v8 = /^(.*?)(?: in JSON)? at position (\d+)(?: \(line \d+ column \d+\))?$/s.exec(message);
  if (v8) {
    const { line, column } = lineAndColumn(text, Number(v8[2]));
    return invalidAt(line, column, v8[1] ?? "");
  }
  // Firefox: "unexpected character at line 1 column 2 of the JSON data".
  const firefox = /^(.*?) at line (\d+) column (\d+) of the JSON data$/s.exec(message);
  if (firefox) return invalidAt(Number(firefox[2]), Number(firefox[3]), firefox[1] ?? "");
  if (message === "Unexpected end of JSON input") {
    const { line, column } = lineAndColumn(text, text.length);
    return invalidAt(line, column, message);
  }
  return `Invalid JSON: ${sentence(message)}`;
}

/** One item per line; a final line break ends the last line rather than starting another. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** RFC 4180 quoting. */
const csvField = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const LIST_LABELS: Readonly<Record<string, string>> = {
  json: "JSON array",
  csvRow: "CSV row",
  csvColumn: "CSV column",
};

/** Letters NFKD leaves whole, which would otherwise vanish into separators. */
const SLUG_LETTERS: Readonly<Record<string, string>> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l",
  ı: "i",
  ħ: "h",
};

const slugify = (text: string, separator: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]/g, (char) => SLUG_LETTERS[char] ?? char)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replaceAll(" ", separator);

function codePointCount(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
    }
    count++;
  }
  return count;
}

/** Null where the engine has no `Intl.Segmenter`. A fixed locale keeps counts host-independent. */
function segmentCount(text: string, granularity: "grapheme" | "word"): number | null {
  if (typeof Intl.Segmenter !== "function") return null;
  let count = 0;
  for (const segment of new Intl.Segmenter("en", { granularity }).segment(text)) {
    if (granularity === "grapheme" || segment.isWordLike) count++;
  }
  return count;
}

function lineCount(text: string): number {
  if (text === "") return 0;
  let breaks = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    breaks++;
  }
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/**
 * Bounds the edit-distance search. Myers' cost grows with the number of changes, not the
 * file size, so large files with few edits stay exact; this is roughly 50 ms of work.
 */
const MAX_DIFF_WORK = 16_000_000;

/** Lines keep their terminators, as jsdiff's `diffLines` tokenizes them. */
function lineTokens(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline + 1;
    lines.push(text.slice(start, end));
    start = end;
  }
  return lines;
}

/**
 * Myers' shortest edit script length (insertions plus deletions), keeping only the furthest
 * point per diagonal. If the work budget runs out the distance is only a lower bound: each
 * finished round has ruled out one more edit.
 */
function editDistance(a: Int32Array, b: Int32Array): { distance: number; exact: boolean } {
  const max = a.length + b.length;
  const offset = max + 1;
  const furthest = new Int32Array(2 * max + 3);
  let work = 0;
  for (let distance = 0; distance <= max; distance++) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const above = furthest[offset + diagonal + 1] ?? 0;
      const left = furthest[offset + diagonal - 1] ?? 0;
      let x = diagonal === -distance || (diagonal !== distance && left < above) ? above : left + 1;
      let y = x - diagonal;
      const start = x;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++;
        y++;
      }
      work += 1 + x - start;
      furthest[offset + diagonal] = x;
      if (x >= a.length && y >= b.length) return { distance, exact: true };
    }
    if (work > MAX_DIFF_WORK) return { distance: distance + 1, exact: false };
  }
  return { distance: max, exact: true };
}

function diffCounts(original: string, changed: string, ignoreWhitespace: boolean) {
  const ids = new Map<string, number>();
  const toIds = (text: string) =>
    Int32Array.from(lineTokens(text), (line) => {
      const key = ignoreWhitespace ? line.trim() : line;
      const known = ids.get(key);
      if (known !== undefined) return known;
      ids.set(key, ids.size);
      return ids.size - 1;
    });
  const allA = toIds(original);
  const allB = toIds(changed);
  let start = 0;
  while (start < allA.length && start < allB.length && allA[start] === allB[start]) start++;
  let endA = allA.length;
  let endB = allB.length;
  while (endA > start && endB > start && allA[endA - 1] === allB[endB - 1]) {
    endA--;
    endB--;
  }
  const a = allA.subarray(start, endA);
  const b = allB.subarray(start, endB);
  // Lines shared regardless of order cap the common subsequence, and when there are none (an
  // empty side included) the counts are already exact, so the search is skipped.
  const unmatched = new Int32Array(ids.size);
  for (const id of a) unmatched[id] = (unmatched[id] ?? 0) + 1;
  let shared = 0;
  for (const id of b) {
    const count = unmatched[id] ?? 0;
    if (count > 0) {
      unmatched[id] = count - 1;
      shared++;
    }
  }
  const search = shared === 0 ? { distance: a.length + b.length, exact: true } : editDistance(a, b);
  const common = Math.min(shared, Math.floor((a.length + b.length - search.distance) / 2));
  return {
    added: b.length - common,
    removed: a.length - common,
    exact: search.exact,
    sameLines: a.length === 0 && b.length === 0,
  };
}

export const TEXT_TOOLS = {
  json: {
    input: "text",
    inputLabel: "JSON",
    placeholder: '{"key": "value"}',
    options: [
      {
        kind: "select",
        id: "format",
        label: "Format",
        choices: [
          { value: "pretty2", label: "2 spaces" },
          { value: "pretty4", label: "4 spaces" },
          { value: "tabs", label: "Tabs" },
          { value: "minify", label: "Minify" },
        ],
        defaultValue: "pretty2",
      },
      { kind: "toggle", id: "sortKeys", label: "Sort keys", defaultValue: false },
    ],
    example: {
      text: '{"name":"Loom","version":2,"tags":["dev","tools"],"limits":{"outputMiB":2,"inputMiB":1}}',
    },
    run: ({ text, options }) => {
      try {
        JSON.parse(text);
      } catch (cause) {
        return error(describeJsonError(text, cause));
      }
      const format = stringOption(options, "format", "pretty2");
      try {
        const value = writeJson(
          readJson(text),
          JSON_INDENTS[format] ?? "  ",
          booleanOption(options, "sortKeys", false),
        );
        return ok([
          { label: format === "minify" ? "Minified" : "Formatted", value, monospace: true },
        ]);
      } catch {
        // Only a stack overflow from extreme nesting can get here; JSON.parse accepted the text.
        return error("This JSON is nested too deeply to format.");
      }
    },
  },
  list: {
    input: "text",
    inputLabel: "Items, one per line",
    options: [
      {
        kind: "select",
        id: "output",
        label: "Output",
        choices: [
          { value: "json", label: "JSON array" },
          { value: "csvRow", label: "CSV row" },
          { value: "csvColumn", label: "CSV column" },
        ],
        defaultValue: "json",
      },
      { kind: "toggle", id: "trim", label: "Trim whitespace", defaultValue: false },
      { kind: "toggle", id: "dropEmpty", label: "Drop empty lines", defaultValue: false },
    ],
    example: { text: 'apple\nbanana, ripe\ncherry "Bing"' },
    run: ({ text, options }) => {
      let items = splitLines(text);
      if (booleanOption(options, "trim", false)) items = items.map((item) => item.trim());
      if (booleanOption(options, "dropEmpty", false)) items = items.filter((item) => item !== "");
      const output = stringOption(options, "output", "json");
      const value =
        output === "csvRow"
          ? items.map(csvField).join(",")
          : output === "csvColumn"
            ? items.map(csvField).join("\n")
            : JSON.stringify(items, null, 2);
      return ok([
        { label: LIST_LABELS[output] ?? "JSON array", value, monospace: true },
        { label: "Items", value: String(items.length) },
      ]);
    },
  },
  slug: {
    input: "text",
    inputLabel: "Text",
    options: [
      {
        kind: "select",
        id: "separator",
        label: "Separator",
        choices: [
          { value: "-", label: "Hyphen (-)" },
          { value: "_", label: "Underscore (_)" },
          { value: ".", label: "Dot (.)" },
        ],
        defaultValue: "-",
      },
    ],
    example: { text: "Crème Brûlée: A Recipe for 2026!" },
    run: ({ text, options }) => {
      const slug = slugify(text, stringOption(options, "separator", "-"));
      return ok(
        [{ label: "Slug", value: slug, monospace: true }],
        slug === "" ? ["The text has no letters or digits that fit in a slug."] : [],
      );
    },
  },
  count: {
    input: "text",
    inputLabel: "Text",
    options: [],
    example: { text: "Hello, world! 👋🏽\nLoom counts characters, not bytes." },
    run: ({ text }) => {
      const codePoints = codePointCount(text);
      const words = segmentCount(text, "word") ?? text.match(/\S+/g)?.length ?? 0;
      return ok([
        { label: "Characters", value: String(segmentCount(text, "grapheme") ?? codePoints) },
        { label: "Code points", value: String(codePoints) },
        { label: "UTF-16 code units", value: String(text.length) },
        { label: "Words", value: String(words) },
        { label: "Lines", value: String(lineCount(text)) },
        { label: "UTF-8 bytes", value: String(utf8ByteLength(text)) },
      ]);
    },
  },
  diff: {
    input: "two",
    inputLabel: "Original",
    secondInputLabel: "Changed",
    options: [
      {
        kind: "select",
        id: "view",
        label: "View",
        choices: [
          { value: "unified", label: "Unified" },
          { value: "split", label: "Split" },
        ],
        defaultValue: "unified",
      },
      { kind: "toggle", id: "ignoreWhitespace", label: "Ignore whitespace", defaultValue: false },
    ],
    example: {
      text: "function total(items) {\n  let sum = 0;\n  for (const item of items) sum += item.price;\n  return sum;\n}\n",
      second:
        "function total(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n",
    },
    run: ({ text, second, options }) => {
      const counts = diffCounts(text, second, booleanOption(options, "ignoreWhitespace", false));
      return ok(
        [
          {
            label: "Result",
            value:
              text === second
                ? "Identical"
                : counts.sameLines
                  ? "Identical ignoring whitespace"
                  : "Different",
          },
          { label: "Added lines", value: String(counts.added) },
          { label: "Removed lines", value: String(counts.removed) },
        ],
        counts.exact
          ? []
          : [
              "These texts differ too much to count exactly. At least this many lines were added and removed.",
            ],
      );
    },
  },
} satisfies Record<string, UtilityToolImpl>;
