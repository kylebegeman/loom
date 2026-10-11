import { referenceHashPrefix } from "@t3tools/contracts/fork";
export const enclosureAssemblyPath = (designId: string) => {
  const slash = designId.lastIndexOf("/"),
    dir = slash < 0 ? "" : designId.slice(0, slash + 1),
    stem = designId
      .slice(slash + 1)
      .split(".")[0]!
      .replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${dir}${stem}.loom-assembly.json`;
};
export function enclosureState(
  features: readonly string[],
  referencePath: string | null,
  sourceHash: string | null,
) {
  const prefix = referencePath ? referenceHashPrefix(referencePath) : null;
  return {
    enabled: features.includes("pcb-enclosure-fit"),
    assembly: features.includes("model-assemblies"),
    python: features.includes("model-python-cad"),
    stale: !!prefix && !!sourceHash && prefix !== sourceHash.slice(0, 16).toLowerCase(),
  };
}
