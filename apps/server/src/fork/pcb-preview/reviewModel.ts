import type { PcbInspection, PcbReviewLocation } from "@t3tools/contracts/fork";
import { parseSexp, child, children, atom } from "./semantics.ts";
import { REGULATORS } from "./reviewData.ts";
export type PinType =
  | "input"
  | "output"
  | "bidirectional"
  | "tri_state"
  | "passive"
  | "free"
  | "unspecified"
  | "power_in"
  | "power_out"
  | "open_collector"
  | "open_emitter"
  | "no_connect"
  | "unknown";
export type PartKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "ferrite"
  | "led"
  | "diode"
  | "tvs"
  | "ic"
  | "regulator"
  | "connector"
  | "switch"
  | "crystal"
  | "transistor"
  | "module"
  | "other";
export type ReviewPin = {
  part: string;
  number: string;
  name: string;
  net: string;
  type: PinType;
  unconnected: boolean;
  noConnectFlag: boolean;
  hints: ReadonlySet<string>;
  recommendedFarads?: number | undefined;
  schematic?: PcbReviewLocation | undefined;
  board?: PcbReviewLocation | undefined;
};
export type ReviewPart = {
  ref: string;
  value: string;
  libId: string;
  mpn: string;
  kind: PartKind;
  ohms?: number | undefined;
  farads?: number | undefined;
  ratedVolts?: number | undefined;
  pins: ReviewPin[];
  schematic?: PcbReviewLocation | undefined;
  board?: PcbReviewLocation | undefined;
};
export type ReviewNet = {
  name: string;
  pins: ReviewPin[];
  role: "ground" | "power" | "signal";
  volts?: number | undefined;
  voltsAssumed: boolean;
};
export type ReviewModel = {
  designKind: "kicad" | "tscircuit";
  parts: ReadonlyMap<string, ReviewPart>;
  nets: ReadonlyMap<string, ReviewNet>;
  has: { pinTypes: boolean; libIds: boolean; boardPositions: boolean; noConnects: boolean };
  notices: string[];
};
const TYPES = new Set<string>([
  "input",
  "output",
  "bidirectional",
  "tri_state",
  "passive",
  "free",
  "unspecified",
  "power_in",
  "power_out",
  "open_collector",
  "open_emitter",
  "no_connect",
]);
export function classify(part: {
  ref: string;
  value: string;
  libId: string;
  mpn: string;
}): PartKind {
  const text = `${part.libId} ${part.value} ${part.mpn}`;
  if (/TVS|ESD|PRTR|USBLC|TPD\d/i.test(text)) return "tvs";
  if (
    /Regulator_|simple_voltage_regulator/i.test(text) ||
    REGULATORS.some((r) => r.match.test(text))
  )
    return "regulator";
  if (/module|RF_Module|ESP32.*WROOM/i.test(text)) return "module";
  if (/simple_resistor|Device:R(?:_|\b)|Resistor/i.test(text)) return "resistor";
  if (/simple_capacitor|Device:C(?:_|\b)|Capacitor/i.test(text)) return "capacitor";
  if (/Ferrite/i.test(text)) return "ferrite";
  if (/simple_inductor|Device:L(?:_|\b)|Inductor/i.test(text)) return "inductor";
  if (/simple_led|Device:LED|\bLED\b/i.test(text) && !/WS281|SK681|LED_Driver/i.test(text))
    return "led";
  if (/simple_diode|Device:D(?:_|\b)|Diode/i.test(text)) return "diode";
  if (/connector|usb_c|USB/i.test(text)) return "connector";
  if (/simple_switch|SW_|switch/i.test(text)) return "switch";
  if (/crystal|oscillator/i.test(text)) return "crystal";
  if (/transistor|mosfet|bjt/i.test(text)) return "transistor";
  if (/simple_chip|\bchip\b|MCU_|Interface_|Amplifier_|Logic_/i.test(text)) return "ic";
  return /^R\d/i.test(part.ref)
    ? "resistor"
    : /^C\d/i.test(part.ref)
      ? "capacitor"
      : /^L\d/i.test(part.ref)
        ? "inductor"
        : /^(J|P)\d/i.test(part.ref)
          ? "connector"
          : /^SW\d/i.test(part.ref)
            ? "switch"
            : /^Q\d/i.test(part.ref)
              ? "transistor"
              : /^U\d/i.test(part.ref)
                ? "ic"
                : "other";
}
/** SI and European notation. A suffix such as a voltage rating never changes the value. */
export function parseValue(text: string, unit: "ohms" | "farads") {
  const rated = /(?:\/|\s)(\d+(?:\.\d+)?)\s*V\b/i.exec(text);
  const token = /^\s*(\d+(?:\.\d+)?)([pnuµmkKMGR]?)(\d*)(?:\s*(?:F|Ω|ohms?))?(?=\s|\/|$)/i.exec(
    text,
  );
  if (!token) return undefined;
  const prefix = token[2] ?? "";
  const scale: Record<string, number> = {
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    µ: 1e-6,
    m: 1e-3,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    R: 1,
  };
  if (unit === "farads" && /[kKMGR]/.test(prefix)) return undefined;
  const value = Number(token[3] ? `${token[1]}.${token[3]}` : token[1]) * (scale[prefix] ?? 1);
  return { value, ...(rated ? { volts: Number(rated[1]) } : {}) };
}
export function netVolts(name: string) {
  if (/^VBUS$/i.test(name)) return { volts: 5, voltsAssumed: true };
  const european = /(?:^|_)[+]?([0-9]+)V([0-9]+)(?:$|_)/i.exec(name);
  const decimal = /^\+?(\d+(?:\.\d+)?)V$/i.exec(name);
  return {
    volts: european
      ? Number(`${european[1]}.${european[2]}`)
      : decimal
        ? Number(decimal[1])
        : undefined,
    voltsAssumed: false,
  };
}
export function netRole(
  name: string,
  flags: { is_ground?: boolean | undefined; is_power?: boolean | undefined } = {},
): ReviewNet["role"] {
  if (flags.is_ground || /^(?:[ADP]?GND[AD]?|VSS\w*|0V)$/i.test(name)) return "ground";
  if (
    flags.is_power ||
    netVolts(name).volts !== undefined ||
    /^(?:VCC|VDD|AVDD|DVDD|VBUS|VBAT|VIN|VSYS|V\+)/i.test(name)
  )
    return "power";
  return "signal";
}
function base(inspection: PcbInspection, designKind: ReviewModel["designKind"]): ReviewModel {
  const parts = new Map<string, ReviewPart>();
  for (const c of inspection.components) {
    const part: ReviewPart = {
      ref: c.reference,
      value: c.value,
      libId: c.symbol ?? "",
      mpn: "",
      kind: "other",
      schematic: c.schematic,
      board: c.pcb,
      pins: c.pins.map((p) => ({
        part: c.reference,
        number: p.number,
        name: p.name,
        net: p.net,
        type: TYPES.has(p.type ?? "") ? (p.type as PinType) : "unknown",
        unconnected: !p.net,
        noConnectFlag: false,
        hints: new Set(),
        schematic: p.schematic,
        board: p.pcb,
      })),
    };
    parts.set(part.ref, part);
  }
  return {
    designKind,
    parts,
    nets: new Map(),
    has: {
      pinTypes: false,
      libIds: false,
      boardPositions: inspection.components.some((c) => !!c.pcb),
      noConnects: false,
    },
    notices: [],
  };
}
function finalize(
  model: ReviewModel,
  flags = new Map<
    string,
    { is_ground?: boolean | undefined; is_power?: boolean | undefined; volts?: number | undefined }
  >(),
) {
  const nets = new Map<string, ReviewNet>();
  for (const p of model.parts.values()) {
    p.kind = classify(p);
    p.ohms ??= parseValue(p.value, "ohms")?.value;
    p.farads ??= parseValue(p.value, "farads")?.value;
    p.ratedVolts ??= parseValue(p.value, "farads")?.volts;
    for (const pin of p.pins) {
      if (!pin.net) continue;
      let net = nets.get(pin.net);
      if (!net) {
        const f = flags.get(pin.net);
        net = { name: pin.net, pins: [], role: netRole(pin.net, f), ...netVolts(pin.net) };
        if (f?.volts !== undefined) {
          net.volts = f.volts;
          net.voltsAssumed = false;
        }
        nets.set(pin.net, net);
      }
      net.pins.push(pin);
      if (pin.type === "power_out" && net.role !== "ground") net.role = "power";
    }
  }
  model.nets = nets;
  model.has.libIds = [...model.parts.values()].some((p) => !!p.libId);
  return model;
}
export function kicadReviewModel(
  inspection: PcbInspection,
  netlist: string | null,
  noConnects: readonly PcbReviewLocation[] = [],
): ReviewModel {
  const model = base(inspection, "kicad");
  if (netlist) {
    const root = parseSexp(netlist)[0];
    if (!Array.isArray(root) || root[0] !== "export") throw new Error("Invalid KiCad netlist.");
    const parts = model.parts as Map<string, ReviewPart>;
    for (const comp of children(child(root, "components"), "comp")) {
      const ref = atom(child(comp, "ref"));
      if (ref.startsWith("#")) continue;
      const lib = child(comp, "libsource");
      const p = parts.get(ref) ?? { ref, value: "", libId: "", mpn: "", kind: "other", pins: [] };
      p.value = atom(child(comp, "value")) || p.value;
      p.libId =
        [atom(child(lib, "lib")), atom(child(lib, "part"))].filter(Boolean).join(":") || p.libId;
      for (const field of children(child(comp, "fields"), "field")) {
        const name = atom(child(field, "name"));
        if (/^(MPN|Manufacturer_Part_Number)$/i.test(name)) p.mpn = atom(field, 2);
        if (/^Voltage$/i.test(name)) p.ratedVolts = Number.parseFloat(atom(field, 2));
      }
      parts.set(ref, p);
    }
    for (const net of children(child(root, "nets"), "net")) {
      const name = atom(child(net, "name"));
      const nodes = children(net, "node").filter((n) => !atom(child(n, "ref")).startsWith("#"));
      for (const node of nodes) {
        const p = parts.get(atom(child(node, "ref")));
        if (!p) continue;
        const number = atom(child(node, "pin"));
        let pin = p.pins.find((p) => p.number === number);
        if (!pin) {
          pin = {
            part: p.ref,
            number,
            name: "",
            net: "",
            type: "unknown",
            unconnected: false,
            noConnectFlag: false,
            hints: new Set(),
          };
          p.pins.push(pin);
        }
        const [type, ...suffix] = atom(child(node, "pintype")).split("+");
        pin.type = TYPES.has(type ?? "") ? (type as PinType) : "unknown";
        pin.name = atom(child(node, "pinfunction")) || pin.name;
        pin.net = name;
        pin.noConnectFlag = suffix.includes("no_connect");
        pin.unconnected =
          pin.noConnectFlag || nodes.length === 1 || name.startsWith("unconnected-");
      }
    }
    model.has.pinTypes = [...parts.values()].some((p) => p.pins.some((p) => p.type !== "unknown"));
  } else
    model.notices.push(
      "Pin types are unavailable because the netlist export failed. Rules that need them use names where possible.",
    );
  for (const p of model.parts.values())
    for (const pin of p.pins)
      if (
        pin.schematic &&
        noConnects.some(
          (n) =>
            n.sheet === pin.schematic!.sheet &&
            Math.hypot(n.x - pin.schematic!.x, n.y - pin.schematic!.y) <= 0.01,
        )
      )
        pin.noConnectFlag = true;
  model.has.noConnects = netlist !== null;
  return finalize(model);
}
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export function circuitJsonReviewModel(json: unknown, inspection: PcbInspection): ReviewModel {
  if (!Array.isArray(json)) throw new Error("Invalid Circuit JSON.");
  const entries = json.map(record);
  const model = base(inspection, "tscircuit");
  let chipPorts = 0,
    typed = 0;
  const partsById = new Map(
    inspection.components.map((c) => [c.id, model.parts.get(c.reference)!]),
  );
  const portsByComponent = new Map<unknown, Record<string, unknown>[]>();
  for (const port of entries)
    if (port.type === "source_port") {
      const ports = portsByComponent.get(port.source_component_id) ?? [];
      ports.push(port);
      portsByComponent.set(port.source_component_id, ports);
    }
  for (const c of entries.filter((e) => e.type === "source_component")) {
    const p = model.parts.get(String(c.name)) ?? partsById.get(String(c.source_component_id));
    if (!p) continue;
    p.libId = String(c.ftype ?? "");
    p.mpn = String(c.manufacturer_part_number ?? "");
    p.value = String(c.display_value ?? c.name ?? p.value);
    if (typeof c.resistance === "number") p.ohms = c.resistance;
    if (typeof c.capacitance === "number") p.farads = c.capacitance;
    if (typeof c.max_voltage_rating === "number") p.ratedVolts = c.max_voltage_rating;
    p.kind = classify(p);
    if (c.standard) p.libId += ` ${String(c.standard)}`;
    const pinsByNumber = new Map(p.pins.map((pin) => [pin.number, pin]));
    for (const port of portsByComponent.get(c.source_component_id) ?? []) {
      const pin = pinsByNumber.get(String(port.pin_number ?? port.name ?? port.source_port_id));
      if (!pin) continue;
      pin.type = port.do_not_connect
        ? "no_connect"
        : port.provides_power
          ? "power_out"
          : port.requires_power
            ? "power_in"
            : port.is_passive
              ? "passive"
              : port.is_bidirectional || (port.is_input && port.is_output)
                ? "bidirectional"
                : port.is_output
                  ? "output"
                  : port.is_input
                    ? "input"
                    : "unknown";
      pin.noConnectFlag = port.do_not_connect === true;
      pin.hints = new Set([
        ...Object.keys(port).filter((k) => port[k] === true),
        ...(Array.isArray(port.port_hints)
          ? port.port_hints.filter((v): v is string => typeof v === "string")
          : []),
      ]);
      if (typeof port.recommended_decoupling_capacitor_capacitance === "number")
        pin.recommendedFarads = port.recommended_decoupling_capacitor_capacitance;
      if (p.kind === "ic") {
        chipPorts++;
        if (pin.type !== "unknown") typed++;
      }
    }
  }
  const flags = new Map<
    string,
    { is_ground?: boolean | undefined; is_power?: boolean | undefined; volts?: number | undefined }
  >();
  for (const n of entries.filter((e) => e.type === "source_net"))
    flags.set(String(n.name), { is_ground: n.is_ground === true, is_power: n.is_power === true });
  for (const c of entries.filter(
    (e) =>
      e.type === "source_component" &&
      e.ftype === "simple_power_source" &&
      typeof e.voltage === "number",
  )) {
    const p = [...model.parts.values()].find((p) => p.ref === c.name);
    for (const pin of p?.pins ?? [])
      if (netRole(pin.net) !== "ground")
        flags.set(pin.net, { is_power: true, volts: c.voltage as number });
  }
  model.has.pinTypes = chipPorts > 0 && typed >= chipPorts / 2;
  model.has.noConnects = true;
  if (!model.has.pinTypes)
    model.notices.push("Some parts do not declare pin roles; rules fall back to pin names.");
  return finalize(model, flags);
}
/** Small series elements bridge protection paths. Never traverse a pull-up or an entire circuit. */
export function throughSeries(name: string, model: ReviewModel): ReadonlySet<string> {
  const nets = new Set([name]),
    queue = [name];
  while (queue.length) {
    const next = queue.shift()!;
    for (const pin of model.nets.get(next)?.pins ?? []) {
      const p = model.parts.get(pin.part)!;
      if (
        p.pins.length !== 2 ||
        !(
          p.kind === "ferrite" ||
          p.kind === "inductor" ||
          (p.kind === "resistor" && p.ohms !== undefined && p.ohms <= 100)
        )
      )
        continue;
      for (const end of p.pins)
        if (end.net && !nets.has(end.net)) {
          nets.add(end.net);
          queue.push(end.net);
        }
    }
  }
  return nets;
}
