import { lazy, Suspense } from "react";
import { BoxIcon } from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useRouteThread } from "../routeThread";
import { useAgentModelMarks } from "./agentModelMarks";
import type { ForkPanelDefinition, ForkRightPanelSurface } from "../panels/types";
const ModelPanel = lazy(() => import("./ModelPanel"));
function ModelTabIcon({
  surface,
  className,
}: {
  surface: ForkRightPanelSurface;
  className?: string;
}) {
  const threadRef = useRouteThread()?.threadRef;
  const mark = useAgentModelMarks((state) =>
    threadRef && surface.resourceId
      ? state.marks[scopedThreadKey(threadRef)]?.[surface.resourceId]
      : undefined,
  );
  if (!mark) return <BoxIcon className={className} />;
  const label = `Changed by the agent in turn ${mark.turn}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn("relative inline-flex", className)} aria-label={label} />}
      >
        <BoxIcon className="size-full" />
        <span
          className="absolute right-0 bottom-0 size-1.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
export const modelPreview3dPanel: ForkPanelDefinition = {
  id: "model-preview-3d",
  title: "3D model",
  icon: BoxIcon,
  TabIcon: ModelTabIcon,
  shortcut: "O",
  description: "Preview parts, customize OpenSCAD, and capture views for the agent.",
  unavailableHint: "This environment does not support 3D model preview.",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes("model-preview-3d"),
  Component: (props) => (
    <Suspense fallback={<p className="p-3">Loading 3D model panel...</p>}>
      <ModelPanel {...props} />
    </Suspense>
  ),
};
