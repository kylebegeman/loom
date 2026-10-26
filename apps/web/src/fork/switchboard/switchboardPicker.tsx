import {
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type EnvironmentId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { memo, useCallback, useMemo, type ComponentType, type ReactNode } from "react";

import { getDisplayModelName, type ModelEsque } from "~/components/chat/providerIconUtils";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { usePrimaryEnvironmentId } from "~/state/environments";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  type ProviderInstanceEntry,
} from "~/providerInstances";
import {
  hasSwitchboardBlocks,
  isSwitchboardAvailabilityUnknown,
  switchboardModelBlock,
  useSwitchboardStatus,
} from "./switchboardLimits";

/** Drivers whose accounts Switchboard pools. Other providers keep every instance. */
const POOLED_DRIVERS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
]);

/**
 * With Switchboard on, the hub picks the account, so the picker shows one Claude and one Codex.
 * Each driver keeps the selected instance when it has that driver, else its first ready one, so the
 * composer still sends a real instance. The kept entry takes the plain brand name and no accent.
 */
export function collapseForSwitchboard(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  activeInstanceId: ProviderInstanceId | undefined,
): ReadonlyArray<ProviderInstanceEntry> {
  const kept = new Map<ProviderDriverKind, ProviderInstanceEntry>();
  for (const driverKind of POOLED_DRIVERS) {
    const candidates = entries.filter((entry) => entry.driverKind === driverKind);
    const representative =
      candidates.find((entry) => entry.instanceId === activeInstanceId) ??
      candidates.find(isProviderInstancePickerReady) ??
      candidates.find(isProviderInstancePickerVisible);
    if (representative) kept.set(driverKind, representative);
  }
  return entries.flatMap((entry) => {
    if (!POOLED_DRIVERS.has(entry.driverKind)) return [entry];
    if (kept.get(entry.driverKind) !== entry) return [];
    return [
      {
        ...entry,
        displayName: PROVIDER_DISPLAY_NAMES[entry.driverKind] ?? entry.displayName,
        accentColor: undefined,
      },
    ];
  });
}

type ModelDisabledReason = (instanceId: ProviderInstanceId, model: string) => string | null;

interface PickerProps {
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly activeInstanceId: ProviderInstanceId;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly getModelDisabledReason?: ModelDisabledReason | undefined;
  /** Rendered below the model list. */
  readonly footer?: ReactNode | undefined;
}

/** Shown when Switchboard cannot report availability, in place of a spinner or a guess. */
function SwitchboardUnknownNote({ unconfigured }: { readonly unconfigured: boolean }) {
  return (
    <p role="status" className="border-t px-3 py-2 text-xs text-muted-foreground">
      {unconfigured
        ? "Switchboard availability is unknown because this server has no Switchboard controller configured."
        : "Switchboard availability is unknown right now."}{" "}
      Every model stays selectable, and a turn reports any limit it hits.
    </p>
  );
}

/**
 * Shows the collapsed entries while Switchboard is on, and disables, with the reason, models the
 * hub confirms it cannot serve now: one reported unavailable, all but credit models while every
 * Codex account is on credits, or a provider with no allowance left. The caller's reasons come
 * first. With availability unknown nothing is disabled, and the picker says so.
 */
export function withSwitchboardEntries<P extends PickerProps>(Picker: ComponentType<P>) {
  const ScopedPicker = memo(function EnvironmentSwitchboardModelPicker(
    props: P & { readonly environmentId: EnvironmentId },
  ) {
    const enabled = useEnvironmentSettings(
      props.environmentId,
      (settings) => settings.switchboardEnabled,
    );
    const status = useSwitchboardStatus(enabled, props.environmentId);
    const { instanceEntries, activeInstanceId, modelOptionsByInstance, getModelDisabledReason } =
      props;
    const collapsed = useMemo(
      () => (enabled ? collapseForSwitchboard(instanceEntries, activeInstanceId) : instanceEntries),
      [enabled, instanceEntries, activeInstanceId],
    );
    const switchboardReason = useCallback<ModelDisabledReason>(
      (instanceId, model) => {
        const own = getModelDisabledReason?.(instanceId, model) ?? null;
        if (own !== null) return own;
        const driverKind = instanceEntries.find(
          (entry) => entry.instanceId === instanceId,
        )?.driverKind;
        if (!driverKind) return null;
        const options = modelOptionsByInstance.get(instanceId) ?? [];
        return switchboardModelBlock(status, driverKind, model, (slug) => {
          const option = options.find((candidate) => candidate.slug === slug);
          return option ? getDisplayModelName(option, { preferShortName: true }) : slug;
        });
      },
      [getModelDisabledReason, instanceEntries, modelOptionsByInstance, status],
    );
    return (
      <Picker
        {...props}
        instanceEntries={collapsed}
        {...(hasSwitchboardBlocks(status) ? { getModelDisabledReason: switchboardReason } : {})}
        {...(isSwitchboardAvailabilityUnknown(status)
          ? {
              footer: (
                <SwitchboardUnknownNote unconfigured={status.availability === "unconfigured"} />
              ),
            }
          : {})}
      />
    );
  });
  // A caller that has not resolved an environment follows the primary one.
  return memo(function SwitchboardModelPicker(
    props: P & { readonly environmentId?: EnvironmentId | null },
  ) {
    const primaryEnvironmentId = usePrimaryEnvironmentId();
    const environmentId = props.environmentId ?? primaryEnvironmentId;
    return environmentId === null ? (
      <Picker {...props} />
    ) : (
      <ScopedPicker {...props} environmentId={environmentId} />
    );
  });
}
