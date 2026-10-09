import type { ComponentType } from "react";

/** Both upstream surface action arrays and ForkSurfaceAction satisfy this. */
export interface PanelPickerAction {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly shortcut: string;
  readonly available: boolean;
  readonly disabledReason: string;
  readonly onClick: () => void;
  readonly description?: string | undefined;
}

export interface PanelPickerBrowserProfiles {
  readonly profiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onOpenInProfile: (profileId: string) => void;
}
