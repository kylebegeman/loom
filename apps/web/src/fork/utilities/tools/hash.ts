import { hmac } from "@noble/hashes/hmac";
import { md5, sha1 } from "@noble/hashes/legacy";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2";

import {
  error,
  ok,
  stringOption,
  type UtilityOption,
  type UtilityResult,
  type UtilityToolImpl,
} from "../types";
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8Bytes } from "./bytes";

const ALGORITHMS = [
  { id: "md5", name: "MD5", hash: md5, weak: true },
  { id: "sha1", name: "SHA-1", hash: sha1, weak: true },
  { id: "sha256", name: "SHA-256", hash: sha256, weak: false },
  { id: "sha384", name: "SHA-384", hash: sha384, weak: false },
  { id: "sha512", name: "SHA-512", hash: sha512, weak: false },
];

type Algorithm = (typeof ALGORITHMS)[number];

// HMAC offers SHA-1 and SHA-2 only (TECHNICAL.md row 8), so MD5 is not a choice there.
const HMAC_ALGORITHMS = ALGORITHMS.filter((algorithm) => algorithm.id !== "md5");

const ALL = "all";
const DEFAULT_ALGORITHM = "sha256";

// A Map, so an option value such as "constructor" cannot reach Object.prototype.
const OUTPUT_ENCODINGS = new Map<string, (bytes: Uint8Array) => string>([
  ["hex", bytesToHex],
  ["base64", bytesToBase64],
]);

const outputEncodingOption: UtilityOption = {
  kind: "select",
  id: "encoding",
  label: "Output encoding",
  choices: [
    { value: "hex", label: "Hex" },
    { value: "base64", label: "Base64" },
  ],
  defaultValue: "hex",
};

const algorithmChoices = (algorithms: ReadonlyArray<Algorithm>) =>
  algorithms.map((algorithm) => ({ value: algorithm.id, label: algorithm.name }));

function weakWarning(algorithms: ReadonlyArray<Algorithm>): ReadonlyArray<string> {
  const names = algorithms.filter((algorithm) => algorithm.weak).map((algorithm) => algorithm.name);
  if (names.length === 0) return [];
  const verb = names.length === 1 ? "is" : "are";
  return [`${names.join(" and ")} ${verb} not suitable for security.`];
}

// TextEncoder writes an unpaired surrogate as U+FFFD, so such text cannot be hashed exactly.
// With the `u` flag a surrogate pair reads as one code point, so only unpaired halves match.
const UNPAIRED_SURROGATE = /\p{Surrogate}/u;

function replacementWarning(subject: string, text: string): ReadonlyArray<string> {
  return UNPAIRED_SURROGATE.test(text)
    ? [`The ${subject} has an unpaired surrogate, which was hashed as U+FFFD.`]
    : [];
}

const HEX_DIGIT = /[0-9a-fA-F]/;
const BASE64_CHARACTER = /[A-Za-z0-9+/\-_=]/;
// Zero-width and control characters often ride along with a pasted key and would otherwise
// print as an empty pair of quotes.
const INVISIBLE_CHARACTER = /^[\p{C}\p{Z}]$/u;

