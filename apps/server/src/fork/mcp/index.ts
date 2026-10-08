import { ModelPreview3dToolkit, modelPreview3dHandlers } from "../model-preview-3d/mcp.ts";
/** Register through McpHttpServer so every fork tool uses the shared access checks. */
export const FORK_MCP_TOOLKITS = [
  { toolkit: ModelPreview3dToolkit, handlers: modelPreview3dHandlers },
] as const;
