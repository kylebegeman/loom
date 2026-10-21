import {
  generateVaultPassword,
  VAULT_PASSWORD_CHARACTER_SETS,
  VAULT_PASSWORD_DEFAULTS,
  VAULT_PASSWORD_MAX_LENGTH,
  VAULT_PASSWORD_MIN_LENGTH,
} from "@t3tools/client-runtime/fork";
import {
  booleanOption,
  error,
  numberOption,
  ok,
  stringOption,
  type UtilityOption,
  type UtilityOptionValues,
  type UtilityOutputField,
  type UtilityResult,
  type UtilityRunInput,
  type UtilityToolImpl,
} from "../types";
import { bytesToBase64, bytesToHex } from "./bytes";
import { formatLocal } from "./time";

type Random = UtilityRunInput["random"];
type NumberOption = Extract<UtilityOption, { readonly kind: "number" }>;

/** A number option held to its own bounds, so counts are capped before anything is allocated. */
function clampedNumber(values: UtilityOptionValues, option: NumberOption): number {
  const value = Math.trunc(numberOption(values, option.id, option.defaultValue));
  return Math.min(option.max, Math.max(option.min, value));
}

/**
 * Unbiased integers below `bound` (1 to 256). A byte at or above the largest multiple of
 * `bound` is skipped, because folding it in with modulo would favour the low values.
 */
function randomIndices(bound: number, count: number, random: Random): number[] {
  // Above 256 every byte would be rejected and the loop below would freeze the tab, so a
  // larger alphabet or password length fails loudly instead.
  if (!Number.isInteger(bound) || bound < 1 || bound > 256) {
    throw new RangeError(`Cannot draw an unbiased index below ${bound} from one byte.`);
  }
  const limit = 256 - (256 % bound);
  const indices: number[] = [];
  while (indices.length < count) {
    // Twice the shortfall, since fewer than half of all byte values are ever rejected.
    for (const byte of random((count - indices.length) * 2)) {
      if (byte >= limit) continue;
      indices.push(byte % bound);
      if (indices.length === count) break;
    }
  }
  return indices;
}

const randomIndex = (bound: number, random: Random) => randomIndices(bound, 1, random)[0] ?? 0;

const between = (min: number, max: number, random: Random) =>
  min + randomIndex(max - min + 1, random);

/** Unbiased characters from an alphabet of at most 256. */
export const pick = (alphabet: string, count: number, random: Random) =>
  randomIndices(alphabet.length, count, random)
    .map((index) => alphabet.charAt(index))
    .join("");

const ID_COUNT: NumberOption = {
  kind: "number",
  id: "count",
  label: "Count",
  min: 1,
  max: 100,
  defaultValue: 1,
};

// UUID v7 and ULID both store Unix milliseconds in 48 bits.
const MAX_TIME_48 = 2 ** 48 - 1;
const CLOCK_ERROR = "The clock is outside the 48-bit range this format can store.";

function time48(now: number): number | null {
  const ms = Math.floor(now);
  return ms >= 0 && ms <= MAX_TIME_48 ? ms : null;
}

function timeFields(ms: number, timeZone: string): UtilityOutputField[] {
  return [
    { label: "Unix time (ms)", value: String(ms), monospace: true },
    { label: "UTC", value: new Date(ms).toISOString(), monospace: true },
    { label: "Local time", value: formatLocal(ms, timeZone) },
  ];
}

/** Sets the version nibble and the RFC 9562 variant bits (10) over otherwise random bytes. */
function stampUuid(bytes: Uint8Array, version: number): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | (version << 4);
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const uuidV4 = (random: Random) => stampUuid(random(16), 4);