function describeCharacter(character: string): string {
  if (!INVISIBLE_CHARACTER.test(character)) return `"${character}"`;
  const codePoint = character.codePointAt(0) ?? 0;
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Says why `bytes.ts` refused the key, so the message can point at the character. */
function invalidKey(key: string, encoding: "hex" | "base64"): UtilityResult {
  const valid = encoding === "hex" ? HEX_DIGIT : BASE64_CHARACTER;
  const characters = [...key];
  const index = characters.findIndex(
    (character) => !/\s/.test(character) && !valid.test(character),
  );
  const prefix = `The key is not valid ${encoding}`;
  const character = characters[index];
  if (character !== undefined) {
    return error(
      `${prefix}: unexpected character ${describeCharacter(character)} at position ${index + 1}.`,
    );
  }
  return error(
    encoding === "hex"
      ? `${prefix}: it has an odd number of digits.`
      : `${prefix}: check its length and padding.`,
  );
}

function decodeKey(key: string, keyEncoding: string): Uint8Array | UtilityResult {
  if (keyEncoding === "utf8") return utf8Bytes(key);
  if (keyEncoding === "hex") return hexToBytes(key) ?? invalidKey(key, "hex");
  if (keyEncoding === "base64") return base64ToBytes(key) ?? invalidKey(key, "base64");
  return error(`Unsupported key encoding "${keyEncoding}".`);
}

export const HASH_TOOLS = {
  hash: {
    input: "text",
    inputLabel: "Text",
    placeholder: "Text to hash",
    options: [
      {
        kind: "select",
        id: "algorithm",
        label: "Algorithm",
        choices: [...algorithmChoices(ALGORITHMS), { value: ALL, label: "All algorithms" }],
        defaultValue: DEFAULT_ALGORITHM,
      },
      outputEncodingOption,
    ],
    example: { text: "The quick brown fox jumps over the lazy dog" },
    run: ({ text, options }) => {
      const algorithmId = stringOption(options, "algorithm", DEFAULT_ALGORITHM);
      const selected =
        algorithmId === ALL
          ? ALGORITHMS
          : ALGORITHMS.filter((algorithm) => algorithm.id === algorithmId);
      if (selected.length === 0) return error(`Unsupported algorithm "${algorithmId}".`);
      const encodingId = stringOption(options, "encoding", "hex");
      const encode = OUTPUT_ENCODINGS.get(encodingId);
      if (!encode) return error(`Unsupported output encoding "${encodingId}".`);
      // No trimming or newline normalization: the digest must match `shasum` on the same text.
      const bytes = utf8Bytes(text);
      return ok(
        selected.map((algorithm) => ({
          label: algorithm.name,
          value: encode(algorithm.hash(bytes)),
          monospace: true,
        })),
        [...weakWarning(selected), ...replacementWarning("text", text)],
      );
    },
  },
  hmac: {
    input: "two",
    inputLabel: "Message",
    secondInputLabel: "Key",
    options: [
      {
        kind: "select",
        id: "algorithm",
        label: "Algorithm",
        choices: algorithmChoices(HMAC_ALGORITHMS),
        defaultValue: DEFAULT_ALGORITHM,
      },
      {
        kind: "select",
        id: "keyEncoding",
        label: "Key encoding",
        choices: [
          { value: "utf8", label: "UTF-8" },
          { value: "hex", label: "Hex" },
          { value: "base64", label: "Base64" },
        ],
        defaultValue: "utf8",
      },
      outputEncodingOption,
    ],
    // RFC 4231 test case 2.
    example: { text: "what do ya want for nothing?", second: "Jefe" },
    run: ({ text, second, options }) => {
      const algorithmId = stringOption(options, "algorithm", DEFAULT_ALGORITHM);
      const algorithm = HMAC_ALGORITHMS.find((candidate) => candidate.id === algorithmId);
      if (!algorithm) return error(`Unsupported algorithm "${algorithmId}".`);
      const encodingId = stringOption(options, "encoding", "hex");
      const encode = OUTPUT_ENCODINGS.get(encodingId);
      if (!encode) return error(`Unsupported output encoding "${encodingId}".`);
      const keyEncoding = stringOption(options, "keyEncoding", "utf8");
      // An empty key is valid HMAC (it is zero-padded to the block size), so it is not refused.
      const key = decodeKey(second, keyEncoding);
      if (!(key instanceof Uint8Array)) return key;
      return ok(
        [
          {
            label: `HMAC-${algorithm.name}`,
            value: encode(hmac(algorithm.hash, key, utf8Bytes(text))),
            monospace: true,
          },
        ],
        [
          ...weakWarning([algorithm]),
          ...replacementWarning("message", text),
          ...(keyEncoding === "utf8" ? replacementWarning("key", second) : []),
        ],
      );
    },
  },
} satisfies Record<string, UtilityToolImpl>;
