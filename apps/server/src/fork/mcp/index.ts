import {
  VaultMigrationInventoryToolkit,
  vaultMigrationInventoryHandlers,
} from "../vault/migration-inventory-mcp.ts";
import { VaultMigrationToolkit, vaultMigrationHandlers } from "../vault/migration-mcp.ts";
import { VaultHealthToolkit, vaultHealthHandlers } from "../vault/health-mcp.ts";
import { VaultGitHubToolkit, vaultGitHubHandlers } from "../vault/github-mcp.ts";
import { VaultProfileToolkit, vaultProfileHandlers } from "../vault/profile-mcp.ts";
import { VaultSshToolkit, vaultSshHandlers } from "../vault/ssh-mcp.ts";
import { VaultWorkloadToolkit, vaultWorkloadHandlers } from "../vault/workload-mcp.ts";
import { VaultBrokerToolkit, vaultBrokerHandlers } from "../vault/broker-mcp.ts";
import { VaultAccessToolkit, vaultAccessHandlers } from "../vault/access-mcp.ts";
import { VaultCoreToolkit, vaultCoreHandlers } from "../vault/mcp.ts";
import { SitesToolkit, sitesHandlers } from "../sites/mcp.ts";
import { ProjectLibraryToolkit, projectLibraryHandlers } from "../project-library/mcp.ts";
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
import { PreviewLinksToolkit, previewLinksHandlers } from "../preview-links/mcp.ts";
import { DirectoryToolkit, directoryHandlers } from "../directory/mcp.ts";
import { BotsToolkit, botsHandlers } from "../bots/mcp.ts";
/** Register through McpHttpServer so every fork tool uses the shared access checks. */
export const FORK_MCP_TOOLKITS = [
  {
    toolkit: VaultMigrationInventoryToolkit,
    handlers: vaultMigrationInventoryHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultMigrationInventoryToolkit, vaultMigrationInventoryHandlers),
  },
  {
    toolkit: VaultMigrationToolkit,
    handlers: vaultMigrationHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultMigrationToolkit, vaultMigrationHandlers),
  },
  {
    toolkit: VaultHealthToolkit,
    handlers: vaultHealthHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultHealthToolkit, vaultHealthHandlers),
  },
  {
    toolkit: VaultGitHubToolkit,
    handlers: vaultGitHubHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultGitHubToolkit, vaultGitHubHandlers),
  },
  {
    toolkit: VaultProfileToolkit,
    handlers: vaultProfileHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultProfileToolkit, vaultProfileHandlers),
  },
  {
    toolkit: VaultSshToolkit,
    handlers: vaultSshHandlers,
    register: (register: typeof toolkitRegistration) => register(VaultSshToolkit, vaultSshHandlers),
  },
  {
    toolkit: VaultWorkloadToolkit,
    handlers: vaultWorkloadHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultWorkloadToolkit, vaultWorkloadHandlers),
  },
  {
    toolkit: VaultBrokerToolkit,
    handlers: vaultBrokerHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultBrokerToolkit, vaultBrokerHandlers),
  },
  {
    toolkit: VaultAccessToolkit,
    handlers: vaultAccessHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultAccessToolkit, vaultAccessHandlers),
  },
  {
    toolkit: VaultCoreToolkit,
    handlers: vaultCoreHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(VaultCoreToolkit, vaultCoreHandlers),
  },
  {
    toolkit: SitesToolkit,
    handlers: sitesHandlers,
    register: (register: typeof toolkitRegistration) => register(SitesToolkit, sitesHandlers),
  },
  {
    toolkit: ProjectLibraryToolkit,
    handlers: projectLibraryHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(ProjectLibraryToolkit, projectLibraryHandlers),
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
  {
    toolkit: PreviewLinksToolkit,
    handlers: previewLinksHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(PreviewLinksToolkit, previewLinksHandlers),
  },
  {
    toolkit: DirectoryToolkit,
    handlers: directoryHandlers,
    register: (register: typeof toolkitRegistration) =>
      register(DirectoryToolkit, directoryHandlers),
  },
  {
    toolkit: BotsToolkit,
    handlers: botsHandlers,
    register: (register: typeof toolkitRegistration) => register(BotsToolkit, botsHandlers),
  },
] as const;
