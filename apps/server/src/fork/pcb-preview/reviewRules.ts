import type { PcbReviewFinding, PcbReviewSettings, PcbReviewResult } from "@t3tools/contracts/fork";
import { I2C, RESET, GPIO, USB_SIGNAL, UART_TX, UART_RX, REGULATORS } from "./reviewData.ts";
import { throughSeries, type ReviewModel, type ReviewPart, type ReviewPin } from "./reviewModel.ts";
export const REVIEW_RULES_VERSION = 1;
type Params = Readonly<Record<string, number | string>>;
type RawFinding = Omit<PcbReviewFinding, "id" | "rule" | "waived"> & { discriminator?: string };
type Param = {
  default: number | string;
  min?: number;
  max?: number;
  options?: readonly string[];
  label: string;
};
type Rule = {
  id: string;
  title: string;
  defaultSeverity: PcbReviewFinding["severity"];
  defaultEnabled: boolean;
  needs: readonly (keyof ReviewModel["has"])[];
  params: Record<string, Param>;
  match: (model: ReviewModel, params: Params) => RawFinding[];
};
const drive = (p: ReviewPin) =>
  ["output", "bidirectional", "tri_state", "power_out", "open_collector", "open_emitter"].includes(
    p.type,
  );
const links = (m: ReviewModel, net: string, kind: ReviewPart["kind"], role: "power" | "ground") =>
  (m.nets.get(net)?.pins ?? []).flatMap((pin) => {
    const p = m.parts.get(pin.part)!;
    return p.kind === kind &&
      p.pins.some((other) => other.net !== net && m.nets.get(other.net)?.role === role)
      ? [p]
      : [];
  });
const held = (m: ReviewModel, net: string) =>
  links(m, net, "resistor", "power").length + links(m, net, "resistor", "ground").length > 0;
function finding(
  part: ReviewPart | undefined,
  nets: string[],
  message: string,
  why: string,
  fix: string,
  severity: PcbReviewFinding["severity"] = "warning",
  pins: readonly ReviewPin[] = [],
  parts?: string[],
  discriminator?: string,
): RawFinding {
  const anchor = pins[0];
  return {
    message,
    why,
    fix,
    severity,
    parts: (parts ?? (part ? [part.ref] : pins.map((p) => p.part))).slice(0, 20),
    nets: nets.slice(0, 10),
    ...((anchor?.schematic ?? part?.schematic)
      ? { schematic: anchor?.schematic ?? part!.schematic }
      : {}),
    ...((anchor?.board ?? part?.board) ? { board: anchor?.board ?? part!.board } : {}),
    ...(discriminator ? { discriminator } : {}),
  };
}
const describe = (pins: readonly ReviewPin[]) =>
  pins
    .slice(0, 20)
    .map((p) => `${p.part} pin ${p.number}${p.name ? ` (${p.name})` : ""}`)
    .join(", ");
