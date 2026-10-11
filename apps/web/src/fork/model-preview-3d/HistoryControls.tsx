import { HistoryIcon } from "lucide-react";
import { ModelTool } from "./WorkspaceTools";
export function HistoryControls({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <ModelTool label="Model history" kbd="T" aria-pressed={open} onClick={onToggle}>
      <HistoryIcon />
    </ModelTool>
  );
}
