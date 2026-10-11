import { it, expect } from "vite-plus/test";
import { emptyInspection } from "./semantics.ts";
import { kicadReviewModel, type ReviewModel, type ReviewPart } from "./reviewModel.ts";
import { runReview, applyReviewWaivers } from "./reviewRules.ts";
import type { PcbReviewSettings, PcbReviewResult } from "@t3tools/contracts/fork";
const defaults: PcbReviewSettings = { rules: {}, params: {}, waivers: [] };
/** Hand-authored electrical graphs expressed in the same netlist format as KiCad. */
function model(
  parts: Record<
    string,
    { value: string; lib?: string; pins: readonly (readonly [string, string, string])[] }
  >,
): ReviewModel {
  const nets = new Map<string, string[]>();
  let comps = "";
  for (const [ref, p] of Object.entries(parts)) {
    comps += `(comp (ref ${ref}) (value "${p.value}") ${p.lib ? `(libsource (lib Test) (part "${p.lib}"))` : ""})`;
    p.pins.forEach(([name, net, type], i) => {
      nets.set(net, [
        ...(nets.get(net) ?? []),
        `(node (ref ${ref}) (pin ${i + 1}) (pinfunction "${name}") (pintype ${type}))`,
      ]);
    });
  }
  return kicadReviewModel(
    emptyInspection("one"),
    `(export (components ${comps}) (nets ${[...nets].map(([name, nodes]) => `(net (name "${name}") ${nodes.join("")})`).join("")}))`,
  );
}
const rule = (m: ReviewModel, id: string, settings = defaults) =>
  runReview(m, settings).findings.filter((f) => f.rule === id);
