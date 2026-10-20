import { error, ok, type UtilityToolImpl } from "../types";

const MODE_BITS = 0o7777;
const SETUID = 0o4000;
const SETGID = 0o2000;
const STICKY = 0o1000;

/** The type character `ls -l` prints first; it says nothing about the mode. */
const FILE_TYPES = new Set(["-", "d", "l", "c", "b", "p", "s"]);
/** macOS ls appends @ (extended attributes) or + (ACL), GNU ls + (ACL) or . (SELinux). */
const LS_MARKERS = new Set(["@", "+", "."]);
/**
 * chmod's own expression syntax (`u+x`, `go-w`, `a=r`, GNU's `-022`) edits a mode rather than
 * naming one. A lone leading `-` is still the ls -l type, so only `-` before a digit counts.
 */
const CHMOD_EXPRESSION = /^[ugoa]*[+=]|^[ugoa]+-|^-\p{Nd}/u;
/** Any decimal digit, so `７５５` typed with an IME gets the octal digit error, not a length one. */
const STARTS_WITH_DIGIT = /^\p{Nd}/u;
// Pasted modes carry zero-width spaces, NULs and stray line breaks, and a lone combining mark
// attaches to the quote; inside quotes each would read as `""`.
const INVISIBLE_CHARACTER = /^[\p{C}\p{Z}\p{M}]$/u;

/**
 * ls folds each special bit into its class's execute position: lowercase means the special
 * bit plus execute, uppercase the special bit alone.
 */
const CLASSES = [
  {
    label: "Owner",
    noAccess: "Owner has no access.",
    shift: 6,
    special: SETUID,
    withExecute: "s",
    withoutExecute: "S",
  },
  {
    label: "Group",
    noAccess: "Group has no access.",
    shift: 3,
    special: SETGID,
    withExecute: "s",
    withoutExecute: "S",
  },
  {
    label: "Others",
    noAccess: "Others have no access.",
    shift: 0,
    special: STICKY,
    withExecute: "t",
    withoutExecute: "T",
  },
] as const;

const SLOTS = CLASSES.flatMap(({ shift, special, withExecute, withoutExecute }) => {
  const execute = 1 << shift;
  return [
    {
      expected: "r or -",
      bits: new Map([
        ["r", 4 << shift],
        ["-", 0],
      ]),
    },
    {
      expected: "w or -",
      bits: new Map([
        ["w", 2 << shift],
        ["-", 0],
      ]),
    },
    {
      expected: `x, ${withExecute}, ${withoutExecute} or -`,
      bits: new Map([
        ["x", execute],
        [withExecute, execute | special],
        [withoutExecute, special],
        ["-", 0],
      ]),
    },
  ];
});

type ParsedChmod = { readonly mode: number } | { readonly error: string };

