import { WrenchIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import type { ForkPanelDefinition } from "../panels/types";

const UtilitiesView = lazy(() => import("./UtilitiesView"));

// Here, not in open.ts: open.ts imports the panel registry, which imports this file.
export const UTILITIES_PANEL_ID = "utilities";

export const utilitiesPanel: ForkPanelDefinition = {
  id: UTILITIES_PANEL_ID,
  title: "Utilities",
  icon: WrenchIcon,
  shortcut: "U",
  description: "Encode, hash, generate, convert and inspect text without leaving the thread.",
  unavailableHint: "Open a thread to use Utilities in the panel.",
  // Every tool runs in the browser, so any server works, upstream ones included.
  isAvailable: ({ threadRef }) => threadRef !== null,
  Component: () => (
    <Suspense fallback={<p className="p-3 text-muted-foreground text-sm">Loading utilities...</p>}>
      <UtilitiesView />
    </Suspense>
  ),
};
