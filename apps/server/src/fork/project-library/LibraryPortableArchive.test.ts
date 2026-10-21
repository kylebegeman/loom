import { expect, test } from "vite-plus/test";
import { makeRecoveryTarReader } from "./LibraryPortableArchive.ts";

const encoder = new TextEncoder();
const entry = (name: string, type = "0", body = "", link = "") => {
  const data = encoder.encode(body);
  const bytes = new Uint8Array(512 + Math.ceil(data.length / 512) * 512);
  const field = (offset: number, text: string) => bytes.set(encoder.encode(text), offset);
  field(0, name);
  field(100, "0000644\0");
  field(124, `${data.length.toString(8).padStart(11, "0")}\0`);
  bytes.fill(32, 148, 156);
  field(156, type);
  field(157, link);
  field(257, "ustar ");
  const checksum = bytes.subarray(0, 512).reduce((sum, value) => sum + value, 0);
  field(148, `${checksum.toString(8).padStart(6, "0")}\0 `);
  bytes.set(data, 512);
  return bytes;
};
const read = (...entries: Uint8Array[]) => {
  const reader = makeRecoveryTarReader();
  for (const bytes of [
    entry("loom-working-copy.json", "0", "{}"),
    entry("./workspace/", "5"),
    ...entries,
    new Uint8Array(1024),
  ]) {
    // Chunk boundaries need not align with tar blocks or UTF-8 sequences.
    for (let offset = 0; offset < bytes.length; offset += 73)
      reader.write(bytes.subarray(offset, offset + 73));
  }
  return reader.finish();
};

test("preflights relative links, internal hardlinks and GNU long names", () => {
  const longName = `workspace/${"a".repeat(140)}`;
  const result = read(
    entry("./workspace/file", "0", "content"),
    entry("./workspace/link", "2", "", "file"),
    entry("./workspace/hardlink", "1", "", "./workspace/file"),
    entry("././@LongLink", "L", `${longName}\0`),
    entry("ignored-long-name", "0", "long content"),
  );
  expect(result.root).toBe("workspace");
  expect(result.entries.get(longName)?.type).toBe("0");
});

test.each([
  ["absolute path", entry("/outside", "0", "bad")],
  ["parent traversal", entry("workspace/../outside", "0", "bad")],
  ["Windows path", entry("C:\\outside", "0", "bad")],
  ["external symlink", entry("workspace/link", "2", "", "../../outside")],
  ["absolute symlink", entry("workspace/link", "2", "", "/outside")],
  ["external hardlink", entry("workspace/link", "1", "", "../outside")],
  ["Git metadata symlink", entry("workspace/.git", "2", "", "local-git")],
  ["special device", entry("workspace/device", "3")],
  ["PAX override", entry("workspace/pax", "x", "path=../outside")],
] as const)("rejects %s before extraction", (_name, bytes) => {
  expect(() => read(bytes)).toThrow();
});

test("rejects duplicate paths and links used as extraction parents", () => {
  expect(() => read(entry("workspace/file"), entry("./workspace/file"))).toThrow();
  expect(() => read(entry("workspace/file"), entry("workspace/FILE"))).toThrow();
  expect(() =>
    read(entry("workspace/a", "2", "", "d/.."), entry("workspace/d", "2", "", ".")),
  ).toThrow();
  expect(() =>
    read(entry("workspace/link", "2", "", "folder"), entry("workspace/link/file")),
  ).toThrow();
  expect(() =>
    read(entry("workspace/a", "2", "", "b"), entry("workspace/b", "2", "", "a")),
  ).toThrow();
});

test("rejects corrupt checksums and truncated archives", () => {
  const corrupt = entry("workspace/file", "0", "body");
  corrupt[10] = 1;
  expect(() => read(corrupt)).toThrow();
  const reader = makeRecoveryTarReader();
  reader.write(entry("loom-working-copy.json", "0", "{}"));
  reader.write(entry("workspace", "5"));
  expect(reader.finish).toThrow();
});
