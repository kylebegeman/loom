import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { ThreadId } from "../baseSchemas.ts";
import type { PcbComponent, PcbInspection } from "./pcb-workspace.ts";
const text = (max = 200) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
export const PcbPinMapFormat = Schema.Literals([
  "markdown",
  "c",
  "rust",
  "micropython",
  "circuitpython",
  "arduino",
]);
export type PcbPinMapFormat = typeof PcbPinMapFormat.Type;
export const PcbPinFamily = Schema.Literals(["rp2", "esp32", "esp32s3", "stm32", "avr", "pins"]);
export type PcbPinFamily = typeof PcbPinFamily.Type;
export const PcbPinMapRow = Schema.Struct({
  pin: text(),
  pad: Schema.NullOr(text()),
  name: Schema.String,
  baseName: Schema.optional(Schema.String),
  net: Schema.String,
  kind: Schema.Literals(["signal", "power", "ground", "no-connect", "unconnected"]),
  gpio: Schema.NullOr(
    Schema.Struct({
      label: text(32),
      port: Schema.NullOr(text(2)),
      number: Schema.Number,
      arduino: Schema.optional(text(8)),
    }),
  ),
  identifier: Schema.String,
  included: Schema.Boolean,
  others: Schema.Array(Schema.Struct({ reference: text(), pin: text() })).check(
    Schema.isMaxLength(64),
  ),
  othersTotal: Schema.Number,
});
export type PcbPinMapRow = typeof PcbPinMapRow.Type;
export const PcbPinMap = Schema.Struct({
  reference: text(),
  value: Schema.String,
  symbol: Schema.optional(Schema.String),
  family: PcbPinFamily,
  detectedFrom: Schema.Literals(["override", "symbol", "value", "pin-names", "default"]),
  formats: Schema.Array(
    Schema.Struct({
      format: PcbPinMapFormat,
      available: Schema.Boolean,
      reason: Schema.optional(Schema.String),
    }),
  ).check(Schema.isMaxLength(6)),
  rows: Schema.Array(PcbPinMapRow).check(Schema.isMaxLength(2048)),
  warnings: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
});
export type PcbPinMap = typeof PcbPinMap.Type;
export const PcbPinMapInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  reference: text(),
  family: Schema.optional(PcbPinFamily),
  format: PcbPinMapFormat.pipe(Schema.withDecodingDefault(Effect.succeed("markdown"))),
  names: Schema.optional(Schema.Record(text(), Schema.String.check(Schema.isMaxLength(64)))),
  includePower: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  includeNoConnect: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  save: Schema.optional(
    Schema.Struct({
      path: text(1024),
      overwrite: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
    }),
  ),
  expectedSourceHash: Schema.optional(text()),
});
export type PcbPinMapInput = typeof PcbPinMapInput.Type;
export const PcbPinMapResult = Schema.Struct({
  sourceHash: text(),
  map: PcbPinMap,
  format: PcbPinMapFormat,
  text: Schema.String.check(Schema.isMaxLength(512 * 1024)),
  saved: Schema.NullOr(Schema.Struct({ path: text(1024), bytes: Schema.Number })),
});
export type PcbPinMapResult = typeof PcbPinMapResult.Type;
const formats = ["markdown", "c", "rust", "micropython", "circuitpython", "arduino"] as const;
const keywords = new Set(
  "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while alignas alignof bool class namespace new delete nullptr template this true false public private protected virtual fn let mut impl trait type match mod pub use crate self super loop move ref async await dyn where as in is and or not def from import pass None True False try except finally lambda global nonlocal raise with yield assert del elif HIGH LOW INPUT OUTPUT INPUT_PULLUP LED_BUILTIN"
    .toLowerCase()
    .split(" "),
);
const isGroundNet = (net: string) =>
  /^(?:[ADP]?GND\w*|VSS\w*|0V)$/i.test(net.split("/").at(-1) ?? "");
const isPowerNet = (net: string) =>
  /^(?:[+-]?(?:VCC|VDD|VEE|VBUS|VBAT|VIN|VOUT|\d+V\d*|V\d+V\d*))(?:\b|_)/i.test(
    net.split("/").at(-1) ?? "",
  );
