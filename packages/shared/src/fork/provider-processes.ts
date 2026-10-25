import * as Schema from "effect/Schema";

/**
 * The provider process ledger, relative to a server's state directory. The server owns it; the
 * desktop only reads it after its backend dies, and the next server start revalidates what is left.
 */
export const PROVIDER_PROCESS_LEDGER_PATH = ["runtime", "provider-processes.json"] as const;

export const ProcessIdentity = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(1)),
  pgid: Schema.Int.check(Schema.isGreaterThan(1)),
  // PID, group and start second identify a process; command lines are not compared because
  // `#!/usr/bin/env node` launchers and retitling CLIs rewrite theirs after spawn.
  lstart: Schema.String,
});
export type ProcessIdentity = typeof ProcessIdentity.Type;

export const ProviderProcessRecord = Schema.Struct({
  ...ProcessIdentity.fields,
  owner: ProcessIdentity,
  threadId: Schema.optional(Schema.String),
  nativeSessionId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
});
export type ProviderProcessRecord = typeof ProviderProcessRecord.Type;

export const ProviderProcessLedger = Schema.Struct({
  version: Schema.Literal(1),
  processes: Schema.Array(ProviderProcessRecord),
});

export const decodeProviderProcessLedger = Schema.decodeUnknownSync(
  Schema.fromJsonString(ProviderProcessLedger),
);

export const sameProcess = (record: ProcessIdentity, current: ProcessIdentity) =>
  record.pid === current.pid && record.pgid === current.pgid && record.lstart === current.lstart;

/**
 * A recorded process is gone once its PID is free or reused; a live one whose group changed may
 * not be signalled, because its group no longer proves ownership.
 */
export const processState = (
  record: ProcessIdentity,
  current: ProcessIdentity | null,
): "gone" | "owned" | "uncertain" => {
  if (current === null || current.lstart !== record.lstart) return "gone";
  return sameProcess(record, current) ? "owned" : "uncertain";
};

// Both commands run with LC_ALL=C so `lstart` keeps the format the ledger records.
export const psIdentityArgs = (pid: number) => ["-p", String(pid), "-o", "pgid=", "-o", "lstart="];
export const PS_TABLE_ARGS = ["-A", "-o", "pid=", "-o", "pgid=", "-o", "lstart="] as const;

const LSTART = String.raw`\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4}`;
const IDENTITY_LINE = new RegExp(String.raw`^(\d+)\s+(${LSTART})$`);
const TABLE_LINE = new RegExp(String.raw`^\s*(\d+)\s+(\d+)\s+(${LSTART})\s*$`);

/** Reads `psIdentityArgs` output; null when it is not one process's identity. */
export const parsePsIdentity = (pid: number, output: string): ProcessIdentity | null => {
  const match = IDENTITY_LINE.exec(output.trim());
  return match ? { pid, pgid: Number(match[1]), lstart: match[2]! } : null;
};

/** Reads `PS_TABLE_ARGS` output by PID; null if any line is unreadable, so nothing is guessed. */
export const parsePsTable = (output: string): ReadonlyMap<number, ProcessIdentity> | null => {
  const table = new Map<number, ProcessIdentity>();
  for (const line of output.split("\n")) {
    if (line.trim().length === 0) continue;
    const match = TABLE_LINE.exec(line);
    if (!match) return null;
    const pid = Number(match[1]);
    table.set(pid, { pid, pgid: Number(match[2]), lstart: match[3]! });
  }
  return table;
};