function uuidV7(random: Random, ms: number): string {
  const bytes = random(16);
  for (let index = 0; index < 6; index++) {
    bytes[index] = Math.floor(ms / 2 ** (8 * (5 - index))) % 256;
  }
  return stampUuid(bytes, 7);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const UUID_VERSIONS = new Map([
  [1, "Gregorian time"],
  [2, "DCE security"],
  [3, "name-based, MD5"],
  [4, "random"],
  [5, "name-based, SHA-1"],
  [6, "reordered Gregorian time"],
  [7, "Unix time"],
  [8, "custom"],
]);

// The variant is the leading bits of the 17th hex digit; only 10xx defines a version nibble.
function uuidVariant(digit: number): string {
  if (digit < 0x8) return "NCS (reserved)";
  if (digit < 0xc) return "RFC 9562, formerly RFC 4122";
  if (digit < 0xe) return "Microsoft (reserved)";
  return "Reserved for future use";
}

function inspectUuid(text: string, timeZone: string): UtilityResult {
  let value = text.trim().replace(/^urn:uuid:/i, "");
  if (value.startsWith("{") && value.endsWith("}")) value = value.slice(1, -1);
  value = value.toLowerCase();
  if (!UUID_PATTERN.test(value)) return error("Not a valid UUID.");
  const hex = value.replaceAll("-", "");
  const uuid = { label: "UUID", value, monospace: true };
  if (/^0+$/.test(hex)) return ok([uuid, { label: "Version", value: "Nil UUID (all bits zero)" }]);
  if (/^f+$/.test(hex)) return ok([uuid, { label: "Version", value: "Max UUID (all bits one)" }]);
  const variantDigit = Number.parseInt(hex.charAt(16), 16);
  const variant = { label: "Variant", value: uuidVariant(variantDigit) };
  if (variantDigit < 0x8 || variantDigit >= 0xc) {
    return ok([uuid, { label: "Version", value: "Not defined for this variant" }, variant]);
  }
  const version = Number.parseInt(hex.charAt(12), 16);
  const name = UUID_VERSIONS.get(version) ?? "unassigned";
  const fields = [uuid, { label: "Version", value: `${version} (${name})` }, variant];
  if (version !== 7) return ok(fields);
  return ok([...fields, ...timeFields(Number.parseInt(hex.slice(0, 12), 16), timeZone)]);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_VALUES = new Map(
  [...CROCKFORD].flatMap((char, index) => [
    [char, index],
    [char.toLowerCase(), index],
  ]),
);

function ulid(random: Random, ms: number): string {
  let time = "";
  for (let rest = ms, index = 0; index < 10; index++, rest = Math.floor(rest / 32)) {
    time = CROCKFORD.charAt(rest % 32) + time;
  }
  // 32 divides 256, so no byte is rejected and 16 characters carry exactly 80 random bits.
  return time + pick(CROCKFORD, 16, random);
}

function decodeUlid(text: string, timeZone: string): UtilityResult {
  // Code points, so a pasted emoji counts as one character in the length and positions.
  const chars = [...text.trim()];
  if (chars.length !== 26) return error(`A ULID has 26 characters; this has ${chars.length}.`);
  let ms = 0;
  for (const [index, char] of chars.entries()) {
    const digit = CROCKFORD_VALUES.get(char);
    if (digit === undefined) {
      return error(`Not a valid ULID: unexpected character "${char}" at position ${index + 1}.`);
    }
    if (index < 10) ms = ms * 32 + digit;
  }
  // Ten characters hold 50 bits but the timestamp is 48, so a first character above 7 overflows.
  if (ms > MAX_TIME_48) {
    return error(
      "Not a valid ULID: the timestamp overflows 48 bits; the first character must be 0 to 7.",
    );
  }
  return ok([
    { label: "ULID", value: chars.join("").toUpperCase(), monospace: true },
    ...timeFields(ms, timeZone),
  ]);
}

const PASSWORD_LENGTH: NumberOption = {
  kind: "number",
  id: "length",
  label: "Length",
  min: VAULT_PASSWORD_MIN_LENGTH,
  max: VAULT_PASSWORD_MAX_LENGTH,
  defaultValue: VAULT_PASSWORD_DEFAULTS.length,
};

function generatePassword(input: UtilityRunInput): UtilityResult {
  try {
    const { value, entropyBits } = generateVaultPassword(
      {
        length: clampedNumber(input.options, PASSWORD_LENGTH),
        lowercase: booleanOption(input.options, "lowercase", VAULT_PASSWORD_DEFAULTS.lowercase),
        uppercase: booleanOption(input.options, "uppercase", VAULT_PASSWORD_DEFAULTS.uppercase),
        digits: booleanOption(input.options, "digits", VAULT_PASSWORD_DEFAULTS.digits),
        symbols: booleanOption(input.options, "symbols", VAULT_PASSWORD_DEFAULTS.symbols),
        excludeLookAlikes: booleanOption(
          input.options,
          "excludeLookAlikes",
          VAULT_PASSWORD_DEFAULTS.excludeLookAlikes,
        ),
      },
      input.random,
    );
    return ok([
      { label: "Password", value, monospace: true },
      { label: "Entropy", value: `${Math.round(entropyBits)} bits` },
    ]);
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Unable to generate a password.");
  }
}

const TOKEN_BYTES: NumberOption = {
  kind: "number",
  id: "bytes",
  label: "Bytes",
  min: 8,
  max: 256,
  defaultValue: 32,
};

function encodeToken(bytes: Uint8Array, encoding: string): string {
  if (encoding === "base64") return bytesToBase64(bytes);
  // Unpadded, as JWTs and most tokens carried in URLs are (RFC 7515).
  if (encoding === "base64url") return bytesToBase64(bytes, { urlSafe: true, padding: false });
  return bytesToHex(bytes);
}

const LOREM_COUNT: NumberOption = {
  kind: "number",
  id: "count",
  label: "Count",
  min: 1,
  max: 100,
  defaultValue: 3,
};

const LOREM_WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore",
  "et",
  "dolore",
  "magna",
  "aliqua",
  "enim",
  "ad",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
  "ullamco",
  "laboris",
  "nisi",
  "aliquip",
  "ex",
  "ea",
  "commodo",
  "consequat",
  "duis",
  "aute",
  "irure",
  "in",
  "reprehenderit",
  "voluptate",
  "velit",
  "esse",
  "cillum",
  "fugiat",
  "nulla",
  "pariatur",
  "excepteur",
  "sint",
  "occaecat",
  "cupidatat",
  "non",
  "proident",
  "sunt",
  "culpa",
  "qui",
  "officia",
  "deserunt",
  "mollit",
  "anim",
  "id",
  "est",
  "laborum",
  "vitae",
  "porta",
  "nunc",
  "felis",
  "lacus",
  "metus",
  "purus",
  "risus",
  "urna",
  "massa",
  "justo",
  "neque",
  "augue",
  "erat",
  "libero",
  "mauris",
  "tellus",
  "turpis",
  "viverra",
  "integer",
];

const OPENING_WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
];
const OPENING_SENTENCE = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const randomWords = (count: number, random: Random) =>
  randomIndices(LOREM_WORDS.length, count, random).map((index) => LOREM_WORDS[index] ?? "");

