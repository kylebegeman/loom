import { lazy, Suspense } from "react";
import { NetworkIcon } from "lucide-react";
import type { ForkPanelDefinition } from "../panels/types";
import { FEATURE, PANEL_ID } from "./state";
const CodeGraphPanel = lazy(() => import("./CodeGraphPanel"));
export const codeGraphPanel: ForkPanelDefinition = {
  id: PANEL_ID,
  title: "Code map",
  icon: NetworkIcon,
  shortcut: "Y",
  description: "See how the project's files and symbols connect, and what a change can reach.",
  unavailableHint: "Needs a Loom server with the code graph",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes(FEATURE),
  Component: (props) => (
    <Suspense fallback={<p className="p-3">Loading the code map...</p>}>
      <CodeGraphPanel {...props} />
    </Suspense>
  ),
};
