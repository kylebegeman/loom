import type { ModelFormat } from "@t3tools/contracts/fork";

/** Formats supported by direct loading or host rendering. */
export const PREVIEWABLE_FORMATS: ReadonlySet<ModelFormat> = new Set([
  "stl",
  "3mf",
  "obj",
  "glb",
  "gltf",
  "scad",
  "step",
  "build123d",
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
