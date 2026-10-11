import type { ModelFormat } from "@t3tools/contracts/fork";

/** Formats the client viewer supports; STEP preview support belongs to L50. */
export const PREVIEWABLE_FORMATS: ReadonlySet<ModelFormat> = new Set([
  "stl",
  "3mf",
  "obj",
  "glb",
  "gltf",
  "scad",
]);
/** Literal include, import and surface inputs OpenSCAD can consume. */
export const SCAD_INPUT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".scad",
  ".stl",
  ".off",
  ".obj",
  ".amf",
  ".3mf",
  ".dxf",
  ".svg",
  ".pdf",
  ".png",
  ".json",
  ".dat",
  ".txt",
]);
