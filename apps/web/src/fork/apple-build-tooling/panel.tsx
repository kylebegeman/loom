import { lazy, Suspense } from "react";
import { HammerIcon } from "lucide-react";
import type { ForkPanelDefinition } from "../panels/types";
const AppleBuildPanel = lazy(() => import("./AppleBuildPanel"));
export const appleBuildToolingPanel: ForkPanelDefinition = {
  id: "apple-build-tooling",
  title: "Apple build",
  icon: HammerIcon,
  shortcut: "X",
  description: "Build, test and run Xcode projects and Swift packages, and read the results.",
  unavailableHint: "Needs a Loom server with Apple build tooling",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes("apple-build-tooling"),
  Component: (props) => (
    <Suspense fallback={<p className="p-3">Loading Apple build panel...</p>}>
      <AppleBuildPanel {...props} />
    </Suspense>
  ),
};
