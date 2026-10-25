import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultSshPinnedKey, VaultSshTarget } from "@t3tools/contracts/fork";
import { createVaultSshAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "~/connection/runtime";
import { Button } from "~/components/ui/button";
import { LoomSettingsNotice } from "../settings/parts";
import { runVault } from "./state";
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
  const [keys, setKeys] = useState<ReadonlyArray<VaultSshPinnedKey> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    if (busy || disabled || !allowed) return;
    setBusy(true);
    setError(null);
    setKeys(null);
    try {
      setKeys(
        await runVault(ssh.pinnedKeys, {
          environmentId,
          input: { hostname: target.hostname, port: target.port },
        }),
      );
    } catch {
      setError("Could not read host keys on this computer. Paste a verified key below.");
    }
    setBusy(false);
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={disabled || busy || !allowed}
          onClick={() => void find()}
        >
          {busy ? "Reading this computer's host keys…" : "Find pinned keys on this computer"}
        </Button>
      </div>
      {keys?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved Ed25519 key for this host on the selected computer. Paste a verified key below.
        </p>
      ) : null}
      {keys?.map((key) => (
        <div
          key={`${key.sourceFile}:${key.fingerprint}`}
          className="flex min-w-0 flex-col gap-1 text-sm"
        >
          <p className="break-all">
            {key.sourceFile} ·{" "}
            {key.source === "global"
              ? "Global known-hosts pins"
              : "User known-hosts entry, possibly trusted on first use"}
          </p>
          <p className="break-all">
            {key.hostname}:{key.port} · {key.fingerprint}
          </p>
          <div>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => onSelect(key)}
            >
              Use pinned key from this computer
            </Button>
          </div>
        </div>
      ))}
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
    </div>
  );
}
