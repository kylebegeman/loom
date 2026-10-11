// @effect-diagnostics nodeBuiltinImport:off -- ZIP encoding is a bounded server file adapter.
import * as NodeZlib from "node:zlib";
export function archiveName(name: string) {
  return (
    name.length > 0 &&
    name.length <= 300 &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.includes(":") &&
    !name.split("/").some((s) => s === ".." || s === "" || s === ".") &&
    !Array.from(name).some((char) => char.charCodeAt(0) < 32)
  );
}
/** Small deterministic ZIPs; bounds exclude ZIP64 and keep compression work finite. */
export function writeZip(
  entries: readonly { name: string; bytes: Uint8Array }[],
  mtime: Date,
): Uint8Array {
  if (entries.length > 1000 || entries.reduce((n, e) => n + e.bytes.length, 0) > 128 * 1024 * 1024)
    throw new Error("Archive exceeds limits");
  const names = new Set<string>(),
    local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  const year = Math.max(1980, Math.min(2107, mtime.getUTCFullYear()));
  const date = ((year - 1980) << 9) | ((mtime.getUTCMonth() + 1) << 5) | mtime.getUTCDate();
  const time =
    (mtime.getUTCHours() << 11) |
    (mtime.getUTCMinutes() << 5) |
    Math.floor(mtime.getUTCSeconds() / 2);
  for (const entry of entries) {
    if (!archiveName(entry.name) || names.has(entry.name))
      throw new Error("Invalid archive member");
    names.add(entry.name);
    const name = Buffer.from(entry.name),
      raw = Buffer.from(entry.bytes),
      deflated = NodeZlib.deflateRawSync(raw),
      compressed = deflated.length < raw.length ? deflated : raw,
      method = compressed === raw ? 0 : 8,
      crc = NodeZlib.crc32(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(time, 12);
    directory.writeUInt16LE(date, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, compressed);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}
