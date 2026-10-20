import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { UtilityResult, UtilityToolImpl } from "../types";
import { HASH_TOOLS } from "./hash";
import { runInput } from "./testSupport";

// Each vector checked against `printf <text> | shasum -a <n>`, `md5` and node:crypto.
const VECTORS = {
  md5: {
    "": "d41d8cd98f00b204e9800998ecf8427e",
    abc: "900150983cd24fb0d6963f7d28e17f72",
  },
  sha1: {
    "": "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    abc: "a9993e364706816aba3e25717850c26c9cd0d89d",
  },
  sha256: {
    "": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    abc: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  },
  sha384: {
    "": "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
    abc: "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
  },
  sha512: {
    "": "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    abc: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  },
};

const VECTOR_CASES = Object.entries(VECTORS).flatMap(([algorithm, digests]) =>
  Object.entries(digests).map(([text, digest]) => ({ algorithm, text, digest })),
);

// RFC 4231 test cases 1 and 2.
const RFC4231_CASE1 = {
  key: "0b".repeat(20),
  message: "Hi There",
  sha256: "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
  sha384:
    "afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6",
  sha512:
    "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
};
const RFC4231_CASE2 = {
  key: "Jefe",
  message: "what do ya want for nothing?",
  sha256: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  sha512:
    "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737",
};

function run(tool: UtilityToolImpl, overrides: Parameters<typeof runInput>[1] = {}): UtilityResult {
  if (!tool.run) throw new Error("Tool has no run.");
  return tool.run(runInput(tool, overrides));
}

function okFields(result: UtilityResult) {
  if (result.kind !== "ok") throw new Error(`Expected ok, got: ${result.message}`);
  return result.fields;
}

function onlyValue(result: UtilityResult) {
  const fields = okFields(result);
  expect(fields).toHaveLength(1);
  return fields[0]?.value;
}

const hash = (text: string, options: Record<string, string> = {}) =>
  run(HASH_TOOLS.hash, { text, options });

const hmac = (message: string, key: string, options: Record<string, string> = {}) =>
  run(HASH_TOOLS.hmac, { text: message, second: key, options });

describe("hash", () => {
  it.each(VECTOR_CASES)("$algorithm of $text matches the known vector", (vector) => {
    expect(onlyValue(hash(vector.text, { algorithm: vector.algorithm }))).toBe(vector.digest);
  });

  it("defaults to SHA-256 in hex", () => {
    const result = hash("abc");
    expect(okFields(result)).toEqual([
      { label: "SHA-256", value: VECTORS.sha256.abc, monospace: true },
    ]);
  });

  it("writes standard padded base64", () => {
    expect(onlyValue(hash("abc", { encoding: "base64" }))).toBe(
      "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
    );
    expect(onlyValue(hash("", { algorithm: "md5", encoding: "base64" }))).toBe(
      "1B2M2Y8AsgTpgAmY7PhCfg==",
    );
  });

  it("hashes the exact UTF-8 bytes, keeping whitespace and line endings", () => {
    expect(onlyValue(hash(" a\r\n"))).toBe(
      "f97b4fcda3db6d9e52c49c9b28d9b4c3c2966a147754b6db3a60de7a87da49b9",
    );
    const emoji = hash("héllo 🌍");
    expect(onlyValue(emoji)).toBe(
      "cbbcee01a3fc5f1c0db23e02be25316adf28ede876031fdbabe5f4fabe47ed7f",
    );
    expect(emoji).not.toHaveProperty("warnings");
  });

  it("says when an unpaired surrogate was hashed as U+FFFD", () => {
    // `printf 'a\xef\xbf\xbdb' | shasum -a 256`
    const replaced = "05087813392efc16fe8ff448920c6328e53af865df39419436659d9ffda90f7b";
    for (const text of ["a\uD83Db", "a\uDF0Db"]) {
      const result = hash(text);
      expect(onlyValue(result)).toBe(replaced);
      expect(result.kind === "ok" && result.warnings).toEqual([
        "The text has an unpaired surrogate, which was hashed as U+FFFD.",
      ]);
    }
    expect(hash("a�b")).not.toHaveProperty("warnings");
    expect(hash("a\uD83D", { algorithm: "all" })).toMatchObject({
      warnings: [
        "MD5 and SHA-1 are not suitable for security.",
        "The text has an unpaired surrogate, which was hashed as U+FFFD.",
      ],
    });
  });

  it("lists every algorithm at once", () => {
    const result = hash("abc", { algorithm: "all" });
    expect(okFields(result).map((field) => [field.label, field.value])).toEqual([
      ["MD5", VECTORS.md5.abc],
      ["SHA-1", VECTORS.sha1.abc],
      ["SHA-256", VECTORS.sha256.abc],
      ["SHA-384", VECTORS.sha384.abc],
      ["SHA-512", VECTORS.sha512.abc],
    ]);
    expect(result.kind === "ok" && result.warnings).toEqual([
      "MD5 and SHA-1 are not suitable for security.",
    ]);
  });

  it("warns that MD5 and SHA-1 are not suitable for security", () => {
    for (const algorithm of ["md5", "sha1"]) {
      const result = hash("abc", { algorithm });
      expect(result.kind === "ok" && result.warnings?.join(" ")).toContain(
        "not suitable for security",
      );
    }
    for (const algorithm of ["sha256", "sha384", "sha512"]) {
      const result = hash("abc", { algorithm });
      expect(result.kind === "ok" && result.warnings).toBeUndefined();
    }
  });

  it("rejects an algorithm or encoding outside its choices", () => {
    expect(hash("abc", { algorithm: "sha3" }).kind).toBe("error");
    expect(hash("abc", { encoding: "base32" }).kind).toBe("error");
    expect(hash("abc", { encoding: "constructor" }).kind).toBe("error");
  });
});

describe("hmac", () => {
  it("matches RFC 4231 test case 1 for SHA-256, SHA-384 and SHA-512", () => {
    const options = { keyEncoding: "hex" };
    const { key, message } = RFC4231_CASE1;
    expect(okFields(hmac(message, key, options))).toEqual([
      { label: "HMAC-SHA-256", value: RFC4231_CASE1.sha256, monospace: true },
    ]);
    expect(onlyValue(hmac(message, key, { ...options, algorithm: "sha384" }))).toBe(
      RFC4231_CASE1.sha384,
    );
    expect(onlyValue(hmac(message, key, { ...options, algorithm: "sha512" }))).toBe(
      RFC4231_CASE1.sha512,
    );
  });

  it("matches RFC 4231 test case 2 with a UTF-8 key", () => {
    const { key, message } = RFC4231_CASE2;
    expect(onlyValue(hmac(message, key))).toBe(RFC4231_CASE2.sha256);
    expect(onlyValue(hmac(message, key, { algorithm: "sha512" }))).toBe(RFC4231_CASE2.sha512);
  });

  it("reads the key as base64 and as spaced hex", () => {
    const { message } = RFC4231_CASE1;
    expect(
      onlyValue(hmac(message, "CwsLCwsLCwsLCwsLCwsLCwsLCws=", { keyEncoding: "base64" })),
    ).toBe(RFC4231_CASE1.sha256);
    expect(onlyValue(hmac(message, "CwsLCwsLCwsLCwsLCwsLCwsLCws", { keyEncoding: "base64" }))).toBe(
      RFC4231_CASE1.sha256,
    );
    expect(
      onlyValue(
        hmac(message, "0b 0b 0b 0b 0b 0B 0B 0B 0B 0B 0b0b0b0b0b0b0b0b0b0b", { keyEncoding: "hex" }),
      ),
    ).toBe(RFC4231_CASE1.sha256);
  });

  it("writes base64 output", () => {
    const { key, message } = RFC4231_CASE1;
    expect(onlyValue(hmac(message, key, { keyEncoding: "hex", encoding: "base64" }))).toBe(
      "sDRMYdjbOFNcqK/OrwvxK4gdwgDJgz2nJuk3bC4yz/c=",
    );
  });

  it("allows an empty key and an empty message", () => {
    expect(onlyValue(hmac("abc", ""))).toBe(
      "fd7adb152c05ef80dccf50a1fa4c05d5a3ec6da95575fc312ae7c5d091836351",
    );
    expect(hmac("", "key").kind).toBe("ok");
  });

  it("names the key when it is not valid hex", () => {
    expect(hmac("abc", "0b0g", { keyEncoding: "hex" })).toEqual({
      kind: "error",
      message: 'The key is not valid hex: unexpected character "g" at position 4.',
    });
    expect(hmac("abc", "0b0", { keyEncoding: "hex" })).toEqual({
      kind: "error",
      message: "The key is not valid hex: it has an odd number of digits.",
    });
    expect(hmac("abc", "0b 0g", { keyEncoding: "hex" })).toMatchObject({
      message: 'The key is not valid hex: unexpected character "g" at position 5.',
    });
  });

  it("shows an invisible character in a key error by its code point", () => {
    expect(hmac("abc", "0b​0b", { keyEncoding: "hex" })).toEqual({
      kind: "error",
      message: "The key is not valid hex: unexpected character U+200B at position 3.",
    });
    expect(hmac("abc", "Zm9v\u0000", { keyEncoding: "base64" })).toEqual({
      kind: "error",
      message: "The key is not valid base64: unexpected character U+0000 at position 5.",
    });
    expect(hmac("abc", "0b\uD83D", { keyEncoding: "hex" })).toMatchObject({
      message: "The key is not valid hex: unexpected character U+D83D at position 3.",
    });
  });

  it("says when the message or a UTF-8 key had an unpaired surrogate", () => {
    const result = hmac("a\uD83Db", "\uDF0D");
    // HMAC-SHA256 of the bytes 61 ef bf bd 62 under the key ef bf bd, from node:crypto.
    expect(onlyValue(result)).toBe(
      "f029dbf2fb1aaaa143d508d2eb3f43660013daeb46896f058536c41bc114523d",
    );
    expect(result.kind === "ok" && result.warnings).toEqual([
      "The message has an unpaired surrogate, which was hashed as U+FFFD.",
      "The key has an unpaired surrogate, which was hashed as U+FFFD.",
    ]);
    expect(hmac("abc", "key 🌍")).not.toHaveProperty("warnings");
  });

  it("names the key when it is not valid base64", () => {
    expect(hmac("abc", "Zm9v!", { keyEncoding: "base64" })).toEqual({
      kind: "error",
      message: 'The key is not valid base64: unexpected character "!" at position 5.',
    });
    expect(hmac("abc", "Zm9vY", { keyEncoding: "base64" })).toEqual({
      kind: "error",
      message: "The key is not valid base64: check its length and padding.",
    });
  });

  it("warns that SHA-1 is not suitable for security", () => {
    const result = hmac(RFC4231_CASE2.message, RFC4231_CASE2.key, { algorithm: "sha1" });
    // RFC 2202 test case 2.
    expect(onlyValue(result)).toBe("effcdf6ae5eb2fa2d27416d5f184df9c259a7c79");
    expect(result.kind === "ok" && result.warnings).toEqual([
      "SHA-1 is not suitable for security.",
    ]);
    expect(hmac("abc", "key")).not.toHaveProperty("warnings");
  });

  it("does not offer MD5", () => {
    expect(hmac("abc", "key", { algorithm: "md5" }).kind).toBe("error");
  });
});

describe("examples", () => {
  it.each(Object.entries(HASH_TOOLS))("%s example gives an ok result", (_id, tool) => {
    expect(tool.example).toBeDefined();
    expect(run(tool, { ...tool.example }).kind).toBe("ok");
  });
});

describe("without secure-context crypto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("hashes and signs when crypto.subtle and crypto.randomUUID are unavailable", async () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: original.getRandomValues.bind(original) });
    expect("subtle" in globalThis.crypto).toBe(false);
    expect("randomUUID" in globalThis.crypto).toBe(false);

    // A fresh import, so module setup also runs without them.
    vi.resetModules();
    const { HASH_TOOLS: tools } = await import("./hash");
    expect(onlyValue(run(tools.hash, { text: "abc", options: { algorithm: "sha512" } }))).toBe(
      VECTORS.sha512.abc,
    );
    expect(onlyValue(run(tools.hash, { text: "abc", options: { algorithm: "md5" } }))).toBe(
      VECTORS.md5.abc,
    );
    expect(
      onlyValue(run(tools.hmac, { text: RFC4231_CASE2.message, second: RFC4231_CASE2.key })),
    ).toBe(RFC4231_CASE2.sha256);
  });
});