export function pinKind(pin: PcbComponent["pins"][number]): PcbPinMapRow["kind"] {
  if (pin.type?.endsWith("no_connect") || pin.net.startsWith("unconnected-(")) return "no-connect";
  if (!pin.net) return "unconnected";
  if (isGroundNet(pin.net) || (pin.type?.startsWith("power_in") && isGroundNet(pin.name)))
    return "ground";
  if (/^power_(?:in|out)/.test(pin.type ?? "") || isPowerNet(pin.net)) return "power";
  return "signal";
}
export function validateIdentifier(name: string, format: PcbPinMapFormat = "c") {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))
    return "Use a letter or underscore, then letters, digits or underscores (64 characters maximum).";
  if (keywords.has(name.toLowerCase()))
    return `This name is reserved in a generated language or board core (${format}).`;
  return null;
}
export function sanitizeIdentifier(raw: string, taken: Set<string>) {
  let name =
    raw
      .replace(/~\{([^}]+)\}/g, "$1_N")
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "PIN";
  if (/^\d/.test(name)) name = `PIN_${name}`;
  if (keywords.has(name.toLowerCase())) name += "_PIN";
  name = name.slice(0, 64);
  let candidate = name,
    count = 2;
  while (taken.has(candidate)) {
    const suffix = `_${count++}`;
    candidate = name.slice(0, 64 - suffix.length) + suffix;
  }
  taken.add(candidate);
  return candidate;
}
function namedFamily(name: string): { family: PcbPinFamily; variant?: string } | null {
  if (/RP2040|RP2350|RP235[04]/i.test(name)) return { family: "rp2" };
  if (/ESP32-?S3/i.test(name)) return { family: "esp32s3", variant: "s3" };
  if (/ESP32/i.test(name))
    return {
      family: "esp32",
      variant: /ESP32-?(C3|C6|S2|H2)/i.exec(name)?.[1]?.toLowerCase() ?? "classic",
    };
  if (/^STM32/i.test(name)) return { family: "stm32" };
  if (/^AT(?:mega|tiny)/i.test(name)) return { family: "avr", variant: name };
  return null;
}
export function detectFamily(component: PcbComponent): {
  family: PcbPinFamily;
  detectedFrom: PcbPinMap["detectedFrom"];
  variant?: string;
} {
  for (const [from, name] of [
    ["symbol", component.symbol?.split(":").at(-1)],
    ["value", component.value],
  ] as const) {
    const match = namedFamily(name ?? "");
    if (match) return { ...match, detectedFrom: from };
  }
  const scores = (["rp2", "esp32", "stm32"] as const)
    .map((family) => ({
      family,
      count: component.pins.filter((p) => parseGpio(family, p.baseName ?? p.name) !== null).length,
    }))
    .sort((a, b) => b.count - a.count);
  if (scores[0] && scores[0].count >= 4)
    return { family: scores[0].family, detectedFrom: "pin-names" };
  return { family: "pins", detectedFrom: "default" };
}
export function parseGpio(
  family: PcbPinFamily,
  name: string,
  variant?: string,
): PcbPinMapRow["gpio"] {
  if (family === "rp2" || family === "esp32" || family === "esp32s3") {
    const match = (
      family === "rp2" ? /^(?:GPIO|GP)(\d{1,2})(?:_ADC\d)?$/ : /^(?:GPIO|IO)(\d{1,2})$/
    ).exec(name);
    let number = match ? Number(match[1]) : null;
    if (number === null && family !== "rp2") {
      const special =
        family === "esp32s3"
          ? { TXD0: 43, RXD0: 44 }
          : variant === undefined || variant === "classic"
            ? { TXD0: 1, RXD0: 3, SENSOR_VP: 36, SENSOR_VN: 39 }
            : {};
      number = special[name as keyof typeof special] ?? null;
    }
    return number === null
      ? null
      : { label: String(number), port: null, number, arduino: String(number) };
  }
  if (family === "stm32" || family === "avr") {
    const match = (
      family === "stm32" ? /^P([A-K])(\d{1,2})(?:[-_/].*)?$/ : /^P([A-H])([0-7])(?:[-_/].*)?$/
    ).exec(name);
    if (!match) return null;
    const port = match[1]!,
      number = Number(match[2]);
    if (family === "stm32" && number > 15) return null;
    const uno = /^ATmega(?:328P?|168P?)(?:$|[-_])/i.test(variant ?? "");
    const arduino =
      family === "stm32"
        ? `P${port}${number}`
        : uno
          ? port === "D"
            ? `D${number}`
            : port === "B" && number <= 5
              ? `D${8 + number}`
              : port === "C" && number <= 5
                ? `A${number}`
                : undefined
          : undefined;
    return {
      label: `P${port}${number}${family === "avr" && arduino ? ` (${arduino})` : ""}`,
      port,
      number,
      ...(arduino ? { arduino } : {}),
    };
  }
  return null;
}
export function buildPinMap(
  inspection: PcbInspection,
  reference: string,
  options: {
    family?: PcbPinFamily | undefined;
    names?: Readonly<Record<string, string>> | undefined;
    includePower: boolean;
    includeNoConnect: boolean;
    netIndex?: ReadonlyMap<string, readonly { reference: string; pin: string }[]>;
  },
): PcbPinMap | null {
  const component = inspection.components.find((c) => c.reference === reference);
  if (!component) return null;
  const detected = detectFamily(component),
    family = options.family ?? detected.family;
  const netIndex = options.netIndex ?? new Map(inspection.nets.map((n) => [n.name, n.members]));
  const taken = new Set<string>(),
    warnings: string[] = [];
  const rows = component.pins.map((pin): PcbPinMapRow => {
    const kind = pinKind(pin),
      gpio =
        parseGpio(family, pin.name, detected.variant) ??
        (pin.baseName ? parseGpio(family, pin.baseName, detected.variant) : null);
    const others = (netIndex.get(pin.net) ?? []).filter((m) => m.reference !== reference);
    const raw =
      pin.net && !/^(?:Net-\(|unconnected-\()/.test(pin.net)
        ? pin.net.split("/").at(-1)!
        : pin.name || `PIN_${pin.number}`;
    if (!gpio && kind === "signal" && family !== "pins")
      warnings.push(
        `Pin ${pin.number} (${pin.name}): GPIO could not be determined from the pin name.`,
      );
    return {
      pin: pin.number,
      pad: pin.pcb ? pin.number : null,
      name: pin.name,
      ...(pin.baseName ? { baseName: pin.baseName } : {}),
      net: pin.net,
      kind,
      gpio,
      identifier:
        options.names?.[pin.number] ??
        sanitizeIdentifier(family === "pins" ? `${reference}_${raw}` : raw, taken),
      included:
        kind === "signal" ||
        (kind === "power" || kind === "ground" ? options.includePower : options.includeNoConnect),
      others: others.slice(0, 64),
      othersTotal: others.length,
    };
  });
  return {
    reference,
    value: component.value,
    ...(component.symbol ? { symbol: component.symbol } : {}),
    family,
    detectedFrom: options.family ? "override" : detected.detectedFrom,
    rows,
    warnings: warnings.slice(0, 50),
    formats: formats.map((format) => {
      const available =
        format === "micropython"
          ? ["rp2", "esp32", "esp32s3", "stm32"].includes(family)
          : format === "circuitpython"
            ? ["rp2", "esp32", "esp32s3"].includes(family)
            : format === "arduino" && family === "avr"
              ? /^ATmega(?:328P?|168P?)(?:$|[-_])/i.test(detected.variant ?? "")
              : true;
      return {
        format,
        available,
        ...(!available
          ? { reason: `${format} output is unavailable for this part and board core.` }
          : {}),
      };
    }),
  };
}
const safeComment = (text: string) => text.replace(/[\r\n]/g, " ").replaceAll("*/", "* /");
const md = (text: string) => text.replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
export function renderPinMap(
  map: PcbPinMap,
  format: PcbPinMapFormat,
  context: { designId: string; sourceHash: string },
) {
  const rows = map.rows.filter((r) => r.included);
  if (format === "markdown")
    return `### ${md(map.reference)} ${md(map.value)} pin map\n\n| Pin | Pad | Name | GPIO | Net | Also on net | Constant |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows
      .map(
        (r) =>
          `| ${[
            r.pin,
            r.pad ?? "Not placed",
            r.name,
            r.gpio?.label ?? "",
            r.net,
            r.others
              .slice(0, 8)
              .map((m) => `${m.reference}.${m.pin}`)
              .join(", ") + (r.othersTotal > 8 ? ` +${r.othersTotal - 8} more` : ""),
            r.identifier,
          ]
            .map(md)
            .join(" | ")} |`,
      )
      .join("\n")}\n`;
  const prefix = format === "micropython" || format === "circuitpython" ? "#" : "//";
  const header = [
    `${context.designId}: ${map.reference} ${map.value}; family ${map.family}; source ${context.sourceHash}`,
    "Numbers come from symbol pin names, not datasheets. Verify before first power.",
    "Arduino: Arduino-Pico, Arduino-ESP32, STM32duino or Uno core as applicable.",
    ...(format === "circuitpython"
      ? ["CPU pin names: check against your CircuitPython port."]
      : []),
  ]
    .map((s) => `${prefix} ${safeComment(s)}`)
    .join("\n");
  const body = rows.flatMap((r) => {
    const id = r.identifier,
      gpio = r.gpio;
    if (!gpio && map.family !== "pins")
      return [`${prefix} Pin ${safeComment(r.pin)} ${safeComment(r.name)}: GPIO unknown; omitted.`];
    const number = gpio?.number ?? Number(r.pin);
    if (!Number.isInteger(number))
      return [`${prefix} Pin ${safeComment(r.pin)}: non-numeric pin; omitted.`];
    const connector = map.family === "pins" ? ` ${prefix} Connector pin, not a GPIO.` : "";
    if (format === "c")
      return gpio?.port
        ? map.family === "avr"
          ? [
              `#define ${id}_PORT PORT${gpio.port}`,
              `#define ${id}_DDR DDR${gpio.port}`,
              `#define ${id}_PINR PIN${gpio.port}`,
              `#define ${id}_BIT ${number}`,
            ]
          : [`#define ${id}_PORT GPIO${gpio.port}`, `#define ${id}_PIN GPIO_PIN_${number}`]
        : [`#define ${id} ${number}${connector}`];
    if (format === "rust")
      return gpio?.port
        ? [`pub const ${id}_PORT: char = '${gpio.port}';`, `pub const ${id}_PIN: u8 = ${number};`]
        : [`pub const ${id}: u8 = ${number};${connector}`];
    if (format === "arduino") {
      if (map.family === "avr" && !gpio?.arduino)
        return [`${prefix} ${safeComment(r.name)}: Arduino mapping unknown; omitted.`];
      const value = gpio?.arduino?.startsWith("D")
        ? gpio.arduino.slice(1)
        : (gpio?.arduino ?? String(number));
      return [
        `constexpr ${map.family === "stm32" ? "uint32_t" : "uint8_t"} ${id} = ${value};${connector}`,
      ];
    }
    if (format === "micropython")
      return [`${id} = ${gpio?.port ? `Pin.cpu.${gpio.port}${number}` : number}`];
    return [`${id} = microcontroller.pin.GPIO${number}`];
  });
  return `${header}\n${format === "c" ? "#pragma once\n" : format === "arduino" ? "#pragma once\n#include <Arduino.h>\n" : format === "micropython" && map.family === "stm32" ? "from machine import Pin\n" : format === "circuitpython" ? "import microcontroller\n" : ""}\n${body.join("\n")}\n`;
}
export const pinMapFileName = (format: PcbPinMapFormat) =>
  format === "c" || format === "arduino"
    ? "pins.h"
    : format === "rust"
      ? "pins.rs"
      : format === "micropython" || format === "circuitpython"
        ? "pins.py"
        : null;
