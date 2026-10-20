import { describe, expect, it } from "vite-plus/test";

import type { UtilityOptionValues, UtilityResult, UtilityToolImpl } from "../types";
import { ENCODE_TOOLS } from "./encode";
import { limitResult, MAX_OUTPUT_BYTES, OUTPUT_TRUNCATED_WARNING } from "./limits";
import { FIXED_NOW, runInput } from "./testSupport";

type Overrides = NonNullable<Parameters<typeof runInput>[1]>;

function run(tool: UtilityToolImpl, text: string, overrides: Overrides = {}): UtilityResult {
  if (!tool.run) throw new Error("The tool has no run function.");
  return tool.run(runInput(tool, { ...overrides, text }));
}

function fields(result: UtilityResult): Record<string, string> {
  if (result.kind === "error") throw new Error(`Expected a result, got: ${result.message}`);
  return Object.fromEntries(result.fields.map((field) => [field.label, field.value]));
}

function firstValue(result: UtilityResult): string {
  if (result.kind === "error") throw new Error(`Expected a result, got: ${result.message}`);
  const first = result.fields[0];
  if (!first) throw new Error("Expected at least one field.");
  return first.value;
}

const warningsOf = (result: UtilityResult) => (result.kind === "ok" ? (result.warnings ?? []) : []);

/** Forward, then Swap: the first output becomes the input and the options flip. */
function roundTrip(tool: UtilityToolImpl, text: string, options: UtilityOptionValues = {}) {
  if (!tool.swap) throw new Error("The tool has no swap.");
  const merged = { ...runInput(tool).options, ...options };
  const forward = firstValue(run(tool, text, { options: merged }));
  return firstValue(run(tool, forward, { options: tool.swap(merged) }));
}

const DECODE = { direction: "decode" };

const TWO_WAY = ["base64", "url", "html", "json-string", "basic-auth"] as const;

const ALL_TOOLS: ReadonlyArray<[string, UtilityToolImpl]> = Object.entries(ENCODE_TOOLS);

describe("every encode tool", () => {
  it.each(ALL_TOOLS)("%s runs its example to a result", (_id, tool) => {
    const example = tool.example;
    if (!example) throw new Error("Every encode tool has an example.");
    const overrides = example.options ? { options: example.options } : {};
    expect(run(tool, example.text, overrides).kind).toBe("ok");
  });

  it.each(TWO_WAY)("%s gives back its example after Swap", (id) => {
    const tool = ENCODE_TOOLS[id];
    expect(roundTrip(tool, tool.example.text)).toBe(tool.example.text);
  });

  it("swap flips the direction both ways", () => {
    const swap = ENCODE_TOOLS.base64.swap;
    expect(swap({ direction: "encode", urlSafe: true })).toEqual({
      direction: "decode",
      urlSafe: true,
    });
    expect(swap({ direction: "decode" })).toEqual({ direction: "encode" });
  });

  const awkward = ["", "%", "%zz", "\uD800", "&#;", "\\", '"', "a.b.c", "Basic ", "=", "€"];
  it.each(ALL_TOOLS)("%s never throws on awkward input", (_id, tool) => {
    for (const text of awkward) {
      for (const direction of ["encode", "decode"]) {
        expect(() => run(tool, text, { options: { direction } })).not.toThrow();
      }
    }
  });
});

