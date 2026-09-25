import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import type {
  CommandPaletteActionItem,
  CommandPaletteSubmenuItem,
} from "~/components/CommandPalette.logic";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useServerConfigs } from "~/state/entities";
import { threadInspectorPaletteSource } from "../thread-inspector/palette";

export interface ForkCommandPaletteContext {
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly loomFeatures: ReadonlyArray<string>;
}

export interface ForkCommandPaletteSource {
  readonly id: string;
  /** Pure: no hooks. Item values are `action:loom:<slug>:<name>`. */
  readonly items: (
    context: ForkCommandPaletteContext,
  ) => ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

/** One line per packet. */
export const FORK_COMMAND_PALETTE_SOURCES: ReadonlyArray<ForkCommandPaletteSource> = [
  threadInspectorPaletteSource,
  // snippetsPaletteSource,
];

/** Rebuilt on every render, like the palette's own action items. */
export function useForkCommandPaletteItems(): ReadonlyArray<
  CommandPaletteActionItem | CommandPaletteSubmenuItem
> {
  const { activeThread } = useHandleNewThread();
  const activeThreadRef = activeThread
    ? scopeThreadRef(activeThread.environmentId, activeThread.id)
    : null;
  const serverConfig = useServerConfigs().get(
    activeThreadRef?.environmentId ?? ("" as EnvironmentId),
  );
  const loomFeatures = loomFeaturesOf(serverConfig?.environment.capabilities);
  return FORK_COMMAND_PALETTE_SOURCES.flatMap((source) =>
    source.items({ activeThreadRef, loomFeatures }),
  );
}
