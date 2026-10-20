import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { UtilityOptionValues, UtilityResult, UtilityToolImpl } from "../types";
import { MAX_OUTPUT_BYTES } from "./limits";
import { runInput, seededRandom } from "./testSupport";
import { TEXT_TOOLS } from "./text";

const run = (
  tool: UtilityToolImpl,
  text: string,
  options: UtilityOptionValues = {},
  second = "",
): UtilityResult => {
  if (!tool.run) throw new Error("The tool has no run.");
  return tool.run(runInput(tool, { text, second, options }));
};

const fields = (result: UtilityResult) => {
  if (result.kind !== "ok") throw new Error(`Expected a result, got: ${result.message}`);
  return Object.fromEntries(result.fields.map((field) => [field.label, field.value]));
};

const firstValue = (result: UtilityResult) => {
  if (result.kind !== "ok") throw new Error(`Expected a result, got: ${result.message}`);
  return result.fields[0]?.value;
};

const errorMessage = (result: UtilityResult) =>
  result.kind === "error" ? result.message : `Unexpected result: ${JSON.stringify(result)}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("examples", () => {
  it.each(Object.entries(TEXT_TOOLS))("%s runs its example", (_id, tool) => {
    const example = tool.example;
    const result = tool.run(
      runInput(tool, {
        text: example.text,
        second: "second" in example ? example.second : "",
      }),
    );
    expect(result.kind).toBe("ok");
  });
});

describe("json", () => {
  const tool = TEXT_TOOLS.json;
  const sample = '{"name":"Loom","tags":["dev",{"a":null}],"empty":{},"none":[],"n":-15}';

  it.each([
    ["pretty2", 2],
    ["pretty4", 4],
    ["tabs", "\t"],
  ] as const)("lays out %s like JSON.stringify", (format, indent) => {
    expect(firstValue(run(tool, sample, { format }))).toBe(
      JSON.stringify(JSON.parse(sample), null, indent),
    );
  });

  it("minifies and labels the output", () => {
    const result = run(tool, ' {\n  "a" : [ 1 , 2 ] ,\n  "b" : { }\n} ', { format: "minify" });
    expect(fields(result)).toEqual({ Minified: '{"a":[1,2],"b":{}}' });
    expect(Object.keys(fields(run(tool, "[]")))).toEqual(["Formatted"]);
  });

  it("keeps big integers, number spelling, escapes and key order as written", () => {
    const text = '{"b":1,"10":2,"id":12345678901234567890,"x":1.50,"s":"\\u00e9\\n"}';
    expect(firstValue(run(tool, text, { format: "minify" }))).toBe(text);
    expect(firstValue(run(tool, "  42  "))).toBe("42");
  });

  it("sorts keys recursively only when asked, leaving arrays in order", () => {
    const text = '{"b":{"d":1,"c":[{"z":1,"y":2}]},"a":[3,1,2],"\\u0061a":0}';
    expect(firstValue(run(tool, text, { format: "minify" }))).toBe(text);
    expect(firstValue(run(tool, text, { format: "minify", sortKeys: true }))).toBe(
      '{"a":[3,1,2],"\\u0061a":0,"b":{"c":[{"y":2,"z":1}],"d":1}}',
    );
  });

  it.each([
    ["{x}", "Invalid JSON at line 1, column 2: Expected property name or '}'."],
    ['{\n  "a": 1,\n}', "Invalid JSON at line 3, column 1: Expected double-quoted property name."],
    ["[1,2", "Invalid JSON at line 1, column 5: Expected ',' or ']' after array element."],
    ['{"a":', "Invalid JSON at line 1, column 6: Unexpected end of JSON input."],
    ["abc", `Invalid JSON: Unexpected token 'a', "abc" is not valid JSON.`],
  ])("explains %j", (text, message) => {
    expect(errorMessage(run(tool, text))).toBe(message);
  });

  it("counts lines and columns the way this engine does", () => {
    for (const text of ["[1,\r 2 3]", "[1,\r\n 2 3]", '["😀😀"\n, 2 3]', "[1,\r\r 2 3]"]) {
      let engine = "";
      try {
        JSON.parse(text);
      } catch (cause) {
        engine = cause instanceof Error ? cause.message : "";
      }
      const [, line, column] = /\(line (\d+) column (\d+)\)$/.exec(engine) ?? [];
      expect(errorMessage(run(tool, text))).toContain(`at line ${line}, column ${column}:`);
    }
  });

  it.each([
    [
      "an older V8",
      "Unexpected token } in JSON at position 4",
      "Invalid JSON at line 2, column 2: Unexpected token }.",
    ],
    [
      "Firefox",
      "JSON.parse: unexpected character at line 2 column 2 of the JSON data",
      "Invalid JSON at line 2, column 2: Unexpected character.",
    ],
    [
      "Safari",
      'JSON Parse error: Unexpected identifier "x"',
      'Invalid JSON: Unexpected identifier "x".',
    ],
  ])("reads the error position from %s", (_engine, engineMessage, message) => {
    vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw new SyntaxError(engineMessage);
    });
    expect(errorMessage(run(tool, "[1\n,}"))).toBe(message);
  });

  it("refuses nesting too deep to format instead of throwing", () => {
    const text = `${"[".repeat(100_000)}${"]".repeat(100_000)}`;
    expect(errorMessage(run(tool, text))).toBe("This JSON is nested too deeply to format.");
  });

  it("stops writing once indentation outgrows the output cap", () => {
    const depth = 500;
    const text = `${"[".repeat(depth)}${"1,".repeat(100_000)}1${"]".repeat(depth)}`;
    const value = firstValue(run(tool, text, { format: "pretty4" })) ?? "";
    expect(value.length).toBeGreaterThan(MAX_OUTPUT_BYTES);
    expect(value.length).toBeLessThan(MAX_OUTPUT_BYTES * 2);
  });
});

describe("list", () => {
  const tool = TEXT_TOOLS.list;

  it("makes a JSON array, one item per line, a final line break adding nothing", () => {
    expect(fields(run(tool, "a\r\nb\n"))).toEqual({
      "JSON array": '[\n  "a",\n  "b"\n]',
      Items: "2",
    });
  });

  it("keeps whitespace and empty lines unless asked", () => {
    const text = " a \n\n  \nb";
    const items = (options: UtilityOptionValues) =>
      JSON.parse(firstValue(run(tool, text, options)) ?? "");
    expect(items({})).toEqual([" a ", "", "  ", "b"]);
    expect(items({ trim: true })).toEqual(["a", "", "", "b"]);
    expect(items({ dropEmpty: true })).toEqual([" a ", "  ", "b"]);
    expect(items({ trim: true, dropEmpty: true })).toEqual(["a", "b"]);
  });

  it("quotes CSV fields by RFC 4180", () => {
    const text = 'plain\nhas, comma\nsays "hi"\ncarriage\rreturn';
    expect(fields(run(tool, text, { output: "csvRow" }))).toEqual({
      "CSV row": 'plain,"has, comma","says ""hi""","carriage\rreturn"',
      Items: "4",
    });
    expect(firstValue(run(tool, text, { output: "csvColumn" }))).toBe(
      'plain\n"has, comma"\n"says ""hi"""\n"carriage\rreturn"',
    );
  });
});

describe("slug", () => {
  const tool = TEXT_TOOLS.slug;

  it.each([
    ["Crème Brûlée: A Recipe for 2026!", "-", "creme-brulee-a-recipe-for-2026"],
    ["  --Hello,   World!!--  ", "-", "hello-world"],
    ["Hello World", "_", "hello_world"],
    ["Hello World", ".", "hello.world"],
    ["Straße Łódź Ærø", "-", "strasse-lodz-aero"],
    ["ﬁle №5 ＡＢＣ İstanbul", "-", "file-no5-abc-istanbul"],
  ])("slugifies %j with %j", (text, separator, slug) => {
    expect(fields(run(tool, text, { separator }))).toEqual({ Slug: slug });
  });

  it("warns when nothing fits in a slug", () => {
    expect(run(tool, "日本語!!!")).toEqual({
      kind: "ok",
      fields: [{ label: "Slug", value: "", monospace: true }],
      warnings: ["The text has no letters or digits that fit in a slug."],
    });
  });
});

describe("count", () => {
  const tool = TEXT_TOOLS.count;
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
  const counts = (text: string) => {
    const all = fields(run(tool, text));
    return [all.Characters, all["Code points"], all["UTF-16 code units"], all["UTF-8 bytes"]];
  };

  it.each([
    ["a family emoji", family, ["1", "7", "11", "25"]],
    ["a flag", "\u{1F1FA}\u{1F1F8}", ["1", "2", "4", "8"]],
    ["a combining accent", "é", ["1", "2", "2", "3"]],
    ["a lone surrogate", "\uD800", ["1", "1", "1", "3"]],
    ["ASCII", "abc", ["3", "3", "3", "3"]],
  ])(
    "tells characters, code points, UTF-16 units and bytes apart for %s",
    (_name, text, expected) => {
      expect(counts(text)).toEqual(expected);
    },
  );

  it("counts words, skipping punctuation and emoji", () => {
    expect(fields(run(tool, "Hello, world! 👋 It's 3pm.")).Words).toBe("4");
  });

  it.each([
    ["", "0"],
    ["a", "1"],
    ["a\n", "1"],
    ["a\nb", "2"],
    ["a\r\nb\r\n", "2"],
    ["\n\n", "2"],
  ])("counts lines in %j", (text, lines) => {
    expect(fields(run(tool, text)).Lines).toBe(lines);
  });

  it("falls back to code points and whitespace words without Intl.Segmenter", () => {
    vi.stubGlobal("Intl", {});
    const all = fields(run(tool, `${family} and  more\nwords`));
    expect(all.Characters).toBe(all["Code points"]);
    expect(all.Characters).toBe("23");
    expect(all.Words).toBe("4");
  });
});

describe("diff", () => {
  const tool = TEXT_TOOLS.diff;
  const diff = (original: string, changed: string, ignoreWhitespace = false) =>
    run(tool, original, { ignoreWhitespace }, changed);
  const summary = (original: string, changed: string, ignoreWhitespace = false) => {
    const all = fields(diff(original, changed, ignoreWhitespace));
    return [all.Result, all["Added lines"], all["Removed lines"]];
  };

  it("summarises the example", () => {
    const { text, second } = tool.example;
    expect(summary(text, second)).toEqual(["Different", "1", "3"]);
  });

  it.each([
    ["identical texts", "a\nb\n", "a\nb\n", ["Identical", "0", "0"]],
    ["a changed middle line", "a\nb\nc\n", "a\nB\nc\n", ["Different", "1", "1"]],
    ["lines added to an empty text", "", "a\nb\n", ["Different", "2", "0"]],
    ["a missing final line break", "a\nb", "a\nb\n", ["Different", "1", "1"]],
    ["CRLF against LF", "a\r\nb\r\n", "a\nb\n", ["Different", "2", "2"]],
    ["changed indentation", "  x\ny\n", "x\ny\n", ["Different", "1", "1"]],
  ])("compares %s exactly by default", (_name, original, changed, expected) => {
    expect(summary(original, changed)).toEqual(expected);
  });

  it.each([
    ["a missing final line break", "a\nb", "a\nb\n"],
    ["CRLF against LF", "a\r\nb\r\n", "a\nb\n"],
    ["changed indentation", "  x\ny  \n", "x\n\ty\n"],
  ])("ignores leading and trailing whitespace on request: %s", (_name, original, changed) => {
    expect(summary(original, changed, true)).toEqual(["Identical ignoring whitespace", "0", "0"]);
  });

  it("still sees whitespace inside a line when ignoring whitespace", () => {
    expect(summary("a b\n", "a  b\n", true)).toEqual(["Different", "1", "1"]);
  });

  it("finds the fewest added and removed lines", () => {
    const random = seededRandom(7);
    const lines = (count: number) =>
      Array.from(random(count), (byte) => `line ${byte % 4}\n`).join("");
    const longestCommon = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
      let previous = Array.from({ length: b.length + 1 }, () => 0);
      for (const lineA of a) {
        const current = [0];
        b.forEach((lineB, index) => {
          current.push(
            lineA === lineB
              ? (previous[index] ?? 0) + 1
              : Math.max(previous[index + 1] ?? 0, current[index] ?? 0),
          );
        });
        previous = current;
      }
      return previous[b.length] ?? 0;
    };
    for (let round = 0; round < 200; round++) {
      const [sizeA = 0, sizeB = 0] = random(2);
      const original = lines(sizeA % 12);
      const changed = lines(sizeB % 12);
      const a = original.split("\n").slice(0, -1);
      const b = changed.split("\n").slice(0, -1);
      const common = longestCommon(a, b);
      expect(summary(original, changed).slice(1)).toEqual([
        String(b.length - common),
        String(a.length - common),
      ]);
    }
  });

  it("stays exact on large texts with few edits", () => {
    const original = Array.from({ length: 50_000 }, (_, index) => `line ${index}\n`);
    const changed = [...original];
    changed[10] = "edited\n";
    changed.splice(40_000, 2);
    const result = diff(original.join(""), changed.join(""));
    expect(result).toMatchObject({ kind: "ok" });
    expect(result).not.toHaveProperty("warnings");
    expect(fields(result)).toMatchObject({ "Added lines": "1", "Removed lines": "3" });
  });

  it("counts long texts with no line in common exactly, an empty side included", () => {
    const old = Array.from({ length: 6_000 }, (_, index) => `old ${index}\n`).join("");
    const changed = Array.from({ length: 6_000 }, (_, index) => `new ${index}\n`).join("");
    for (const [original, updated, expected] of [
      [old, changed, ["Different", "6000", "6000"]],
      ["", changed, ["Different", "6000", "0"]],
      [old, "", ["Different", "0", "6000"]],
    ] as const) {
      expect(diff(original, updated)).not.toHaveProperty("warnings");
      expect(summary(original, updated)).toEqual(expected);
    }
  });

  it("gives minimums, never identical, when reordered texts are too far apart to count", () => {
    const lines = Array.from({ length: 6_000 }, (_, index) => `line ${index}\n`);
    const original = lines.join("");
    const reversed = lines.toReversed().join("");
    for (const ignoreWhitespace of [false, true]) {
      const result = diff(original, reversed, ignoreWhitespace);
      expect(result).toMatchObject({
        warnings: [
          "These texts differ too much to count exactly. At least this many lines were added and removed.",
        ],
      });
      const [outcome, added, removed] = summary(original, reversed, ignoreWhitespace);
      expect(outcome).toBe("Different");
      expect(added).toBe(removed);
      // Reversal keeps one line in common, so the true counts are 5999 each.
      expect(Number(added)).toBeGreaterThanOrEqual(1);
      expect(Number(added)).toBeLessThanOrEqual(5_999);
    }
  });
});
