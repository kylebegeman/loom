import { ChevronLeftIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { DEFAULT_UTILITY_TOOL_ID } from "./registry-meta";
import { findUtilityTool } from "./registry";
import { useUtilitiesStore } from "./store";
import { ToolList } from "./ToolList";
import { ToolView } from "./ToolView";

/**
 * The list and the selected tool, shared by the panel and the dialog. Under 480 px they stack:
 * the list until a tool is picked, then the tool with a way back.
 */
export default function UtilitiesView() {
  const selectedToolId = useUtilitiesStore((state) => state.selectedToolId);
  const recent = useUtilitiesStore((state) => state.recent);
  const [pane, setPane] = useState<"list" | "tool">(selectedToolId ? "tool" : "list");
  const [seenToolId, setSeenToolId] = useState(selectedToolId);
  if (seenToolId !== selectedToolId) {
    // Opened on a tool from the palette or the keybinding while already mounted.
    setSeenToolId(selectedToolId);
    setPane("tool");
  }
  const tool = findUtilityTool(selectedToolId ?? DEFAULT_UTILITY_TOOL_ID);

  return (
    <div className="@container flex h-full min-h-0 min-w-0">
      <div
        className={cn(
          "min-h-0 w-full flex-col @min-[480px]:flex @min-[480px]:w-45 @min-[480px]:shrink-0 @min-[480px]:border-e",
          pane === "list" ? "flex" : "hidden",
        )}
      >
        <ToolList
          selectedId={tool?.id ?? null}
          recent={recent}
          onSelect={(toolId) => {
            useUtilitiesStore.getState().select(toolId);
            setPane("tool");
          }}
        />
      </div>
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto @min-[480px]:block",
          pane === "tool" ? "block" : "hidden",
        )}
      >
        <div className="px-2 pt-2 @min-[480px]:hidden">
          <Button size="xs" variant="ghost" onClick={() => setPane("list")}>
            <ChevronLeftIcon />
            All tools
          </Button>
        </div>
        {tool ? <ToolView key={tool.id} tool={tool} /> : null}
      </div>
    </div>
  );
}
