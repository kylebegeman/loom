/** The same source policy drives hashing, reload and turn-to-design matching. */
export function isPcbSource(kind: "kicad" | "tscircuit", name: string) {
  return kind === "tscircuit"
    ? /\.(?:[cm]?[jt]sx?|json|svg|dxf|png|jpe?g|csv|txt|obj|stl|3mf|glb|gltf|bin)$/i.test(name)
    : /\.(?:kicad_(?:sch|pcb|pro|dru|sym|mod)|lib|dcm|wks)$/i.test(name) ||
        /(?:^|\/)(?:sym-lib-table|fp-lib-table)$/.test(name);
}
