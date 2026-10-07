// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";

const Claims = Schema.Struct({
  v: Schema.Literal(1),
  root: Schema.String,
  base: Schema.String,
  exp: Schema.Number,
  large: Schema.Boolean,
});
export type FileClaims = typeof Claims.Type;
const decodeClaims = Schema.decodeUnknownSync(Claims);
export const mintToken = (claims: Omit<FileClaims, "v">, key: Uint8Array) => {
  const payload = Buffer.from(JSON.stringify({ ...claims, v: 1 })).toString("base64url");
  return `${payload}.${NodeCrypto.createHmac("sha256", key).update(payload).digest("base64url")}`;
};
export function verifyToken(token: string, key: Uint8Array, now: number): FileClaims {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || token.length > 16384) throw new Error("Invalid token");
  const expected = NodeCrypto.createHmac("sha256", key).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !NodeCrypto.timingSafeEqual(actual, expected))
    throw new Error("Invalid token");
  const claims = decodeClaims(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (claims.exp <= now) throw new Error("Expired token");
  return claims;
}
export function isContained(base: string, target: string): boolean {
  const relative = NodePath.relative(base, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
}
export function resolveTokenPath(claims: FileClaims, requestPath: string): string {
  const decoded = decodeURIComponent(requestPath);
  if (
    !decoded ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    NodePath.isAbsolute(decoded) ||
    decoded.split("/").includes("..")
  )
    throw new Error("Invalid path");
  const target = NodePath.resolve(claims.base, decoded);
  if (!isContained(claims.root, target) || !isContained(claims.base, target))
    throw new Error("Invalid path");
  return target;
}
