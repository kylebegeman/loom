import { PcbPreviewSettingsSection } from "../pcb-preview/settings";
import type { ComponentType } from "react";
import { ModelPreviewSettingsSection } from "../model-preview-3d/SettingsSection";
import { ProjectLifecycleSettingsSection } from "../project-lifecycle/SettingsSection";
import { AppleBuildToolingSettingsSection } from "../apple-build-tooling/settings";
import { DeviceQaSettingsSection } from "../device-qa/settings";
export interface ForkSettingsSection {
  readonly id: string;
  readonly title: string;
  readonly Component: ComponentType;
}
export const FORK_SETTINGS_SECTIONS: ReadonlyArray<ForkSettingsSection> = [
  { id: "pcb-preview", title: "PCB preview", Component: PcbPreviewSettingsSection },
  { id: "model-preview-3d", title: "3D model", Component: ModelPreviewSettingsSection },
  { id: "project-lifecycle", title: "Storage", Component: ProjectLifecycleSettingsSection },
  {
    id: "apple-build-tooling",
    title: "Apple build",
    Component: AppleBuildToolingSettingsSection,
  },
  { id: "device-qa", title: "Device QA", Component: DeviceQaSettingsSection },
];
