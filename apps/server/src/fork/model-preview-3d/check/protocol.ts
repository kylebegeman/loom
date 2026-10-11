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

export type AssemblyWorkerPart = {
  readonly id: string;
  readonly format: CheckRequest["format"];
  readonly files: readonly CheckFile[];
  readonly matrix: readonly number[];
  readonly geometryRevision: string;
};
export type BoundsRequest = {
  readonly kind: "bounds";
  readonly part: AssemblyWorkerPart;
  readonly limits: { readonly maxTriangles: number };
};
export type BoundsReply =
  | {
      readonly ok: true;
      readonly bounds: import("@t3tools/contracts/fork").AssemblyBounds;
      readonly triangles: number;
    }
  | Extract<CheckReply, { ok: false }>;
export type AssemblyWorkerRequest = {
  readonly kind: "assembly";
  readonly parts: readonly AssemblyWorkerPart[];
  readonly pairs: readonly {
    readonly a: string;
    readonly b: string;
    readonly clearanceId: string | null;
    readonly requiredMm: number | null;
  }[];
  readonly limits: {
    readonly maxTriangles: number;
    readonly intersections: number;
    readonly distances: number;
  };
};
export type AssemblyWorkerCore = Pick<
  import("@t3tools/contracts/fork").AssemblyCheckReport,
  "parts" | "pairs" | "summary" | "complete" | "durationMs"
>;
export type AssemblyWorkerReply =
  | { readonly ok: true; readonly core: AssemblyWorkerCore }
  | Extract<CheckReply, { ok: false }>;
export type WorkerRequest = CheckRequest | BoundsRequest | AssemblyWorkerRequest;
export type WorkerReply = CheckReply | BoundsReply | AssemblyWorkerReply;