// Remote modules and SPI displays sometimes use SDA names. Connector findings are notes.
function i2c(m: ReviewModel): RawFinding[] {
  const out: RawFinding[] = [];
  for (const net of m.nets.values())
    if (
      (I2C.test(net.name) ||
        net.pins.some(
          (p) => I2C.test(p.name) || [...p.hints].some((h) => /i2c.*(?:sda|scl)/i.test(h)),
        )) &&
      !links(m, net.name, "resistor", "power").length
    ) {
      const connector = net.pins.some((p) => m.parts.get(p.part)?.kind === "connector");
      const anchor = net.pins.find((p) => m.parts.get(p.part)?.kind === "ic") ?? net.pins[0];
      out.push(
        finding(
          anchor ? m.parts.get(anchor.part) : undefined,
          [net.name],
          `${net.name} has no pull-up resistor to a supply.`,
          `Net ${net.name} connects ${describe(net.pins)}. No resistor joins it to a supply net.${connector ? " Pull-ups may be on the other board." : ""}`,
          "Add a pull-up, often 2.2 k to 10 k, to the bus supply.",
          connector ? "info" : "warning",
          anchor ? [anchor] : [],
          net.pins.map((p) => p.part),
        ),
      );
    }
  return out;
}
// Modules are skipped. Only capacitors on the IC's own supply net count for distance.
function decoupling(m: ReviewModel, params: Params): RawFinding[] {
  const out: RawFinding[] = [];
  for (const part of m.parts.values()) {
    if (part.kind !== "ic" || part.pins.length < 3) continue;
    const groups = new Map<string, ReviewPin[]>();
    for (const pin of part.pins)
      if (
        pin.net &&
        m.nets.get(pin.net)?.role !== "ground" &&
        (pin.type === "power_in" ||
          pin.hints.has("should_have_decoupling_capacitor") ||
          (pin.type === "unknown" && /^(?:[AD]?VDD\w*|VCC\w*|V\+|VBAT)$/i.test(pin.name)))
      )
        groups.set(pin.net, [...(groups.get(pin.net) ?? []), pin]);
    for (const [net, pins] of groups) {
      const caps = [...new Set(links(m, net, "capacitor", "ground"))];
      const recommendation = Math.max(0, ...pins.map((p) => p.recommendedFarads ?? 0));
      if (!caps.length || recommendation > caps.reduce((n, c) => n + (c.farads ?? 0), 0)) {
        out.push(
          finding(
            part,
            [net],
            `${part.ref} ${net} ${caps.length ? "has less decoupling than recommended" : "has no decoupling capacitor to ground"}.`,
            `${describe(pins)} uses ${net}; ${caps.length} capacitors connect this supply to ground.`,
            "Add decoupling on this supply near the IC power pins.",
            "warning",
            pins,
            undefined,
            net,
          ),
        );
        continue;
      }
      let worst: { distance: number; pin: ReviewPin; cap: ReviewPart } | undefined;
      for (const pin of pins) {
        if (!pin.board) continue;
        const distances = caps
          .flatMap((c) =>
            c.pins
              .filter((p) => p.net === net && p.board)
              .map((p) => ({
                distance: Math.hypot(pin.board!.x - p.board!.x, pin.board!.y - p.board!.y),
                pin,
                cap: c,
              })),
          )
          .sort((a, b) => a.distance - b.distance);
        if (distances[0] && (!worst || distances[0].distance > worst.distance))
          worst = distances[0];
      }
      if (worst && worst.distance > Number(params.maxDistanceMm))
        out.push(
          finding(
            part,
            [net],
            `${worst.cap.ref} is ${worst.distance.toFixed(1)} mm from ${part.ref} pin ${worst.pin.number} (${worst.pin.name}).`,
            `This is the nearest capacitor pad on ${net}.`,
            `Place a capacitor within ${params.maxDistanceMm} mm of the pin.`,
            "info",
            [worst.pin],
            [part.ref, worst.cap.ref],
            `distance:${net}`,
          ),
        );
    }
  }
  return out;
}
// Integrated ESD protection and unrecognized protection arrays can cause false positives.
function esd(m: ReviewModel, params: Params): RawFinding[] {
  const out: RawFinding[] = [];
  for (const p of m.parts.values()) {
    if (p.kind !== "connector") continue;
    const usb = /USB/i.test(`${p.libId} ${p.value} ${p.mpn}`);
    if (!usb && params.scope !== "all-connectors") continue;
    const pins = p.pins.filter(
      (pin) =>
        pin.net && m.nets.get(pin.net)?.role === "signal" && (!usb || USB_SIGNAL.test(pin.name)),
    );
    const missing = pins.filter(
      (pin) =>
        ![...throughSeries(pin.net, m)].some((net) =>
          m.nets.get(net)?.pins.some((p) => m.parts.get(p.part)?.kind === "tvs"),
        ),
    );
    if (missing.length)
      out.push(
        finding(
          p,
          [...new Set(missing.map((p) => p.net))],
          `${p.ref}${usb ? " (USB)" : ""} has no ESD protection on ${missing.map((p) => p.name || p.number).join(", ")}.`,
          `No TVS connects these nets, including through small series elements: ${missing.map((p) => p.net).join(", ")}.`,
          "Add a suitable low-capacitance ESD array between the connector and the IC.",
          "warning",
          missing,
        ),
      );
  }
  return out;
}
// Libraries may omit internal pulls. Bare unconnected inputs are left to ERC.
function floating(m: ReviewModel): RawFinding[] {
  const out: RawFinding[] = [];
  for (const part of m.parts.values())
    for (const pin of part.pins) {
      const net = m.nets.get(pin.net);
      const external = pin.hints.has("needs_external_pullup");
      const explicit = pin.type === "input" && pin.noConnectFlag;
      const passive = net?.pins.some((p) =>
        ["connector", "switch"].includes(m.parts.get(p.part)?.kind ?? ""),
      );
      const gpio = pin.type === "bidirectional" && GPIO.test(pin.name);
      const noDriver = net && !net.pins.some((p) => p !== pin && drive(p));
      if (
        !explicit &&
        !(external && !links(m, pin.net, "resistor", "power").length) &&
        !((pin.type === "input" || gpio) && passive && noDriver && !held(m, pin.net))
      )
        continue;
      if (pin.hints.has("can_use_internal_pullup") && !external) continue;
      out.push(
        finding(
          part,
          [pin.net],
          `${part.ref} pin ${pin.number} (${pin.name}) can float${gpio ? " unless firmware enables an internal pull-up" : ""}.`,
          explicit
            ? "An input has an explicit no-connect flag."
            : `${describe(net?.pins ?? [pin])} has no drive or external pull.`,
          "Add a pull-up or pull-down, or enable an internal pull in firmware.",
          gpio ? "info" : "warning",
          [pin],
          undefined,
          pin.number,
        ),
      );
    }
  return out;
}
// Internal reset pulls are common, so these are notes rather than warnings.
function reset(m: ReviewModel): RawFinding[] {
  const out: RawFinding[] = [];
  for (const p of m.parts.values())
    if (p.kind === "ic")
      for (const pin of p.pins)
        if (RESET.test(pin.name) || (/ESP32/i.test(p.value) && /^(EN|CHIP_PU)$/i.test(pin.name))) {
          if (
            held(m, pin.net) ||
            links(m, pin.net, "capacitor", "ground").length ||
            m.nets.get(pin.net)?.pins.some((i) => i.part !== p.ref && drive(i))
          )
            continue;
          out.push(
            finding(
              p,
              [pin.net],
              `${p.ref} reset pin ${pin.name} has no pull-up or capacitor.`,
              `${describe([pin])} has no external reset bias or driver.`,
              "Check the datasheet for an internal pull. A 10 k pull-up and 100 nF to ground often make reset dependable.",
              "info",
              [pin],
              undefined,
              pin.number,
            ),
          );
        }
  return out;
}
// A transistor or recognized current driver terminates the walk; it is not treated as a resistor.
function leds(m: ReviewModel): RawFinding[] {
  const out: RawFinding[] = [];
  const visited = new Set<string>();
  for (const part of m.parts.values()) {
    if (part.kind !== "led" || visited.has(part.ref)) continue;
    const queue = [part],
      string = new Set([part.ref]);
    let limited = false,
      unsafeEnd = false;
    while (queue.length) {
      const led = queue.shift()!;
      visited.add(led.ref);
      for (const pin of led.pins) {
        const net = m.nets.get(pin.net);
        if (!net) continue;
        for (const end of net.pins) {
          if (end.part === led.ref) continue;
          const p = m.parts.get(end.part)!;
          if (
            p.kind === "resistor" ||
            p.kind === "inductor" ||
            p.kind === "transistor" ||
            (p.kind === "ic" &&
              /LED|ISET|TLC59|CAT4|MAX72/i.test(`${p.value} ${p.libId} ${end.name}`))
          )
            limited = true;
          else if (p.kind === "led" && net.pins.length === 2 && !string.has(p.ref)) {
            string.add(p.ref);
            queue.push(p);
          } else unsafeEnd = true;
        }
        if (net.role !== "signal") unsafeEnd = true;
      }
    }
    if (!limited && unsafeEnd)
      out.push(
        finding(
          part,
          part.pins.map((p) => p.net),
          `${part.ref} has no series resistor.`,
          `LED string ${[...string].join(", ")} has no recognized current-limiting element.`,
          "Add a series resistor sized for the LED current.",
          "warning",
          part.pins,
          [...string],
        ),
      );
  }
  return out;
}
// Some modules label UART pins from the host's point of view; open-drain flags can be incomplete.
function drivers(m: ReviewModel): RawFinding[] {
  const out: RawFinding[] = [];
  for (const net of m.nets.values()) {
    const outputs = net.pins.filter((p) => p.type === "output" || p.type === "power_out");
    if (m.designKind === "tscircuit" && new Set(outputs.map((p) => p.part)).size > 1) {
      out.push(
        finding(
          undefined,
          [net.name],
          `Two outputs drive net ${net.name}: ${describe(outputs)}.`,
          "Output flags identify more than one driving part.",
          "Use one driver or explicitly model open-drain or bidirectional behavior.",
          "error",
          outputs,
        ),
      );
      continue;
    }
    for (const role of [UART_TX, UART_RX]) {
      const pins = net.pins.filter(
        (p) => role.test(p.name) && ["ic", "module"].includes(m.parts.get(p.part)?.kind ?? ""),
      );
      if (new Set(pins.map((p) => p.part)).size > 1)
        out.push(
          finding(
            undefined,
            [net.name],
            `${pins.map((p) => `${p.part} ${p.name}`).join(" and ")} are on the same net.`,
            `${describe(pins)} names indicate a UART crossing.`,
            "Cross the lines: TX goes to RX.",
            "warning",
            pins,
            undefined,
            role.source,
          ),
        );
    }
  }
  return out;
}
const fixedOutput = (p: ReviewPart) => {
  const text = `${p.value} ${p.mpn}`;
  if (/ADJ/i.test(text)) return undefined;
  const suffix = /-(\d\.\d)(?:\b|[A-Z])/i.exec(text);
  const european = /(\d)V(\d)/i.exec(text);
  const family = /(?:L|LM|MC|UA)78(05|09|12|15)/i.exec(text);
  const compact = /-(18|25|26|30|33|50)(?:\b|[A-Z])/i.exec(text);
  return suffix
    ? Number(suffix[1])
    : european
      ? Number(`${european[1]}.${european[2]}`)
      : family
        ? Number(family[1])
        : compact
          ? Number(compact[1]) / 10
          : undefined;
};
// Named voltages can be inaccurate. VBUS is explicitly described as assumed when used.
function regulators(m: ReviewModel): RawFinding[] {
  const out: RawFinding[] = [];
  for (const p of m.parts.values()) {
    if (p.kind !== "regulator") continue;
    const input =
      p.pins.find((p) => /^(VIN|IN|VI)$/i.test(p.name)) ??
      p.pins.find((p) => p.type === "power_in");
    const output =
      p.pins.find((p) => /^(VOUT|OUT|VO)$/i.test(p.name)) ??
      p.pins.find((p) => p.type === "power_out");
    const entry = REGULATORS.find((r) => r.match.test(`${p.value} ${p.mpn}`));
    const vin = input ? m.nets.get(input.net) : undefined,
      vout = output ? m.nets.get(output.net) : undefined;
    const emit = (key: string, msg: string, pin: ReviewPin) =>
      out.push(
        finding(
          p,
          [pin.net],
          msg,
          `${p.value}: ${pin.net}${m.nets.get(pin.net)?.voltsAssumed ? " (voltage assumed)" : ""}.`,
          "Check the regulator datasheet, supply voltage and capacitors.",
          "warning",
          [pin],
          undefined,
          key,
        ),
      );
    const fixed = fixedOutput(p);
    if (
      output &&
      fixed !== undefined &&
      vout?.volts !== undefined &&
      Math.abs(fixed - vout.volts) > fixed * 0.03
    )
      emit("fixed", `${p.ref} is a ${fixed} V regulator on net ${output.net}.`, output);
    if (entry?.checkedOn && input && vin?.volts !== undefined && vin.volts > entry.vinMaxV)
      emit("maximum", `${input.net} is above ${p.ref}'s ${entry.vinMaxV} V input limit.`, input);
    if (
      entry?.checkedOn &&
      output &&
      vin?.volts !== undefined &&
      vout?.volts !== undefined &&
      vin.volts - vout.volts < entry.dropoutV
    )
      emit("headroom", `${p.ref} has less than ${entry.dropoutV} V headroom.`, output);
    for (const [side, pin] of [
      ["input", input],
      ["output", output],
    ] as const) {
      if (!pin) continue;
      const caps = [...new Set(links(m, pin.net, "capacitor", "ground"))];
      if (!caps.length) emit(`cap:${side}`, `${p.ref} has no ${side} capacitor to ground.`, pin);
      else if (
        side === "output" &&
        entry?.checkedOn &&
        entry.minOutputCapUf !== undefined &&
        caps.reduce((n, c) => n + (c.farads ?? 0), 0) * 1e6 < entry.minOutputCapUf
      )
        emit(
          "cap-min",
          `${p.ref} has less than ${entry.minOutputCapUf} uF output capacitance.`,
          pin,
        );
      for (const cap of caps) {
        const volts = m.nets.get(pin.net)?.volts;
        if (volts !== undefined && cap.ratedVolts !== undefined && cap.ratedVolts < volts)
          emit(
            `rating:${cap.ref}`,
            `${cap.ref}'s ${cap.ratedVolts} V rating is below ${pin.net}.`,
            pin,
          );
      }
    }
  }
  return out;
}
export const REVIEW_RULES: readonly Rule[] = [
  {
    id: "i2c-pullup",
    title: "I2C pull-ups",
    defaultSeverity: "warning",
    defaultEnabled: true,
    needs: [],
    params: {},
    match: i2c,
  },
  {
    id: "decoupling",
    title: "Decoupling",
    defaultSeverity: "warning",
    defaultEnabled: true,
    needs: ["pinTypes", "boardPositions"],
    params: { maxDistanceMm: { default: 5, min: 1, max: 50, label: "Decoupling distance (mm)" } },
    match: decoupling,
  },
  {
    id: "connector-esd",
    title: "Connector ESD",
    defaultSeverity: "warning",
    defaultEnabled: true,
    needs: ["libIds"],
    params: {
      scope: { default: "usb", options: ["usb", "all-connectors"], label: "Connector scope" },
    },
    match: esd,
  },
  {
    id: "floating-input",
    title: "Floating inputs",
    defaultSeverity: "warning",
    defaultEnabled: true,
    needs: ["pinTypes", "noConnects"],
    params: {},
    match: floating,
  },
  {
    id: "reset-pullup",
    title: "Reset bias",
    defaultSeverity: "info",
    defaultEnabled: true,
    needs: [],
    params: {},
    match: reset,
  },
  {
    id: "led-resistor",
    title: "LED resistors",
    defaultSeverity: "warning",
    defaultEnabled: true,
    needs: [],
    params: {},
    match: leds,
  },
  {
    id: "multiple-drivers",
    title: "Multiple drivers",
    defaultSeverity: "warning",
    defaultEnabled: true,
    needs: ["pinTypes"],
    params: {},
    match: drivers,
  },
  {
    id: "regulator-ratings",
    title: "Regulator ratings",
    defaultSeverity: "warning",
    defaultEnabled: true,
    needs: [],
    params: {},
    match: regulators,
  },
];
export function runReview(
  model: ReviewModel,
  settings: PcbReviewSettings,
): Pick<PcbReviewResult, "findings" | "rules" | "notices" | "truncated"> {
  const findings: PcbReviewFinding[] = [],
    rules: PcbReviewResult["rules"][number][] = [],
    notices = [...model.notices];
  for (const rule of REVIEW_RULES) {
    const enabled = settings.rules[rule.id] ?? rule.defaultEnabled;
    const params: Record<string, number | string> = {};
    for (const [key, def] of Object.entries(rule.params)) {
      const given = settings.params[rule.id]?.[key];
      const valid =
        typeof def.default === "number"
          ? typeof given === "number" &&
            Number.isFinite(given) &&
            given >= (def.min ?? -Infinity) &&
            given <= (def.max ?? Infinity)
          : typeof given === "string" && !!def.options?.includes(given);
      params[key] = valid ? given! : def.default;
      if (given !== undefined && !valid)
        notices.push(
          `${def.label} is invalid; using ${def.default}${typeof def.default === "number" ? " mm" : ""}.`,
        );
    }
    const raw = enabled ? rule.match(model, params) : [];
    const limited = rule.needs.filter((n) => !model.has[n]);
    rules.push({
      id: rule.id,
      title: rule.title,
      enabled,
      findings: raw.length,
      ...(enabled && limited.length
        ? { limited: `Limited data: ${limited.join(", ")}. Available names and roles were used.` }
        : {}),
    });
    for (const { discriminator, ...f } of raw) {
      const parts = [...new Set(f.parts)].sort(),
        nets = [...new Set(f.nets)].sort();
      const key = JSON.stringify([rule.id, parts, nets, discriminator ?? ""]);
      let hash = 0x811c9dc5;
      for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
      findings.push({
        ...f,
        parts,
        nets,
        id: `review:${rule.id}:${(hash >>> 0).toString(16)}`,
        rule: rule.id,
        waived: false,
      });
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  findings.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      REVIEW_RULES.findIndex((r) => r.id === a.rule) -
        REVIEW_RULES.findIndex((r) => r.id === b.rule) ||
      a.parts.join().localeCompare(b.parts.join()) ||
      a.id.localeCompare(b.id),
  );
  return {
    findings: findings.slice(0, 500),
    rules,
    notices: notices.slice(0, 20),
    truncated: findings.length > 500,
  };
}
export function applyReviewWaivers(
  result: PcbReviewResult,
  settings: PcbReviewSettings,
  designId: string,
): PcbReviewResult {
  const waived = new Map(
    settings.waivers.filter((w) => w.designId === designId).map((w) => [w.findingId, w]),
  );
  const findings = result.findings.map((f) => {
    const waiver = waived.get(f.id);
    return { ...f, waived: !!waiver, ...(waiver?.note ? { waiverNote: waiver.note } : {}) };
  });
  const counts = { errors: 0, warnings: 0, info: 0, waived: 0 };
  for (const f of findings)
    if (f.waived) counts.waived++;
    else if (f.severity === "error") counts.errors++;
    else if (f.severity === "warning") counts.warnings++;
    else counts.info++;
  return {
    ...result,
    findings,
    counts,
    outcome:
      result.outcome === "failed"
        ? "failed"
        : counts.errors + counts.warnings + counts.info
          ? "findings"
          : "clean",
  };
}
