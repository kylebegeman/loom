import {
  LoomSettingsActions,
  LoomSettingsNotice,
  LoomSettingsDetails,
  LoomSettingsField,
} from "~/fork/settings/parts";
import { VaultQueryFeedback } from "./SettingsFeedback";
import { Checkbox } from "~/components/ui/checkbox";
import { VaultOwnerSettings } from "./OwnerSettingsSection";
import { VaultSshDialog } from "./SshDialog";
import { openVaultAccess } from "./access-navigation";
import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import {
  VaultFileContent,
  VaultItemKind,
  type VaultItemSummary,
  type VaultItemPage,
  type VaultError,
} from "@t3tools/contracts/fork";
import {
  loomFeaturesOf,
  vaultStatusMessage,
  VAULT_KIND_LABELS,
  VAULT_FILE_LIMIT_BYTES,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Atom, AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { vault, runVault } from "./state";

const EMPTY_PAGE = Atom.make(AsyncResult.initial<VaultItemPage, VaultError>(false));
const newId = () => randomUUID().replaceAll("-", "");
const encodeFile = Schema.encodeSync(Schema.fromJsonString(VaultFileContent));
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(VaultFileContent));
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The Vault operation failed. Try again.";
const failure = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  result._tag === "Failure" ? message(Cause.squash(result.cause)) : null;

