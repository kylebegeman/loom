import type { ReactNode } from "react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import type { ComposerControlSize } from "~/components/chat/ComposerControl";
import { useAttachedBotRunsBlock } from "../bots/composer/AttachedRunsChip";
import { useBotRunDrawer } from "../bots/composer/BotRunDrawer";

/** What a fork composer feature knows about the composer it sits in. */
export interface ForkComposerContext {
  readonly environmentId: EnvironmentId;
  /** Null for a draft, which has no thread on the server yet. */
  readonly threadRef: ScopedThreadRef | null;
  readonly projectId: ProjectId | null;
}

export type ForkPromptReplace = (
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
  options?: { expectedText?: string; focusEditorAfterReplace?: boolean },
) => boolean;

/** A footer control. Null when it has nothing to show, so it takes no room in the footer. */
export interface ForkComposerBlock {
  readonly id: string;
  readonly render: (size: ComposerControlSize) => ReactNode;
}

/**
 * The fork's composer features, called in a fixed order so hook order never changes. A packet
 * adds one hook call here. The first open drawer wins.
 */
export function useForkComposer(context: ForkComposerContext) {
  const blocks = [useAttachedBotRunsBlock(context)].filter(
    (block): block is ForkComposerBlock => block !== null,
  );
  const drawer = useBotRunDrawer(context);
  return {
    context,
    drawer,
    /** Prepended to the footer blocks: upstream hides blocks from the end, by position. */
    blockDefs: (size: ComposerControlSize) =>
      blocks.map((block) => ({ id: `loom:${block.id}`, content: block.render(size) })),
  };
}
