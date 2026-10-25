import { describe, expect, it } from "vite-plus/test";

import { parsePsIdentity, parsePsTable, processState } from "./provider-processes.ts";

describe("provider process identity", () => {
  it("reads one process from padded ps output, including a single-digit day", () => {
    expect(parsePsIdentity(4243, "  4242 Sun Oct  5 09:00:01 2026\n")).toEqual({
      pid: 4243,
      pgid: 4242,
      lstart: "Sun Oct  5 09:00:01 2026",
    });
    expect(parsePsIdentity(4242, "")).toBeNull();
    expect(parsePsIdentity(4242, "4242 yesterday")).toBeNull();
  });

  it("reads the process table, or nothing when any line is unreadable", () => {
    const table = parsePsTable(
      "    1     1 Sat Oct 24 08:00:00 2026\n  501   500 Sun Oct 25 10:00:00 2026\n\n",
    );
    expect(table?.get(501)).toEqual({ pid: 501, pgid: 500, lstart: "Sun Oct 25 10:00:00 2026" });
    expect(table?.size).toBe(2);
    expect(parsePsTable("    1     1 Sat Oct 24 08:00:00 2026\n  501 ???\n")).toBeNull();
  });

  it("tells a stopped or reused process from one whose group changed", () => {
    const record = { pid: 500, pgid: 500, lstart: "Sun Oct 25 10:00:00 2026" };
    expect(processState(record, null)).toBe("gone");
    expect(processState(record, { ...record, lstart: "Sun Oct 25 11:30:00 2026" })).toBe("gone");
    expect(processState(record, { ...record, pgid: 650 })).toBe("uncertain");
    expect(processState(record, record)).toBe("owned");
  });
});
