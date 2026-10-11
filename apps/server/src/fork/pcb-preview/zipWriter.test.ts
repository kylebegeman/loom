import * as DateTime from "effect/DateTime";
import { PcbPreviewError } from "@t3tools/contracts/fork";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeStream from "@effect/platform-node/NodeStream";
import * as Stream from "effect/Stream";
import * as NodeZlib from "node:zlib";
import { writeZip } from "./zipWriter.ts";
import { openZipArchive } from "../../zipArchive.ts";
it.effect("archives round-trip stored and deflated UTF-8 entries with CRCs", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path,
        root = yield* fs.makeTempDirectoryScoped();
      const values = [
          { name: "copper.gtl", bytes: Buffer.from("copper".repeat(100)) },
          { name: "孔.drl", bytes: Uint8Array.of(1, 255, 32, 4) },
        ],
        date = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-10T12:00:00Z")),
        bytes = writeZip(values, date);
      expect(writeZip(values, date)).toEqual(bytes);
      const archiveFile = path.join(root, "package.zip");
      yield* fs.writeFile(archiveFile, bytes);
      const archive = yield* openZipArchive(
        archiveFile,
        () => new PcbPreviewError({ reason: "invalid-report", message: "archive" }),
      );
      const compression: number[] = [];
      for (const value of values) {
        const entry = yield* archive.next;
        expect(entry?.fileName).toBe(value.name);
        expect(entry?.crc32).toBe(NodeZlib.crc32(value.bytes));
        compression.push(entry!.compressionMethod);
        const readable = yield* archive.streamEntry(entry!);
        const chunks = yield* NodeStream.fromReadable<Uint8Array, PcbPreviewError>({
          evaluate: () => readable,
          onError: () => new PcbPreviewError({ reason: "invalid-report", message: "stream" }),
        }).pipe(Stream.runCollect);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(value.bytes));
      }
      expect(compression).toEqual([8, 0]);
      expect(yield* archive.next).toBeNull();
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
it("rejects traversal, duplicate names, and excess entries", () => {
  const date = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-10T12:00:00Z"));
  for (const name of ["../x", "/x", "a\\x", "a/../x", "C:/x", "a\u0000"]) {
    expect(() => writeZip([{ name, bytes: new Uint8Array() }], date)).toThrow();
  }
  const entry = { name: "x", bytes: new Uint8Array() };
  expect(() => writeZip([entry, entry], date)).toThrow();
  expect(() =>
    writeZip(
      Array.from({ length: 1001 }, (_, i) => ({ ...entry, name: String(i) })),
      date,
    ),
  ).toThrow();
});