describe("base64", () => {
  const tool = ENCODE_TOOLS.base64;

  it("encodes through UTF-8", () => {
    expect(firstValue(run(tool, "Hello, world! \u{1F44B}"))).toBe("SGVsbG8sIHdvcmxkISDwn5GL");
    expect(firstValue(run(tool, "日本語"))).toBe("5pel5pys6Kqe");
  });

  it.each(["plain ASCII", "emoji \u{1F600}\u{1F44B}\u{1F3FD}", "中文測試", "\u{FEFF}bom"])(
    "round-trips %j",
    (text) => {
      expect(roundTrip(tool, text)).toBe(text);
      expect(roundTrip(tool, text, { urlSafe: true, padding: false })).toBe(text);
    },
  );

  it("writes the URL-safe alphabet without padding on request", () => {
    expect(firstValue(run(tool, "<<???>>"))).toBe("PDw/Pz8+Pg==");
    expect(firstValue(run(tool, "<<???>>", { options: { urlSafe: true, padding: false } }))).toBe(
      "PDw_Pz8-Pg",
    );
  });

  it("decodes either alphabet, whitespace and missing padding", () => {
    expect(fields(run(tool, "PDw_Pz8-Pg", { options: DECODE }))).toEqual({ Text: "<<???>>" });
    expect(fields(run(tool, "PDw/Pz8+Pg==", { options: DECODE }))).toEqual({ Text: "<<???>>" });
    expect(fields(run(tool, "  SGVs\nbG8 ", { options: DECODE }))).toEqual({ Text: "Hello" });
  });

  it("points at the first bad character in the original text", () => {
    expect(run(tool, "SGVs bG8!", { options: DECODE })).toEqual({
      kind: "error",
      message: "Not valid base64: unexpected character at position 9.",
    });
    expect(run(tool, "ab\u{1F600}cd", { options: DECODE })).toEqual({
      kind: "error",
      message: "Not valid base64: unexpected character at position 3.",
    });
    expect(run(tool, "Zm8=Zm8=", { options: DECODE })).toEqual({
      kind: "error",
      message: "Not valid base64: unexpected character at position 5.",
    });
  });

  it.each(["SGVsb", "SGVsbG8==", "Zg==="])("rejects the padding or length of %j", (text) => {
    expect(run(tool, text, { options: DECODE })).toEqual({
      kind: "error",
      message: "Not valid base64: invalid padding or length.",
    });
  });

  it("falls back to hex for bytes that are not UTF-8", () => {
    const result = run(tool, "//7/", { options: DECODE });
    expect(fields(result)).toEqual({ Hex: "fffeff" });
    expect(warningsOf(result)).toEqual(["The bytes are not UTF-8 text; showing hex."]);
  });

  it("warns that a lone surrogate is written as U+FFFD", () => {
    const result = run(tool, "a\uD800");
    expect(firstValue(result)).toBe("Ye+/vQ==");
    expect(warningsOf(result)).toHaveLength(1);
  });
});

describe("url", () => {
  const tool = ENCODE_TOOLS.url;
  const full = { mode: "full" };

  it("encodes a component or a whole URL", () => {
    expect(firstValue(run(tool, "a b&c=d/é"))).toBe("a%20b%26c%3Dd%2F%C3%A9");
    expect(firstValue(run(tool, "https://example.com/a b?q=é&x=1", { options: full }))).toBe(
      "https://example.com/a%20b?q=%C3%A9&x=1",
    );
  });

  it("leaves reserved escapes alone when decoding a whole URL", () => {
    expect(firstValue(run(tool, "a%2Fb%20c", { options: DECODE }))).toBe("a/b c");
    expect(firstValue(run(tool, "a%2Fb%20c", { options: { ...DECODE, ...full } }))).toBe("a%2Fb c");
  });

  it.each([
    ["café & crème/brûlée?", {}],
    ["https://example.com/path with spaces?q=\u{1F600}&r=50%", full],
  ])("round-trips %j", (text, options) => {
    expect(roundTrip(tool, text, options)).toBe(text);
  });

  it("explains a malformed percent-escape", () => {
    expect(run(tool, "100%", { options: DECODE })).toEqual({
      kind: "error",
      message: "The % at position 4 is not followed by two hex digits.",
    });
    expect(run(tool, "\u{1F600}%zz", { options: DECODE })).toEqual({
      kind: "error",
      message: "The % at position 2 is not followed by two hex digits.",
    });
  });

  it("explains escapes that are not UTF-8", () => {
    expect(run(tool, "ok%C3%A9 then %E9", { options: DECODE })).toEqual({
      kind: "error",
      message: "The percent-escapes at position 15 are not valid UTF-8.",
    });
  });

  it("points at the first bad escape, inside a run or before a stray %", () => {
    expect(run(tool, "%E9 then 100%", { options: DECODE })).toEqual({
      kind: "error",
      message: "The percent-escapes at position 1 are not valid UTF-8.",
    });
    expect(run(tool, "%E6%97%A5%E6%9C", { options: DECODE })).toEqual({
      kind: "error",
      message: "The percent-escapes at position 10 are not valid UTF-8.",
    });
  });

  it("refuses a lone surrogate instead of throwing", () => {
    expect(run(tool, "ab\uD800")).toEqual({
      kind: "error",
      message: "The text has a broken Unicode character (a lone surrogate) at position 3.",
    });
  });
});

