import { expect, it } from "vite-plus/test";
import {
  buildPinMap,
  detectFamily,
  parseGpio,
  pinKind,
  sanitizeIdentifier,
  validateIdentifier,
  renderPinMap,
} from "./pcb-pin-map.ts";
import type { PcbComponent, PcbInspection } from "./pcb-workspace.ts";
const component: PcbComponent = {
  id: "U1",
  reference: "U1",
  value: "RP2040",
  footprint: "QFN",
  pins: [
    { number: "27", name: "GPIO25", net: "/LED", pcb: { x: 1, y: 2 } },
    { number: "1", name: "GND", net: "GND", type: "power_in" },
    { number: "2", name: "GPIO26_ADC0", net: "unconnected-(U1-GPIO26-Pad2)" },
  ],
};
const inspection: PcbInspection = {
  sourceHash: "source",
  components: [component],
  nets: [
    {
      name: "/LED",
      members: [
        { reference: "U1", pin: "27" },
        { reference: "R1", pin: "1" },
      ],
    },
  ],
  layers: [],
  bounds: null,
  thickness: 1.6,
  mountingHoles: [],
  warnings: [],
};
it("detects explicit parts before pin-name fallback and handles alternate GPIO identities", () => {
  expect(detectFamily(component).family).toBe("rp2");
  expect(detectFamily({ ...component, value: "ESP32-S3-WROOM" }).family).toBe("esp32s3");
  expect(
    detectFamily({ ...component, value: "unknown", symbol: "MCU:STM32F103C8" }).detectedFrom,
  ).toBe("symbol");
  expect(
    detectFamily({
      ...component,
      value: "unknown",
      pins: [0, 1, 2, 3].map((n) => ({ number: String(n), name: `GP${n}`, net: "a" })),
    }).detectedFrom,
  ).toBe("pin-names");
  const map = buildPinMap(
    {
      ...inspection,
      components: [
        {
          ...component,
          symbol: "MCU:STM32F103",
          pins: [{ number: "1", name: "TIM2_CH1", baseName: "PA0", net: "PWM" }],
        },
      ],
    },
    "U1",
    { includePower: false, includeNoConnect: false },
  )!;
  expect(map.rows[0]?.gpio?.label).toBe("PA0");
});
it.each([
  ["rp2", "GPIO26_ADC0", undefined, "26"],
  ["rp2", "GP15", undefined, "15"],
  ["esp32", "SENSOR_VP", "classic", "36"],
  ["esp32", "TXD0", "classic", "1"],
  ["esp32s3", "TXD0", "s3", "43"],
  ["esp32", "RXD0", "c3", null],
  ["stm32", "PC14-OSC32_IN", undefined, "PC14"],
  ["avr", "PB5/SCK", "ATmega328P", "PB5 (D13)"],
  ["avr", "PB5", "ATmega2560", "PB5"],
] as const)("parses %s pin %s conservatively", (family, name, variant, label) =>
  expect(parseGpio(family, name, variant)?.label ?? null).toBe(label),
);
it("filters power and no-connect pins, reports absent pads and excludes the selected part from net members", () => {
  const map = buildPinMap(inspection, "U1", { includePower: false, includeNoConnect: false })!;
  expect(map.rows.map((r) => r.included)).toEqual([true, false, false]);
  expect(map.rows[0]).toMatchObject({
    pad: "27",
    identifier: "LED",
    others: [{ reference: "R1", pin: "1" }],
  });
  expect(map.rows[1]?.pad).toBeNull();
  expect(pinKind({ number: "1", name: "", net: "", type: "bidirectional+no_connect" })).toBe(
    "no-connect",
  );
  expect(
    buildPinMap(inspection, "removed", { includePower: false, includeNoConnect: false }),
  ).toBeNull();
  expect(
    buildPinMap(inspection, "U1", { includePower: true, includeNoConnect: true })?.rows.every(
      (r) => r.included,
    ),
  ).toBe(true);
});
it("sanitizes overbars, keywords, leading digits, long identifiers and collisions", () => {
  const used = new Set<string>();
  expect(sanitizeIdentifier("~{RESET}", used)).toBe("RESET_N");
  expect(sanitizeIdentifier("3V3_EN", used)).toBe("PIN_3V3_EN");
  expect(sanitizeIdentifier("int", used)).toBe("INT_PIN");
  expect(sanitizeIdentifier("GND", used)).toBe("GND");
  expect(sanitizeIdentifier("GND", used)).toBe("GND_2");
  const long = "a".repeat(100);
  expect(sanitizeIdentifier(long, used)).toHaveLength(64);
  expect(sanitizeIdentifier(long, used)).toHaveLength(64);
  expect(validateIdentifier("broken name")).toBeTruthy();
  expect(validateIdentifier("HIGH")).toBeTruthy();
  expect(validateIdentifier("LED")).toBeNull();
});
it("generates all six supported formats from the same rows", () => {
  const map = buildPinMap(inspection, "U1", { includePower: false, includeNoConnect: false })!,
    ctx = { designId: "board.kicad_pro", sourceHash: "source" };
  expect(renderPinMap(map, "c", ctx)).toContain("#define LED 25");
  expect(renderPinMap(map, "rust", ctx)).toContain("pub const LED: u8 = 25;");
  expect(renderPinMap(map, "micropython", ctx)).toContain("LED = 25");
  expect(renderPinMap(map, "circuitpython", ctx)).toContain("LED = microcontroller.pin.GPIO25");
  expect(renderPinMap(map, "arduino", ctx)).toContain("constexpr uint8_t LED = 25;");
  expect(renderPinMap(map, "markdown", ctx)).toContain(
    "| 27 | 27 | GPIO25 | 25 | /LED | R1.1 | LED |",
  );
  const connector = buildPinMap(
    {
      ...inspection,
      components: [
        {
          ...component,
          reference: "J1",
          value: "Conn",
          pins: [{ number: "3", name: "SDA", net: "SDA" }],
        },
      ],
    },
    "J1",
    { includePower: false, includeNoConnect: false },
  )!;
  expect(renderPinMap(connector, "c", ctx)).toContain("#define J1_SDA 3");
  expect(connector.formats.find((f) => f.format === "micropython")?.available).toBe(false);
});
it("bounds net members and gives honest unavailable formats for AVR and STM32", () => {
  const map = buildPinMap(
    {
      ...inspection,
      nets: [
        {
          name: "/LED",
          members: Array.from({ length: 80 }, (_, n) => ({ reference: `R${n}`, pin: "1" })),
        },
      ],
    },
    "U1",
    { includePower: false, includeNoConnect: false },
  )!;
  expect(map.rows[0]?.others).toHaveLength(64);
  expect(map.rows[0]?.othersTotal).toBe(80);
  const stm = buildPinMap(
    {
      ...inspection,
      components: [
        { ...component, value: "STM32F103", pins: [{ number: "1", name: "PA5", net: "LED" }] },
      ],
    },
    "U1",
    { includePower: false, includeNoConnect: false },
  )!;
  expect(renderPinMap(stm, "c", { designId: "board", sourceHash: "source" })).toContain(
    "#define LED_PORT GPIOA\n#define LED_PIN GPIO_PIN_5",
  );
  expect(stm.formats.find((f) => f.format === "circuitpython")?.available).toBe(false);
});
