import { describe, expect, it } from "@effect/vitest";
import {
  ancestorsOf,
  liveProcess,
  parseDocker,
  parseLedger,
  parseLsofPids,
  parseProcessTable,
  parseSlotHolder,
  withDescendants,
} from "./leases.ts";

const table = parseProcessTable(
  [
    "    1     0 Thu Oct  1 09:00:00 2026",
    "  100     1 Thu Oct  8 12:00:00 2026",
    "  200   100 Thu Oct  8 12:00:01 2026",
    "  201   200 Thu Oct  8 12:00:02 2026",
    "  300     1 Thu Oct  8 12:00:03 2026",
    "garbage",
  ].join("\n"),
);

describe("ledger", () => {
  it("keeps the latest entry per lease and skips lines it cannot use", () => {
    expect(
      parseLedger(
        [
          "process\t200\tweb\tThu Oct  8 12:00:01 2026",
          "simulator\tUDID-1\tPhone\t1790000000",
          "process\tnot-a-pid\tbad\tx",
          "volume\tdb\tignored\t0",
          "simulator\tUDID-1\tRenamed\t1790000001",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "process", ref: "200", label: "web", stamp: "Thu Oct 8 12:00:01 2026" },
      { kind: "simulator", ref: "UDID-1", label: "Renamed", stamp: "1790000001" },
    ]);
  });

  it("counts a process only while the same pid has the same start time", () => {
    const [entry] = parseLedger("process\t200\tweb\tThu Oct 8 12:00:01 2026");
    expect(liveProcess(table, entry!)).toBe(true);
    const [reused] = parseLedger("process\t200\tweb\tWed Oct 7 08:00:00 2026");
    expect(liveProcess(table, reused!)).toBe(false);
  });
});

describe("process tree", () => {
  it("finds every descendant of the roots and every ancestor of a process", () => {
    expect([...withDescendants(table, [100, 999])].sort()).toEqual([100, 200, 201]);
    expect([...ancestorsOf(table, 201)].sort()).toEqual([100, 200, 201]);
  });
});

describe("tool output", () => {
  it("reads labelled Docker resources, lsof pids and slot holders", () => {
    expect(parseDocker("container", "abc\tlane-1\tdb\trunning\n\tlane-2\n")).toEqual([
      { kind: "container", ref: "abc", laneId: "lane-1", label: "db (running)" },
    ]);
    expect(parseDocker("volume", "data\tlane-1\n")).toEqual([
      { kind: "volume", ref: "data", laneId: "lane-1", label: "data" },
    ]);
    expect([...parseLsofPids("p12\nfcwd\np34\n")]).toEqual([12, 34]);
    expect(
      parseSlotHolder(
        2,
        "200\tThu Oct  8 12:00:01 2026\t/lanes/app/main/space\txcodebuild build\n",
      ),
    ).toEqual({
      slot: 2,
      pid: 200,
      started: "Thu Oct 8 12:00:01 2026",
      spacePath: "/lanes/app/main/space",
      command: "xcodebuild build",
    });
    expect(parseSlotHolder(1, "")).toBeNull();
  });
});
