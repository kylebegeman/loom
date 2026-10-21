export const VAULT_PASSWORD_MIN_LENGTH = 8;
export const VAULT_PASSWORD_MAX_LENGTH = 128;

export type VaultPasswordOptions = {
  readonly length: number;
  readonly lowercase: boolean;
  readonly uppercase: boolean;
  readonly digits: boolean;
  readonly symbols: boolean;
  readonly excludeLookAlikes: boolean;
};

export const VAULT_PASSWORD_DEFAULTS: VaultPasswordOptions = Object.freeze({
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeLookAlikes: false,
});

export const VAULT_PASSWORD_CHARACTER_SETS = [
  { id: "lowercase", label: "Lowercase letters", characters: "abcdefghijklmnopqrstuvwxyz" },
  { id: "uppercase", label: "Uppercase letters", characters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  { id: "digits", label: "Digits", characters: "0123456789" },
  // Preserve the Utilities symbol policy; these values still require quoting in shell/config use.
  { id: "symbols", label: "Symbols", characters: "!#$%&()*+,-./:;<=>?@[]^_{|}~" },
] as const;

const BOOLEAN_OPTIONS = [
  "lowercase",
  "uppercase",
  "digits",
  "symbols",
  "excludeLookAlikes",
] as const;
const LOOK_ALIKES = /[0Oo1lI|]/g;
// Bound both kinds of rejection so a broken source cannot freeze a synchronous client.
const MAX_PASSWORD_ATTEMPTS = 128;
const MAX_RANDOM_BATCHES = 1024;

function passwordEntropy(length: number, sets: readonly string[]): number {
  const alphabetLength = sets.reduce((total, set) => total + set.length, 0);
  let probability = 0;
  // Inclusion-exclusion counts only passwords containing every selected, disjoint class.
  for (let mask = 0; mask < 1 << sets.length; mask++) {
    let remaining = alphabetLength;
    let sign = 1;
    for (const [index, set] of sets.entries()) {
      if (mask & (1 << index)) {
        remaining -= set.length;
        sign = -sign;
      }
    }
    probability += sign * (remaining / alphabetLength) ** length;
  }
  return length * Math.log2(alphabetLength) + Math.log2(probability);
}

/** The caller must supply cryptographically secure bytes; this helper never reads global RNGs. */
export function generateVaultPassword(
  options: VaultPasswordOptions,
  randomBytes: (count: number) => Uint8Array,
): { value: string; entropyBits: number } {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Password options must be an object.");
  }
  const length = options.length;
  if (
    !Number.isInteger(length) ||
    length < VAULT_PASSWORD_MIN_LENGTH ||
    length > VAULT_PASSWORD_MAX_LENGTH
  ) {
    throw new RangeError(
      `Password length must be an integer from ${VAULT_PASSWORD_MIN_LENGTH} to ${VAULT_PASSWORD_MAX_LENGTH}.`,
    );
  }
  for (const id of BOOLEAN_OPTIONS) {
    if (typeof options[id] !== "boolean") {
      throw new TypeError(`Password option "${id}" must be a boolean.`);
    }
  }
  const sets = VAULT_PASSWORD_CHARACTER_SETS.filter((set) => options[set.id]).map((set) =>
    options.excludeLookAlikes ? set.characters.replace(LOOK_ALIKES, "") : set.characters,
  );
  if (sets.length === 0) throw new RangeError("Choose at least one character set.");
  if (typeof randomBytes !== "function") {
    throw new TypeError("A random byte source is required.");
  }

  const alphabet = sets.join("");
  const limit = 256 - (256 % alphabet.length);
  let batches = 0;
  for (let attempt = 0; attempt < MAX_PASSWORD_ATTEMPTS; attempt++) {
    let value = "";
    while (value.length < length) {
      if (batches >= MAX_RANDOM_BATCHES) {
        throw new Error("Random source could not produce enough usable bytes.");
      }
      batches++;
      const count = (length - value.length) * 2;
      let bytes: Uint8Array;
      try {
        bytes = randomBytes(count);
      } catch {
        throw new Error("Unable to obtain random bytes.");
      }
      if (!(bytes instanceof Uint8Array) || bytes.length !== count) {
        throw new TypeError("Random source must return the requested number of bytes.");
      }
      for (const byte of bytes) {
        if (byte >= limit) continue;
        value += alphabet.charAt(byte % alphabet.length);
        if (value.length === length) break;
      }
    }
    // Conditioning whole uniform draws keeps all valid passwords equally likely. Seeding a
    // character per class and shuffling would give different class counts different weights.
    if (sets.every((set) => [...value].some((character) => set.includes(character)))) {
      return { value, entropyBits: passwordEntropy(length, sets) };
    }
  }
  throw new Error("Random source could not produce a password with every selected character set.");
}
