import { lazy, Suspense } from "react";
import { SquareTerminalIcon } from "lucide-react";
import type { ForkPanelDefinition } from "../panels/types";
const DevEnvironmentPanel = lazy(() => import("./DevEnvironmentPanel"));
export const devEnvironmentPanel: ForkPanelDefinition = {
  id: "browser-dev-tools",
  title: "Development",
  icon: SquareTerminalIcon,
  shortcut: "V",
  description:
    "Run this checkout, inspect logs and Browser errors, and manage development services.",
  unavailableHint: "Needs a Loom server with development tools",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes("browser-dev-tools"),
  Component: (props) => (
    <Suspense fallback={<p className="p-4 text-sm">Loading development tools...</p>}>
      <DevEnvironmentPanel {...props} />
    </Suspense>
  ),
};
