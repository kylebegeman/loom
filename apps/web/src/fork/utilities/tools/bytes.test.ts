import { describe, expect, it } from "vite-plus/test";

import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8Bytes } from "./bytes";

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("base64", () => {
  it.each(["", "f", "fo", "foo", "foob", "fooba", "foobar"])("matches btoa for %j", (text) => {
    expect(bytesToBase64(utf8Bytes(text))).toBe(btoa(text));
    expect(base64ToBytes(btoa(text))).toEqual(utf8Bytes(text));
  });

  it("writes the URL-safe alphabet and drops padding on request", () => {
    expect(bytesToBase64(bytes(0xfb, 0xff), { urlSafe: true, padding: false })).toBe("-_8");
    expect(bytesToBase64(bytes(0xfb, 0xff))).toBe("+/8=");
  });

  it("reads either alphabet, whitespace and missing padding", () => {
    expect(base64ToBytes("-_8")).toEqual(bytes(0xfb, 0xff));
    expect(base64ToBytes("+/8=")).toEqual(bytes(0xfb, 0xff));
    expect(base64ToBytes("Zm9v\nYmFy")).toEqual(utf8Bytes("foobar"));
  });

  it("rejects stray characters and impossible lengths", () => {
    expect(base64ToBytes("Zm9v!")).toBeNull();
    expect(base64ToBytes("Zm9vY")).toBeNull();
    expect(base64ToBytes("Zm8")).toEqual(utf8Bytes("fo"));
    expect(base64ToBytes("Zm8==")).toBeNull();
  });
});

describe("hex", () => {
  it("round-trips and tolerates spaces between bytes", () => {
    expect(bytesToHex(bytes(0, 15, 255))).toBe("000fff");
    expect(hexToBytes("00 0f FF")).toEqual(bytes(0, 15, 255));
  });

  it("rejects odd lengths and non-hex", () => {
    expect(hexToBytes("abc")).toBeNull();
    expect(hexToBytes("zz")).toBeNull();
  });
});
