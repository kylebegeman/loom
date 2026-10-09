import { lazy, Suspense } from "react";
import { ClipboardCheckIcon } from "lucide-react";
import type { ForkPanelDefinition } from "../panels/types";
const DeviceQaPanel = lazy(() => import("./DeviceQaPanel"));
export const deviceQaPanel: ForkPanelDefinition = {
  id: "device-qa",
  title: "Device QA",
  icon: ClipboardCheckIcon,
  shortcut: "Q",
  description:
    "Replay recorded UI flows on simulators and keep screenshots and recordings as evidence.",
  unavailableHint: "Needs a Loom server with Device QA",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes("device-qa"),
  Component: (props) => (
    <Suspense fallback={<p className="p-3">Loading Device QA...</p>}>
      <DeviceQaPanel {...props} />
    </Suspense>
  ),
};
