import { describe, expect, it } from "@effect/vitest";
import { signB2ObjectUrl } from "./b2Signing.ts";
const config = {
  endpoint: "https://s3.us-west-004.backblazeb2.com",
  region: "us-west-004",
  bucket: "loom-assets-test",
  keyId: "test-key",
  applicationKey: "test-secret",
};
const input = {
  method: "GET" as const,
  objectKey: "assets/a b.png",
  now: "2026-10-15T12:00:00Z",
  expiresInSeconds: 300,
};
describe("private B2 object authorization", () => {
  it("signs the exact escaped object with an expiring request without disclosing the application key", () => {
    const signed = signB2ObjectUrl(config, input);
    const url = new URL(signed);
    expect(url.pathname).toBe("/loom-assets-test/assets/a%20b.png");
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261015T120000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(signed).not.toContain(config.applicationKey);
    expect(signB2ObjectUrl(config, { ...input, method: "PUT" })).not.toBe(signed);
    expect(signB2ObjectUrl(config, { ...input, objectKey: "assets/other.png" })).not.toBe(signed);
  });
  it("refuses credentials embedded in the endpoint, unsafe paths and unbounded grants", () => {
    expect(() =>
      signB2ObjectUrl({ ...config, endpoint: "http://storage.example" }, input),
    ).toThrow();
    expect(() =>
      signB2ObjectUrl({ ...config, endpoint: "https://key:secret@storage.example" }, input),
    ).toThrow();
    expect(() => signB2ObjectUrl(config, { ...input, objectKey: "assets/../private" })).toThrow();
    expect(() => signB2ObjectUrl(config, { ...input, expiresInSeconds: 3600 })).toThrow();
  });
});
