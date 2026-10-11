import type { PrintCheckReport, PrintFinding } from "@t3tools/contracts/fork";
export type PrintCheckCore = {
  status: PrintCheckReport["status"];
  truncated: boolean;
  summary: PrintCheckReport["summary"];
  findings: PrintFinding[];
  checks: PrintCheckReport["checks"];
  stages: PrintCheckReport["stages"];
  durationMs: number;
  orientation: PrintCheckReport["orientation"];
  modelCenter: readonly [number, number, number];
};
export type CheckFile = { readonly name: string; readonly bytes: Uint8Array };
export type CheckRequest = {
  readonly format: "stl" | "obj" | "3mf" | "gltf" | "glb";
  readonly files: readonly CheckFile[];
  readonly orientation: readonly [number, number, number, number] | null;
  readonly params: {
    readonly nozzleMm: number;
    readonly overhangAngleDegrees: number;
    readonly firstLayerMm: number;
  };
  readonly seed: number;
  readonly limits: { readonly maxTriangles: number; readonly thicknessBudgetMs: number };
};
export type CheckReply =
  | { readonly ok: true; readonly core: PrintCheckCore }
  | {
      readonly ok: false;
      readonly reason: "unsupported-format" | "too-large" | "command-failed";
      readonly message: string;
    };
