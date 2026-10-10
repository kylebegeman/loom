import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import {
  GB,
  PORT_BLOCK,
  PORT_RANGE,
  allocatePortBase,
  autoBuildSlots,
  growTarget,
  holdsLane,
  isAppleCheckout,
  laneActions,
  laneBaseName,
  laneCapBytes,
  laneSlug,
  machinePressure,
  projectFolder,
  shouldGrow,
  uniqueName,
} from "./policy.ts";

const settings = {
  enabled: true,
  lanesRoot: "/lanes",
  defaultCapGb: 40,
  appleCapGb: 100,
  reserveGb: 40,
  projectCapsGb: { big: 250 },
  buildSlots: null,
};

const shell = (fields: Partial<OrchestrationV2ThreadShell>) =>
  ({
    archivedAt: null,
    settledAt: null,
    settledOverride: null,
    activeRunId: null,
    creationSource: "web",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "thread-1" },
    ...fields,
  }) as OrchestrationV2ThreadShell;

const reading = (usedGb: number, extra: Partial<Parameters<typeof laneActions>[0]> = {}) => ({
  capBytes: 100 * GB,
  usedBytes: usedGb * GB,
  imageBytes: usedGb * GB,
  running: false,
  mounted: true,
  ...extra,
});

describe("caps", () => {
  it("gives Xcode and SwiftPM projects the Apple cap and honours project overrides", () => {
    expect(isAppleCheckout(["README.md", "AspectAvy.xcodeproj"])).toBe(true);
    expect(isAppleCheckout(["Package.swift"])).toBe(true);
    expect(isAppleCheckout(["package.json", "apps"])).toBe(false);
    expect(laneCapBytes(settings, "web", false)).toBe(40 * GB);
    expect(laneCapBytes(settings, "app", true)).toBe(100 * GB);
    expect(laneCapBytes(settings, "big", false)).toBe(250 * GB);
  });
});

describe("names", () => {
  it("names the project root lane main and worktree lanes after their folder", () => {
    expect(laneBaseName("/active/loom", "/active/loom")).toBe("main");
    expect(laneBaseName("/worktrees/loom-project lifecycle", "/active/loom")).toBe(
      "loom-project-lifecycle",
    );
    expect(laneSlug("../..")).toBe("lane");
    expect(uniqueName("main", new Set(["main", "main-2"]))).toBe("main-3");
  });

  it("reuses a project's folder and separates projects that share a folder name", () => {
    const existing = [{ projectId: "p1", folder: "app" }];
    expect(projectFolder({ projectId: "p1", workspaceRoot: "/x/other", existing })).toBe("app");
    expect(projectFolder({ projectId: "p2abcdefgh", workspaceRoot: "/y/app", existing })).toBe(
      "app-p2abcdef",
    );
    expect(projectFolder({ projectId: "p3", workspaceRoot: "/y/web", existing })).toBe("web");
  });
});

describe("holders", () => {
  it("lets archived and settled threads release their lane, but not unsettled ones", () => {
    const now = DateTime.nowUnsafe();
    expect(holdsLane(shell({}))).toBe(true);
    expect(holdsLane(shell({ archivedAt: now }))).toBe(false);
    expect(holdsLane(shell({ settledAt: now }))).toBe(false);
    expect(holdsLane(shell({ settledOverride: "settled" }))).toBe(false);
    expect(holdsLane(shell({ settledAt: now, settledOverride: "active" }))).toBe(true);
  });

  it("lets a provider's own subagent hold a lane only while it runs", () => {
    const lineage = {
      parentThreadId: "parent",
      relationshipToParent: "subagent",
      rootThreadId: "parent",
    };
    const native = { creationSource: "provider", lineage } as Partial<OrchestrationV2ThreadShell>;
    expect(holdsLane(shell(native))).toBe(false);
    expect(
      holdsLane(shell({ ...native, activeRunId: "run-1" } as Partial<OrchestrationV2ThreadShell>)),
    ).toBe(true);
    // A delegated child is an ordinary thread that settles on its own.
    expect(
      holdsLane(shell({ ...native, creationSource: "mcp" } as Partial<OrchestrationV2ThreadShell>)),
    ).toBe(true);
  });
});