describe("html", () => {
  const tool = ENCODE_TOOLS.html;

  it("escapes all five characters", () => {
    expect(firstValue(run(tool, `<a href="x">Tom's & Jerry</a>`))).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; Jerry&lt;/a&gt;",
    );
  });

  it("decodes named, decimal and hex entities", () => {
    expect(
      firstValue(
        run(tool, "&copy; &#169; &#xA9; &#X1F600; &hellip;&nbsp;&mdash;&apos;", {
          options: DECODE,
        }),
      ),
    ).toBe("© © © \u{1F600} …\u{A0}\u{2014}'");
  });

  it("decodes in one pass", () => {
    expect(firstValue(run(tool, "&amp;lt;", { options: DECODE }))).toBe("&lt;");
  });

  it("keeps unknown, out-of-range and surrogate entities as written", () => {
    const text = "&bogus; &constructor; &#x110000; &#xD800; &#99999999999999999999; &amp";
    expect(firstValue(run(tool, text, { options: DECODE }))).toBe(text);
  });

  it("round-trips markup", () => {
    const text = `<p class="note">Fish & chips, 5 > 3, it's "done"</p>`;
    expect(roundTrip(tool, text)).toBe(text);
  });
});

describe("json-string", () => {
  const tool = ENCODE_TOOLS["json-string"];
  const tricky = `say "hi"\n\tC:\\path\\file \u{1F600} é\r\n\u0007`;

  it("escapes to a quoted JSON literal", () => {
    expect(firstValue(run(tool, tricky))).toBe(JSON.stringify(tricky));
    expect(firstValue(run(tool, 'a"b'))).toBe('"a\\"b"');
  });

  it("round-trips quotes, backslashes, newlines, tabs and emoji", () => {
    expect(roundTrip(tool, tricky)).toBe(tricky);
    expect(roundTrip(tool, "")).toBe("");
    expect(roundTrip(tool, "\\")).toBe("\\");
  });

  it("unescapes with or without the surrounding quotes", () => {
    expect(firstValue(run(tool, "line\\nnext\\u00e9", { options: DECODE }))).toBe("line\nnexté");
    expect(firstValue(run(tool, '  "a\\tb"  ', { options: DECODE }))).toBe("a\tb");
    expect(firstValue(run(tool, "\\ud83d\\ude00\\/", { options: DECODE }))).toBe("\u{1F600}/");
    expect(firstValue(run(tool, "  keep spaces  ", { options: DECODE }))).toBe("  keep spaces  ");
  });

  it.each([
    ["bad \\q here", "Invalid escape \\q at position 5."],
    ["x\\u12G4", "Invalid escape at position 2: \\u needs four hex digits."],
    ['"\\u12"', "Invalid escape at position 2: \\u needs four hex digits."],
    ['say "hi"', "Unescaped double quote at position 5."],
    ['"a"b"', "Unescaped double quote at position 3."],
    ["one\ntwo", "Unescaped control character at position 4. Use an escape such as \\n or \\t."],
    ['"abc', "The closing quote is missing."],
    ['"abc\\"', "The closing quote is missing."],
    ["abc\\", "The text ends in the middle of an escape."],
  ])("explains %j", (text, message) => {
    expect(run(tool, text, { options: DECODE })).toEqual({ kind: "error", message });
  });
});

