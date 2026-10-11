import type {
  PcbComponent,
  PcbComponentChange,
  PcbInspection,
  PcbNetChange,
} from "./pcb-workspace.ts";
export const MOVE_TOLERANCE_MM = 0.01;
export interface PcbChangeSet {
  readonly components: ReadonlyArray<PcbComponentChange>;
  readonly nets: ReadonlyArray<PcbNetChange>;
  readonly truncated?: boolean;
}
type Location = PcbComponent["pcb"];
const different = (a: Location, b: Location) =>
  a && b
    ? a.sheet !== b.sheet ||
      Math.abs(a.x - b.x) > MOVE_TOLERANCE_MM + 1e-9 ||
      Math.abs(a.y - b.y) > MOVE_TOLERANCE_MM + 1e-9
    : !!a !== !!b;
const offset = (pin: Location, part: Location): Location =>
  pin && part ? { x: pin.x - part.x, y: pin.y - part.y } : undefined;
export function pcbChangeSet(before: PcbInspection, after: PcbInspection): PcbChangeSet {
  const old = new Map(before.components.map((c) => [c.reference, c]));
  const current = new Map(after.components.map((c) => [c.reference, c]));
  const components: PcbComponentChange[] = [];
  for (const reference of new Set([...current.keys(), ...old.keys()])) {
    const a = old.get(reference),
      b = current.get(reference),
      part = b ?? a!;
    const fields: PcbComponentChange["fields"][number][] = [];
    if (a && b) {
      if (a.value !== b.value) fields.push("value");
      if (a.footprint !== b.footprint) fields.push("footprint");
      if (different(a.pcb, b.pcb) || a.side !== b.side) fields.push("pcb");
      if (different(a.schematic, b.schematic)) fields.push("schematic");
      const ap = new Map(a.pins.map((p) => [p.number, p])),
        bp = new Map(b.pins.map((p) => [p.number, p]));
      if (ap.size !== bp.size || [...ap].some(([n, p]) => !bp.has(n) || bp.get(n)!.name !== p.name))
        fields.push("pins");
      if ([...ap].some(([n, p]) => bp.has(n) && bp.get(n)!.net !== p.net)) fields.push("nets");
      if (
        a.rotation !== b.rotation ||
        [...ap].some(([n, p]) => {
          const q = bp.get(n);
          return (
            q &&
            (["pcb", "schematic"] as const).some((v) =>
              different(offset(p[v], a[v]), offset(q[v], b[v])),
            )
          );
        })
      )
        fields.push("orientation");
      if (!fields.length) continue;
    }
    components.push({
      reference,
      value: part.value,
      fields,
      kind: !a
        ? "added"
        : !b
          ? "removed"
          : fields.includes("pcb") || fields.includes("schematic")
            ? "moved"
            : "changed",
      ...(a?.pcb || b?.pcb
        ? { pcb: { ...(a?.pcb ? { from: a.pcb } : {}), ...(b?.pcb ? { to: b.pcb } : {}) } }
        : {}),
      ...(a?.schematic || b?.schematic
        ? {
            schematic: {
              ...(a?.schematic ? { from: a.schematic } : {}),
              ...(b?.schematic ? { to: b.schematic } : {}),
            },
          }
        : {}),
    });
  }
  const kinds = ["added", "removed", "moved", "changed"];
  components.sort(
    (a, b) =>
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
      a.reference.localeCompare(b.reference, undefined, { numeric: true }),
  );
  const an = new Map(before.nets.map((n) => [n.name, n])),
    bn = new Map(after.nets.map((n) => [n.name, n]));
  const nets: PcbNetChange[] = [];
  let truncated = false;
  for (const name of new Set([...bn.keys(), ...an.keys()])) {
    const a = an.get(name),
      b = bn.get(name),
      key = (m: { reference: string; pin: string }) => JSON.stringify([m.reference, m.pin]);
    const am = new Set(a?.members.map(key)),
      bm = new Set(b?.members.map(key));
    const joined = b?.members.filter((m) => !am.has(key(m))) ?? [],
      left = a?.members.filter((m) => !bm.has(key(m))) ?? [];
    if (a && b && !joined.length && !left.length) continue;
    truncated ||= joined.length > 50 || left.length > 50;
    nets.push({
      name,
      kind: !a ? "added" : !b ? "removed" : "changed",
      joined: joined.slice(0, 50),
      left: left.slice(0, 50),
    });
  }
  nets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { components, nets, truncated };
}
export const changeDetail = (change: PcbComponentChange) =>
  change.kind === "added"
    ? `Added ${change.value}`
    : change.kind === "removed"
      ? `Removed ${change.value}`
      : change.fields.join(", ");
export function changeCounts(set: PcbChangeSet) {
  const counts = { added: 0, removed: 0, moved: 0, changed: 0, nets: set.nets.length };
  for (const c of set.components) counts[c.kind]++;
  return counts;
}
