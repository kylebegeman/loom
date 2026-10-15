// @effect-diagnostics nodeBuiltinImport:off
import * as Sqlite from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteSnapshot } from "./loomLibrarySnapshot.ts";
import { describe, it, expect } from "vite-plus/test";

describe("online snapshot under continuing writes", () => {
  it("pins the read transaction so other connections cannot restart the backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "loom-snapshot-writes-"));
    const source = join(directory, "source.sqlite");
    const target = join(directory, "snapshot.sqlite");
    const writer = new Sqlite.DatabaseSync(source);
    writer.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES(0); CREATE TABLE pages(data BLOB);",
    );
    for (let i = 0; i < 32; i++) writer.exec("INSERT INTO pages VALUES(zeroblob(8192))");
    try {
      const remaining: number[] = [];
      await sqliteSnapshot(source, target, {
        rate: 1,
        progress(info) {
          remaining.push(info.remainingPages);
          if (remaining.length <= 16) writer.exec("UPDATE marker SET value=value+1");
        },
      });
      const snapshot = new Sqlite.DatabaseSync(target, { readOnly: true });
      try {
        expect(snapshot.prepare("SELECT value FROM marker").get()?.value).toBe(0);
      } finally {
        snapshot.close();
      }
      expect(remaining.length).toBeGreaterThan(10);
      expect(remaining.every((value, index) => index === 0 || value < remaining[index - 1]!)).toBe(
        true,
      );
      expect(Number(writer.prepare("SELECT value FROM marker").get()?.value)).toBeGreaterThan(10);
    } finally {
      writer.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
