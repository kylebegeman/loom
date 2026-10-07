import type { ModelPreviewSettings, OpenScadInfo, ScadRenderResult } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

export const parseVersion = (text: string): string | null =>
  /(?:version\s+)?(\d{4}\.\d{2}(?:\.\d{2})?[^\s]*)/i.exec(text)?.[1] ?? null;
export function detectedInfo(path: string, versionText: string, help: string): OpenScadInfo {
  const version = parseVersion(versionText);
  return {
    path,
    version,
    isSnapshot: version !== null && /^\d{4}\.\d{2}\.\d{2}/.test(version),
    supportsManifold: /--backend/.test(help) && /manifold/i.test(help),
    supportsColors: /color-mode/.test(help),
    supportsSummary: /--summary-file/.test(help),
  };
}
export const parseLog = (text: string): ScadRenderResult["log"] =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-500)
    .map((text) => {
      const match = /^(ECHO|WARNING|ERROR|TRACE):\s*(.*)$/.exec(text);
      const level = match?.[1]?.toLowerCase();
      return {
        level:
          level === "echo" || level === "warning" || level === "error" || level === "trace"
            ? level
            : "info",
        text: match?.[2] ?? text,
      };
    });
export const View = Schema.Literals(["iso", "front", "top", "right", "bottom"]);
export type ModelView = typeof View.Type;
export const viewCamera: Record<ModelView, string> = {
  iso: "0,0,0,55,0,25,200",
  front: "0,0,0,90,0,0,200",
  top: "0,0,0,0,0,0,200",
  right: "0,0,0,90,0,90,200",
  bottom: "0,0,0,180,0,0,200",
};
export function renderArgs(input: {
  source: string;
  output: string;
  deps: string;
  summary: string;
  info: OpenScadInfo;
  settings: ModelPreviewSettings;
  overrides: Readonly<Record<string, string>>;
  parameterSet: string | null;
  sidecar: string;
}) {
  const args = ["-o", input.output];
  if (!input.settings.renderColors) args.push("--export-format", "binstl");
  else args.push("-O", "export-3mf/color-mode=model");
  const backend =
    input.settings.backend === "auto"
      ? input.info.supportsManifold
        ? "manifold"
        : null
      : input.settings.backend;
  if (backend && input.info.supportsManifold) args.push(`--backend=${backend}`);
  if (input.parameterSet) args.push("-p", input.sidecar, "-P", input.parameterSet);
  for (const [name, value] of Object.entries(input.overrides).toSorted(([a], [b]) =>
    a.localeCompare(b),
  ))
    args.push("-D", `${name}=${value}`);
  if (input.info.supportsSummary) args.push("--summary", "all", "--summary-file", input.summary);
  args.push("-d", input.deps, input.source);
  return args;
}
export const pngArgs = (source: string, output: string, view: ModelView) => [
  "-o",
  output,
  "--render",
  "--imgsize=1024,768",
  "--autocenter",
  "--viewall",
  "--projection=p",
  `--camera=${viewCamera[view]}`,
  source,
];
const Summary = Schema.Struct({
  geometry: Schema.optional(
    Schema.Struct({
      simple: Schema.optional(Schema.Boolean),
      facets: Schema.optional(Schema.Int),
      vertices: Schema.optional(Schema.Int),
      bounding_box: Schema.optional(
        Schema.Struct({ min: Schema.Array(Schema.Number), max: Schema.Array(Schema.Number) }),
      ),
    }),
  ),
});
const decodeSummary = Schema.decodeUnknownSync(Summary);
export function parseSummary(text: string): ScadRenderResult["summary"] {
  try {
    const data = decodeSummary(JSON.parse(text)).geometry;
    return data
      ? {
          manifold: data.simple ?? null,
          facets: data.facets ?? null,
          vertices: data.vertices ?? null,
          boundingBox: data.bounding_box ?? null,
        }
      : null;
  } catch {
    return null;
  }
}
