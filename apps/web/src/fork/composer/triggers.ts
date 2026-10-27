import type { ComposerTrigger } from "~/composer-logic";
import { projectNotesTrigger } from "../project-profiles/composerTrigger";
const FORK_COMPOSER_TRIGGERS: readonly {
  readonly id: string;
  readonly kind: `loom:${string}`;
  readonly label: string;
  readonly detect: (text: string, cursor: number) => ComposerTrigger | null;
}[] = [projectNotesTrigger];
export function detectForkComposerTrigger(text: string, cursor: number): ComposerTrigger | null {
  for (const trigger of FORK_COMPOSER_TRIGGERS) {
    const result = trigger.detect(text, cursor);
    if (result) return result;
  }
  return null;
}

export function forkComposerTriggerLabel(kind: string): string | undefined {
  return FORK_COMPOSER_TRIGGERS.find((trigger) => trigger.kind === kind)?.label;
}
