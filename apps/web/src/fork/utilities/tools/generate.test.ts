import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { UtilityResult, UtilityToolImpl } from "../types";
import { base64ToBytes, hexToBytes } from "./bytes";
import { GENERATE_TOOLS, pick } from "./generate";
import { cyclingBytes, FIXED_NOW, runInput, seededRandom } from "./testSupport";

const { uuid, ulid, password, token, lorem } = GENERATE_TOOLS;

function fields(result: UtilityResult): Record<string, string> {
  if (result.kind === "error") throw new Error(`Expected a result, got "${result.message}"`);
  return Object.fromEntries(result.fields.map((field) => [field.label, field.value]));
}

const firstValue = (result: UtilityResult) => {
  if (result.kind === "error") throw new Error(`Expected a result, got "${result.message}"`);
  return result.fields[0]?.value ?? "";
};

const errorMessage = (result: UtilityResult) => (result.kind === "error" ? result.message : null);

const seeds = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

describe("pick", () => {
  it("skips bytes at or above the rejection limit instead of folding them with modulo", () => {
    // 256 % 62 is 8, so 248 to 255 are rejected; modulo would map 248 to "A" and 255 to "H".
    expect(pick(ALPHANUMERIC, 3, cyclingBytes([248, 255, 0, 61, 130]))).toBe("A9G");
    expect(pick(ALPHANUMERIC, 2, cyclingBytes([247, 248]))).toBe("99");
  });

  it("gives every character of a 62-character alphabet the same share", () => {
    const allBytes = Array.from({ length: 256 }, (_, index) => index);
    const counts = new Map<string, number>();
    for (const char of pick(ALPHANUMERIC, 248 * 10, cyclingBytes(allBytes))) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(62);
    expect(new Set(counts.values())).toEqual(new Set([40]));
  });

  it("refuses an alphabet too large for one byte instead of looping forever", () => {
    // The limit for 257 is 256 - 256 % 257 = 0, so every byte would be rejected. A synchronous
    // loop cannot be timed out, so the source gives up to make a missing guard fail, not hang.
    const source = seededRandom(1);
    let calls = 0;
    const random = (bytes: number) => {
      calls++;
      if (calls > 1000) throw new Error("Every byte was rejected.");
      return source(bytes);
    };
    expect(() => pick("x".repeat(257), 1, random)).toThrow(RangeError);
    expect(calls).toBe(0);
    expect(pick("x".repeat(256), 4, random)).toBe("xxxx");
  });
});

