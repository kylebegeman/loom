import { LibraryError } from "@t3tools/contracts/fork";
import { LIBRARY_RECOVERY_MAX_BYTES } from "./assets/LibraryRecoveryStore.ts";

const TAR_BLOCK_BYTES = 512;
export const hasNonPortablePathCharacters = (value: string) =>
  /[\\:]/.test(value) ||
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

// Preflight the compressed bytes before letting tar create any paths. GNU long-name
// records are the only extensions emitted by our archive writer.
export const makeRecoveryTarReader = () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = new Map<string, { type: string; link: string }>();
  const portableNames = new Map<string, { type: string; link: string }>();
  const portableName = (name: string) => name.normalize("NFC").toLowerCase();
  const header = new Uint8Array(TAR_BLOCK_BYTES);
  let headerBytes = 0;
  let remaining = 0;
  let padding = 0;
  let metadata: Uint8Array | undefined;
  let metadataOffset = 0;
  let metadataKind = "";
  let longName: string | undefined;
  let longLink: string | undefined;
  let manifest: string | undefined;
  let zeroBlocks = 0;
  let totalBytes = 0;
  const invalid = () => new LibraryError({ reason: "archive-unverified" });
  const field = (start: number, length: number) => {
    const bytes = header.subarray(start, start + length);
    const end = bytes.indexOf(0);
    return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
  };
  const number = (start: number, length: number) => {
    const text = field(start, length).trim();
    if (!/^[0-7]+$/.test(text)) throw invalid();
    const value = Number.parseInt(text, 8);
    if (!Number.isSafeInteger(value) || value < 0) throw invalid();
    return value;
  };
  const safePath = (name: string) => {
    const clean = name.replace(/^(?:\.\/)+/, "").replace(/\/$/, "");
    if (
      !clean ||
      hasNonPortablePathCharacters(clean) ||
      clean.startsWith("/") ||
      clean
        .split("/")
        .some(
          (part) =>
            part === "" ||
            part === "." ||
            part === ".." ||
            /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part),
        )
    )
      throw invalid();
    return clean;
  };
  const finishBody = () => {
    if (metadata !== undefined) {
      const value = decoder.decode(metadata).replace(/\0+$/, "");
      if (metadataKind === "L") longName = value;
      else if (metadataKind === "K") longLink = value;
      else manifest = value;
      metadata = undefined;
    }
  };
  const write = (chunk: Uint8Array) => {
    totalBytes += chunk.length;
    if (totalBytes > 64 * LIBRARY_RECOVERY_MAX_BYTES) throw invalid();
    let offset = 0;
    while (offset < chunk.length) {
      if (remaining > 0) {
        const length = Math.min(remaining, chunk.length - offset);
        if (metadata !== undefined) {
          metadata.set(chunk.subarray(offset, offset + length), metadataOffset);
          metadataOffset += length;
        }
        remaining -= length;
        offset += length;
        if (remaining === 0) finishBody();
      } else if (padding > 0) {
        const length = Math.min(padding, chunk.length - offset);
        padding -= length;
        offset += length;
      } else {
        const length = Math.min(TAR_BLOCK_BYTES - headerBytes, chunk.length - offset);
        header.set(chunk.subarray(offset, offset + length), headerBytes);
        headerBytes += length;
        offset += length;
        if (headerBytes !== TAR_BLOCK_BYTES) continue;
        headerBytes = 0;
        if (header.every((byte) => byte === 0)) {
          zeroBlocks += 1;
          continue;
        }
        if (zeroBlocks > 0) throw invalid();
        const checksum = number(148, 8);
        let sum = 0;
        for (let index = 0; index < TAR_BLOCK_BYTES; index++)
          sum += index >= 148 && index < 156 ? 32 : header[index]!;
        if (sum !== checksum || !field(257, 6).startsWith("ustar")) throw invalid();
        const type = field(156, 1) || "0";
        const size = number(124, 12);
        remaining = size;
        padding = (TAR_BLOCK_BYTES - (size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
        metadataKind = type;
        if (type === "L" || type === "K") {
          if (size === 0 || size > 1024 * 1024) throw invalid();
          metadata = new Uint8Array(size);
          metadataOffset = 0;
          continue;
        }
        if (!["0", "1", "2", "5"].includes(type) || (type !== "0" && size !== 0)) throw invalid();
        const prefix = field(345, 155);
        const name = safePath(
          longName ??
            (prefix && field(257, 6) === "ustar" ? `${prefix}/${field(0, 100)}` : field(0, 100)),
        );
        const link = longLink ?? field(157, 100);
        longName = undefined;
        longLink = undefined;
        if (portableNames.has(portableName(name))) throw invalid();
        entries.set(name, { type, link });
        portableNames.set(portableName(name), { type, link });
        if (entries.size > 1_000_000) throw invalid();
        if (name === "loom-working-copy.json") {
          if (type !== "0" || size === 0 || size > 16 * 1024 * 1024) throw invalid();
          metadataKind = "manifest";
          metadata = new Uint8Array(size);
          metadataOffset = 0;
        }
        if (remaining === 0) finishBody();
      }
    }
  };
  const finish = () => {
    if (headerBytes || remaining || padding || zeroBlocks < 2 || longName || longLink || !manifest)
      throw invalid();
    const roots = [
      ...new Set(
        [...entries.keys()]
          .filter(
            (name) =>
              name !== "loom-working-copy.json" &&
              name !== "loom-portable-git" &&
              !name.startsWith("loom-portable-git/"),
          )
          .map((name) => name.split("/")[0]!),
      ),
    ];
    if (roots.length !== 1 || entries.get(roots[0]!)?.type !== "5") throw invalid();
    const root = roots[0]!;
    for (const [name, entry] of entries) {
      const parts = name.split("/");
      for (let length = 1; length < parts.length; length++) {
        const ancestor = portableNames.get(portableName(parts.slice(0, length).join("/")));
        if (ancestor !== undefined && ancestor.type !== "5") throw invalid();
      }
      if (parts.includes(".git") && entry.type === "2") throw invalid();
      if (entry.type === "1") {
        const target = safePath(entry.link);
        if (
          !(target.startsWith(`${root}/`) || target.startsWith("loom-portable-git/")) ||
          entries.get(target)?.type !== "0"
        )
          throw invalid();
      }
      if (entry.type === "2") {
        if (!entry.link || hasNonPortablePathCharacters(entry.link) || entry.link.startsWith("/"))
          throw invalid();
        const resolved = parts.slice(0, -1);
        for (const part of entry.link.split("/")) {
          if (part === "..") resolved.pop();
          else if (part && part !== ".") resolved.push(part);
          if (resolved[0] !== root) throw invalid();
          const intermediate = portableNames.get(portableName(resolved.join("/")));
          if (intermediate?.type === "1" || intermediate?.type === "2") throw invalid();
        }
        // Never follow a second link: chained links can escape despite a safe lexical target.
        for (let length = 1; length <= resolved.length; length++) {
          const target = portableNames.get(portableName(resolved.slice(0, length).join("/")));
          if (target?.type === "1" || target?.type === "2") throw invalid();
        }
      }
    }
    return { root, manifest, entries };
  };
  return { write, finish };
};
