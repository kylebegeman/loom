import { useId, useState } from "react";
import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  supportsLoomFeature,
  secretSaveTarget,
  VAULT_SEARCH_DEBOUNCE_MS,
  VAULT_KIND_LABELS,
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
import { Radio, RadioGroup } from "~/components/ui/radio-group";
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
  const nameId = useId();
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
  const matchingItem = secretSaveTarget(
    Option.getOrNull(AsyncResult.value(matches))?.items ?? [],
    name,
    false,
  );
  const target = saveAsNew ? null : matchingItem;
  const lookupPending =
    matchingSupported &&
    (query !== name.trim().slice(0, 100) || matches.waiting || matches._tag === "Initial");
  const lookupFailed = matchingSupported && matches._tag === "Failure";
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
      <div className="flex min-w-0 flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={enabled}
            disabled={disabled || saved || (!allowed && !enabled)}
            onCheckedChange={setEnabled}
          />
          Also save a copy to Vault
        </label>
        {enabled ? (
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor={nameId} className="text-xs font-medium text-muted-foreground">
              Vault item name
            </label>
            <Input
              id={nameId}
              value={name}
              maxLength={200}
              disabled={disabled || saved || !allowed}
              onChange={(event) => setName(event.target.value)}
            />
            {lookupPending ? (
              <p role="status" className="text-xs text-muted-foreground">
                Checking saved items…
              </p>
            ) : lookupFailed ? (
              <p role="alert" className="text-xs text-destructive">
                Could not check saved items. Refresh the lookup before saving to Vault.
              </p>
            ) : matchingItem ? (
              <RadioGroup
                aria-label="How to save this Vault copy"
                value={saveAsNew ? "new" : "update"}
                disabled={disabled || saved || !allowed}
                onValueChange={(value) => setSaveAsNew(value === "new")}
              >
                <label className="flex min-w-0 cursor-pointer items-start gap-2.5 text-sm">
                  <span className="pt-0.5">
                    <Radio value="update" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>Update existing item</span>
                    <span className="text-xs wrap-anywhere text-muted-foreground">
                      {matchingItem.label} · {VAULT_KIND_LABELS[matchingItem.kind]} · Version{" "}
                      {matchingItem.version} · {matchingItem.id.slice(0, 8)}
                    </span>
                  </span>
                </label>
                <label className="flex min-w-0 cursor-pointer items-start gap-2.5 text-sm">
                  <span className="pt-0.5">
                    <Radio value="new" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>Create new item</span>
                    <span className="text-xs text-muted-foreground">
                      Keep the existing item unchanged.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            ) : name.trim() ? (
              <p className="text-xs text-muted-foreground">A new Vault item will be created.</p>
            ) : null}
          </div>
        ) : null}
        {saved ? (
          <p role="status" className="text-xs text-muted-foreground">
            Saved to Vault as {name}. The private request still needs to finish.
          </p>
        ) : null}
        {enabled && matchingSupported && (error || lookupFailed) ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || saved}
              onClick={() => {
                refresh();
                setError(null);
              }}
            >
              Refresh matching item
            </Button>
          </div>
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
