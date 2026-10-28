import { useId, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultItemKind, VaultItemSummary } from "@t3tools/contracts/fork";
import {
  VAULT_KIND_LABELS,
  VAULT_GENERIC_ITEM_KINDS,
  vaultItemActions,
} from "@t3tools/client-runtime/fork";
import * as Redacted from "effect/Redacted";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { LoomSettingsActions, LoomSettingsField, LoomSettingsNotice } from "~/fork/settings/parts";
import { forkSettingsTarget } from "../settings/navigation";
import { randomUUID } from "~/lib/utils";
import { readVaultFile } from "./file-draft";
import { vault, runVault } from "./state";
const newId = () => randomUUID().replaceAll("-", "");
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The Vault operation failed. Try again.";

export function VaultEditor({
  environmentId,
  item,
  initialFile,
  initialKind,
  initialLabel,
  initialValue,
  lockKind = false,
  saveDisabled = false,
  header,
  onConnectGitHub,
  onCreateSsh,
  githubEnabled,
  onSaved,
  onClose,
}: {
  environmentId: EnvironmentId;
  item: VaultItemSummary | null;
  initialFile: { name: string; value: string } | null;
  initialKind?: VaultItemKind;
  initialLabel?: string;
  initialValue?: string;
  lockKind?: boolean;
  saveDisabled?: boolean;
  header?: ReactNode;
  onConnectGitHub?: () => void;
  onCreateSsh: (() => void) | undefined;
  githubEnabled: boolean;
  onSaved: (item: VaultItemSummary) => void;
  onClose: () => void;
}) {
  const managed = item !== null && !vaultItemActions(item.kind).replaceValue;
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [id] = useState(() => item?.id ?? newId());
  const [operationId, setOperationId] = useState(newId);
  const [label, setLabel] = useState(item?.label ?? initialFile?.name ?? initialLabel ?? "");
  const [kind, setKind] = useState<VaultItemKind>(
    item?.kind ?? (initialFile ? "secure-file" : (initialKind ?? "secret")),
  );
  const [replace, setReplace] = useState(item === null);
  const [value, setValue] = useState(initialFile?.value ?? initialValue ?? "");
  const [multiline, setMultiline] = useState(initialKind === "secure-note");
  const [fileName, setFileName] = useState<string | null>(initialFile?.name ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(vault.save.permissionAtom(environmentId));
  const changed = () => setOperationId(newId());
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const draft = await readVaultFile(file);
      setValue(draft.value);
      setFileName(draft.name);
      setKind("secure-file");
      setReplace(true);
      if (!label.trim()) setLabel(draft.name);
      changed();
      setError(null);
    } catch (cause) {
      setError(message(cause));
    }
    setBusy(false);
  };
  const save = async () => {
    if (busy || !allowed || saveDisabled) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await runVault(vault.save, {
        environmentId,
        input: {
          id,
          operationId,
          expectedVersion: item?.version ?? 0,
          label,
          kind,
          ...(replace ? { value: Redacted.make(value) } : {}),
        },
      });
      setValue("");
      onSaved(saved);
    } catch (cause) {
      setError(message(cause));
    }
    setBusy(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{item ? "Edit Vault item" : "Add Vault item"}</DialogTitle>
          <DialogDescription>
            {managed
              ? "Rename this item here. Manage its connection in the dedicated settings."
              : item
                ? "Rename this item without changing its value, or replace the value explicitly."
                : "Save development access separately from your personal accounts."}
          </DialogDescription>
        </DialogHeader>
        {header}
        <form
          className="flex max-h-[70vh] min-w-0 flex-col gap-5 overflow-y-auto px-6 pb-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <LoomSettingsField label={<label htmlFor={fieldId}>Name</label>}>
            <Input
              id={fieldId}
              autoFocus
              autoComplete="off"
              maxLength={200}
              value={label}
              disabled={busy}
              onChange={(event) => {
                setLabel(event.target.value);
                changed();
              }}
            />
          </LoomSettingsField>
          {!item ? (
            <LoomSettingsActions>
              {onCreateSsh ? (
                <Button type="button" size="sm" variant="outline" onClick={onCreateSsh}>
                  Create SSH key
                </Button>
              ) : null}
              {githubEnabled && onConnectGitHub ? (
                <Button type="button" size="sm" variant="outline" onClick={onConnectGitHub}>
                  Connect GitHub
                </Button>
              ) : githubEnabled ? (
                <Link
                  {...forkSettingsTarget("vault-github")}
                  search={{ machine: environmentId, project: undefined, checkout: undefined }}
                  hashScrollIntoView={false}
                  className="text-primary underline underline-offset-4"
                >
                  Connect GitHub
                </Link>
              ) : null}
            </LoomSettingsActions>
          ) : null}
          {!managed ? (
            <LoomSettingsField label={<span id={`${fieldId}-kind`}>Kind</span>}>
              <Select
                value={kind}
                onValueChange={(next) => {
                  if (next !== null) {
                    setKind(next);
                    setReplace(true);
                    setMultiline(next === "secure-note");
                    setValue("");
                    setFileName(null);
                    changed();
                  }
                }}
                disabled={busy || lockKind || (item !== null && !replace)}
              >
                <SelectTrigger aria-labelledby={`${fieldId}-kind`}>
                  <SelectValue>{VAULT_KIND_LABELS[kind]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {VAULT_GENERIC_ITEM_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {VAULT_KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </LoomSettingsField>
          ) : null}
          {item && !managed && (
            <label className="flex items-start gap-2 text-sm leading-6">
              <Checkbox
                checked={replace}
                disabled={busy}
                onCheckedChange={(checked) => {
                  setReplace(checked);
                  setKind(item.kind);
                  setValue("");
                  setFileName(null);
                  changed();
                }}
              />
              Replace value
            </label>
          )}
          {replace ? (
            <>
              <input
                ref={fileInput}
                type="file"
                hidden
                disabled={busy || (lockKind && kind !== "secure-file")}
                onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <LoomSettingsActions>
                <Button
                  type="button"
                  size="sm-multiline"
                  variant="outline"
                  disabled={busy || (lockKind && kind !== "secure-file")}
                  onClick={() => fileInput.current?.click()}
                >
                  Choose file
                </Button>
                <span className="text-sm text-muted-foreground">
                  Up to 512 KB{fileName ? ` · ${fileName}` : ""}
                </span>
              </LoomSettingsActions>
              {kind !== "secure-file" ? (
                <LoomSettingsField label={<label htmlFor={`${fieldId}-value`}>Value</label>}>
                  {multiline ? (
                    <Textarea
                      id={`${fieldId}-value`}
                      autoComplete="off"
                      value={value}
                      disabled={busy}
                      onChange={(event) => {
                        setValue(event.target.value);
                        changed();
                      }}
                    />
                  ) : (
                    <Input
                      id={`${fieldId}-value`}
                      type="password"
                      autoComplete="new-password"
                      value={value}
                      disabled={busy}
                      onChange={(event) => {
                        setValue(event.target.value);
                        changed();
                      }}
                    />
                  )}
                  <div>
                    <Button
                      type="button"
                      size="sm-multiline"
                      variant="ghost"
                      disabled={busy || (multiline && value.includes("\n"))}
                      onClick={() => setMultiline((previous) => !previous)}
                    >
                      {multiline ? "Use hidden single-line entry" : "Use visible multiline entry"}
                    </Button>
                  </div>
                </LoomSettingsField>
              ) : null}
            </>
          ) : null}
          {error && <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>}
          <p className="text-sm text-muted-foreground">
            {item
              ? replace
                ? "Saving creates a new version with the replacement value."
                : "Saving changes the name. The existing value is retained."
              : "Draft item. Save to add it to this computer's Vault."}
          </p>
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              size="sm-multiline"
              type="submit"
              disabled={
                !allowed ||
                saveDisabled ||
                busy ||
                !label.trim() ||
                (replace && kind === "secure-file" && !fileName)
              }
            >
              {busy ? "Saving…" : "Save item"}
            </Button>
          </LoomSettingsActions>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
