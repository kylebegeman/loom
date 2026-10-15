// @effect-diagnostics nodeBuiltinImport:off - SQLite physical backups and streaming file checksums use Node's native boundary APIs.
import * as NodeSqlite from "node:sqlite";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";

const decodeIntegrity = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ integrity_check: Schema.String })),
);
export async function sqliteSnapshot(
  source: string,
  destination: string,
  options: Pick<NodeSqlite.BackupOptions, "rate" | "progress"> = {},
): Promise<void> {
  const sourcePath = await NodeFSP.realpath(source);
  const destinationPath = NodePath.resolve(destination);
  if (sourcePath === destinationPath)
    throw new Error("Snapshot destination must differ from its source.");
  await NodeFSP.mkdir(NodePath.dirname(destinationPath), { recursive: true, mode: 0o700 });
  const reserved = await NodeFSP.open(destinationPath, "wx", 0o600);
  await reserved.close();
  const database = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
  try {
    // Other connections restart an unpinned online backup on every commit.
    // Keep one WAL read snapshot while copying, then release it before verification.
    database.exec("BEGIN");
    database.prepare("SELECT name FROM sqlite_schema LIMIT 1").get();
    try {
      await NodeSqlite.backup(database, destinationPath, options);
    } finally {
      database.exec("ROLLBACK");
    }
    const snapshot = new NodeSqlite.DatabaseSync(destinationPath, { readOnly: true });
    try {
      if (
        decodeIntegrity(snapshot.prepare("PRAGMA integrity_check").all()).some(
          (row) => row.integrity_check !== "ok",
        )
      )
        throw new Error("Snapshot integrity check failed.");
    } finally {
      snapshot.close();
    }
    await NodeFSP.chmod(destinationPath, 0o600);
  } catch (error) {
    await NodeFSP.rm(destinationPath, { force: true });
    throw error;
  } finally {
    database.close();
  }
}
export async function fileFingerprint(file: string): Promise<{ digest: string; bytes: number }> {
  const hash = NodeCrypto.createHash("sha256");
  let bytes = 0;
  for await (const chunk of NodeFS.createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { digest: hash.digest("hex"), bytes };
}
