// @effect-diagnostics nodeBuiltinImport:off -- Hashing is a server adapter boundary.
import * as NodeCrypto from "node:crypto";

export const MAX_SVG_BYTES = 4 * 1024 * 1024;
export const CHECK_LIMITS = { maxCount: 100, maxBytes: 20 * 1024 * 1024 };
export const CACHE_LIMITS = { maxCount: 100, maxBytes: 200 * 1024 * 1024 };
export const hashKey = (...parts: ReadonlyArray<string>) =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const renderKey = (
  workspace: string,
  designId: string,
  sourceHash: string,
  kind: string,
  view: string,
  preset: string,
  toolVersion: string,
) => hashKey(workspace, designId, sourceHash, kind, view, preset, toolVersion);
export const isRenderKey = (value: string) => /^[a-f0-9]{64}$/.test(value);
/** Unicode sheet titles are valid; separators, control characters and traversal are not. */
export const isSheetFileName = (value: string) =>
  value.length <= 240 &&
  /^[^/\\]+\.svg$/i.test(value) &&
  !Array.from(value).some((char) => char.charCodeAt(0) < 32) &&
  value !== "..svg" &&
  !value.startsWith(".");
export function pickPruneVictims(
  entries: ReadonlyArray<{ key: string; bytes: number; modified: number; protected?: boolean }>,
  limits = CACHE_LIMITS,
) {
  let count = entries.length,
    bytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  const victims: string[] = [];
  for (const e of entries.toSorted(
    (a, b) => a.modified - b.modified || a.key.localeCompare(b.key),
  )) {
    if (count <= limits.maxCount && bytes <= limits.maxBytes) break;
    if (e.protected) continue;
    victims.push(e.key);
    count--;
    bytes -= e.bytes;
  }
  return victims;
}
