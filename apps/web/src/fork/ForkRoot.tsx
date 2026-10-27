import { ProjectProfileHost } from "./project-profiles/ProjectProfileHost";

import { VaultPasswordGeneratorHost } from "./vault/PasswordGenerator";
import { VaultAccessHost } from "./vault/AccessHost";
import { WorkspaceHandoffHost } from "./workspace-handoff/WorkspaceHandoffHost";
import { PcbPreviewCommandHost } from "./pcb-preview/commands";
import { ModelPreview3dShortcuts } from "./model-preview-3d/Shortcuts";
import { ProjectLifecycleHost } from "./project-lifecycle/StorageHost";
import { AppleBuildToolingShortcuts } from "./apple-build-tooling/Shortcuts";
import { DeviceQaShortcuts } from "./device-qa/Shortcuts";
import { CodeGraphOpenWatcher } from "./code-graph/CodeGraphOpenWatcher";
import { PreviewLinksHost } from "./preview-links/LinksSheet";
import { UtilitiesDialogHost } from "./utilities/UtilitiesDialogHost";
import type { ComponentType } from "react";

import { FileOutlineShortcuts } from "./file-outline/FileOutlineShortcuts";
import { ForkGlobalShortcuts } from "./keybindings/ForkGlobalShortcuts";
import { EmptyConversationOffer } from "./project-library/EmptyConversationOffer";
import { LibraryConnectHost } from "./project-library/LibraryConnectDialog";
import { PanelPickerCommandHost } from "./panel-picker/PanelPickerCommandHost";
import { LocalUpdateInstallHost } from "./connections/LocalUpdateInstallHost";
import { ScheduledTaskFailureAlertsHost } from "./scheduled-task-alerts/ScheduledTaskFailureAlertsHost";

/** Components mounted once in the authenticated app shell. One line per packet. */
const FORK_ROOT_COMPONENTS: ReadonlyArray<{
  readonly id: string;
  readonly Component: ComponentType;
}> = [
  { id: "project-profile-host", Component: ProjectProfileHost },

  { id: "vault-passwords", Component: VaultPasswordGeneratorHost },
  { id: "vault-access", Component: VaultAccessHost },
  { id: "file-outline-shortcuts", Component: FileOutlineShortcuts },
  { id: "model-preview-3d-shortcuts", Component: ModelPreview3dShortcuts },
  { id: "pcb-preview-commands", Component: PcbPreviewCommandHost },
  { id: "workspace-handoff-host", Component: WorkspaceHandoffHost },
  { id: "project-lifecycle-host", Component: ProjectLifecycleHost },
  { id: "apple-build-tooling-shortcuts", Component: AppleBuildToolingShortcuts },
  { id: "device-qa-shortcuts", Component: DeviceQaShortcuts },
  { id: "panel-picker-commands", Component: PanelPickerCommandHost },
  { id: "code-graph-open-watcher", Component: CodeGraphOpenWatcher },
  { id: "preview-links-host", Component: PreviewLinksHost },
  { id: "utilities-dialog", Component: UtilitiesDialogHost },
  { id: "shortcuts", Component: ForkGlobalShortcuts },
  { id: "local-update-install", Component: LocalUpdateInstallHost },
  { id: "library-empty-conversations", Component: EmptyConversationOffer },
  { id: "library-connect", Component: LibraryConnectHost },
  { id: "scheduled-task-alerts", Component: ScheduledTaskFailureAlertsHost },
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