describe("uuid", () => {
  const generate = (options: Record<string, string | number | boolean>, now = FIXED_NOW) =>
    firstValue(uuid.generate(runInput(uuid, { options, now, random: seededRandom(3) })));

  it("sets the v4 version and variant bits over random bytes", () => {
    const zeros = { random: cyclingBytes([0]) };
    const ones = { random: cyclingBytes([0xff]) };
    expect(firstValue(uuid.generate(runInput(uuid, zeros)))).toBe(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(firstValue(uuid.generate(runInput(uuid, ones)))).toBe(
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
    );
    for (const value of generate({ count: 100 }).split("\n")) {
      expect(value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("encodes the injected time in v7", () => {
    const result = uuid.generate(
      runInput(uuid, {
        options: { version: "v7" },
        now: 0x017f22e279b0,
        random: cyclingBytes([0]),
      }),
    );
    expect(firstValue(result)).toBe("017f22e2-79b0-7000-8000-000000000000");
    expect(fields(uuid.run(runInput(uuid, { text: generate({ version: "v7" }) })))).toMatchObject({
      Version: "7 (Unix time)",
      "Unix time (ms)": String(FIXED_NOW),
      UTC: "2023-11-14T22:13:20.000Z",
    });
  });

  it("sorts v7 values by time, across calls and within a batch", () => {
    const times = [FIXED_NOW + 86_400_000, FIXED_NOW, FIXED_NOW + 1, FIXED_NOW + 1000];
    const random = seededRandom(9);
    const values = times.map((now) =>
      firstValue(uuid.generate(runInput(uuid, { options: { version: "v7" }, now, random }))),
    );
    const byTime = [...times].sort((a, b) => a - b).map((now) => values[times.indexOf(now)]);
    expect([...values].sort()).toEqual(byTime);

    const batch = generate({ version: "v7", count: 50 }).split("\n");
    expect(new Set(batch).size).toBe(50);
    expect(batch).toEqual([...batch].sort());
  });

  it("caps the count and labels bulk output", () => {
    expect(generate({ count: 1000 }).split("\n")).toHaveLength(100);
    expect(generate({ count: 0 }).split("\n")).toHaveLength(1);
    expect(fields(uuid.generate(runInput(uuid, { options: { count: 2 } })))).toHaveProperty(
      "UUIDs",
    );
  });

  it("writes uppercase on request", () => {
    expect(generate({ uppercase: true, count: 5 })).toMatch(/^[0-9A-F\n-]+$/);
  });

  it("refuses a clock outside the 48-bit range for v7", () => {
    expect(
      errorMessage(uuid.generate(runInput(uuid, { options: { version: "v7" }, now: -1 }))),
    ).toBe("The clock is outside the 48-bit range this format can store.");
  });

  // RFC 9562 appendix A and B test vectors.
  it.each([
    ["C232AB00-9414-11EC-B3C8-9F6BDECED846", "1 (Gregorian time)"],
    ["5df41881-3aed-3515-88a7-2f4a814cf09e", "3 (name-based, MD5)"],
    ["919108f7-52d1-4320-9bac-f847db4148a8", "4 (random)"],
    ["2ed6657d-e927-568b-95e1-2665a8aea6a2", "5 (name-based, SHA-1)"],
    ["1EC9414C-232A-6B00-B3C8-9F6BDECED846", "6 (reordered Gregorian time)"],
    ["017F22E2-79B0-7CC3-98C4-DC0C0C07398F", "7 (Unix time)"],
    ["2489E9AD-2EE2-8E00-8EC9-32D5F69181C0", "8 (custom)"],
  ])("reports the version of %s", (text, version) => {
    expect(fields(uuid.run(runInput(uuid, { text })))).toMatchObject({
      UUID: text.toLowerCase(),
      Version: version,
      Variant: "RFC 9562, formerly RFC 4122",
    });
  });

  it("reads the v7 timestamp in UTC and the given zone", () => {
    const result = uuid.run(
      runInput(uuid, {
        text: "017F22E2-79B0-7CC3-98C4-DC0C0C07398F",
        timeZone: "America/New_York",
      }),
    );
    expect(fields(result)).toMatchObject({
      "Unix time (ms)": "1645557742000",
      UTC: "2022-02-22T19:22:22.000Z",
      "Local time": "2022-02-22 14:22:22 EST",
    });
  });

  it("accepts braces, the URN prefix and surrounding whitespace", () => {
    for (const text of [
      "{919108F7-52D1-4320-9BAC-F847DB4148A8}",
      "urn:uuid:919108f7-52d1-4320-9bac-f847db4148a8",
      "  919108f7-52d1-4320-9bac-f847db4148a8\n",
    ]) {
      expect(fields(uuid.run(runInput(uuid, { text }))).UUID).toBe(
        "919108f7-52d1-4320-9bac-f847db4148a8",
      );
    }
  });

  it("recognises the nil and max UUIDs and other variants", () => {
    const run = (text: string) => fields(uuid.run(runInput(uuid, { text })));
    expect(run("00000000-0000-0000-0000-000000000000").Version).toBe("Nil UUID (all bits zero)");
    expect(run("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF").Version).toBe("Max UUID (all bits one)");
    // IUnknown's interface id, a Microsoft-variant GUID.
    expect(run("00000000-0000-0000-C000-000000000046")).toMatchObject({
      Version: "Not defined for this variant",
      Variant: "Microsoft (reserved)",
    });
  });

  it.each([
    "",
    "not-a-uuid",
    "919108f752d143209bacf847db4148a8",
    "919108f7-52d1-4320-9bac-f847db4148ag",
    "{919108f7-52d1-4320-9bac-f847db4148a8",
  ])("rejects %j", (text) => {
    expect(errorMessage(uuid.run(runInput(uuid, { text })))).toBe("Not a valid UUID.");
  });
});

describe("ulid", () => {
  it("writes 26 Crockford characters whose timestamp decodes back", () => {
    const value = firstValue(ulid.generate(runInput(ulid)));
    expect(value).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(fields(ulid.run(runInput(ulid, { text: value })))).toMatchObject({
      "Unix time (ms)": String(FIXED_NOW),
      UTC: "2023-11-14T22:13:20.000Z",
    });
  });

  it("puts 48 bits of time before 80 random bits", () => {
    const generate = (now: number, byte: number) =>
      firstValue(ulid.generate(runInput(ulid, { now, random: cyclingBytes([byte]) })));
    expect(generate(0, 0)).toBe("0".repeat(26));
    expect(generate(2 ** 48 - 1, 0xff)).toBe(`7${"Z".repeat(25)}`);
    expect(errorMessage(ulid.generate(runInput(ulid, { now: 2 ** 48 })))).toBe(
      "The clock is outside the 48-bit range this format can store.",
    );
  });

  it("caps the count and sorts a batch", () => {
    const values = firstValue(ulid.generate(runInput(ulid, { options: { count: 1000 } }))).split(
      "\n",
    );
    expect(values).toHaveLength(100);
    expect(values).toEqual([...values].sort());
  });

  it("decodes the specification's example in any case", () => {
    for (const text of ["01ARZ3NDEKTSV4RRFFQ69G5FAV", " 01arz3ndektsv4rrffq69g5fav "]) {
      const result = ulid.run(runInput(ulid, { text, timeZone: "America/New_York" }));
      expect(fields(result)).toEqual({
        ULID: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "Unix time (ms)": "1469922850259",
        UTC: "2016-07-30T23:54:10.259Z",
        "Local time": "2016-07-30 19:54:10 EDT",
      });
    }
  });

  it("names the bad character, the wrong length and an overflowing timestamp", () => {
    const run = (text: string) => errorMessage(ulid.run(runInput(ulid, { text })));
    expect(run("01ARZ3NDEKTSV4RRFFQ69G5FAU")).toBe(
      'Not a valid ULID: unexpected character "U" at position 26.',
    );
    expect(run("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe("A ULID has 26 characters; this has 25.");
    expect(run("01ARZ3NDEKTSV4RRFFQ69G5FA🙂")).toBe(
      'Not a valid ULID: unexpected character "🙂" at position 26.',
    );
    expect(run("8ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(
      "Not a valid ULID: the timestamp overflows 48 bits; the first character must be 0 to 7.",
    );
  });
});

describe("password", () => {
  const generate = (options: Record<string, string | number | boolean>, seed = 1) =>
    fields(password.generate(runInput(password, { options, random: seededRandom(seed) })));

  it("defaults to 20 characters from all four sets", () => {
    const result = generate({});
    expect(result.Password).toHaveLength(20);
    expect(result.Entropy).toBe("130 bits");
  });

  it("keeps the length within 8 to 128", () => {
    expect(generate({ length: 1000 }).Password).toHaveLength(128);
    expect(generate({ length: 3 }).Password).toHaveLength(8);
  });

  it("always includes every chosen set", () => {
    for (const seed of seeds(200)) {
      const value = generate({ length: 8 }, seed).Password;
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/[0-9]/);
      expect(value).toMatch(/[^a-zA-Z0-9]/);
    }
  });

  it("does not pin the guaranteed characters to fixed positions", () => {
    const leading = new Set(
      seeds(100).map((seed) => {
        const value =
          generate({ length: 8, uppercase: false, symbols: false }, seed).Password ?? "";
        return /[0-9]/.test(value.charAt(0)) ? "digit" : "letter";
      }),
    );
    expect(leading).toEqual(new Set(["digit", "letter"]));
  });

  it("leaves out look-alikes on request and counts the smaller alphabet", () => {
    for (const seed of seeds(30)) {
      expect(generate({ length: 128, excludeLookAlikes: true }, seed).Password).not.toMatch(
        /[0Oo1lI|]/,
      );
    }
    expect(generate({ excludeLookAlikes: true }).Entropy).toBe("128 bits");
  });

  it("uses only the chosen sets", () => {
    const result = generate({ lowercase: false, uppercase: false, symbols: false });
    expect(result.Password).toMatch(/^[0-9]{20}$/);
    expect(result.Entropy).toBe("66 bits");
  });

  it("asks for a character set when none is chosen", () => {
    const options = { lowercase: false, uppercase: false, digits: false, symbols: false };
    expect(errorMessage(password.generate(runInput(password, { options })))).toBe(
      "Choose at least one character set.",
    );
  });
});

describe("token", () => {
  const generate = (options: Record<string, string | number | boolean>) =>
    firstValue(token.generate(runInput(token, { options })));

  it("encodes the chosen number of bytes", () => {
    expect(hexToBytes(generate({}))).toHaveLength(32);
    const base64 = generate({ encoding: "base64" });
    expect(base64).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(base64ToBytes(base64)).toHaveLength(32);
    const base64url = generate({ encoding: "base64url", bytes: 16 });
    expect(base64url).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(base64ToBytes(base64url)).toHaveLength(16);
  });

  it("writes the source bytes as they are", () => {
    const random = cyclingBytes([0xfb, 0xff]);
    const options = { bytes: 8, encoding: "base64url" };
    expect(firstValue(token.generate(runInput(token, { options, random })))).toBe("-__7__v_-_8");
  });

  it("keeps the byte count within 8 to 256", () => {
    expect(generate({ bytes: 1000 })).toHaveLength(512);
    expect(generate({ bytes: 1 })).toHaveLength(16);
  });
});

describe("lorem", () => {
  const generate = (options: Record<string, string | number | boolean>) =>
    firstValue(lorem.generate(runInput(lorem, { options })));

  it("defaults to three paragraphs that open with Lorem ipsum", () => {
    const paragraphs = generate({}).split("\n\n");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toMatch(/^Lorem ipsum dolor sit amet, consectetur adipiscing elit\. /);
    for (const paragraph of paragraphs) expect(paragraph).toMatch(/^([A-Z][a-z, ]+\. ?)+$/);
  });

  it("writes the requested number of sentences and words", () => {
    const sentences = generate({ unit: "sentences", count: 4 }).split(/(?<=\.) /);
    expect(sentences).toHaveLength(4);
    for (const sentence of sentences) expect(sentence).toMatch(/^[A-Z][a-z, ]+\.$/);
    expect(generate({ unit: "words", count: 5 })).toBe("Lorem ipsum dolor sit amet");
    expect(generate({ unit: "words", count: 12 }).split(" ")).toHaveLength(12);
  });

  it("starts with a random word when Lorem ipsum is off", () => {
    const value = generate({ unit: "words", count: 30, startWithLorem: false });
    expect(value).not.toMatch(/^Lorem ipsum/);
    expect(value).toMatch(/^[A-Z][a-z]*( [a-z]+){29}$/);
  });

  it("caps the count at 100", () => {
    expect(generate({ unit: "words", count: 1000 }).split(" ")).toHaveLength(100);
    expect(generate({ unit: "paragraphs", count: 1000 }).split("\n\n")).toHaveLength(100);
  });
});

describe("without secure-context APIs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("generates everything with only getRandomValues and never Math.random", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array<ArrayBuffer>) => real.getRandomValues(array),
    });
    const mathRandom = vi.spyOn(Math, "random");
    expect(globalThis.crypto.subtle).toBeUndefined();
    expect("randomUUID" in globalThis.crypto).toBe(false);

    const random = (bytes: number) => globalThis.crypto.getRandomValues(new Uint8Array(bytes));
    const tools: Record<string, UtilityToolImpl> = GENERATE_TOOLS;
    for (const [id, tool] of Object.entries(tools)) {
      const result = tool.generate?.(runInput(tool, { random }));
      expect(result?.kind, id).toBe("ok");
    }
    expect(mathRandom).not.toHaveBeenCalled();
  });
});

it("gives every example a result", () => {
  const tools: Record<string, UtilityToolImpl> = GENERATE_TOOLS;
  for (const [id, tool] of Object.entries(tools)) {
    const input = runInput(tool, tool.example ?? {});
    expect((tool.run ?? tool.generate)?.(input).kind, id).toBe("ok");
  }
});
