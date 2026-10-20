import { describe, expect, it } from "vite-plus/test";

import {
  compileRegex,
  matchAll,
  REGEX_MAX_MATCHES,
  REGEX_TOOLS,
  validateFlags,
} from "./regexMatch";
import { runInput } from "./testSupport";

const regex = REGEX_TOOLS.regex;
const run = (pattern: string, flags = "g", text = "") =>
  regex.run(runInput(regex, { text: pattern, second: text, options: { flags } }));

const matches = (pattern: string, flags: string, text: string, maxMatches = REGEX_MAX_MATCHES) => {
  const result = matchAll(pattern, flags, text, { maxMatches });
  if (result.kind !== "ok") throw new Error(`Expected matches, got: ${result.message}`);
  return result;
};

describe("validateFlags", () => {
  it.each(["", "g", "dgimsuy", "gimsvy", "yg"])("accepts %j", (flags) => {
    expect(validateFlags(flags)).toBeNull();
  });

  it("rejects an unknown flag", () => {
    expect(validateFlags("gx")).toBe('Unknown flag "x". Flags can be d, g, i, m, s, u, v and y.');
    expect(validateFlags("G")).toBe('Unknown flag "G". Flags can be d, g, i, m, s, u, v and y.');
  });

  it("rejects a repeated flag", () => {
    expect(validateFlags("gig")).toBe('The "g" flag is repeated.');
  });

  it("rejects u together with v", () => {
    expect(validateFlags("uv")).toBe("The u and v flags cannot be used together.");
  });
});

describe("compileRegex", () => {
  it("compiles a valid pattern", () => {
    const compiled = compileRegex("a+", "gi");
    expect("regex" in compiled && compiled.regex.flags).toBe("gi");
  });

  it("reports flag errors before compiling", () => {
    expect(compileRegex("a", "uv")).toEqual({
      error: "The u and v flags cannot be used together.",
    });
  });

  it("reports the reason for a syntax error without repeating the pattern", () => {
    expect(compileRegex("a: b(", "g")).toEqual({
      error: "Invalid regular expression: unterminated group.",
    });
    expect(compileRegex("a\n/(", "yig")).toEqual({
      error: "Invalid regular expression: unterminated group.",
    });
  });
});

describe("regex tool", () => {
  it("shows the compiled pattern as a literal", () => {
    expect(run("(\\w+)@(?<host>[\\w.]+)", "gi", "ada@example.com")).toEqual({
      kind: "ok",
      fields: [{ label: "Pattern", value: "/(\\w+)@(?<host>[\\w.]+)/gi", monospace: true }],
    });
  });

  it("escapes slashes so the literal stays valid", () => {
    expect(run("a/b")).toMatchObject({ fields: [{ value: "/a\\/b/g" }] });
  });

  it("reports syntax errors with the engine's reason", () => {
    expect(run("(abc")).toEqual({
      kind: "error",
      message: "Invalid regular expression: unterminated group.",
    });
    expect(run("[z-a]", "u")).toEqual({
      kind: "error",
      message: "Invalid regular expression: range out of order in character class.",
    });
  });

  it("reports flag errors", () => {
    expect(run("a", "gg")).toEqual({ kind: "error", message: 'The "g" flag is repeated.' });
  });

  it("leaves patterns over 1,000 characters for the worker to compile", () => {
    // Compiling a long class of Unicode properties can block for seconds, so only the
    // worker, under its time limit, sees such a pattern's syntax error.
    expect(run(`(${"a".repeat(999)}`)).toMatchObject({ kind: "error" });
    const long = `(${"a".repeat(1000)}`;
    expect(run(long, "yg")).toEqual({
      kind: "ok",
      fields: [{ label: "Pattern", value: `/${long}/gy`, monospace: true }],
    });
    expect(matchAll(long, "gy", "a", { maxMatches: 10 })).toEqual({
      kind: "error",
      message: "Invalid regular expression: unterminated group.",
    });
    expect(run(long, "gg")).toEqual({ kind: "error", message: 'The "g" flag is repeated.' });
  });

  it("compiles its example", () => {
    const example = regex.example;
    const result = regex.run(
      runInput(regex, {
        text: example.text,
        second: example.second,
        options: example.options,
      }),
    );
    expect(result.kind).toBe("ok");
    expect(
      matches(example.text, String(example.options.flags), example.second).matches,
    ).toHaveLength(3);
  });

  it("never throws", () => {
    for (const pattern of ["(", ")", "[", "\\", "a{2,1}", "(?<a>x)(?<a>y)", "\\p{Nope}", "*"]) {
      for (const flags of ["", "u", "v", "x", "gg"]) {
        expect(() => run(pattern, flags)).not.toThrow();
      }
    }
  });
});

