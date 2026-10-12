import { lazy, Suspense } from "react";
import { TerminalIcon } from "lucide-react";
import type { ForkPanelDefinition } from "../panels/types";
const CommandJobs = lazy(() => import("./CommandJobsPanel"));
export const miniOffloadPanel: ForkPanelDefinition = {
  id: "mini-offload",
  title: "Command jobs",
  icon: TerminalIcon,
  shortcut: "",
  description: "Run builds, tests and scripts on registered workers.",
  unavailableHint: "Command jobs require a supporting Loom server and an open thread",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes("mini-offload"),
  Component: (props) => (
    <Suspense fallback={<p className="p-3">Loading command jobs...</p>}>
      <CommandJobs {...props} />
    </Suspense>
  ),
};
