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
export interface ForkSettingsSection {
  readonly id: string;
  readonly title: string;
  readonly Component: ComponentType;
}
export const FORK_SETTINGS_SECTIONS: ReadonlyArray<ForkSettingsSection> = [
  { id: "vault-brokers", title: "Vault brokers", Component: VaultBrokerSettingsSection },
  { id: "vault", title: "Vault", Component: VaultSettingsSection },
  { id: "vault-access", title: "Vault access", Component: VaultAccessSettingsSection },
  { id: "mini-offload", title: "Command workers", Component: MiniOffloadSettingsSection },
  { id: "pcb-preview", title: "PCB preview", Component: PcbPreviewSettingsSection },
  { id: "model-preview-3d", title: "3D model", Component: ModelPreviewSettingsSection },
  { id: "project-lifecycle", title: "Storage", Component: ProjectLifecycleSettingsSection },
  {
    id: "apple-build-tooling",
    title: "Apple build",
    Component: AppleBuildToolingSettingsSection,
  },
  { id: "device-qa", title: "Device QA", Component: DeviceQaSettingsSection },
  { id: "panel-picker", title: "Panel picker", Component: PanelPickerSettingsSection },
  { id: "code-graph", title: "Code graph", Component: CodeGraphSettingsSection },
];