describe("basic-auth", () => {
  const tool = ENCODE_TOOLS["basic-auth"];

  it("builds the header from user:password", () => {
    expect(fields(run(tool, "aladdin:open sesame"))).toEqual({
      "Header value": "Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ==",
      Header: "Authorization: Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ==",
    });
  });

  it("asks for user:password when there is no colon", () => {
    expect(run(tool, "aladdin")).toEqual({
      kind: "error",
      message: "Use user:password, with a colon between the user name and the password.",
    });
  });

  it.each([
    "Authorization: Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ==",
    "authorization:basic   YWxhZGRpbjpvcGVuIHNlc2FtZQ",
    "Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ==",
    "  YWxhZGRpbjpvcGVuIHNlc2FtZQ==\n",
  ])("decodes %j", (text) => {
    expect(fields(run(tool, text, { options: DECODE }))).toEqual({
      Credentials: "aladdin:open sesame",
      User: "aladdin",
      Password: "open sesame",
    });
  });

  it("splits at the first colon so the password keeps its colons", () => {
    const header = firstValue(run(tool, "user:pa:ss:"));
    expect(fields(run(tool, header, { options: DECODE }))).toMatchObject({
      User: "user",
      Password: "pa:ss:",
    });
    expect(roundTrip(tool, "jürgen:päss \u{1F511}")).toBe("jürgen:päss \u{1F511}");
  });

  it("reports base64 problems at their position in the pasted header", () => {
    expect(run(tool, "Basic YWx!", { options: DECODE })).toEqual({
      kind: "error",
      message: "Not valid base64: unexpected character at position 10.",
    });
  });

  it("explains a decoded value without a colon and an empty header", () => {
    expect(run(tool, "Basic YWxhZGRpbg==", { options: DECODE })).toEqual({
      kind: "error",
      message: "The decoded value has no colon, so it is not user:password.",
    });
    expect(run(tool, "Basic ", { options: DECODE })).toEqual({
      kind: "error",
      message: "Paste a Basic auth header or its base64 value.",
    });
  });
});

