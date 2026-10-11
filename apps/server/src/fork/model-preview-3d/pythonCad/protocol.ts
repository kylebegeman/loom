import * as Schema from "effect/Schema";
import { ScadParameter, ScadRenderResult } from "@t3tools/contracts/fork";

export const PythonResponse = Schema.Struct({
  ok: Schema.Boolean,
  python: Schema.optionalKey(Schema.String),
  build123d: Schema.optionalKey(Schema.NullOr(Schema.String)),
  parameters: Schema.optionalKey(Schema.Array(ScadParameter)),
  summary: Schema.optionalKey(ScadRenderResult.fields.summary),
  log: ScadRenderResult.fields.log,
});
export type PythonResponse = typeof PythonResponse.Type;
export type PythonCommand = "probe" | "inspect" | "render" | "tessellate" | "export-step";
export const LINEAR_TOLERANCE_MM = 0.01;
export const ANGULAR_TOLERANCE_RAD = 0.1;
