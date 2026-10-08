import type {
  PcbBounds,
  PcbComponent,
  PcbInspection,
  PcbComparison,
} from "@t3tools/contracts/fork";
export type Sexp = string | Sexp[];
/** Parse saved KiCad data, with explicit limits on nesting and token count. */
export function parseSexp(source: string): Sexp[] {
  const root: Sexp[] = [],
    stack = [root];
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g) ?? [];
  if (tokens.length > 2000000)
    throw new Error("KiCad source exceeds the semantic inspection limit.");
  for (const token of tokens) {
    if (token === "(") {
      const next: Sexp[] = [];
      stack.at(-1)!.push(next);
      stack.push(next);
      if (stack.length > 256) throw new Error("KiCad source nesting exceeds the inspection limit.");
    } else if (token === ")") {
      if (stack.length === 1) throw new Error("Unbalanced KiCad source.");
      stack.pop();
    } else
      stack
        .at(-1)!
        .push(
          token.startsWith('"')
            ? token
                .slice(1, -1)
                .replace(/\\(["\\nrt])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c)
            : token,
        );
  }
  if (stack.length !== 1) throw new Error("Unbalanced KiCad source.");
  return root;
}
export const children = (node: Sexp[], name: string): Sexp[][] =>
  node.filter((v): v is Sexp[] => Array.isArray(v) && v[0] === name);
export const child = (node: Sexp[], name: string): Sexp[] => children(node, name)[0] ?? [];
export const atom = (node: Sexp[], index = 1): string =>
  typeof node[index] === "string" ? node[index] : "";
const number = (node: Sexp[], index = 1, fallback = 0) => {
  const value = Number(atom(node, index));
  return Number.isFinite(value) && atom(node, index) !== "" ? value : fallback;
};
const property = (node: Sexp[], name: string) =>
  atom(children(node, "property").find((p) => p[1] === name) ?? [], 2);
const localPosition = (at: Sexp[], local: Sexp[]) => {
  const a = (number(at, 3) * Math.PI) / 180;
  return {
    x: number(at) + number(local) * Math.cos(a) + number(local, 2) * Math.sin(a),
    y: number(at, 2) - number(local) * Math.sin(a) + number(local, 2) * Math.cos(a),
  };
};
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
  const edges = board.filter(
    (n): n is Sexp[] => Array.isArray(n) && atom(child(n, "layer")) === "Edge.Cuts",
  );
  const points = edges.flatMap((e) =>
    ["start", "end", "mid", "center"].flatMap((key) =>
      children(e, key).map((p) => ({ x: number(p), y: number(p, 2) })),
    ),
  );
  for (const edge of edges) {
    for (const p of child(edge, "pts").slice(1))
      if (Array.isArray(p)) points.push({ x: number(p), y: number(p, 2) });
    if (edge[0] === "gr_circle") {
      const center = child(edge, "center"),
        end = child(edge, "end"),
        x = number(center),
        y = number(center, 2);
      const radius = Math.hypot(number(end) - x, number(end, 2) - y);
      points.push({ x: x - radius, y: y - radius }, { x: x + radius, y: y + radius });
    }
    if (edge[0] === "gr_arc") {
      const a = child(edge, "start"),
        b = child(edge, "mid"),
        c = child(edge, "end");
      const ax = number(a),
        ay = number(a, 2),
        bx = number(b),
        by = number(b, 2),
        cx = number(c),
        cy = number(c, 2);
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(d) > 1e-12) {
        const aa = ax * ax + ay * ay,
          bb = bx * bx + by * by,
          cc = cx * cx + cy * cy;
        const x = (aa * (by - cy) + bb * (cy - ay) + cc * (ay - by)) / d,
          y = (aa * (cx - bx) + bb * (ax - cx) + cc * (bx - ax)) / d;
        const radius = Math.hypot(ax - x, ay - y),
          tau = 2 * Math.PI;
        const norm = (v: number) => ((v % tau) + tau) % tau;
        const start = Math.atan2(ay - y, ax - x),
          end = Math.atan2(cy - y, cx - x),
          mid = Math.atan2(by - y, bx - x);
        const ccw = norm(mid - start) <= norm(end - start);
        for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])
          if (
            ccw
              ? norm(angle - start) <= norm(end - start)
              : norm(start - angle) <= norm(start - end)
          )
            points.push({ x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) });
      }
    }
  }
  const mountingHoles = children(board, "footprint").flatMap((f) =>
    children(f, "pad")
      .filter((p) => p[2] === "np_thru_hole")
      .map((p) => {
        const drill = child(p, "drill"),
          oval = drill[1] === "oval",
          diameter = number(drill, oval ? 2 : 1);
        return {
          ...localPosition(child(f, "at"), child(p, "at")),
          diameter,
          slotLength: oval ? number(drill, 3, diameter) : diameter,
        };
      }),
  );
  let bounds: PcbBounds | null = null;
  if (points.length) {
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y),
      x = Math.min(...xs),
      y = Math.min(...ys);
    bounds = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
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
      ...(pcb ? { pcb: { x: num(record(pcb.center).x), y: -num(record(pcb.center).y) } } : {}),
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
    layers: ["top", "bottom"],
    bounds: board
      ? {
          x: num(record(board.center).x) - num(board.width) / 2,
          y: -num(record(board.center).y) - num(board.height) / 2,
          width: num(board.width),
          height: num(board.height),
        }
      : null,
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
            },
          ]
        : [];
    }),
    thickness: num(board?.thickness) || 1.6,
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
