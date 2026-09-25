import { PanelTopIcon } from "lucide-react";

import type { ForkPanelDefinition } from "../panels/types";
import { ThreadInspectorPanel } from "./ThreadInspectorPanel";

export const THREAD_INSPECTOR_PANEL_ID = "thread-inspector";

export const threadInspectorPanel: ForkPanelDefinition = {
  id: THREAD_INSPECTOR_PANEL_ID,
  title: "Inspector",
  icon: PanelTopIcon,
  shortcut: "I",
  description: "Status, workspace, changes and what needs you, for this thread.",
  unavailableHint: "Open a thread to inspect it.",
  isAvailable: ({ threadRef }) => threadRef !== null,
  Component: ThreadInspectorPanel,
};