describe("matchAll", () => {
  it("returns every match with its index and end", () => {
    expect(matches("\\d+", "g", "a1 b22 c333").matches).toEqual([
      { index: 1, end: 2, value: "1", groups: [], named: {} },
      { index: 4, end: 6, value: "22", groups: [], named: {} },
      { index: 8, end: 11, value: "333", groups: [], named: {} },
    ]);
  });

  it("returns numbered and named groups, unmatched optional groups as undefined", () => {
    const result = matches("(?<user>\\w+)(@)?(?<host>\\w+)?", "g", "ada@home bob");
    expect(result.matches).toEqual([
      {
        index: 0,
        end: 8,
        value: "ada@home",
        groups: ["ada", "@", "home"],
        named: { user: "ada", host: "home" },
      },
      {
        index: 9,
        end: 12,
        value: "bob",
        groups: ["bob", undefined, undefined],
        named: { user: "bob", host: undefined },
      },
    ]);
    const second = result.matches[1];
    expect(second && "host" in second.named).toBe(true);
  });

  it("returns group indices only with the d flag", () => {
    expect(matches("(a)(x)?(b)", "g", "zab").matches[0]).not.toHaveProperty("indices");
    expect(matches("(a)(x)?(b)", "dg", "zab").matches[0]).toEqual({
      index: 1,
      end: 3,
      value: "ab",
      groups: ["a", undefined, "b"],
      named: {},
      indices: [[1, 2], undefined, [2, 3]],
    });
  });

  it("returns only the first match without the g flag", () => {
    const result = matches("\\d", "", "1 2 3");
    expect(result).toEqual({
      kind: "ok",
      matches: [{ index: 0, end: 1, value: "1", groups: [], named: {} }],
      truncated: false,
    });
  });

  it("honors the sticky flag", () => {
    expect(matches("a", "gy", "aab").matches.map((match) => match.index)).toEqual([0, 1]);
    expect(matches("b", "y", "ab").matches).toEqual([]);
  });

  it("advances past zero-length matches", () => {
    const result = matches("a*", "g", "bbb");
    expect(result.matches.map((match) => [match.index, match.value])).toEqual([
      [0, ""],
      [1, ""],
      [2, ""],
      [3, ""],
    ]);
  });

  it("advances over whole code points with the u or v flag", () => {
    for (const flags of ["gu", "gv"]) {
      expect(matches("", flags, "a😀b").matches.map((match) => match.index)).toEqual([0, 1, 3, 4]);
    }
    expect(matches("", "g", "a😀b").matches.map((match) => match.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("matches an emoji as one character with the u flag", () => {
    expect(matches(".", "gu", "😀!").matches.map((match) => match.value)).toEqual(["😀", "!"]);
    expect(matches("^.$", "u", "😀").matches).toEqual([
      { index: 0, end: 2, value: "😀", groups: [], named: {} },
    ]);
    expect(matches("^.$", "", "😀").matches).toEqual([]);
  });

  it("caps matches at the limit and says there were more", () => {
    const capped = matches("a", "g", "a".repeat(REGEX_MAX_MATCHES + 1));
    expect(capped.matches).toHaveLength(REGEX_MAX_MATCHES);
    expect(capped.truncated).toBe(true);
    expect(capped.matches.at(-1)?.index).toBe(REGEX_MAX_MATCHES - 1);

    const exact = matches("a", "g", "a".repeat(REGEX_MAX_MATCHES));
    expect(exact.matches).toHaveLength(REGEX_MAX_MATCHES);
    expect(exact.truncated).toBe(false);

    expect(matches("a", "g", "aaa", 2)).toMatchObject({ truncated: true });
  });

  it("returns no matches for text that does not match", () => {
    expect(matchAll("x", "g", "abc", { maxMatches: 10 })).toEqual({
      kind: "ok",
      matches: [],
      truncated: false,
    });
  });

  it("reports an engine failure while matching without repeating the pattern", () => {
    // V8 compiles on first use and rejects this there, in a message naming the whole pattern.
    const result = matchAll("(?:a?)*".repeat(40_000), "", "b", { maxMatches: 10 });
    expect(result).toMatchObject({
      kind: "error",
      message: expect.stringMatching(
        /^Matching failed: (regular expression too large|stack overflow)\.$/,
      ),
    });
  });

  it("refuses groups nested deeper than the engine compiles safely", () => {
    const nested = (depth: number) => `${"(?=".repeat(depth)}a${")".repeat(depth)}`;
    expect(matches(nested(500), "", "a").matches).toHaveLength(1);
    expect(matchAll(nested(501), "", "a", { maxMatches: 10 })).toEqual({
      kind: "error",
      message: "Groups nested more than 500 levels deep are not supported.",
    });
    // Escaped parentheses and parentheses in a class are characters, not groups.
    const literal = `${"\\(".repeat(600)}${"[(]".repeat(600)}`;
    expect(matches(literal, "", "(".repeat(1200)).matches).toHaveLength(1);
  });

  it("returns compile errors as error results", () => {
    expect(matchAll("(", "g", "abc", { maxMatches: 10 })).toEqual({
      kind: "error",
      message: "Invalid regular expression: unterminated group.",
    });
    expect(matchAll("a", "q", "abc", { maxMatches: 10 })).toEqual({
      kind: "error",
      message: 'Unknown flag "q". Flags can be d, g, i, m, s, u, v and y.',
    });
  });
});
