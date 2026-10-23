import { describe, expect, it, vi } from "vite-plus/test";
import {
  generateVaultPassword,
  VAULT_PASSWORD_CHARACTER_SETS,
  VAULT_PASSWORD_DEFAULTS,
  VAULT_PASSWORD_MAX_LENGTH,
  VAULT_PASSWORD_MIN_LENGTH,
  type VaultPasswordOptions,
} from "./vault-password.ts";

function seededBytes(seed = 1) {
  let state = seed >>> 0;
  return (count: number) =>
    Uint8Array.from({ length: count }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state >>> 24;
    });
}

function cyclingBytes(values: readonly number[]) {
  let index = 0;
  return (count: number) =>
    Uint8Array.from({ length: count }, () => values[index++ % values.length] ?? 0);
}

const digitsOnly: VaultPasswordOptions = {
  ...VAULT_PASSWORD_DEFAULTS,
  lowercase: false,
  uppercase: false,
  symbols: false,
};

const booleanOptions = [
  "lowercase",
  "uppercase",
  "digits",
  "symbols",
  "excludeLookAlikes",
] as const;

describe("generateVaultPassword", () => {
  it("defaults to 20 characters containing every character class", () => {
    const { value, entropyBits } = generateVaultPassword(VAULT_PASSWORD_DEFAULTS, seededBytes());
    expect(value).toHaveLength(20);
    for (const set of VAULT_PASSWORD_CHARACTER_SETS) {
      expect([...value].some((character) => set.characters.includes(character))).toBe(true);
    }
    expect(entropyBits).toBeGreaterThan(129);
    expect(entropyBits).toBeLessThan(20 * Math.log2(90));
  });

  it.each(Array.from({ length: 15 }, (_, index) => index + 1))(
    "uses and guarantees exactly the selected classes for mask %i",
    (mask) => {
      const options = {
        ...VAULT_PASSWORD_DEFAULTS,
        length: 8,
        lowercase: Boolean(mask & 1),
        uppercase: Boolean(mask & 2),
        digits: Boolean(mask & 4),
        symbols: Boolean(mask & 8),
      };
      for (let seed = 1; seed <= 10; seed++) {
        const { value } = generateVaultPassword(options, seededBytes(seed));
        expect(value).toHaveLength(8);
        for (const set of VAULT_PASSWORD_CHARACTER_SETS) {
          const present = [...value].some((character) => set.characters.includes(character));
          expect(present, set.id).toBe(options[set.id]);
        }
      }
    },
  );

  it.each([VAULT_PASSWORD_MIN_LENGTH, VAULT_PASSWORD_MAX_LENGTH])(
    "accepts the boundary length %i",
    (length) => {
      expect(
        generateVaultPassword({ ...VAULT_PASSWORD_DEFAULTS, length }, seededBytes()).value,
      ).toHaveLength(length);
    },
  );

  it("removes look-alikes from every selected set and accounts for the smaller alphabet", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const options = { ...VAULT_PASSWORD_DEFAULTS, length: 128, excludeLookAlikes: true };
      expect(generateVaultPassword(options, seededBytes(seed)).value).not.toMatch(/[0Oo1lI|]/);
    }
    const { value, entropyBits } = generateVaultPassword(
      { ...digitsOnly, excludeLookAlikes: true },
      seededBytes(),
    );
    expect(value).toMatch(/^[2-9]{20}$/);
    expect(entropyBits).toBe(60);
  });

  it("reports the entropy of uniform passwords conditioned on all selected classes appearing", () => {
    const options = { ...digitsOnly, lowercase: true, length: 8 };
    const { entropyBits } = generateVaultPassword(options, seededBytes());
    const validPasswords = 36 ** 8 - 26 ** 8 - 10 ** 8;
    expect(entropyBits).toBeCloseTo(Math.log2(validPasswords), 12);
    expect(entropyBits).toBeLessThan(8 * Math.log2(36));
    expect(generateVaultPassword(digitsOnly, seededBytes()).entropyBits).toBe(20 * Math.log2(10));
  });

  it.each([
    { length: 8, excludeLookAlikes: false },
    { length: 8, excludeLookAlikes: true },
    { length: 20, excludeLookAlikes: false },
    { length: 128, excludeLookAlikes: true },
  ])("matches an exact class-coverage count for %j", (overrides) => {
    const sizes = overrides.excludeLookAlikes ? [24, 24, 8, 27] : [26, 26, 10, 28];
    let counts: bigint[] = Array.from({ length: 16 }, (_, mask) => (mask === 0 ? 1n : 0n));
    for (let position = 0; position < overrides.length; position++) {
      const next = Array<bigint>(16).fill(0n);
      for (const [mask, count] of counts.entries()) {
        for (const [index, size] of sizes.entries()) {
          const seen = mask | (1 << index);
          next[seen] = (next[seen] ?? 0n) + count * BigInt(size);
        }
      }
      counts = next;
    }
    const { entropyBits } = generateVaultPassword(
      { ...VAULT_PASSWORD_DEFAULTS, ...overrides },
      seededBytes(),
    );
    expect(entropyBits).toBeCloseTo(Math.log2(Number(counts[15])), 10);
  });

  it("rejects bytes at the modulo boundary while accepting the preceding byte", () => {
    const { value } = generateVaultPassword(
      { ...digitsOnly, length: 8 },
      cyclingBytes([249, 250, 255, 0]),
    );
    expect(value).toBe("90909090");
  });

  it("rejects whole passwords missing a class without rearranging an accepted password", () => {
    const alphabet = VAULT_PASSWORD_CHARACTER_SETS.map((set) => set.characters).join("");
    const accepted = "aA0!aaaa";
    const random = vi
      .fn<(count: number) => Uint8Array>()
      .mockImplementationOnce((count) => new Uint8Array(count))
      .mockImplementationOnce(
        cyclingBytes([...accepted].map((character) => alphabet.indexOf(character))),
      );
    expect(generateVaultPassword({ ...VAULT_PASSWORD_DEFAULTS, length: 8 }, random).value).toBe(
      accepted,
    );
    expect(random).toHaveBeenCalledTimes(2);
  });

  it.each([7, 129, 8.5, NaN, Infinity, -Infinity, "20", undefined, null])(
    "rejects invalid length %s before requesting bytes",
    (length) => {
      const random = vi.fn(seededBytes());
      const options = { ...VAULT_PASSWORD_DEFAULTS, length } as VaultPasswordOptions;
      expect(() => generateVaultPassword(options, random)).toThrow(RangeError);
      expect(random).not.toHaveBeenCalled();
    },
  );

  it.each(booleanOptions)("requires an explicit boolean for %s", (id) => {
    const random = vi.fn(seededBytes());
    for (const value of [undefined, null, 0, 1, "true", "false"]) {
      const options = { ...VAULT_PASSWORD_DEFAULTS, [id]: value } as VaultPasswordOptions;
      expect(() => generateVaultPassword(options, random)).toThrow(`"${id}" must be a boolean`);
    }
    expect(random).not.toHaveBeenCalled();
  });

  it("rejects missing options and a missing byte source", () => {
    expect(() =>
      generateVaultPassword(null as unknown as VaultPasswordOptions, seededBytes()),
    ).toThrow("Password options must be an object");
    expect(() =>
      generateVaultPassword(
        VAULT_PASSWORD_DEFAULTS,
        undefined as unknown as (count: number) => Uint8Array,
      ),
    ).toThrow("A random byte source is required");
  });

  it("rejects an empty selection before requesting bytes", () => {
    const random = vi.fn(seededBytes());
    expect(() => generateVaultPassword({ ...digitsOnly, digits: false }, random)).toThrow(
      "Choose at least one character set",
    );
    expect(random).not.toHaveBeenCalled();
  });

  it("fails closed if the source throws", () => {
    expect(() =>
      generateVaultPassword(VAULT_PASSWORD_DEFAULTS, () => {
        throw new Error("Provider-specific failure");
      }),
    ).toThrow("Unable to obtain random bytes");
  });

  it.each([undefined, null, [], new Uint16Array(40)])(
    "rejects a malformed source result %s",
    (result) => {
      const random = vi.fn(() => result as unknown as Uint8Array);
      expect(() => generateVaultPassword(VAULT_PASSWORD_DEFAULTS, random)).toThrow(
        "Random source must return the requested number of bytes",
      );
      expect(random).toHaveBeenCalledTimes(1);
    },
  );

  it.each([0, -1, 1])("rejects the wrong byte count (offset %i)", (offset) => {
    const random = vi.fn((count: number) => new Uint8Array(offset === 0 ? 0 : count + offset));
    expect(() => generateVaultPassword(VAULT_PASSWORD_DEFAULTS, random)).toThrow(
      "Random source must return the requested number of bytes",
    );
    expect(random).toHaveBeenCalledTimes(1);
  });

  it.each([
    [255, "enough usable bytes"],
    [0, "every selected character set"],
  ] as const)("bounds retries when repeated byte %i cannot produce a password", (byte, error) => {
    let calls = 0;
    const random = (count: number) => {
      if (++calls > 1024) throw new Error("Test source exceeded the safety bound.");
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(256);
      return new Uint8Array(count).fill(byte);
    };
    expect(() => generateVaultPassword(VAULT_PASSWORD_DEFAULTS, random)).toThrow(error);
    expect(calls).toBeLessThanOrEqual(1024);
  });
});
