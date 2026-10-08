import { describe, expect, it } from "vite-plus/test";
import { EMPTY_APPLE_LOG, appendAppleLog } from "./apple-build-tooling.ts";

const chunk = (text: string, done = false) => ({ offset: 0, text, done });

describe("appendAppleLog", () => {
  it("keeps the last lines across chunks and marks the view truncated", () => {
    let view = appendAppleLog(EMPTY_APPLE_LOG, chunk("one\ntwo\nthr"), 3);
    expect(view).toEqual({ text: "one\ntwo\nthr", truncated: false, done: false });
    view = appendAppleLog(view, chunk("ee\nfour\n", true), 3);
    expect(view).toEqual({ text: "two\nthree\nfour\n", truncated: true, done: true });
  });

  it("counts a partial last line as a line", () => {
    expect(appendAppleLog(EMPTY_APPLE_LOG, chunk("a\nb\nc\nd"), 2).text).toBe("c\nd");
  });
});
