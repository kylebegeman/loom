import { lazy, Suspense } from "react";
import { BookOpenIcon } from "lucide-react";
import { useQuietThreadShell } from "~/state/entities";
import type { ForkPanelDefinition, ForkPanelProps } from "../panels/types";
import { FEATURE } from "./constants";
const SkillManager = lazy(() => import("./SkillManager"));
function SkillsPanel({ threadRef, surface, visible }: ForkPanelProps) {
  const thread = useQuietThreadShell(threadRef);
  if (!visible) return null;
  const tab =
    surface.resourceId === "sources" || surface.resourceId === "lab"
      ? surface.resourceId
      : "skills";
  return (
    <Suspense fallback={<p className="p-4 text-sm">Loading Skills…</p>}>
      <SkillManager
        key={`${threadRef.environmentId}:${threadRef.threadId}:${tab}`}
        environmentId={threadRef.environmentId}
        initialProjectId={thread?.projectId ?? null}
        initialTab={tab}
      />
    </Suspense>
  );
}
export const skillsPanel: ForkPanelDefinition = {
  id: FEATURE,
  title: "Skills",
  icon: BookOpenIcon,
  shortcut: "K",
  description: "Manage skills, install from git and create or test skills in the Lab.",
  unavailableHint: "Needs a Loom server with Skills",
  isAvailable: ({ threadRef, loomFeatures }) =>
    threadRef !== null && loomFeatures.includes(FEATURE),
  Component: SkillsPanel,
};
