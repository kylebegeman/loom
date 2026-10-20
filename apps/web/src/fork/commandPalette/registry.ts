import { vaultTestAccountsPaletteSource } from "../vault/test-accounts-palette";
import { vaultMigrationPaletteSource } from "../vault/migration-palette";
import { vaultHealthPaletteSource } from "../vault/health-palette";
import { vaultProfilePaletteSource } from "../vault/profile-palette";
import { vaultSshPaletteSource } from "../vault/ssh-palette";
import { vaultAccessPaletteSource } from "../vault/access-palette";
import { workspaceHandoffPaletteSource } from "../workspace-handoff/palette";
import { miniOffloadPaletteSource } from "../mini-offload/palette";
import { pcbPreviewPaletteSource } from "../pcb-preview/palette";
import { modelPreview3dPaletteSource } from "../model-preview-3d/palette";
import { projectLifecyclePaletteSource } from "../project-lifecycle/palette";
import { appleBuildToolingPaletteSource } from "../apple-build-tooling/palette";
import { deviceQaPaletteSource } from "../device-qa/palette";
import { panelPickerPaletteSource } from "../panel-picker/palette";
import { codeGraphPaletteSource } from "../code-graph/palette";
import { previewLinksPaletteSource } from "../preview-links/palette";
import { utilitiesPaletteSource } from "../utilities/palette";
import {
  libraryPaletteSource,
  useLibraryPaletteContext,
  type LibraryPaletteContext,
} from "./library";
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
  readonly library?: LibraryPaletteContext | null;
}

export interface ForkCommandPaletteSource {
  readonly id: string;
  /** Pure: no hooks. Item values are `action:loom:<slug>:<name>`. */
  readonly items: (
    context: ForkCommandPaletteContext,
  ) => ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  /** Pure. Searched only once the user types, beside the palette's own project matches. */
  readonly searchItems?: (
    context: ForkCommandPaletteContext,
  ) => ReadonlyArray<CommandPaletteActionItem>;
}

/** One line per packet. */
export const FORK_COMMAND_PALETTE_SOURCES: ReadonlyArray<ForkCommandPaletteSource> = [
  vaultProfilePaletteSource,
  vaultSshPaletteSource,
  vaultMigrationPaletteSource,
  vaultTestAccountsPaletteSource,
  vaultHealthPaletteSource,
  vaultAccessPaletteSource,
  miniOffloadPaletteSource,
  fileOutlinePaletteSource,
  // snippetsPaletteSource,
  modelPreview3dPaletteSource,
  pcbPreviewPaletteSource,
  projectLifecyclePaletteSource,
  workspaceHandoffPaletteSource,
  appleBuildToolingPaletteSource,
  deviceQaPaletteSource,
  panelPickerPaletteSource,
  codeGraphPaletteSource,
  previewLinksPaletteSource,
  utilitiesPaletteSource,
  libraryPaletteSource,
];

/** Every source's items. The palette matches search terms only, so a string title joins them. */
export const forkCommandPaletteItems = (context: ForkCommandPaletteContext) =>
  FORK_COMMAND_PALETTE_SOURCES.flatMap((source) =>
    source
      .items(context)
      .map((item) =>
        typeof item.title === "string"
          ? { ...item, searchTerms: [item.title, ...item.searchTerms] }
          : item,
      ),
  );

export const forkCommandPaletteSearchItems = (context: ForkCommandPaletteContext) =>
  FORK_COMMAND_PALETTE_SOURCES.flatMap((source) => source.searchItems?.(context) ?? []);

/** Rebuilt on every render, like the palette's own action items. */
export function useForkCommandPaletteItems(): {
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  readonly searchItems: ReadonlyArray<CommandPaletteActionItem>;
} {
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
  const library = useLibraryPaletteContext(activeThreadRef);
  const context = { activeThreadRef, loomFeatures, modelFiles, library };
  return {
    items: forkCommandPaletteItems(context),
    searchItems: forkCommandPaletteSearchItems(context),
  };
}
