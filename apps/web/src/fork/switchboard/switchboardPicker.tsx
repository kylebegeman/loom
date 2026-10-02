import {
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { memo, useMemo, type ComponentType } from "react";

import { usePrimarySettings } from "~/hooks/useSettings";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  type ProviderInstanceEntry,
} from "~/providerInstances";

/** Drivers whose accounts Switchboard pools. Other providers keep every instance. */
const POOLED_DRIVERS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
]);

/**
 * With Switchboard on, the hub picks the account, so the picker shows one Claude and
 * one Codex in place of an entry per account. Each driver keeps the selected
 * instance when it has that driver, otherwise its first ready one, so the routing
 * key the composer sends is still a real instance. The kept entry takes the plain
 * brand name and no accent, which drops the account badge.
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

interface PickerProps {
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly activeInstanceId: ProviderInstanceId;
}

/** Wraps a model picker so it shows the collapsed entries while Switchboard is on. */
export function withSwitchboardEntries<P extends PickerProps>(Picker: ComponentType<P>) {
  return memo(function SwitchboardModelPicker(props: P) {
    const enabled = usePrimarySettings((settings) => settings.switchboardEnabled);
    const { instanceEntries, activeInstanceId } = props;
    const collapsed = useMemo(
      () => (enabled ? collapseForSwitchboard(instanceEntries, activeInstanceId) : instanceEntries),
      [enabled, instanceEntries, activeInstanceId],
    );
    return <Picker {...props} instanceEntries={collapsed} />;
  });
}