describe("jwt", () => {
  const tool = ENCODE_TOOLS.jwt;
  const UNVERIFIED = "The signature is not verified.";
  // iat 1699996400 and exp 1699998200, both before FIXED_NOW.
  const expired =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwiaWF0IjoxNjk5OTk2NDAwLCJleHAiOjE2OTk5OTgyMDB9.Vu-q4cf8P6YsiJrKA3FEhF0HOmYB4lNU9iiJY6cvBt4";
  // nbf 1700003600, an hour after FIXED_NOW.
  const early =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmJmIjoxNzAwMDAzNjAwfQ.FUNDS3FHrQA2hkNcLKJx32LWivLkagUV_lOYgC3F6tk";
  const part = (value: string) =>
    btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

  it("decodes the header and payload as formatted JSON", () => {
    const result = fields(run(tool, expired));
    expect(result.Header).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    expect(JSON.parse(result.Payload ?? "")).toEqual({
      sub: "user-42",
      iat: 1699996400,
      exp: 1699998200,
    });
    expect(result.Payload).toContain('\n  "sub": "user-42",');
  });

  it("shows claim times in UTC and the given zone, and flags expiry", () => {
    const result = run(tool, `Bearer ${expired}`, { timeZone: "America/New_York" });
    expect(fields(result)).toMatchObject({
      "Issued at": "2023-11-14T21:13:20.000Z (2023-11-14 16:13:20 EST)",
      Expires: "2023-11-14T21:43:20.000Z (2023-11-14 16:43:20 EST), expired",
    });
    expect(warningsOf(result)).toEqual([UNVERIFIED, "The token has expired."]);
  });

  it("treats the exact expiry instant as expired", () => {
    const result = run(tool, expired, { now: 1699998200 * 1000 });
    expect(fields(result).Expires).toMatch(/, expired$/);
    expect(run(tool, expired, { now: 1699998199 * 1000 })).toMatchObject({
      warnings: [UNVERIFIED],
    });
  });

  it("flags a token that is not valid yet", () => {
    const result = run(tool, early);
    expect(fields(result)["Not before"]).toBe(
      "2023-11-14T23:13:20.000Z (2023-11-14 23:13:20 UTC), not yet valid",
    );
    expect(warningsOf(result)).toEqual([UNVERIFIED, "The token is not valid yet."]);
    expect(warningsOf(run(tool, early, { now: FIXED_NOW + 3_600_000 }))).toEqual([UNVERIFIED]);
  });

  it("always says the signature is not verified", () => {
    const token = `${part('{"alg":"none"}')}.${part('{"sub":"x"}')}.`;
    expect(run(tool, token)).toEqual({
      kind: "ok",
      fields: [
        { label: "Header", value: '{\n  "alg": "none"\n}', monospace: true },
        { label: "Payload", value: '{\n  "sub": "x"\n}', monospace: true },
      ],
      warnings: [UNVERIFIED],
    });
  });

  it("warns about a time claim that is not a number of seconds", () => {
    const token = `${part('{"alg":"none"}')}.${part('{"exp":"tomorrow","iat":1e300}')}.`;
    expect(warningsOf(run(tool, token))).toEqual([
      UNVERIFIED,
      "The iat claim is not a time in seconds.",
      "The exp claim is not a time in seconds.",
    ]);
  });

  it.each([
    ["header.payload", 2],
    ["a.b.c.d.e", 5],
    ["", 1],
  ])("counts the parts of %j", (text, count) => {
    expect(run(tool, text)).toEqual({
      kind: "error",
      message: `A JWT has three parts separated by dots; this has ${count}.`,
    });
  });

  it.each([
    [`${part('{"alg":"none"}')}.!!!.sig`, "The JWT payload is not valid base64url."],
    [`${part("{not json")}.${part("{}")}.sig`, "The JWT header is not valid JSON."],
    [`${part('{"alg":"none"}')}.${part("[1,2]")}.sig`, "The JWT payload is not a JSON object."],
    [`.${part("{}")}.sig`, "The JWT header is empty."],
  ])("explains a malformed part in %j", (text, message) => {
    expect(run(tool, text)).toEqual({ kind: "error", message });
  });

  it("ignores line breaks inside a pasted token", () => {
    const wrapped = `${expired.slice(0, 40)}\n${expired.slice(40)}`;
    expect(run(tool, wrapped).kind).toBe("ok");
  });

  it("rejects the standard base64 alphabet whichever decoder jose picks", () => {
    const token = `${part('{"alg":"none"}')}.${btoa('{"a":"???"}').replace(/=+$/, "")}.`;
    expect(token).toContain("/");
    expect(run(tool, token)).toEqual({
      kind: "error",
      message: "The JWT payload is not valid base64url.",
    });
  });

  it("shows the payload as written, with big integers, exponents and repeated keys", () => {
    const payload = '{"uid":12345678901234567890,"big":1e400,"k":"a","k":"b"}';
    expect(fields(run(tool, `${part('{"alg":"none"}')}.${part(payload)}.`)).Payload).toBe(
      '{\n  "uid": 12345678901234567890,\n  "big": 1e400,\n  "k": "a",\n  "k": "b"\n}',
    );
  });

  it("indents nested JSON by two spaces, keeping strings and empty containers whole", () => {
    const payload = '{ "a" : [1, {"b":"x\\"y,z:{[ ]}"}], "c" : { }, "d":[ ], "e":null }';
    expect(fields(run(tool, `${part('{"alg":"none"}')}.${part(payload)}.`)).Payload).toBe(
      '{\n  "a": [\n    1,\n    {\n      "b": "x\\"y,z:{[ ]}"\n    }\n  ],\n  "c": {},\n  "d": [],\n  "e": null\n}',
    );
  });

  it("decodes a deeply nested payload without overflowing the stack or the output cap", () => {
    const depth = 20_000;
    const payload = `{"a":${"[".repeat(depth)}${"]".repeat(depth)}}`;
    const result = limitResult(run(tool, `${part('{"alg":"none"}')}.${part(payload)}.`));
    expect(fields(result).Payload?.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(warningsOf(result)).toEqual([UNVERIFIED, OUTPUT_TRUNCATED_WARNING]);
  });
});