function loremWords(count: number, opening: boolean, random: Random): string {
  const lead = opening ? OPENING_WORDS.slice(0, count) : [];
  return capitalize([...lead, ...randomWords(count - lead.length, random)].join(" "));
}

const loremSentence = (opening: boolean, random: Random) =>
  opening
    ? OPENING_SENTENCE
    : `${capitalize(randomWords(between(6, 14, random), random).join(" "))}.`;

const loremSentences = (count: number, opening: boolean, random: Random) =>
  Array.from({ length: count }, (_, index) => loremSentence(opening && index === 0, random)).join(
    " ",
  );

function generateLorem(input: UtilityRunInput): string {
  const count = clampedNumber(input.options, LOREM_COUNT);
  const opening = booleanOption(input.options, "startWithLorem", true);
  const unit = stringOption(input.options, "unit", "paragraphs");
  if (unit === "words") return loremWords(count, opening, input.random);
  if (unit === "sentences") return loremSentences(count, opening, input.random);
  return Array.from({ length: count }, (_, index) =>
    loremSentences(between(4, 7, input.random), opening && index === 0, input.random),
  ).join("\n\n");
}

export const GENERATE_TOOLS = {
  uuid: {
    input: "text",
    inputLabel: "UUID",
    placeholder: "Paste a UUID to inspect it",
    options: [
      {
        kind: "select",
        id: "version",
        label: "Version",
        choices: [
          { value: "v4", label: "v4 (random)" },
          { value: "v7", label: "v7 (time-ordered)" },
        ],
        defaultValue: "v4",
      },
      ID_COUNT,
      { kind: "toggle", id: "uppercase", label: "Uppercase", defaultValue: false },
    ],
    // RFC 9562 appendix A.6.
    example: { text: "017F22E2-79B0-7CC3-98C4-DC0C0C07398F" },
    run: (input) => inspectUuid(input.text, input.timeZone),
    generate: (input) => {
      const count = clampedNumber(input.options, ID_COUNT);
      let values: string[];
      if (stringOption(input.options, "version", "v4") === "v7") {
        const ms = time48(input.now());
        if (ms === null) return error(CLOCK_ERROR);
        // A batch shares one millisecond; sorting keeps v7's promise that the list ascends.
        values = Array.from({ length: count }, () => uuidV7(input.random, ms)).sort();
      } else {
        values = Array.from({ length: count }, () => uuidV4(input.random));
      }
      const text = values.join("\n");
      return ok([
        {
          label: count === 1 ? "UUID" : "UUIDs",
          value: booleanOption(input.options, "uppercase", false) ? text.toUpperCase() : text,
          monospace: true,
        },
      ]);
    },
  },
  ulid: {
    input: "text",
    inputLabel: "ULID",
    placeholder: "Paste a ULID to read its timestamp",
    options: [ID_COUNT],
    // The example from the ULID specification.
    example: { text: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
    run: (input) => decodeUlid(input.text, input.timeZone),
    generate: (input) => {
      const count = clampedNumber(input.options, ID_COUNT);
      const ms = time48(input.now());
      if (ms === null) return error(CLOCK_ERROR);
      // As with UUID v7: one millisecond per batch, so sort to keep the list ascending.
      const values = Array.from({ length: count }, () => ulid(input.random, ms)).sort();
      return ok([
        { label: count === 1 ? "ULID" : "ULIDs", value: values.join("\n"), monospace: true },
      ]);
    },
  },
  password: {
    input: "none",
    options: [
      PASSWORD_LENGTH,
      ...VAULT_PASSWORD_CHARACTER_SETS.map(({ id, label }): UtilityOption => ({
        kind: "toggle",
        id,
        label,
        defaultValue: VAULT_PASSWORD_DEFAULTS[id],
      })),
      {
        kind: "toggle",
        id: "excludeLookAlikes",
        label: "Exclude look-alikes (0 O o 1 l I |)",
        defaultValue: VAULT_PASSWORD_DEFAULTS.excludeLookAlikes,
      },
    ],
    example: { text: "" },
    generate: generatePassword,
  },
  token: {
    input: "none",
    options: [
      TOKEN_BYTES,
      {
        kind: "select",
        id: "encoding",
        label: "Encoding",
        choices: [
          { value: "hex", label: "Hex" },
          { value: "base64", label: "Base64" },
          { value: "base64url", label: "Base64url" },
        ],
        defaultValue: "hex",
      },
    ],
    example: { text: "" },
    generate: (input) => {
      const bytes = input.random(clampedNumber(input.options, TOKEN_BYTES));
      const encoding = stringOption(input.options, "encoding", "hex");
      return ok([{ label: "Token", value: encodeToken(bytes, encoding), monospace: true }]);
    },
  },
  lorem: {
    input: "none",
    options: [
      {
        kind: "select",
        id: "unit",
        label: "Unit",
        choices: [
          { value: "paragraphs", label: "Paragraphs" },
          { value: "sentences", label: "Sentences" },
          { value: "words", label: "Words" },
        ],
        defaultValue: "paragraphs",
      },
      LOREM_COUNT,
      { kind: "toggle", id: "startWithLorem", label: "Start with Lorem ipsum", defaultValue: true },
    ],
    example: { text: "" },
    generate: (input) => ok([{ label: "Text", value: generateLorem(input) }]),
  },
} satisfies Record<string, UtilityToolImpl>;
