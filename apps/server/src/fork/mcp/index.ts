import { ProjectResourcesToolkit, projectResourcesHandlers } from "../project-resources/mcp.ts";
import { ProjectCheckoutToolkit, projectCheckoutHandlers } from "../project-checkout/mcp.ts";
import { ComputerNamingToolkit, computerNamingHandlers } from "../computer-naming/mcp.ts";
import { GitHubHostSetupToolkit, githubHostSetupHandlers } from "../github-host-setup/mcp.ts";
import { WorkspaceHandoffToolkit, workspaceHandoffHandlers } from "../workspace-handoff/mcp.ts";
import { MiniOffloadToolkit, miniOffloadHandlers } from "../mini-offload/mcp.ts";
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
    toolkit: ProjectResourcesToolkit,
    handlers: projectResourcesHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(ProjectResourcesToolkit, projectResourcesHandlers),
  },
  {
    toolkit: ProjectCheckoutToolkit,
    handlers: projectCheckoutHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(ProjectCheckoutToolkit, projectCheckoutHandlers),
  },
  {
    toolkit: ComputerNamingToolkit,
    handlers: computerNamingHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(ComputerNamingToolkit, computerNamingHandlers),
  },
  {
    toolkit: GitHubHostSetupToolkit,
    handlers: githubHostSetupHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(GitHubHostSetupToolkit, githubHostSetupHandlers),
  },
  {
    toolkit: WorkspaceHandoffToolkit,
    handlers: workspaceHandoffHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(WorkspaceHandoffToolkit, workspaceHandoffHandlers),
  },
  {
    toolkit: MiniOffloadToolkit,
    handlers: miniOffloadHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(MiniOffloadToolkit, miniOffloadHandlers),
  },
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
