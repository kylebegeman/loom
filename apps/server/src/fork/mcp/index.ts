import type { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import { ModelPreview3dToolkit, modelPreview3dHandlers } from "../model-preview-3d/mcp.ts";
import { PcbToolkit, pcbHandlers } from "../pcb-preview/mcp.ts";
import { ProjectLifecycleToolkit, projectLifecycleHandlers } from "../project-lifecycle/mcp.ts";
/** Register through McpHttpServer so every fork tool uses the shared access checks. */
export const FORK_MCP_TOOLKITS = [
  {
    toolkit: PcbToolkit,
    handlers: pcbHandlers,
    register: (register: typeof toolkitRegistration) => register(PcbToolkit, pcbHandlers),
  },
  {
    toolkit: ModelPreview3dToolkit,
    handlers: modelPreview3dHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(ModelPreview3dToolkit, modelPreview3dHandlers),
  },
  {
    toolkit: ProjectLifecycleToolkit,
    handlers: projectLifecycleHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(ProjectLifecycleToolkit, projectLifecycleHandlers),
  },
] as const;
