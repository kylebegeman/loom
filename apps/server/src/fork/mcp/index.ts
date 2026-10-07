import * as Layer from "effect/Layer";
import { ModelPreview3dToolkitRegistrationLive } from "../model-preview-3d/mcp.ts";
export const ForkMcpToolkitsLive = Layer.mergeAll(
  Layer.empty,
  ModelPreview3dToolkitRegistrationLive,
);
