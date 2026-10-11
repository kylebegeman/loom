import type { PcbComponent, PcbInspection, PcbComparison } from "@t3tools/contracts/fork";
import {
  parseSexp,
  children,
  child,
  atom,
  number,
  property,
  localPosition,
  type Sexp,
} from "./sexp.ts";
import { kicadOutlineBounds, circuitOutline } from "./outline.ts";
export { parseSexp, children, child, atom, number, localPosition, type Sexp } from "./sexp.ts";
export const emptyInspection = (sourceHash: string): PcbInspection => ({
  sourceHash,
  components: [],
  nets: [],
  layers: [],
  bounds: null,
  thickness: 1.6,
  warnings: [],
  mountingHoles: [],
});
export function inspectBoard(source: string, sourceHash: string): PcbInspection {
  const board = parseSexp(source)[0];
  if (!Array.isArray(board) || board[0] !== "kicad_pcb") throw new Error("Invalid KiCad board.");
  const components: PcbComponent[] = children(board, "footprint").map((f, index) => {
    const at = child(f, "at"),
      reference =
        property(f, "Reference") ||
        atom(children(f, "fp_text").find((t) => t[1] === "reference") ?? [], 2) ||
        `Unreferenced ${atom(f) || "footprint"} (${atom(child(f, "uuid")).slice(0, 8) || index + 1})`;
    return {
      id: atom(child(f, "uuid")) || reference,
      reference,
      value:
        property(f, "Value") || atom(children(f, "fp_text").find((t) => t[1] === "value") ?? [], 2),
      footprint: atom(f),
      pcb: { x: number(at), y: number(at, 2) },
      side: atom(child(f, "layer")) === "B.Cu" ? "back" : "front",
      rotation: number(at, 3),
      pins: children(f, "pad")
        .filter((p) => atom(p))
        .map((p) => ({
          number: atom(p),
          name: atom(child(p, "pinfunction")),
          net: atom(child(p, "net"), 2),
          pcb: localPosition(at, child(p, "at")),
        })),
    };
  });
  const mountingHoles = children(board, "footprint").flatMap((f) => {
    const npth = children(f, "pad").filter((p) => p[2] === "np_thru_hole");
    const plated = /MountingHole/i.test(atom(f))
      ? children(f, "pad")
          .filter((p) => p[2] === "thru_hole")
          .toSorted((a, b) => {
            const diameter = (pad: Sexp[]) => {
              const drill = child(pad, "drill");
              return drill[1] === "oval"
                ? Math.min(number(drill, 2), number(drill, 3))
                : number(drill);
            };
            return diameter(b) - diameter(a);
          })
          .slice(0, 1)
      : [];
    return [...npth, ...plated].flatMap((p) => {
      const drill = child(p, "drill"),
        oval = drill[1] === "oval";
      const width = number(drill, oval ? 2 : 1),
        height = number(drill, oval ? 3 : 1);
      if (width <= 0 || height <= 0) return [];
      return [
        {
          ...localPosition(child(f, "at"), child(p, "at")),
          diameter: Math.min(width, height),
          slotLength: Math.max(width, height),
          plated: p[2] === "thru_hole",
          footprint: atom(f),
        },
      ];
    });
  });
  const bounds = kicadOutlineBounds(board);
  const nets = new Map<string, { reference: string; pin: string }[]>();
  for (const c of components)
    for (const p of c.pins)
      if (p.net) {
        const members = nets.get(p.net) ?? [];
        members.push({ reference: c.reference, pin: p.number });
        nets.set(p.net, members);
      }
  return {
    ...emptyInspection(sourceHash),
    components,
    mountingHoles,
    nets: Array.from(nets, ([name, members]) => ({ name, members })),
    layers: child(board, "layers")
      .slice(1)
      .filter((l): l is Sexp[] => Array.isArray(l))
      .map((l) => canonicalLayer(atom(l)))
      .filter(Boolean),
    layerLabels: Object.fromEntries(
      child(board, "layers")
        .slice(1)
        .filter(
          (l): l is Sexp[] =>
            Array.isArray(l) && !!atom(l, 3) && atom(l, 3) !== canonicalLayer(atom(l)),
        )
        .map((l) => [canonicalLayer(atom(l)), atom(l, 3)]),
    ),
    bounds,
    thickness: number(child(child(board, "general"), "thickness"), 1, 1.6),
  };
}
export function inspectSchematic(
  source: string,
  sheet: string,
  instancePath?: string,
): PcbComponent[] {
  const root = parseSexp(source)[0];
  if (!Array.isArray(root) || root[0] !== "kicad_sch") throw new Error("Invalid KiCad schematic.");
  const symbols = new Map(children(child(root, "lib_symbols"), "symbol").map((s) => [atom(s), s]));
  return children(root, "symbol").flatMap((s) => {
    const refs = children(child(s, "instances"), "project")
      .flatMap((p) =>
        children(p, "path")
          .filter(
            (p) => !instancePath || atom(p).replace(/\/$/, "") === instancePath.replace(/\/$/, ""),
          )
          .map((p) => atom(child(p, "reference"))),
      )
      .filter(Boolean);
    const reference = property(s, "Reference");
    if (reference.startsWith("#") || (instancePath && child(s, "instances").length && !refs.length))
      return [];
    const at = child(s, "at");
    return [...new Set(refs.length ? refs : [reference])].filter(Boolean).map((r) => ({
      id: `${atom(child(s, "uuid")) || r}:${r}`,
      reference: r,
      value: property(s, "Value"),
      footprint: property(s, "Footprint"),
      schematic: { x: number(at), y: number(at, 2), sheet },
      pins: (() => {
        const definitions: Sexp[][] = [];
        let name = atom(child(s, "lib_id"));
        const visited = new Set<string>();
        while (name) {
          if (visited.has(name) || visited.size >= 16)
            throw new Error("Invalid symbol inheritance.");
          visited.add(name);
          const definition = symbols.get(name);
          if (!definition) break;
          definitions.unshift(definition);
          name = atom(child(definition, "extends"));
        }
        if (!definitions.length) return [];
        const unit = number(child(s, "unit"), 1, 1),
          mirror = atom(child(s, "mirror")),
          angle = (number(at, 3) * Math.PI) / 180,
          convert = number(child(s, "convert"), 1, 1);
        return definitions
          .flatMap((definition) => children(definition, "symbol"))
          .filter((part) => {
            const m = atom(part).match(/_(\d+)_(\d+)$/);
            return (
              m &&
              (Number(m[1]) === 0 || Number(m[1]) === unit) &&
              (Number(m[2]) === 0 || Number(m[2]) === convert)
            );
          })
          .flatMap((part) =>
            children(part, "pin").map((pin) => {
              const pos = child(pin, "at"),
                x = number(pos) * (mirror === "y" ? -1 : 1),
                y = -number(pos, 2) * (mirror === "x" ? -1 : 1);
              return {
                number: atom(child(pin, "number")),
                name: atom(child(pin, "name")),
                net: "",
                schematic: {
                  x: number(at) + x * Math.cos(angle) + y * Math.sin(angle),
                  y: number(at, 2) - x * Math.sin(angle) + y * Math.cos(angle),
                  sheet,
                },
              };
            }),
          );
      })(),
    }));
  });
}
export function mergeNetlist(inspection: PcbInspection, source: string): PcbInspection {
  const root = parseSexp(source)[0];
  if (!Array.isArray(root)) throw new Error("Invalid netlist.");
  const connections = children(child(root, "nets"), "net").map((n) => ({
    name: atom(child(n, "name")),
    members: children(n, "node").map((p) => ({
      reference: atom(child(p, "ref")),
      pin: atom(child(p, "pin")),
      name: atom(child(p, "pinfunction")),
    })),
  }));
  return {
    ...inspection,
    nets: connections.filter((n) => n.name),
    components: inspection.components.map((c) => {
      const pins = [...c.pins];
      for (const net of connections)
        for (const p of net.members)
          if (p.reference === c.reference) {
            const i = pins.findIndex((v) => v.number === p.pin);
            const pin = { ...(i >= 0 ? pins[i] : {}), number: p.pin, name: p.name, net: net.name };
            if (i >= 0) pins[i] = pin;
            else pins.push(pin);
          }
      return { ...c, pins };
    }),
  };
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export function inspectCircuitJson(json: unknown, sourceHash: string): PcbInspection {
  if (!Array.isArray(json) || json.length > 100000)
    throw new Error("Invalid or oversized Circuit JSON.");
  const byType = new Map<string, Record<string, unknown>[]>();
  for (const item of json) {
    const row = record(item),
      type = str(row.type);
    const bucket = byType.get(type) ?? [];
    bucket.push(row);
    byType.set(type, bucket);
  }
  const of = (type: string) => byType.get(type) ?? [];
  const index = (type: string, key: string) => new Map(of(type).map((row) => [str(row[key]), row]));
  const board = of("pcb_board")[0],
    ports = of("source_port");
  const pcbComponents = index("pcb_component", "source_component_id"),
    schematicComponents = index("schematic_component", "source_component_id");
  const pcbPorts = index("pcb_port", "source_port_id"),
    schematicPorts = index("schematic_port", "source_port_id");
  const portsByComponent = new Map<string, Record<string, unknown>[]>();
  for (const port of ports) {
    const id = str(port.source_component_id),
      bucket = portsByComponent.get(id) ?? [];
    bucket.push(port);
    portsByComponent.set(id, bucket);
  }
  // A connection can span several source_trace records. Union ports and named nets
  // before assigning labels so every segment of one net highlights together.
  const parents = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parents.has(root) && parents.get(root) !== root) root = parents.get(root)!;
    while (parents.has(key) && parents.get(key) !== root) {
      const next = parents.get(key)!;
      parents.set(key, root);
      key = next;
    }
    return root;
  };
  for (const trace of of("source_trace")) {
    const ids = [
      ...(Array.isArray(trace.connected_source_port_ids)
        ? trace.connected_source_port_ids
            .filter((v): v is string => typeof v === "string")
            .map((id) => "port:" + id)
        : []),
      ...(Array.isArray(trace.connected_source_net_ids)
        ? trace.connected_source_net_ids
            .filter((v): v is string => typeof v === "string")
            .map((id) => "net:" + id)
        : []),
      "trace:" + str(trace.source_trace_id),
    ];
    const root = find(ids[0]!);
    for (const id of ids) parents.set(find(id), root);
  }
  const names = new Map<string, string>();
  for (const net of of("source_net"))
    names.set(find("net:" + str(net.source_net_id)), str(net.name));
  const components: PcbComponent[] = of("source_component").map((c) => {
    const id = str(c.source_component_id),
      pcb = pcbComponents.get(id),
      sch = schematicComponents.get(id);
    return {
      id,
      reference: str(c.name) || id,
      value: str(c.display_value) || str(c.ftype),
      footprint: str(pcb?.footprint),
      ...(pcb
        ? {
            pcb: { x: num(record(pcb.center).x), y: -num(record(pcb.center).y) },
            side: pcb.layer === "bottom" ? ("back" as const) : ("front" as const),
            rotation: num(pcb.rotation ?? pcb.ccw_rotation),
          }
        : {}),
      ...(sch
        ? {
            schematic: {
              x: num(record(sch.center).x),
              y: -num(record(sch.center).y),
              sheet: "1.svg",
            },
          }
        : {}),
      pins: (portsByComponent.get(id) ?? []).map((p) => {
        const portId = str(p.source_port_id),
          pcbPort = pcbPorts.get(portId),
          schPort = schematicPorts.get(portId),
          connection = "port:" + portId,
          root = find(connection);
        return {
          number: String(p.pin_number ?? p.name ?? portId),
          name: str(p.name),
          net: names.get(root) || (parents.has(connection) ? root : ""),
          ...(pcbPort ? { pcb: { x: num(pcbPort.x), y: -num(pcbPort.y) } } : {}),
          ...(schPort
            ? { schematic: { x: num(schPort.x), y: -num(schPort.y), sheet: "1.svg" } }
            : {}),
        };
      }),
    };
  });
  const netMap = new Map<string, { reference: string; pin: string }[]>();
  for (const c of components)
    for (const p of c.pins)
      if (p.net) {
        const members = netMap.get(p.net) ?? [];
        members.push({ reference: c.reference, pin: p.number });
        netMap.set(p.net, members);
      }
  return {
    ...emptyInspection(sourceHash),
    components,
    nets: Array.from(netMap, ([name, members]) => ({ name, members })),
    layers:
      num(board?.num_layers) > 2
        ? [
            "top",
            ...Array.from(
              { length: Math.min(62, num(board?.num_layers) - 2) },
              (_, i) => `inner${i + 1}`,
            ),
            "bottom",
          ]
        : ["top", "bottom"],
    bounds: (() => {
      const outline = circuitOutline(json);
      if (!outline) {
        const width = num(board?.width),
          height = num(board?.height);
        return width > 0 && height > 0
          ? {
              x: num(record(board?.center).x) - width / 2,
              y: -num(record(board?.center).y) - height / 2,
              width,
              height,
            }
          : null;
      }
      let x = Infinity,
        y = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const loop of outline.loops)
        for (const point of loop) {
          x = Math.min(x, point.x);
          y = Math.min(y, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      return { x, y, width: maxX - x, height: maxY - y };
    })(),
    mountingHoles: of("pcb_hole").flatMap((hole) => {
      const width = num(hole.hole_diameter) || num(hole.hole_width),
        height = num(hole.hole_diameter) || num(hole.hole_height);
      return width > 0 && height > 0
        ? [
            {
              x: num(hole.x),
              y: -num(hole.y),
              diameter: Math.min(width, height),
              slotLength: Math.max(width, height),
              plated: false,
              footprint: "",
            },
          ]
        : [];
    }),
    thickness: num(board?.thickness) || 1.4,
  };
}
export function compareInspections(before: PcbInspection, after: PcbInspection) {
  const old = new Map(before.components.map((c) => [c.reference, c])),
    now = new Map(after.components.map((c) => [c.reference, c]));
  return [...new Set([...old.keys(), ...now.keys()])].flatMap<PcbComparison["changes"][number]>(
    (reference) => {
      const a = old.get(reference),
        b = now.get(reference);
      if (!a) return [{ kind: "added" as const, reference, detail: `Added ${b!.value}` }];
      if (!b) return [{ kind: "removed" as const, reference, detail: `Removed ${a.value}` }];
      const fields = ["value", "footprint", "pcb", "schematic", "pins"] as const;
      const changed = fields.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      return changed.length
        ? [{ kind: "changed" as const, reference, detail: changed.join(", ") }]
        : [];
    },
  );
}

const canonicalLayer = (name: string) =>
  (
    ({
      "F.SilkS": "F.Silkscreen",
      "B.SilkS": "B.Silkscreen",
      "F.Adhes": "F.Adhesive",
      "B.Adhes": "B.Adhesive",
      "F.CrtYd": "F.Courtyard",
      "B.CrtYd": "B.Courtyard",
      "Dwgs.User": "User.Drawings",
      "Cmts.User": "User.Comments",
      "Eco1.User": "User.Eco1",
      "Eco2.User": "User.Eco2",
    }) as Record<string, string>
  )[name] ?? name;
