import { PcbPreviewCommandHost } from "./pcb-preview/commands";
import { ModelPreview3dShortcuts } from "./model-preview-3d/Shortcuts";
import { ProjectLifecycleHost } from "./project-lifecycle/StorageHost";
import { AppleBuildToolingShortcuts } from "./apple-build-tooling/Shortcuts";
import { DeviceQaShortcuts } from "./device-qa/Shortcuts";
import type { ComponentType } from "react";

import { FileOutlineShortcuts } from "./file-outline/FileOutlineShortcuts";
import { ForkGlobalShortcuts } from "./keybindings/ForkGlobalShortcuts";

/** Components mounted once in the authenticated app shell. One line per packet. */
const FORK_ROOT_COMPONENTS: ReadonlyArray<{
  readonly id: string;
  readonly Component: ComponentType;
}> = [
  { id: "file-outline-shortcuts", Component: FileOutlineShortcuts },
  { id: "model-preview-3d-shortcuts", Component: ModelPreview3dShortcuts },
  { id: "pcb-preview-commands", Component: PcbPreviewCommandHost },
  { id: "project-lifecycle-host", Component: ProjectLifecycleHost },
  { id: "apple-build-tooling-shortcuts", Component: AppleBuildToolingShortcuts },
  { id: "device-qa-shortcuts", Component: DeviceQaShortcuts },
  { id: "shortcuts", Component: ForkGlobalShortcuts },
  // { id: "snippets-dialog", Component: SnippetsDialogHost },
];

export function ForkRoot() {
  return (
    <>
      {FORK_ROOT_COMPONENTS.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}
