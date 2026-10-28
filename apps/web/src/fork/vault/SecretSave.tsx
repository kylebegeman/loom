import { useState } from "react";
import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  supportsLoomFeature,
  secretSaveTarget,
  VAULT_SEARCH_DEBOUNCE_MS,
} from "@t3tools/client-runtime/fork";
import { VAULT_SECRET_FEATURE, type VaultItemPage, type VaultError } from "@t3tools/contracts/fork";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useDebouncedValue } from "~/state/queries";
import { Button } from "~/components/ui/button";
import * as Redacted from "effect/Redacted";
import { useServerConfigs } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { randomUUID } from "~/lib/utils";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { vault } from "./state";
const EMPTY = Atom.make(AsyncResult.initial<VaultItemPage, VaultError>(false));
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
  const [saveAsNew, setSaveAsNew] = useState(false);
  const query = useDebouncedValue(name.trim().slice(0, 100), VAULT_SEARCH_DEBOUNCE_MS);
  const matchingSupported = supportsLoomFeature(
    configs.get(environmentId)?.environment.capabilities,
    VAULT_SECRET_FEATURE,
  );
  const matchAtom = matchingSupported
    ? vault.list({
        environmentId,
        input: { cursor: null, includeArchived: false, query, sort: "label" },
      })
    : EMPTY;
  const matches = useAtomValue(matchAtom);
  const refresh = useAtomRefresh(matchAtom);
  const target = secretSaveTarget(
    Option.getOrNull(AsyncResult.value(matches))?.items ?? [],
    name,
    saveAsNew,
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beforeReply = async (secret: string) => {
    if (!enabled || saved) return true;
    if (!allowed || !supported || !name.trim()) {
      setError("Enter a Vault name and check your write access to this computer.");
      return false;
    }
    if (
      matchingSupported &&
      (query !== name.trim().slice(0, 100) || matches.waiting || matches._tag !== "Success")
    ) {
      setError("Wait for the saved-item lookup, or retry if Vault is unavailable.");
      return false;
    }
    const result = await save({
      environmentId,
      input: {
        id: target?.id ?? id,
        operationId: id,
        expectedVersion: target?.version ?? 0,
        label: name.trim(),
        kind: target?.kind ?? "secret",
        value: Redacted.make(secret),
      },
    });
    if (result._tag === "Failure") {
      setError(
        "Could not save this item. It may have changed. Refresh and retry, or uncheck this option to answer only.",
      );
      return false;
    }
    setSaved(true);
    setError(null);
    return true;
  };
  const control = (disabled: boolean) =>
    supported || enabled ? (
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={enabled}
            disabled={disabled || saved || (!allowed && !enabled)}
            onCheckedChange={setEnabled}
          />
          {target ? `Replace value of ${target.label}` : "Also save to Vault as"}
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
        {enabled && matchingSupported ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || saved}
            onClick={() => setSaveAsNew(!saveAsNew)}
          >
            {saveAsNew ? "Use matching item" : "Save as new"}
          </Button>
        ) : null}
        {saved ? (
          <p role="status" className="text-xs text-muted-foreground">
            Saved to Vault as {name}. The private request still needs to finish.
          </p>
        ) : null}
        {error && matchingSupported ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              refresh();
              setError(null);
            }}
          >
            Refresh matching item
          </Button>
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
