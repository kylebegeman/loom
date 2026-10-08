import { lazy, Suspense } from "react";
import { CircuitBoardIcon } from "lucide-react";
import type { ForkPanelDefinition } from "../panels/types";
const PcbPanel = lazy(() => import("./PcbPreviewPanel"));
export const pcbPreviewPanel: ForkPanelDefinition = {
  id: "pcb-preview",
  title: "PCB preview",
  icon: CircuitBoardIcon,
  shortcut: "Z",
  description: "Preview schematics and boards, then review KiCad design checks.",
  unavailableHint: "Needs a Loom server with PCB preview.",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes("pcb-preview"),
  Component: (props) => (
    <Suspense
      fallback={
        <p role="status" className="p-3">
          Loading PCB preview...
        </p>
      }
    >
      <PcbPanel {...props} />
    </Suspense>
  ),
};
