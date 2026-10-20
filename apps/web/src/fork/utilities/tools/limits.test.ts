import { describe, expect, it } from "vite-plus/test";

import { ok } from "../types";
import {
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  OUTPUT_TRUNCATED_WARNING,
  TRUNCATION_MARKER,
  checkInputSize,
  limitResult,
  truncateOutput,
  utf8ByteLength,
} from "./limits";

const encoder = new TextEncoder();

describe("utf8ByteLength", () => {
  it.each(["", "abc", "é", "日本語", "😀 emoji", "\ud800 lone surrogate"])(
    "matches TextEncoder for %j",
    (text) => {
      expect(utf8ByteLength(text)).toBe(encoder.encode(text).length);
    },
  );
});

describe("checkInputSize", () => {
  it("accepts exactly 1 MiB of UTF-8", () => {
    expect(checkInputSize("a".repeat(MAX_INPUT_BYTES))).toBeNull();
    // 3-byte characters: 349525 * 3 = 1048575 bytes, plus one ASCII byte.
    expect(checkInputSize("日".repeat(349_525) + "a")).toBeNull();
  });

  it("refuses one byte over, counted in UTF-8 rather than UTF-16 units", () => {
    expect(checkInputSize("a".repeat(MAX_INPUT_BYTES + 1))).toEqual({
      kind: "error",
      message: "Input is larger than 1 MiB.",
    });
    expect(checkInputSize("日".repeat(349_526))).not.toBeNull();
  });

  it("counts several inputs together", () => {
    const half = "a".repeat(MAX_INPUT_BYTES / 2);
    expect(checkInputSize(half, half)).toBeNull();
    expect(checkInputSize(half, `${half}a`)).not.toBeNull();
  });
});

describe("truncateOutput", () => {
  it("leaves values at the limit alone", () => {
    const value = "a".repeat(MAX_OUTPUT_BYTES);
    expect(truncateOutput(value)).toEqual({ value, truncated: false });
  });

  it("caps at 2 MiB including the marker", () => {
    const capped = truncateOutput("a".repeat(MAX_OUTPUT_BYTES + 10));
    expect(capped.truncated).toBe(true);
    expect(capped.value.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(encoder.encode(capped.value).length).toBe(MAX_OUTPUT_BYTES);
  });

  it("never splits a code point", () => {
    const capped = truncateOutput("😀".repeat(MAX_OUTPUT_BYTES / 4 + 1));
    const body = capped.value.slice(0, -TRUNCATION_MARKER.length);
    expect(body).toBe("😀".repeat(body.length / 2));
    expect(encoder.encode(capped.value).length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(encoder.encode(capped.value))).toBe(
      capped.value,
    );
  });
});

describe("limitResult", () => {
  it("adds one warning when any field is truncated", () => {
    const big = "a".repeat(MAX_OUTPUT_BYTES + 1);
    const result = limitResult(
      ok(
        [
          { label: "A", value: big },
          { label: "B", value: big },
        ],
        ["w"],
      ),
    );
    expect(result.kind === "ok" && result.warnings).toEqual(["w", OUTPUT_TRUNCATED_WARNING]);
  });

  it("returns small results unchanged", () => {
    const result = ok([{ label: "A", value: "x" }]);
    expect(limitResult(result)).toBe(result);
  });
});