export function VaultSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (
    !environment ||
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "vault-core",
    )
  ) {
    return <LoomSettingsNotice>Vault is unavailable on this server.</LoomSettingsNotice>;
  }
  if (!canRead)
    return (
      <LoomSettingsNotice>
        Your access to this environment does not include Vault inspection.
      </LoomSettingsNotice>
    );
  return (
    <div className="flex flex-col gap-5">
      <VaultOwnerSettings
        key={environment.environmentId}
        environmentId={environment.environmentId}
      />
      {loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
        "vault-owner-trusted",
      ) ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Vault records and advanced controls
          </summary>
          <div className="mt-4">
            <VaultItems
              key={`${environment.environmentId}:${canWrite}`}
              environmentId={environment.environmentId}
            />
          </div>
        </details>
      ) : (
        <VaultItems
          key={`${environment.environmentId}:${canWrite}`}
          environmentId={environment.environmentId}
        />
      )}
    </div>
  );
}
function VaultItems({ environmentId }: { environmentId: EnvironmentId }) {
  const configs = useServerConfigs();
  const sshEnabled = loomFeaturesOf(configs.get(environmentId)?.environment.capabilities).includes(
    "vault-ssh-management",
  );
  const [sshItem, setSshItem] = useState<string | null | undefined>(undefined);
  const statusAtom = vault.status({ environmentId, input: {} });
  const statusResult = useAtomValue(statusAtom);
  const status = Option.getOrNull(AsyncResult.value(statusResult));
  const [includeArchived, setIncludeArchived] = useState(false);
  const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
  const pageAtom = vault.list({
    environmentId,
    input: { cursor: cursors[cursors.length - 1] ?? null, includeArchived },
  });
  const pageResult = useAtomValue(status?.state === "ready" ? pageAtom : EMPTY_PAGE);
  const page = Option.getOrNull(AsyncResult.value(pageResult));
  const canSave = useAtomValue(vault.save.permissionAtom(environmentId));
  const canChange = useAtomValue(vault.change.permissionAtom(environmentId));
  const canReveal = useAtomValue(vault.reveal.permissionAtom(environmentId));
  const [editing, setEditing] = useState<VaultItemSummary | "new" | null>(null);
  const [deleting, setDeleting] = useState<VaultItemSummary | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setRevealed(null);
    appAtomRegistry.refresh(statusAtom);
    appAtomRegistry.refresh(pageAtom);
  };
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    }
    setBusy(false);
  };
  const change = (item: VaultItemSummary, action: "archive" | "restore" | "delete") =>
    act(async () => {
      await runVault(vault.change, {
        environmentId,
        input: { id: item.id, operationId: newId(), expectedVersion: item.version, action },
      });
      setDeleting(null);
      refresh();
    });
  const reveal = (item: VaultItemSummary) =>
    act(async () => {
      if (revealed?.id === item.id) {
        setRevealed(null);
        return;
      }
      const result = await runVault(vault.reveal, {
        environmentId,
        input: { id: item.id, expectedVersion: item.version },
      });
      const value = Redacted.value(result.value);
      if (item.kind === "secure-file") {
        const decoded = decodeFile(value);
        if (Option.isNone(decoded))
          throw new Error("This record does not contain a supported file.");
        const data = Uint8Array.from(atob(decoded.value.base64), (character) =>
          character.charCodeAt(0),
        );
        const url = URL.createObjectURL(
          new Blob([data], { type: decoded.value.mediaType || "application/octet-stream" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = decoded.value.name;
        anchor.click();
        URL.revokeObjectURL(url);
      } else setRevealed({ id: item.id, value });
    });
  return (
    <div className="flex min-w-0 flex-col gap-6 text-sm leading-relaxed wrap-anywhere">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-medium">Development records</h3>
          <p className="max-w-prose text-sm text-muted-foreground">
            Store and manage development access for this environment.
          </p>
        </div>
        <LoomSettingsActions>
          {sshEnabled ? (
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={!canSave || busy || status?.state !== "ready"}
              onClick={() => setSshItem(null)}
            >
              Create SSH key
            </Button>
          ) : null}
          <Button
            size="sm-multiline"
            disabled={!canSave || status?.state !== "ready" || busy}
            onClick={() => setEditing("new")}
          >
            Add item
          </Button>
          <Button
            size="sm-multiline"
            variant="ghost"
            disabled={busy || statusResult.waiting}
            onClick={refresh}
          >
            Refresh records
          </Button>
        </LoomSettingsActions>
      </div>
      <VaultQueryFeedback
        result={statusResult}
        loading="Checking Vault connection…"
        error={failure(statusResult)}
        onRetry={refresh}
      />
      {status && statusResult._tag !== "Failure" && !statusResult.waiting ? (
        <LoomSettingsNotice role="status">{vaultStatusMessage(status)}</LoomSettingsNotice>
      ) : null}
      {error && <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>}
      {status?.state === "ready" && (
        <>
          <label className="flex items-start gap-2 text-sm leading-6">
            <Checkbox
              checked={includeArchived}
              onCheckedChange={(checked) => {
                setIncludeArchived(checked);
                setCursors([null]);
                setRevealed(null);
              }}
            />
            Include archived items
          </label>
          <VaultQueryFeedback
            result={pageResult}
            loading="Loading Vault items…"
            error={failure(pageResult)}
            onRetry={() => appAtomRegistry.refresh(pageAtom)}
          />
          {page ? (
            <>
              {page.items.length === 0 && (
                <LoomSettingsNotice>
                  {cursors.length > 1
                    ? "No items on this page. Return to the previous page to find a record."
                    : "No development records yet. Add an item or create a dedicated SSH key to get started."}
                </LoomSettingsNotice>
              )}
              <div className="flex flex-col divide-y divide-border">
                {page.items.map((item) => (
                  <div key={item.id} className="flex min-w-0 flex-col gap-4 py-4">
                    <div className="flex min-w-0 flex-col gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {VAULT_KIND_LABELS[item.kind]} · Version {item.version}
                          {item.state === "archived" ? " · Archived" : ""}
                        </p>
                      </div>
                      <LoomSettingsActions>
                        {sshEnabled && item.kind === "ssh-key" ? (
                          <Button
                            size="sm-multiline"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setRevealed(null);
                              setSshItem(item.id);
                            }}
                          >
                            Manage SSH key
                          </Button>
                        ) : null}
                        <Button
                          size="sm-multiline"
                          variant="ghost"
                          disabled={!canReveal || busy}
                          onClick={() => void reveal(item)}
                        >
                          {item.kind === "secure-file"
                            ? "Download"
                            : revealed?.id === item.id
                              ? "Hide value"
                              : "Reveal value"}
                        </Button>
                        {item.state === "active" && (
                          <Button
                            size="sm-multiline"
                            variant="outline"
                            disabled={!canSave || busy}
                            onClick={() => {
                              setRevealed(null);
                              setEditing(item);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </LoomSettingsActions>
                      <LoomSettingsDetails title="Item details and maintenance">
                        <dl className="grid min-w-0 gap-3 text-sm grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                          <div className="min-w-0 space-y-1">
                            <dt className="text-xs text-muted-foreground">Item ID</dt>
                            <dd className="wrap-anywhere">{item.id}</dd>
                          </div>
                          <div className="space-y-1">
                            <dt className="text-xs text-muted-foreground">Version</dt>
                            <dd>{item.version}</dd>
                          </div>
                        </dl>
                        <LoomSettingsActions>
                          <Button
                            size="sm-multiline"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setRevealed(null);
                              openVaultAccess({ environmentId, itemId: item.id });
                            }}
                          >
                            Why this access?
                          </Button>
                          <Button
                            size="sm-multiline"
                            variant="outline"
                            disabled={!canChange || busy}
                            onClick={() =>
                              void change(item, item.state === "active" ? "archive" : "restore")
                            }
                          >
                            {item.state === "active" ? "Archive" : "Restore"}
                          </Button>
                        </LoomSettingsActions>
                        <p className="max-w-prose text-sm text-muted-foreground">
                          Deleting removes the current value after confirmation. Encrypted history
                          follows the backend retention policy.
                        </p>
                        <LoomSettingsActions>
                          <Button
                            size="sm-multiline"
                            variant="destructive-outline"
                            disabled={!canChange || busy}
                            onClick={() => setDeleting(item)}
                          >
                            Delete
                          </Button>
                        </LoomSettingsActions>
                      </LoomSettingsDetails>
                    </div>
                    {revealed?.id === item.id && (
                      <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-sm">
                        {revealed.value}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
              <LoomSettingsActions>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={cursors.length <= 1 || busy}
                  onClick={() => {
                    setCursors((previous) => previous.slice(0, -1));
                    setRevealed(null);
                  }}
                >
                  Previous
                </Button>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={!page.nextCursor || busy}
                  onClick={() => {
                    setCursors((previous) => [...previous, page.nextCursor]);
                    setRevealed(null);
                  }}
                >
                  Next page
                </Button>
              </LoomSettingsActions>
            </>
          ) : null}
        </>
      )}
      {sshItem !== undefined ? (
        <VaultSshDialog
          key={`${environmentId}:${sshItem ?? "new"}`}
          environmentId={environmentId}
          itemId={sshItem}
          onClose={() => setSshItem(undefined)}
        />
      ) : null}
      {editing !== null && (
        <VaultEditor
          key={typeof editing === "string" ? editing : editing.id}
          environmentId={environmentId}
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.label}?</DialogTitle>
            <DialogDescription>
              The current value will be removed. Encrypted prior versions remain subject to your
              backend’s retention policy.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="px-6 pb-4">
              <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm-multiline"
              variant="destructive"
              disabled={busy || !deleting || !canChange}
              onClick={() => {
                if (deleting) void change(deleting, "delete");
              }}
            >
              {busy ? "Deleting…" : "Delete item"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
function VaultEditor({
  environmentId,
  item,
  onSaved,
  onClose,
}: {
  environmentId: EnvironmentId;
  item: VaultItemSummary | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const fieldId = useId();
  const [id] = useState(() => item?.id ?? newId());
  const [operationId, setOperationId] = useState(newId);
  const [label, setLabel] = useState(item?.label ?? "");
  const [kind, setKind] = useState<VaultItemKind>(item?.kind ?? "secret");
  const [replace, setReplace] = useState(item === null);
  const [value, setValue] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(vault.save.permissionAtom(environmentId));
  const changed = () => setOperationId(newId());
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > VAULT_FILE_LIMIT_BYTES) {
      setError("Choose a file no larger than 512 KB.");
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("error", () => reject(new Error("The file could not be read.")), {
          once: true,
        });
        reader.addEventListener(
          "load",
          () =>
            typeof reader.result === "string"
              ? resolve(reader.result)
              : reject(new Error("The file could not be read.")),
          { once: true },
        );
        reader.readAsDataURL(file);
      });
      setValue(
        encodeFile({
          name: file.name,
          mediaType: file.type,
          base64: data.slice(data.indexOf(",") + 1),
        }),
      );
      setFileName(file.name);
      if (!label) setLabel(file.name);
      changed();
      setError(null);
    } catch (cause) {
      setError(message(cause));
    }
    setBusy(false);
  };
  const save = async () => {
    if (busy || !allowed) return;
    setBusy(true);
    setError(null);
    try {
      await runVault(vault.save, {
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
      onSaved();
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
            {item
              ? "Rename this item without changing its value, or replace the value explicitly."
              : "Save development access separately from your personal accounts."}
          </DialogDescription>
        </DialogHeader>
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
          <LoomSettingsField label={<span id={`${fieldId}-kind`}>Kind</span>}>
            <Select
              value={kind}
              onValueChange={(next) => {
                if (next !== null) {
                  setKind(next);
                  setReplace(true);
                  setMultiline(next === "ssh-key" || next === "secure-note");
                  setValue("");
                  setFileName(null);
                  changed();
                }
              }}
              disabled={busy || (item !== null && !replace)}
            >
              <SelectTrigger aria-labelledby={`${fieldId}-kind`}>
                <SelectValue>{VAULT_KIND_LABELS[kind]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {VaultItemKind.literals.map((value) => (
                  <SelectItem key={value} value={value}>
                    {VAULT_KIND_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LoomSettingsField>
          {item && (
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
          {replace &&
            (kind === "secure-file" ? (
              <label className="flex flex-col gap-2 text-sm">
                <span>File, up to 512 KB</span>
                <input
                  type="file"
                  disabled={busy}
                  onChange={(event) => void pick(event.target.files?.[0])}
                />
                {fileName && <span>{fileName}</span>}
              </label>
            ) : (
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
            ))}
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
