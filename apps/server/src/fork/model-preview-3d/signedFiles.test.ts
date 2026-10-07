import { describe, expect, it } from "@effect/vitest";
import { mintToken, verifyToken, resolveTokenPath } from "./signedFiles.ts";
const key = new Uint8Array(32).fill(7);
const claims = { root: "/workspace", base: "/workspace/models", exp: 2000, large: false };
describe("signed model files", () => {
  it("round trips and rejects expired or tampered credentials", () => {
    const token = mintToken(claims, key);
    expect(verifyToken(token, key, 1000)).toMatchObject(claims);
    expect(() => verifyToken(token, key, 2000)).toThrow();
    expect(() => verifyToken(token + "x", key, 1000)).toThrow();
    expect(() => verifyToken(token, new Uint8Array(32), 1000)).toThrow();
  });
  it.each(["../secret", "%2e%2e/secret", "/etc/passwd", "a/../../secret", "a\\secret", "%00"])(
    "rejects traversal %s",
    (path) => {
      expect(() => resolveTokenPath({ ...claims, v: 1 }, path)).toThrow();
    },
  );
  it("permits resources below a model's directory", () => {
    expect(resolveTokenPath({ ...claims, v: 1 }, "textures/red.png")).toBe(
      "/workspace/models/textures/red.png",
    );
  });
});
