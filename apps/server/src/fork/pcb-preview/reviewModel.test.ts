import { describe, it, expect } from "vite-plus/test";
import { emptyInspection, inspectCircuitJson } from "./semantics.ts";
import {
  kicadReviewModel,
  circuitJsonReviewModel,
  parseValue,
  netRole,
  netVolts,
  classify,
  throughSeries,
} from "./reviewModel.ts";
describe("review model", () => {
  it.each([
    ["10k", 1e4],
    ["4k7", 4700],
    ["4.7kΩ", 4700],
  ])("parses resistor %s", (text, value) => expect(parseValue(text, "ohms")?.value).toBe(value));
  it.each([
    ["100n", 1e-7],
    ["0.1uF", 1e-7],
    ["100nF/50V", 1e-7],
    ["2u2 16V", 2.2e-6],
  ])("parses capacitor %s", (text, value) =>
    expect(parseValue(text, "farads")?.value).toBeCloseTo(value, 12),
  );
  it("keeps unknown values unknown and reads ratings", () => {
    expect(parseValue("capacitor", "farads")).toBeUndefined();
    expect(parseValue("100nF/50V", "farads")?.volts).toBe(50);
  });
  it.each([
    ["+3V3", 3.3],
    ["3V3", 3.3],
    ["+5V", 5],
    ["1V8", 1.8],
    ["VCC_1V8", 1.8],
    ["+12V", 12],
  ])("reads voltage %s", (name, v) => expect(netVolts(name).volts).toBe(v));
  it("classifies roles without guessing unnamed rails", () => {
    expect(netRole("AGND")).toBe("ground");
    expect(netRole("VSS1")).toBe("ground");
    expect(netRole("3V3")).toBe("power");
    expect(netRole("foo")).toBe("signal");
    expect(netVolts("VBUS")).toEqual({ volts: 5, voltsAssumed: true });
  });
  it("parses no-connect suffixes, pin functions, fields and power symbols", () => {
    const source =
      '(export (components (comp (ref U1) (value MCU) (libsource (lib MCU) (part Chip))) (comp (ref "#PWR1") (value +3V3))) (nets (net (name +3V3) (node (ref "#PWR1") (pin 1) (pintype power_out)) (node (ref U1) (pin 1) (pinfunction VDD) (pintype power_in))) (net (name "unconnected-(U1-EN)") (node (ref U1) (pin 2) (pinfunction EN) (pintype input+no_connect)))))';
    const m = kicadReviewModel(emptyInspection("one"), source);
    expect(m.parts.size).toBe(1);
    expect(m.parts.get("U1")?.libId).toBe("MCU:Chip");
    expect(m.parts.get("U1")?.pins[1]).toMatchObject({
      type: "input",
      noConnectFlag: true,
      unconnected: true,
    });
    expect(m.nets.get("+3V3")?.role).toBe("power");
    expect(m.has.pinTypes).toBe(true);
  });
  it("retains geometry and has explicit limited data without a netlist", () => {
    const i = {
      ...emptyInspection("one"),
      components: [
        {
          id: "u",
          reference: "U1",
          value: "MCU",
          footprint: "",
          schematic: { x: 1, y: 2, sheet: "main.svg" },
          pins: [
            { number: "1", name: "EN", net: "", schematic: { x: 3, y: 4, sheet: "main.svg" } },
          ],
        },
      ],
    };
    const m = kicadReviewModel(i, null, [{ x: 3, y: 4, sheet: "main.svg" }]);
    expect(m.parts.get("U1")?.pins[0]?.noConnectFlag).toBe(true);
    expect(m.has.pinTypes).toBe(false);
    expect(m.notices).toHaveLength(1);
  });
  it("maps circuit flags and numeric values", () => {
    const data = [
      { type: "source_component", source_component_id: "u", name: "U1", ftype: "simple_chip" },
      {
        type: "source_port",
        source_component_id: "u",
        source_port_id: "p",
        pin_number: 1,
        name: "GPIO1",
        is_input: true,
        needs_external_pullup: true,
      },
    ];
    const m = circuitJsonReviewModel(data, inspectCircuitJson(data, "one"));
    expect(m.parts.get("U1")?.pins[0]).toMatchObject({ type: "input" });
    expect(m.parts.get("U1")?.pins[0]?.hints.has("needs_external_pullup")).toBe(true);
    expect(m.has.pinTypes).toBe(true);
  });
  it.each([
    ["Device:R", "resistor"],
    ["Device:C", "capacitor"],
    ["Device:LED", "led"],
    ["Power_Protection:USBLC6", "tvs"],
    ["Regulator_Linear:AMS1117", "regulator"],
    ["Connector:USB_C", "connector"],
    ["Device:Ferrite_Bead", "ferrite"],
  ])("classifies %s", (libId, kind) =>
    expect(classify({ libId, value: "", ref: "U1", mpn: "" })).toBe(kind),
  );
  it("series walk crosses only small resistors", () => {
    const netlist = (ohms: string) =>
      `(export (components (comp (ref R1) (value ${ohms}))) (nets (net (name A) (node (ref R1) (pin 1))) (net (name B) (node (ref R1) (pin 2)))))`;
    expect([
      ...throughSeries("A", kicadReviewModel(emptyInspection("one"), netlist("100"))),
    ]).toEqual(["A", "B"]);
    expect([
      ...throughSeries("A", kicadReviewModel(emptyInspection("one"), netlist("101"))),
    ]).toEqual(["A"]);
  });
});
