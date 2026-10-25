import { useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultSshPinnedKey, VaultSshTarget } from "@t3tools/contracts/fork";
import { createVaultSshAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
const ssh = createVaultSshAtoms(connectionAtomRuntime);
export function PinnedHostKeys({
  environmentId,
  target,
  disabled,
  onSelect,
}: {
  environmentId: EnvironmentId;
  target: VaultSshTarget;
  disabled: boolean;
  onSelect: (key: VaultSshPinnedKey) => void;
}) {
  const allowed = useAtomValue(ssh.pinnedKeys.permissionAtom(environmentId));
  const lookup = useAtomCommand(ssh.pinnedKeys, { reportFailure: false });
  const [keys, setKeys] = useState<ReadonlyArray<VaultSshPinnedKey> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    if (busy || disabled || !allowed) return;
    setBusy(true);
    setError(null);
    setKeys(null);
    const result = await lookup({
      environmentId,
      input: { hostname: target.hostname, port: target.port },
    });
    if (result._tag === "Success") setKeys(result.value);
    else setError("Could not read host keys on this computer. Paste a verified key below.");
    setBusy(false);
  };
  return (
    <View className="gap-2">
      <Button
        disabled={disabled || busy || !allowed}
        onPress={() => void find()}
        label={busy ? "Reading this computer's host keys…" : "Find pinned keys on this computer"}
      />
      {keys?.length === 0 ? (
        <Text>
          No saved Ed25519 key for this host on the selected computer. Paste a verified key below.
        </Text>
      ) : null}
      {keys?.map((key) => (
        <View key={`${key.sourceFile}:${key.fingerprint}`} className="gap-1">
          <Text selectable>
            {key.sourceFile} ·{" "}
            {key.source === "global"
              ? "Global known-hosts pins"
              : "User known-hosts entry, possibly trusted on first use"}
          </Text>
          <Text selectable>
            {key.hostname}:{key.port} · {key.fingerprint}
          </Text>
          <Button
            disabled={disabled || busy}
            onPress={() => onSelect(key)}
            label="Use pinned key from this computer"
          />
        </View>
      ))}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
