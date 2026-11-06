import type { EnvironmentId } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { View } from "react-native";

import { Button } from "../../components/ui/Button"; // fork: fleet-connections
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ConnectionEnvironmentRow } from "./ConnectionEnvironmentRow";

type EnvironmentRowProps = ComponentProps<typeof ConnectionEnvironmentRow>;

// fork: fleet-connections - Computer wording matches the unified inventory.
export function LocalEnvironmentList({
  environments,
  expandedId,
  onToggle,
  onConnect, // fork: fleet-connections
  ...rowActions
}: Pick<
  EnvironmentRowProps,
  "onReconnect" | "onRemove" | "onSetEnabled" | "onUpdate" | "opensDetails"
> & {
  readonly environments: ReadonlyArray<EnvironmentRowProps["environment"]>;
  readonly expandedId: EnvironmentId | null;
  readonly onConnect?: () => void; // fork: fleet-connections
  readonly onToggle: (environmentId: EnvironmentId) => void;
}) {
  if (environments.length === 0) {
    return (
      <View collapsable={false} className="items-start gap-4 py-4">
        <View className="size-14 items-center justify-center rounded-full bg-secondary">
          <SymbolView
            name="point.3.connected.trianglepath.dotted"
            size={20}
            tintColorClassName="accent-secondary-foreground"
            type="monochrome"
          />
        </View>
        <Text textRole="body" className="text-foreground-muted">
          {/* fork: fleet-connections */}
          No computers connected yet. Add the computer where your agents and project folders live.
        </Text>
        {/* fork: fleet-connections */}
        {onConnect ? <Button label="Connect computer" tone="primary" onPress={onConnect} /> : null}
      </View>
    );
  }

  return (
    <View collapsable={false} className="overflow-hidden rounded-[24px] bg-grouped-card">
      {environments.map((environment, index) => (
        <View key={environment.environmentId} collapsable={false}>
          {index > 0 ? <View className="ms-18 h-px bg-border-subtle" /> : null}
          <ConnectionEnvironmentRow
            environment={environment}
            expanded={expandedId === environment.environmentId}
            onToggle={() => onToggle(environment.environmentId)}
            {...rowActions}
          />
        </View>
      ))}
    </View>
  );
}
