import { VaultTestAccountSettingsSection } from "../vault/TestAccountSettingsSection";
import { VaultMigrationInventorySettingsSection } from "../vault/MigrationInventorySettingsSection";
import { VaultMigrationSettingsSection } from "../vault/MigrationSettingsSection";
import { VaultHealthSettingsSection } from "../vault/HealthSettingsSection";
import { VaultGitHubSettingsSection } from "../vault/GitHubSettingsSection";
import { VaultProfileSettingsSection } from "../vault/ProfileSettingsSection";
import { VaultReferenceSettingsSection } from "../vault/ReferenceSettingsSection";
import { VaultBrokerSettingsSection } from "../vault/BrokerSettingsSection";
import { VaultAccessSettingsSection } from "../vault/AccessSettingsSection";
import { VaultSettingsSection } from "../vault/SettingsSection";
import { MiniOffloadSettingsSection } from "../mini-offload/settings";
import { PcbPreviewSettingsSection } from "../pcb-preview/settings";
import type { ComponentType } from "react";
import { ModelPreviewSettingsSection } from "../model-preview-3d/SettingsSection";
import { ProjectLifecycleSettingsSection } from "../project-lifecycle/SettingsSection";
import { AppleBuildToolingSettingsSection } from "../apple-build-tooling/settings";
import { DeviceQaSettingsSection } from "../device-qa/settings";
import { PanelPickerSettingsSection } from "../panel-picker/settings";
import { CodeGraphSettingsSection } from "../code-graph/settings";
import { PreviewLinksSettingsSection } from "../preview-links/settings";
import type { LoomSettingsGroupId } from "./navigation";

export interface ForkSettingsSection {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly group: LoomSettingsGroupId;
  readonly keywords: string;
  readonly layout?: "rows";
  readonly Component: ComponentType;
}

export const FORK_SETTINGS_SECTIONS: ReadonlyArray<ForkSettingsSection> = [
  {
    id: "project-lifecycle",
    title: "Storage",
    description: "Control temporary files, disk limits, and checkout lanes.",
    group: "work",
    keywords: "disk cleanup space reserve cap xcode derived data build slots shell terminal lanes",
    layout: "rows",
    Component: ProjectLifecycleSettingsSection,
  },
  {
    id: "mini-offload",
    title: "Command workers",
    description: "Connect and manage computers that run command jobs.",
    group: "work",
    keywords: "remote mini offload jobs workers computers connection",
    Component: MiniOffloadSettingsSection,
  },
  {
    id: "apple-build-tooling",
    title: "Apple builds",
    description: "Configure Xcode builds, simulators, diagnostics, and run history.",
    group: "tools",
    keywords: "apple xcode derived data simulator tests xcbeautify diagnostics history",
    layout: "rows",
    Component: AppleBuildToolingSettingsSection,
  },
  {
    id: "device-qa",
    title: "Device QA",
    description: "Set up device testing tools and screenshot limits.",
    group: "tools",
    keywords: "ios android simulator emulator screenshots testing device qa agent",
    layout: "rows",
    Component: DeviceQaSettingsSection,
  },
  {
    id: "code-graph",
    title: "Code graphs",
    description: "Configure code indexing and manage project graphs.",
    group: "tools",
    keywords: "graphify index query search nodes cache command agent graph",
    layout: "rows",
    Component: CodeGraphSettingsSection,
  },
  {
    id: "pcb-preview",
    title: "PCB preview",
    description: "Check circuit tools and choose how designs open and display.",
    group: "tools",
    keywords: "kicad tscircuit bun pcb circuit electronics fabrication units checks",
    layout: "rows",
    Component: PcbPreviewSettingsSection,
  },
  {
    id: "model-preview-3d",
    title: "3D models",
    description: "Configure model previews, print tools, units, and render storage.",
    group: "tools",
    keywords: "3d openscad python cad slicer printer nozzle layer bed volume overhang units cache",
    layout: "rows",
    Component: ModelPreviewSettingsSection,
  },
  {
    id: "preview-links",
    title: "Preview links",
    description: "Configure sharing, tunnel access, and open preview links.",
    group: "tools",
    keywords: "cloudflare connector token tunnel gateway port share browser links pages",
    layout: "rows",
    Component: PreviewLinksSettingsSection,
  },
  {
    id: "panel-picker",
    title: "Panel picker",
    description: "Choose the panel launcher and its keyboard shortcut.",
    group: "tools",
    keywords:
      "panel picker launcher compact search recent shortcut keybindings terminal browser device",
    layout: "rows",
    Component: PanelPickerSettingsSection,
  },
  {
    id: "vault",
    title: "Vault",
    description: "View Vault availability and manage development records.",
    group: "connections",
    keywords: "openbao status secrets credentials records unlock environment",
    Component: VaultSettingsSection,
  },
  {
    id: "vault-github",
    title: "GitHub connections",
    description: "Connect a dedicated GitHub identity for repository access.",
    group: "connections",
    keywords: "github token app installation repository repositories git https gh credentials",
    Component: VaultGitHubSettingsSection,
  },
  {
    id: "vault-profiles",
    title: "Project profiles",
    description: "Choose the connections a project needs for development.",
    group: "connections",
    keywords: "vault profile project binding requirements github ssh git default",
    Component: VaultProfileSettingsSection,
  },
  {
    id: "vault-access",
    title: "Access & permissions",
    description: "Review who can inspect, manage, or use Vault records.",
    group: "connections",
    keywords: "vault grants permission policy approval requests allow deny access audit expiry",
    Component: VaultAccessSettingsSection,
  },
  {
    id: "vault-brokers",
    title: "Credential brokers",
    description: "Enroll and manage the brokers that deliver development credentials.",
    group: "connections",
    keywords: "vault broker ssh terminal enroll invitation fingerprint trust credential",
    Component: VaultBrokerSettingsSection,
  },
  {
    id: "vault-references",
    title: "Vault references",
    description: "Find shareable references to records without exposing their values.",
    group: "connections",
    keywords: "vault reference search inspect id secret link item",
    Component: VaultReferenceSettingsSection,
  },
  {
    id: "vault-health",
    title: "Vault health & recovery",
    description: "Check Vault health, review maintenance, and manage recovery evidence.",
    group: "maintenance",
    keywords: "vault openbao health backup recovery maintenance audit rotation cleanup retention",
    Component: VaultHealthSettingsSection,
  },
  {
    id: "vault-test-accounts",
    title: "Test accounts",
    description: "Organize accounts used for development and verification.",
    group: "maintenance",
    keywords: "vault test account collection verification login role synthetic",
    Component: VaultTestAccountSettingsSection,
  },
  {
    id: "vault-migration",
    title: "Development imports",
    description: "Review local records before importing them into Vault.",
    group: "maintenance",
    keywords: "vault migration import credentials local review archive typed ssh github",
    Component: VaultMigrationSettingsSection,
  },
  {
    id: "vault-migration-inventory",
    title: "Migration plans",
    description: "Inspect development dependencies and prepare scoped replacements.",
    group: "maintenance",
    keywords: "vault migration inventory git remote replacement source import plan dependencies",
    Component: VaultMigrationInventorySettingsSection,
  },
];
