import { modelPreview3dPaletteSource } from "../model-preview-3d/palette";
import { models } from "../model-preview-3d/state";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
const emptyModels = Atom.make(
  AsyncResult.initial<{
    models: readonly import("@t3tools/contracts/fork").ModelEntry[];
    truncated: boolean;
  }>(),
);
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import type {
  CommandPaletteActionItem,
  CommandPaletteSubmenuItem,
} from "~/components/CommandPalette.logic";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useServerConfigs } from "~/state/entities";
import { fileOutlinePaletteSource } from "../file-outline/palette";
import { useFileOutlineStore } from "../file-outline/store";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";

export interface ForkCommandPaletteContext {
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly modelFiles?: ReadonlyArray<string>;
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
  fileOutlinePaletteSource,
  // snippetsPaletteSource,
  modelPreview3dPaletteSource,
];

/** Rebuilt on every render, like the palette's own action items. */
export function useForkCommandPaletteItems(): ReadonlyArray<
  CommandPaletteActionItem | CommandPaletteSubmenuItem
> {
  const { activeThread } = useHandleNewThread();
  const activeThreadRef = activeThread
    ? scopeThreadRef(activeThread.environmentId, activeThread.id)
    : null;
  useFileOutlineStore((state) =>
    activeThreadRef ? state.sources[scopedThreadKey(activeThreadRef)] : undefined,
  );
  useRightPanelStore((state) => selectActiveRightPanelSurface(state.byThreadKey, activeThreadRef));
  const serverConfig = useServerConfigs().get(
    activeThreadRef?.environmentId ?? ("" as EnvironmentId),
  );
  const loomFeatures = loomFeaturesOf(serverConfig?.environment.capabilities);
  const listing = useAtomValue(
    activeThreadRef && loomFeatures.includes("model-preview-3d")
      ? models.models({
          environmentId: activeThreadRef.environmentId,
          input: { threadId: activeThreadRef.threadId },
        })
      : emptyModels,
  );
  const modelFiles =
    Option.getOrNull(AsyncResult.value(listing))?.models.map((model) => model.path) ?? [];
  return FORK_COMMAND_PALETTE_SOURCES.flatMap((source) =>
    source.items({ activeThreadRef, loomFeatures, modelFiles }),
  );
}
