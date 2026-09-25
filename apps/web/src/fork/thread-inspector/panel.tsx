import { PanelTopIcon } from "lucide-react";

import { ScrollArea } from "~/components/ui/scroll-area";
import type { ForkPanelDefinition, ForkPanelProps } from "../panels/types";
import { ThreadInspector } from "./ThreadInspector";

export const THREAD_INSPECTOR_PANEL_ID = "thread-inspector";

/** Mounted only while its tab is visible, so a hidden tab derives nothing. */
function ThreadInspectorPanel({ threadRef, visible }: ForkPanelProps) {
  if (!visible) return null;
  return (
    <ScrollArea className="h-full min-h-0">
      <div className="p-2">
        <ThreadInspector threadRef={threadRef} density="full" />
      </div>
    </ScrollArea>
  );
}

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
