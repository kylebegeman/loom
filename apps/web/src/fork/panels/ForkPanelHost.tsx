import { findForkPanel } from "./registry";
import type { ForkPanelProps } from "./types";

/** Renders a fork surface; a surface whose panel is gone from this build explains itself. */
export function ForkPanelHost(props: ForkPanelProps) {
  const panel = findForkPanel(props.surface.panelId);
  if (!panel) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        This Loom panel is not available in this build. Close the tab to remove it.
      </div>
    );
  }
  const Component = panel.Component;
  return <Component {...props} />;
}
