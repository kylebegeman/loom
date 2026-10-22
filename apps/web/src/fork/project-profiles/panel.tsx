import { lazy, Suspense } from "react";
import { KeyRoundIcon } from "lucide-react";
import type { ForkPanelDefinition } from "../panels/types";
import { FEATURE, PANEL_ID } from "./constants";
const EnvPanel = lazy(() => import("./EnvPanel"));
export const projectEnvPanel: ForkPanelDefinition = {
  id: PANEL_ID,
  title: "Env",
  icon: KeyRoundIcon,
  shortcut: "E",
  description: "Inspect env schema, variable presence and project token budgets.",
  unavailableHint: "Needs a Loom server with project profiles",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes(FEATURE),
  Component: (props) => (
    <Suspense fallback={<p className="p-4 text-sm">Loading Env...</p>}>
      <EnvPanel {...props} />
    </Suspense>
  ),
};
