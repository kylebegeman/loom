import type { ComponentType } from "react";
import { ModelPreviewSettingsSection } from "../model-preview-3d/SettingsSection";
export interface ForkSettingsSection {
  readonly id: string;
  readonly title: string;
  readonly Component: ComponentType;
}
export const FORK_SETTINGS_SECTIONS: ReadonlyArray<ForkSettingsSection> = [
  { id: "model-preview-3d", title: "3D model", Component: ModelPreviewSettingsSection },
];
