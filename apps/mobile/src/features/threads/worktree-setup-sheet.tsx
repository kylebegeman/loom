import type { ReactElement } from "react";
import { Sheet } from "../../components/ui/Sheet";

export interface WorktreeSetupSheetProps {
  children: ReactElement;
  height: number;
  onClose: () => void;
}

export function WorktreeSetupSheet({ children, onClose }: WorktreeSetupSheetProps) {
  // fork: project-lifecycle - Setup runs in every workspace, not only worktrees.
  return (
    <Sheet title="Workspace setup" onClose={onClose}>
      {children}
    </Sheet>
  );
}