describe("lane pressure", () => {
  it("steers a running agent once per crossing and again only after it drops below 60%", () => {
    let state = laneActions(reading(80, { running: true }), false);
    expect(state.actions).toEqual([{ type: "steer" }]);
    state = laneActions(reading(95, { running: true }), state.steered);
    expect(state.actions).toEqual([]);
    state = laneActions(reading(70, { running: true }), state.steered);
    expect(state).toEqual({ actions: [], steered: true });
    state = laneActions(reading(50, { running: true }), state.steered);
    expect(state.steered).toBe(false);
    expect(laneActions(reading(76, { running: true }), state.steered).actions).toEqual([
      { type: "steer" },
    ]);
  });

  it("never clears or remounts a lane while its thread runs", () => {
    expect(laneActions(reading(99, { running: true, imageBytes: 300 * GB }), true).actions).toEqual(
      [],
    );
  });

  it("clears an idle nearly full lane and remounts an idle lane holding deleted space", () => {
    expect(laneActions(reading(92), false).actions).toEqual([{ type: "clear-tmp" }]);
    expect(laneActions(reading(10, { imageBytes: 40 * GB }), false).actions).toEqual([
      { type: "remount" },
    ]);
    expect(laneActions(reading(10, { imageBytes: 30 * GB }), false).actions).toEqual([]);
    expect(
      laneActions(reading(10, { mounted: false, imageBytes: 90 * GB }), false).actions,
    ).toEqual([]);
  });

  it("grows by half while keeping the machine reserve", () => {
    expect(shouldGrow(91 * GB, 100 * GB)).toBe(true);
    expect(growTarget({ capBytes: 100 * GB, hostFreeBytes: 500 * GB, reserveBytes: 40 * GB })).toBe(
      150 * GB,
    );
    expect(growTarget({ capBytes: 100 * GB, hostFreeBytes: 60 * GB, reserveBytes: 40 * GB })).toBe(
      120 * GB,
    );
    expect(
      growTarget({ capBytes: 100 * GB, hostFreeBytes: 40.5 * GB, reserveBytes: 40 * GB }),
    ).toBeNull();
  });
});

describe("machine pressure", () => {
  it("steers once per episode and ends the episode only after recovering past the margin", () => {
    const reserveBytes = 40 * GB;
    let state = machinePressure({ hostFreeBytes: 30 * GB, reserveBytes, inEpisode: false });
    expect(state).toEqual({ below: true, inEpisode: true, steer: true });
    state = machinePressure({ hostFreeBytes: 20 * GB, reserveBytes, inEpisode: state.inEpisode });
    expect(state.steer).toBe(false);
    state = machinePressure({ hostFreeBytes: 45 * GB, reserveBytes, inEpisode: state.inEpisode });
    expect(state).toEqual({ below: false, inEpisode: true, steer: false });
    state = machinePressure({ hostFreeBytes: 30 * GB, reserveBytes, inEpisode: state.inEpisode });
    expect(state.steer).toBe(false);
    state = machinePressure({ hostFreeBytes: 60 * GB, reserveBytes, inEpisode: state.inEpisode });
    expect(state.inEpisode).toBe(false);
  });
});

describe("lane ports", () => {
  it("hands out the first free block and runs out at the end of the range", () => {
    expect(allocatePortBase(new Set())).toBe(PORT_RANGE.first);
    expect(allocatePortBase(new Set([PORT_RANGE.first, PORT_RANGE.first + 2 * PORT_BLOCK]))).toBe(
      PORT_RANGE.first + PORT_BLOCK,
    );
    const all = new Set<number>();
    for (let base = PORT_RANGE.first; base + PORT_BLOCK - 1 <= PORT_RANGE.last; base += PORT_BLOCK)
      all.add(base);
    expect(allocatePortBase(all)).toBeNull();
    // Blocks stay below the macOS ephemeral range.
    expect(PORT_RANGE.last).toBeLessThan(49152);
  });
});

describe("build slots", () => {
  it("defaults to one slot per three CPU threads, at least two", () => {
    expect(autoBuildSlots(18)).toBe(6);
    expect(autoBuildSlots(4)).toBe(2);
  });
});