function describeCharacter(char: string): string {
  if (!INVISIBLE_CHARACTER.test(char)) return `"${char}"`;
  const codePoint = char.codePointAt(0) ?? 0;
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Positions count code points of the untrimmed input, as the user sees them. */
const unexpected = (char: string, position: number, expected: string): ParsedChmod => ({
  error: `Unexpected ${describeCharacter(char)} at position ${position}; expected ${expected}.`,
});

/** No serial comma, as in PRODUCT.md's copy; `Intl.ListFormat` would follow the host locale. */
function joinWords(words: ReadonlyArray<string>): string {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.slice(-1).join("")}`;
}

function parseOctal(text: string, offset: number): ParsedChmod {
  const prefix = /^0o/i.test(text) ? 2 : 0;
  const digits = Array.from(text.slice(prefix));
  for (const [index, char] of digits.entries()) {
    if (!/^[0-7]$/.test(char)) {
      return unexpected(char, offset + prefix + index + 1, "an octal digit from 0 to 7");
    }
  }
  // A C-style leading zero on a four-digit mode, as in `chmod 04755`.
  if (digits.length === 5 && digits[0] === "0") digits.shift();
  if (digits.length !== 3 && digits.length !== 4) {
    return { error: `An octal mode has 3 or 4 digits; this has ${digits.length}.` };
  }
  return { mode: Number.parseInt(digits.join(""), 8) };
}

function parseSymbolic(text: string, offset: number): ParsedChmod {
  const chars = Array.from(text);
  const length = chars.length;
  if (length === 11 && LS_MARKERS.has(chars[10] ?? "")) chars.pop();
  let start = 0;
  if (chars.length === 10) {
    const type = chars[0] ?? "";
    if (!FILE_TYPES.has(type)) {
      return unexpected(type, offset + 1, "a file type (-, d, l, c, b, p or s)");
    }
    start = 1;
  } else if (chars.length !== 9) {
    return { error: `A symbolic mode has 9 characters, or 10 in ls -l form; this has ${length}.` };
  }
  let mode = 0;
  for (const [index, slot] of SLOTS.entries()) {
    const char = chars[start + index] ?? "";
    const bits = slot.bits.get(char);
    if (bits === undefined) return unexpected(char, offset + start + index + 1, slot.expected);
    mode |= bits;
  }
  return { mode };
}

/** A 12-bit mode from octal (`755`, `0644`, `0o750`), symbolic or `ls -l` text. */
export function parseChmod(text: string): ParsedChmod {
  const trimmed = text.trim();
  if (trimmed === "") return { error: "Enter a mode such as 755 or rwxr-xr-x." };
  // Trimmed characters are all in the BMP, so the UTF-16 difference is a code point count.
  const offset = text.length - text.trimStart().length;
  if (STARTS_WITH_DIGIT.test(trimmed)) return parseOctal(trimmed, offset);
  if (CHMOD_EXPRESSION.test(trimmed)) {
    return {
      error:
        "Expressions such as u+x change an existing mode; enter a full mode such as 755 or rwxr-xr-x.",
    };
  }
  return parseSymbolic(trimmed, offset);
}

/** Four digits only when a special bit needs the leading digit, so ordinary modes read as 755. */
export function formatChmodOctal(mode: number): string {
  const bits = mode & MODE_BITS;
  return bits.toString(8).padStart(bits > 0o777 ? 4 : 3, "0");
}

export function formatChmodSymbolic(mode: number): string {
  return CLASSES.map(({ shift, special, withExecute, withoutExecute }) => {
    const bits = mode >> shift;
    const execute = (bits & 1) !== 0;
    const executeMark =
      (mode & special) !== 0 ? (execute ? withExecute : withoutExecute) : execute ? "x" : "-";
    return `${bits & 4 ? "r" : "-"}${bits & 2 ? "w" : "-"}${executeMark}`;
  }).join("");
}

function describeClass(mode: number, { label, noAccess, shift }: (typeof CLASSES)[number]) {
  const bits = mode >> shift;
  const abilities: string[] = [];
  if (bits & 4) abilities.push("read");
  if (bits & 2) abilities.push("write");
  if (bits & 1) abilities.push("execute");
  return abilities.length === 0 ? noAccess : `${label} can ${joinWords(abilities)}.`;
}

function describeSpecialBits(mode: number): string {
  const names: string[] = [];
  if (mode & SETUID) names.push("setuid");
  if (mode & SETGID) names.push("setgid");
  if (mode & STICKY) names.push("sticky");
  if (names.length === 0) return "None";
  const text = joinWords(names);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const CHMOD_TOOLS = {
  chmod: {
    input: "text",
    inputLabel: "Permissions",
    placeholder: "755, 0644, rwxr-xr-x or -rwsr-xr-x",
    options: [],
    example: { text: "755" },
    // Only describes the mode and prints a command; it never touches the file system.
    run: ({ text }) => {
      const parsed = parseChmod(text);
      if ("error" in parsed) return error(parsed.error);
      const { mode } = parsed;
      const octal = formatChmodOctal(mode);
      const symbolic = formatChmodSymbolic(mode);
      return ok([
        { label: "Octal", value: octal, monospace: true },
        { label: "Symbolic", value: symbolic, monospace: true },
        { label: "ls -l form", value: `-${symbolic}`, monospace: true },
        ...CLASSES.map((entry) => ({ label: entry.label, value: describeClass(mode, entry) })),
        { label: "Special bits", value: describeSpecialBits(mode) },
        { label: "Command", value: `chmod ${octal} <file>`, monospace: true },
      ]);
    },
  },
} satisfies Record<string, UtilityToolImpl>;
