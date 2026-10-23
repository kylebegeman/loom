import { useState, type ReactNode } from "react";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import { type ModelEsque } from "~/components/chat/providerIconUtils";
import {
  type ProviderInstanceEntry,
  isProviderInstancePickerVisible,
  isProviderInstancePickerReady,
} from "~/providerInstances";
import { withSwitchboardEntries } from "~/fork/switchboard/switchboardPicker";
import { LibraryPaletteView } from "./LibraryPalette";

function ModelPalette({
  instanceEntries,
  modelOptionsByInstance,
  selection,
  onSelect,
  onBack,
  onClose,
  getModelDisabledReason,
  footer,
}: {
  readonly instanceEntries: readonly ProviderInstanceEntry[];
  readonly activeInstanceId: ProviderInstanceId;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, readonly ModelEsque[]>;
  readonly selection: ModelSelection | null;
  readonly onSelect: (selection: ModelSelection) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly getModelDisabledReason?:
    | ((instanceId: ProviderInstanceId, model: string) => string | null)
    | undefined;
  readonly footer?: ReactNode | undefined;
}) {
  const [search, setSearch] = useState("");
  return (
    <LibraryPaletteView
      title="Choose a model"
      placeholder="Search models or providers..."
      query={search}
      onQueryChange={setSearch}
      onBack={onBack}
      onClose={onClose}
      items={instanceEntries.filter(isProviderInstancePickerVisible).flatMap((entry) =>
        (modelOptionsByInstance.get(entry.instanceId) ?? entry.models).map((model) => {
          const reason =
            getModelDisabledReason?.(entry.instanceId, model.slug) ??
            ("isUnavailable" in model && model.isUnavailable
              ? "Model unavailable"
              : !isProviderInstancePickerReady(entry)
                ? "Set up this provider in Settings"
                : null);
          return {
            id: `${entry.instanceId}:${model.slug}`,
            title: model.name,
            description: `${entry.displayName}${reason ? `: ${reason}` : ""}`,
            terms: [model.slug, ...(model.aliases ?? [])],
            icon: <BotIcon className="size-4" />,
            disabled: reason !== null,
            selected: selection?.instanceId === entry.instanceId && selection.model === model.slug,
            select: () =>
              onSelect(
                selection?.instanceId === entry.instanceId && selection.model === model.slug
                  ? selection
                  : { instanceId: entry.instanceId, model: model.slug },
              ),
          };
        }),
      )}
    >
      {footer}
    </LibraryPaletteView>
  );
}

export const LibraryModelPalette = withSwitchboardEntries(ModelPalette);
