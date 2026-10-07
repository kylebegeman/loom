import { lazy, Suspense } from "react";
import { BoxIcon } from "lucide-react";
import type { ForkPanelDefinition } from "../panels/types";
const ModelPanel = lazy(() => import("./ModelPanel"));
export const modelPreview3dPanel: ForkPanelDefinition = {
  id: "model-preview-3d",
  title: "3D model",
  icon: BoxIcon,
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
