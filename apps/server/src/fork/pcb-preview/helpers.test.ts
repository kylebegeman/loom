import { describe, it, expect } from "vite-plus/test";
import { groupDesigns, innerCopperLayers } from "./discovery.ts";
import { isRenderKey, isSheetFileName, pickPruneVictims, renderKey } from "./cache.ts";
import { circuitEnvironment, parseKicadVersion } from "./tools.ts";
import { parseKicadReport } from "./kicadReports.ts";

describe("PCB discovery", () => {
  it("groups projects and nested subsheets, preserves unrelated lone designs and config entrypoints", () => {
    const files = [
      "hw/main.kicad_pro",
      "hw/main.kicad_sch",
      "hw/main.kicad_pcb",
      "hw/sub/power.kicad_sch",
      "other.kicad_pcb",
      "hw/alternate.kicad_sch",
      "blink.circuit.tsx",
      "tscircuit.config.json",
      "noise.kicad_pro.bak",
    ];
    const configs = new Map([["tscircuit.config.json", { mainEntrypoint: "src/index.tsx" }]]);
    const sources = new Map([
      ["hw/main.kicad_sch", '(property "Sheetfile" "sub/power.kicad_sch")'],
    ]);
    const designs = groupDesigns(files, configs, sources);
    expect(designs.map((d) => d.id)).toEqual([
      "blink.circuit.tsx",
      "hw/alternate.kicad_sch",
      "hw/main.kicad_pro",
      "other.kicad_pcb",
      "src/index.tsx",
    ]);
    expect(designs.find((d) => d.id === "hw/main.kicad_pro")?.boardPath).toBe("hw/main.kicad_pcb");
  });
  it("ignores invalid configs, deduplicates entrypoints and sorts inner copper numerically", () => {
    expect(
      groupDesigns(
        ["x.circuit.tsx"],
        new Map([["tscircuit.config.json", { mainEntrypoint: "x.circuit.tsx" }]]),
      ),
    ).toHaveLength(1);
    expect(
      groupDesigns([], new Map([["tscircuit.config.json", { mainEntrypoint: "../outside.tsx" }]])),
    ).toEqual([]);
    expect(
      innerCopperLayers(
        '(layers (4 "In10.Cu" signal) (1 "In2.Cu" signal) (2 "In1.Cu" signal) (3 "In2.Cu" signal))',
      ),
    ).toEqual(["In1.Cu", "In2.Cu", "In10.Cu"]);
  });
});
describe("PCB cache", () => {
  it("isolates workspaces, tools and presets", () => {
    const key = renderKey(
      "workspace",
      "board.kicad_pcb",
      "hash",
      "kicad",
      "pcb",
      "front",
      "10.0.6",
    );
    expect(isRenderKey(key)).toBe(true);
    for (const args of [
      ["other", "board.kicad_pcb", "hash", "kicad", "pcb", "front", "10.0.6"],
      ["workspace", "other.kicad_pcb", "hash", "kicad", "pcb", "front", "10.0.6"],
      ["workspace", "board.kicad_pcb", "hash", "kicad", "pcb", "back", "10.0.6"],
      ["workspace", "board.kicad_pcb", "hash", "kicad", "pcb", "front", "9.0.1"],
    ])
      expect(
        renderKey(...(args as [string, string, string, string, string, string, string])),
      ).not.toBe(key);
    expect(isRenderKey("../" + key)).toBe(false);
    for (const bad of ["../x.svg", "a/b.svg", "a\\b.svg", "x.svg.exe", ".hidden.svg", "x\0.svg"])
      expect(isSheetFileName(bad)).toBe(false);
    expect(isSheetFileName("Alimentation électrique.svg")).toBe(true);
  });
  it("enforces both limits while protecting active readers", () => {
    expect(
      pickPruneVictims(
        [
          { key: "a", bytes: 10, modified: 1, protected: true },
          { key: "b", bytes: 20, modified: 2 },
          { key: "c", bytes: 30, modified: 3 },
        ],
        { maxCount: 2, maxBytes: 35 },
      ),
    ).toEqual(["b", "c"]);
  });
});
describe("PCB tools and reports", () => {
  it("parses versions and removes server secrets and runtime injection", () => {
    expect(parseKicadVersion("KiCad 10.0.6 release")?.major).toBe(10);
    expect(parseKicadVersion("9.0.1")?.version).toBe("9.0.1");
    expect(parseKicadVersion("garbage")).toBeNull();
    expect(
      circuitEnvironment({
        PATH: "/bin",
        HOME: "/home",
        API_TOKEN: "x",
        T3CODE_HOME: "private",
        NODE_OPTIONS: "--require secret.js",
        ELECTRON_RUN_AS_NODE: "1",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/home" });
  });
  it("normalizes ERC and DRC groups, excluded flags and units", () => {
    const warning = {
      type: "unconnected",
      description: "Unconnected pin",
      severity: "unknown",
      items: [{ description: "R1 pin 1", pos: { x: 1, y: 2 } }],
    };
    const error = { ...warning, severity: "error" };
    const report = parseKicadReport(
      {
        kicad_version: "10.0.6",
        coordinate_units: "mm",
        violations: [warning],
        unconnected_items: [error],
        schematic_parity: [{ ...error, excluded: true }],
      },
      "drc",
    );
    expect(report.violations.map((v) => v.group)).toEqual(["unconnected", "violation", "parity"]);
    expect(report.violations[1]?.severity).toBe("warning");
    expect(report.violations[0]?.items[0]).toEqual({ description: "R1 pin 1", x: 1, y: 2 });
    expect(
      parseKicadReport(
        { kicad_version: "10", sheets: [{ path: "/Power/", violations: [warning] }] },
        "erc",
      ).violations[0]?.sheet,
    ).toBe("/Power/");
  });
  it("bounds reports and rejects malformed findings", () => {
    const v = { type: "x", description: "x", severity: "error", items: [] };
    const parsed = parseKicadReport(
      { kicad_version: "10", violations: Array.from({ length: 501 }, () => v) },
      "drc",
    );
    expect(parsed.truncated).toBe(true);
    expect(parsed.violations).toHaveLength(500);
    expect(() =>
      parseKicadReport({ kicad_version: "10", violations: [{ bad: true }] }, "drc"),
    ).toThrow();
  });
});
