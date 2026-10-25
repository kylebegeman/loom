import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import * as Redacted from "effect/Redacted";
import { useServerConfigs } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { randomUUID } from "~/lib/utils";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { vault } from "./state";
const newId = () => randomUUID().replaceAll("-", "");
export function useSecretVaultSave(environmentId: EnvironmentId, initialName: string) {
  const configs = useServerConfigs();
  const allowed = useAtomValue(vault.save.permissionAtom(environmentId));
  const supported = supportsLoomFeature(
    configs.get(environmentId)?.environment.capabilities,
    "vault-core",
  );
  const save = useAtomCommand(vault.save, { reportFailure: false, reportDefect: false });
  const [id] = useState(newId);
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState(initialName.slice(0, 200));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beforeReply = async (secret: string) => {
    if (!enabled || saved) return true;
    if (!allowed || !supported || !name.trim()) {
      setError("Enter a Vault name and check your write access to this computer.");
      return false;
    }
    const result = await save({
      environmentId,
      input: {
        id,
        operationId: id,
        expectedVersion: 0,
        label: name.trim(),
        kind: "secret",
        value: Redacted.make(secret),
      },
    });
    if (result._tag === "Failure") {
      setError(
        "Could not confirm the Vault save. Retry with the same name and value, or uncheck this option to answer only.",
      );
      return false;
    }
    setSaved(true);
    setError(null);
    return true;
  };
  const control = (disabled: boolean) =>
    supported ? (
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={enabled}
            disabled={disabled || saved || !allowed}
            onCheckedChange={setEnabled}
          />
          Also save to Vault as
        </label>
        {enabled ? (
          <Input
            aria-label="Vault item name"
            value={name}
            maxLength={200}
            disabled={disabled || saved || !allowed}
            onChange={(event) => setName(event.target.value)}
          />
        ) : null}
        {saved ? (
          <p role="status" className="text-xs text-muted-foreground">
            Saved to Vault as {name}. The private request still needs to finish.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    ) : null;
  return { beforeReply, control, saved };
}
