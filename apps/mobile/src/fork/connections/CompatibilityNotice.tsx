import type { computersBelowCompatibilityFloor } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";

export function CompatibilityNotice({
  computers,
  onUpdate,
}: {
  readonly computers: ReturnType<typeof computersBelowCompatibilityFloor>;
  readonly onUpdate: (environmentId: EnvironmentId) => void;
}) {
  if (computers.length === 0) return null;
  return (
    <SettingsSection title="Computer updates needed">
      {computers.map((computer) => (
        <ListActionRow
          key={computer.environmentId}
          label={`${computer.label} is older than this Loom supports.`}
          detail="Update"
          onPress={() => onUpdate(computer.environmentId)}
        />
      ))}
    </SettingsSection>
  );
}
