import type { ComposerTrigger } from "~/composer-logic";
import { projectNotesSupported } from "./composerBridgeStore";
export function detectProjectNotesTrigger(
  text: string,
  cursorInput: number,
  supported: boolean,
): ComposerTrigger | null {
  if (!supported) return null;
  const cursor = Math.max(0, Math.min(text.length, cursorInput));
  const match = /(?:^|\s)%([a-z-]*)$/.exec(text.slice(0, cursor));
  return match
    ? {
        kind: "loom:project-notes",
        query: match[1] ?? "",
        rangeStart: cursor - (match[1]?.length ?? 0) - 1,
        rangeEnd: cursor,
      }
    : null;
}
export const projectNotesTrigger = {
  id: "project-profiles",
  kind: "loom:project-notes" as const,
  label: "Project notes",
  detect: (text: string, cursor: number) =>
    detectProjectNotesTrigger(text, cursor, projectNotesSupported()),
};
