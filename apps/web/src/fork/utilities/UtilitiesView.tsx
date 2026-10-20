import { ChevronLeftIcon } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<"list" | "tool">(selectedToolId ? "tool" : "list");
  const [seenToolId, setSeenToolId] = useState(selectedToolId);
  if (seenToolId !== selectedToolId) {
    // Opened on a tool from the palette or the keybinding while already mounted.
    setSeenToolId(selectedToolId);
    setPane("tool");
  }
  const tool = findUtilityTool(selectedToolId ?? DEFAULT_UTILITY_TOOL_ID);

  const showPane = (next: "list" | "tool") => {
    flushSync(() => setPane(next));
    // Focus moves only when it would otherwise be on the page: stacked, the control just used
    // is now hidden, and in Safari a click never focuses a button.
    const active = document.activeElement;
    if (active && active !== document.body && active.checkVisibility()) return;
    const root = rootRef.current;
    const target =
      next === "tool"
        ? root?.querySelector<HTMLElement>("[data-utility-heading]")
        : (root?.querySelector<HTMLElement>('nav [aria-current="true"]') ??
          root?.querySelector<HTMLElement>('input[type="search"]'));
    target?.focus();
  };

  return (
    <div ref={rootRef} className="@container flex h-full min-h-0 min-w-0">
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
            showPane("tool");
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
          <Button size="xs" variant="ghost" onClick={() => showPane("list")}>
            <ChevronLeftIcon />
            All tools
          </Button>
        </div>
        {tool ? (
          <div className="flex min-w-0 flex-col gap-3 p-3">
            {/* Outside the keyed tool so a switch keeps it: the palette closing over the dialog
                returns focus to the element it found focused, and that must still exist. */}
            <h2 data-utility-heading tabIndex={-1} className="font-medium text-sm outline-none">
              {tool.label}
            </h2>
            <ToolView key={tool.id} tool={tool} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
