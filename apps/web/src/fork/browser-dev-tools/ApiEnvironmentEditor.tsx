import { useState } from "react";
import {
  KeyRoundIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  Undo2Icon,
  LockKeyholeIcon,
} from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  DevApiEnvironment,
  DevApiSource,
  DevApiVariable,
  VaultReference,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { VaultReferencePicker } from "~/fork/vault/ReferencePicker";
import { LabSelect } from "./HttpLabParts";
export default function ApiEnvironmentEditor({
  threadRef,
  source,
  environment,
  dirty,
  disabled,
  suggestedOrigin,
  vaultEnabled,
  onChange,
  onSave,
  onReset,
}: {
  threadRef: ScopedThreadRef;
  source: DevApiSource;
  environment: DevApiEnvironment;
  dirty: boolean;
  disabled: boolean;
  suggestedOrigin: string;
  vaultEnabled: boolean;
  onChange: (variables: readonly DevApiVariable[]) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const [search, setSearch] = useState("");
  const [newKey, setNewKey] = useState("");
  const [vaultKey, setVaultKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState(suggestedOrigin);
  const [versionMode, setVersionMode] = useState("latest");
  const [bindingError, setBindingError] = useState<string | null>(null);
  const matches = environment.variables.filter((v) =>
    v.key.toLowerCase().includes(search.toLowerCase()),
  );
  const update = (key: string, change: (variable: DevApiVariable) => DevApiVariable) =>
    onChange(environment.variables.map((v) => (v.key === key ? change(v) : v)));
  const bind = (reference: VaultReference) => {
    let destination: URL;
    try {
      destination = new URL(origin);
    } catch {
      setBindingError("Enter a complete HTTP or HTTPS origin.");
      return;
    }
    if (
      !["http:", "https:"].includes(destination.protocol) ||
      destination.username ||
      destination.password ||
      destination.origin !== origin
    ) {
      setBindingError("Use an exact API origin, such as https://api.example.com, without a path.");
      return;
    }
    if (!vaultKey || reference.item.kind !== "secret" || reference.item.state !== "active") return;
    update(vaultKey, (v) => ({
      ...v,
      value: "",
      secret: true,
      vault: {
        environmentId: threadRef.environmentId,
        itemId: reference.item.id,
        label: reference.item.label,
        origin: destination.origin,
        version: versionMode === "latest" ? null : reference.item.version,
      },
    }));
    setVaultKey(null);
    setBindingError(null);
  };
  return (
    <section aria-label="Environment variables" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h3 className="text-sm font-medium">
            Environment variables{" "}
            <span className="ml-1 text-muted-foreground">{environment.variables.length}</span>
          </h3>
          <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
            Reference values with <code className="font-mono">{"<<variable>>"}</code>. Vault values
            resolve privately when sending, for their bound API origin.
          </p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={disabled || !dirty} onClick={onReset}>
            <Undo2Icon />
            Discard
          </Button>
          <Button
            size="sm"
            disabled={disabled || !dirty || source.kind === "none"}
            onClick={onSave}
          >
            <SaveIcon />
            {source.kind === "dotenv" ? "Save .env" : "Save variables"}
          </Button>
        </div>
      </div>
      {source.kind === "none" ? (
        <p className="p-6 text-sm text-muted-foreground">
          Select an imported environment or project .env file to manage variables.
        </p>
      ) : (
        <>
          <div className="p-3">
            <Input
              aria-label="Find a variable"
              type="search"
              placeholder="Filter variable names..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-96 overflow-y-auto px-3">
            {matches.slice(0, 50).map((v) => (
              <div
                key={v.key}
                className="grid min-w-0 gap-2 border-b border-border py-3 last:border-0 @min-[580px]:grid-cols-[minmax(100px,1fr)_minmax(0,2fr)]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <code className="break-all font-mono text-xs">{v.key}</code>
                  {v.vault ? <LockKeyholeIcon className="size-3.5 shrink-0 text-primary" /> : null}
                </div>
                <div className="min-w-0 space-y-2">
                  {v.vault ? (
                    <div className="rounded-md bg-muted/50 p-2.5">
                      <p className="flex items-center gap-2 text-xs font-medium">
                        <KeyRoundIcon className="size-3.5" />
                        {v.vault.label}
                      </p>
                      <p className="mt-1 break-all text-2xs text-muted-foreground">
                        {v.vault.origin} ·{" "}
                        {v.vault.version === null ? "Latest version" : `Version ${v.vault.version}`}
                      </p>
                    </div>
                  ) : (
                    <Input
                      aria-label={`Value for ${v.key}`}
                      type={v.secret ? "password" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      value={v.value}
                      disabled={disabled}
                      placeholder="Enter a value"
                      onChange={(e) =>
                        update(v.key, (variable) => ({ ...variable, value: e.target.value }))
                      }
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                      <Checkbox
                        aria-label={`Secret ${v.key}`}
                        checked={v.secret}
                        disabled={disabled || Boolean(v.vault)}
                        onCheckedChange={(checked) =>
                          update(v.key, (variable) => ({ ...variable, secret: checked === true }))
                        }
                      />
                      Secret
                    </label>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={disabled || !vaultEnabled}
                      onClick={() => {
                        setVaultKey(v.key);
                        setOrigin(v.vault?.origin ?? suggestedOrigin);
                        setBindingError(null);
                      }}
                    >
                      <KeyRoundIcon />
                      {v.vault ? "Change Vault item" : "Use Vault"}
                    </Button>
                    {v.vault ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() =>
                          update(v.key, ({ vault: _binding, ...variable }) => ({
                            ...variable,
                            value: "",
                          }))
                        }
                      >
                        Use typed value
                      </Button>
                    ) : null}
                    {source.kind === "json" ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove variable ${v.key}`}
                        disabled={disabled}
                        onClick={() =>
                          onChange(
                            environment.variables.filter((variable) => variable.key !== v.key),
                          )
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {!matches.length ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {search ? "No matching variables." : "Add your first variable below."}
              </p>
            ) : null}
          </div>
          {matches.length > 50 ? (
            <p className="px-3 text-xs text-muted-foreground">
              Showing 50 of {matches.length}. Refine the filter to find a variable.
            </p>
          ) : null}
          <form
            className="flex gap-2 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newKey.trim() || environment.variables.some((v) => v.key === newKey.trim()))
                return;
              onChange([...environment.variables, { key: newKey.trim(), value: "", secret: true }]);
              setNewKey("");
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                aria-label="New variable name"
                placeholder="New variable name"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                disabled={disabled}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={
                disabled ||
                !newKey.trim() ||
                environment.variables.some((v) => v.key === newKey.trim())
              }
            >
              <PlusIcon />
              Add
            </Button>
          </form>
          {source.kind === "dotenv" ? (
            <p className="px-4 pb-4 text-xs leading-5 text-muted-foreground">
              Save writes typed values to the selected file and preserves comments. Vault references
              stay in Loom. Script captures are held here until you save.
            </p>
          ) : null}
        </>
      )}
      {vaultKey && vaultEnabled ? (
        <section
          aria-label="Bind a Vault value"
          className="m-3 space-y-4 rounded-lg border border-border bg-muted/20 p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-medium">
                Vault value for <code>{vaultKey}</code>
              </h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Select an existing secret. Its value stays on the execution computer.
              </p>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setVaultKey(null)}>
              Cancel
            </Button>
          </div>
          <label className="block space-y-1.5 text-xs">
            <span>Allowed API origin</span>
            <Input
              aria-label="Allowed API origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://api.example.com"
              disabled={disabled}
            />
          </label>
          <LabSelect
            label="Vault version"
            value={versionMode}
            options={[
              { value: "latest", label: "Follow latest version" },
              { value: "pin", label: "Pin selected version" },
            ]}
            onChange={setVersionMode}
            disabled={disabled}
          />
          {bindingError ? (
            <p role="alert" className="text-xs text-destructive">
              {bindingError}
            </p>
          ) : null}
          <VaultReferencePicker
            environmentId={threadRef.environmentId}
            kind="secret"
            disabled={disabled}
            onSelect={bind}
          />
        </section>
      ) : null}
    </section>
  );
}