it("I2C pull-ups distinguish missing, external and connected pulls", () => {
  const m = model({ U1: { value: "MCU", pins: [["SDA", "SDA", "bidirectional"]] } });
  expect(rule(m, "i2c-pullup")).toHaveLength(1);
  const id = rule(m, "i2c-pullup")[0]!.id;
  (m.parts.get("U1") as ReviewPart).schematic = { x: 100, y: 200 };
  expect(rule(m, "i2c-pullup")[0]!.id).toBe(id);
  const good = model({
    U1: { value: "MCU", pins: [["SDA", "SDA", "bidirectional"]] },
    R1: {
      value: "4k7",
      pins: [
        ["1", "SDA", "passive"],
        ["2", "+3V3", "passive"],
      ],
    },
  });
  expect(rule(good, "i2c-pullup")).toHaveLength(0);
});
it("decoupling uses the same supply and nearest pads", () => {
  const parts = {
    U1: {
      value: "MCU",
      pins: [
        ["VDD", "+3V3", "power_in"],
        ["GND", "GND", "power_in"],
        ["IN", "DATA", "input"],
      ] as const,
    },
  };
  expect(rule(model(parts), "decoupling")).toHaveLength(1);
  const m = model({
    ...parts,
    C1: {
      value: "100n",
      pins: [
        ["1", "+3V3", "passive"],
        ["2", "GND", "passive"],
      ],
    },
  });
  expect(rule(m, "decoupling")).toHaveLength(0);
  m.parts.get("U1")!.pins[0]!.board = { x: 0, y: 0 };
  m.parts.get("C1")!.pins[0]!.board = { x: 10, y: 0 };
  expect(rule(m, "decoupling")[0]).toMatchObject({
    severity: "info",
    message: expect.stringContaining("10.0 mm"),
  });
});
it("USB ESD walks series resistance to recognized protection", () => {
  const j = { value: "USB", lib: "Connector_USB", pins: [["D+", "DP", "passive"]] as const };
  expect(rule(model({ J1: j }), "connector-esd")).toHaveLength(1);
  const m = model({
    J1: j,
    R1: {
      value: "22",
      pins: [
        ["1", "DP", "passive"],
        ["2", "DP_IN", "passive"],
      ],
    },
    D1: {
      value: "USBLC6",
      pins: [
        ["1", "DP_IN", "passive"],
        ["2", "GND", "passive"],
      ],
    },
  });
  expect(rule(m, "connector-esd")).toHaveLength(0);
});
it("floating inputs honor NC flags, passive connections and pulls", () => {
  const u = { value: "MCU", pins: [["EN", "BUTTON", "input+no_connect"]] as const };
  expect(rule(model({ U1: u }), "floating-input")).toHaveLength(1);
  const m = model({
    U1: { ...u, pins: [["EN", "BUTTON", "input"]] },
    SW1: {
      value: "SW",
      pins: [
        ["1", "BUTTON", "passive"],
        ["2", "GND", "passive"],
      ],
    },
  });
  expect(rule(m, "floating-input")).toHaveLength(1);
  const good = model({
    U1: { ...u, pins: [["EN", "BUTTON", "input"]] },
    SW1: { value: "SW", pins: [["1", "BUTTON", "passive"]] },
    R1: {
      value: "10k",
      pins: [
        ["1", "BUTTON", "passive"],
        ["2", "+3V3", "passive"],
      ],
    },
  });
  expect(rule(good, "floating-input")).toHaveLength(0);
});
it("reset accepts pull-downs and ground capacitors", () => {
  const u = { value: "MCU", pins: [["NRST", "RST", "input"]] as const };
  expect(rule(model({ U1: u }), "reset-pullup")).toHaveLength(1);
  expect(
    rule(
      model({
        U1: u,
        C1: {
          value: "100n",
          pins: [
            ["1", "RST", "passive"],
            ["2", "GND", "passive"],
          ],
        },
      }),
      "reset-pullup",
    ),
  ).toHaveLength(0);
});
it("LED series strings require current limiting", () => {
  const led = {
    value: "LED",
    pins: [
      ["A", "+3V3", "passive"],
      ["K", "GND", "passive"],
    ] as const,
  };
  expect(rule(model({ D1: led }), "led-resistor")).toHaveLength(1);
  expect(
    rule(
      model({
        D1: {
          ...led,
          pins: [
            ["A", "+3V3", "passive"],
            ["K", "LED_K", "passive"],
          ],
        },
        R1: {
          value: "330",
          pins: [
            ["1", "LED_K", "passive"],
            ["2", "GND", "passive"],
          ],
        },
      }),
      "led-resistor",
    ),
  ).toHaveLength(0);
});
it("drivers catch UART crossings and tscircuit output flags", () => {
  const m = model({
    U1: { value: "MCU", pins: [["TX", "UART", "output"]] },
    U2: { value: "MCU", pins: [["TXD", "UART", "output"]] },
  });
  expect(rule(m, "multiple-drivers")).toHaveLength(1);
  m.designKind = "tscircuit";
  expect(rule(m, "multiple-drivers")[0]?.severity).toBe("error");
  const good = model({
    U1: { value: "MCU", pins: [["TX", "UART", "output"]] },
    U2: { value: "MCU", pins: [["RX", "UART", "input"]] },
  });
  expect(rule(good, "multiple-drivers")).toHaveLength(0);
});
it("regulators report fixed output mismatches and caps, using only verified limits", () => {
  const m = model({
    U1: {
      value: "AMS1117-3.3",
      pins: [
        ["IN", "+24V", "power_in"],
        ["OUT", "+5V", "power_out"],
      ],
    },
  });
  const findings = rule(m, "regulator-ratings");
  expect(findings).toHaveLength(3);
  expect(findings.some((f) => f.message.includes("input limit"))).toBe(false);
  const verified = model({
    U1: {
      value: "LM1117-3.3",
      pins: [
        ["IN", "+24V", "power_in"],
        ["OUT", "+3V3", "power_out"],
      ],
    },
    C1: {
      value: "10u/50V",
      pins: [
        ["1", "+24V", "passive"],
        ["2", "GND", "passive"],
      ],
    },
    C2: {
      value: "10u/16V",
      pins: [
        ["1", "+3V3", "passive"],
        ["2", "GND", "passive"],
      ],
    },
  });
  expect(rule(verified, "regulator-ratings")).toHaveLength(1);
});
it("disabled rules, parameter fallback, limited notices and caps are explicit", () => {
  const m = model({ U1: { value: "MCU", pins: [["SDA", "SDA", "input"]] } });
  expect(rule(m, "i2c-pullup", { ...defaults, rules: { "i2c-pullup": false } })).toHaveLength(0);
  expect(
    runReview(m, { ...defaults, params: { decoupling: { maxDistanceMm: 0 } } }).notices.join(),
  ).toContain("using 5 mm");
  m.has.pinTypes = false;
  expect(runReview(m, defaults).rules.find((r) => r.id === "floating-input")?.limited).toBeTruthy();
  const parts = Object.fromEntries(
    Array.from({ length: 501 }, (_, i) => [
      `U${i}`,
      { value: "MCU", pins: [["SDA", `I2C_SDA_${i}`, "input"]] as const },
    ]),
  );
  const output = runReview(model(parts), defaults);
  expect(output.findings).toHaveLength(500);
  expect(output.truncated).toBe(true);
});
it("waivers apply on read and preserve raw reports", () => {
  const output = runReview(
    model({ U1: { value: "MCU", pins: [["SDA", "SDA", "input"]] } }),
    defaults,
  );
  const report: PcbReviewResult = {
    ...output,
    designKind: "kicad",
    outcome: "findings",
    sourceHash: "one",
    configHash: "config",
    rulesVersion: 1,
    counts: { errors: 0, warnings: 1, info: 0, waived: 0 },
    log: "",
    durationMs: 1,
    ranAt: "2026-10-11T12:00:00.000Z",
  };
  const result = applyReviewWaivers(
    report,
    {
      ...defaults,
      waivers: [
        {
          designId: "a",
          findingId: output.findings[0]!.id,
          note: "Pulls on module",
          at: report.ranAt,
        },
      ],
    },
    "a",
  );
  expect(result.counts).toMatchObject({ warnings: 0, waived: 1 });
  expect(result.outcome).toBe("clean");
  expect(report.findings[0]?.waived).toBe(false);
  expect(applyReviewWaivers(report, defaults, "a").counts.warnings).toBe(1);
});
