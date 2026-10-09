import type { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import { ModelPreview3dToolkit, modelPreview3dHandlers } from "../model-preview-3d/mcp.ts";
import { PcbToolkit, pcbHandlers } from "../pcb-preview/mcp.ts";
import { ProjectLifecycleToolkit, projectLifecycleHandlers } from "../project-lifecycle/mcp.ts";
import { AppleBuildToolingToolkit, appleBuildToolingHandlers } from "../apple-build-tooling/mcp.ts";
import { DeviceQaToolkit, deviceQaHandlers } from "../device-qa/mcp.ts";
import { CodeGraphToolkit, codeGraphHandlers } from "../code-graph/mcp.ts";
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
  {
    toolkit: AppleBuildToolingToolkit,
    handlers: appleBuildToolingHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(AppleBuildToolingToolkit, appleBuildToolingHandlers),
  },
  {
    toolkit: DeviceQaToolkit,
    handlers: deviceQaHandlers,
    register: (register: typeof toolkitRegistration) => register(DeviceQaToolkit, deviceQaHandlers),
  },
  {
    toolkit: CodeGraphToolkit,
    handlers: codeGraphHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(CodeGraphToolkit, codeGraphHandlers),
  },
] as const;
