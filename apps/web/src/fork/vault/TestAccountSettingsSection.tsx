import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import {
  VaultTestAccountMutation,
  vaultTestAccountDestination,
  type VaultItemSummary,
  type VaultTestAccount,
  type VaultTestAccountChange,
  type VaultTestCollectionDefinition,
} from "@t3tools/contracts/fork";
import {
  createVaultTestAccountAtoms,
  supportsLoomFeature,
  vaultTestAccountActions,
  vaultTestAccountDeadlines,
  vaultTestAccountState,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
import { useVaultTime } from "./useVaultTime";
import { VaultReferencePicker } from "./ReferencePicker";
const atoms = createVaultTestAccountAtoms(connectionAtomRuntime);
const id = () => randomUUID().replaceAll("-", "");
const valid = Schema.is(VaultTestAccountMutation);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Account management failed. Refresh and try again.";
export function VaultTestAccountSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-test-accounts",
    )
  )
    return (
      <LoomSettingsNotice>
        Test account collections are unavailable on this computer.
      </LoomSettingsNotice>
    );
  if (!canRead)
    return (
      <LoomSettingsNotice>
        Your connection does not include test account inspection.
      </LoomSettingsNotice>
    );
  return <Manager key={environment.environmentId} environmentId={environment.environmentId} />;
}
function Manager({ environmentId }: { environmentId: EnvironmentId }) {
  const atom = atoms.snapshot({ environmentId, input: {} }),
    result = useAtomValue(atom);
  const snapshot = result._tag === "Success" && !result.waiting ? result.value : null;
  const canWrite = useAtomValue(atoms.apply.permissionAtom(environmentId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [editor, setEditor] = useState<"collection" | "account" | null>(null);
  const [name, setName] = useState(""),
    [app, setApp] = useState(""),
    [role, setRole] = useState(""),
    [target, setTarget] = useState<VaultTestCollectionDefinition["target"]>("test");
  const [item, setItem] = useState<Pick<VaultItemSummary, "id" | "version" | "label"> | null>(null),
    [developmentOnly, setDevelopmentOnly] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    input: VaultTestAccountMutation;
    title: string;
    description: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copy = useCopyToClipboard({
    target: "agent grant destination",
    onCopy: () => setNotice("Agent grant destination copied."),
    onError: () =>
      setNotice("The destination could not be copied. Select and copy the displayed text."),
  });
  const now = useVaultTime(
    vaultTestAccountDeadlines(snapshot?.accounts ?? []),
    snapshot?.checkedAt,
  );
  const collection =
    snapshot?.collections.find((c) => c.id === selected) ?? snapshot?.collections[0] ?? null;
  const refresh = () => appAtomRegistry.refresh(atom);
  const prepare = (change: VaultTestAccountChange, title: string, description: string) => {
    if (!snapshot) return;
    const input = { operationId: id(), expectedRevision: snapshot.revision, change };
    if (!valid(input)) {
      setError("Complete the name, application and account fields before continuing.");
      return;
    }
    setError(null);
    setReview({ input, title, description });
  };
  const save = () => {
    if (editor === "collection")
      prepare(
        {
          type: "collection-save",
          collection: {
            id: editingId ?? id(),
            label: name.trim(),
            application: app.trim(),
            target,
          },
        },
        editingId ? "Rename collection" : "Create collection",
        `${name.trim()} · ${app.trim()} · ${target}`,
      );
    else if (collection && item && developmentOnly)
      prepare(
        {
          type: "account-save",
          account: {
            id: editingId ?? id(),
            collectionId: collection.id,
            label: name.trim(),
            role: role.trim(),
            itemId: item.id,
            itemVersion: item.version,
          },
          developmentOnly: true,
        },
        editingId ? "Update development account" : "Add development account",
        `${name.trim()} · ${role.trim()} · ${item.label}. It starts in quarantine and grants no login access.`,
      );
    else setError("Select a Vault account and confirm it is a dedicated development identity.");
  };
  const apply = async () => {
    if (!review || busy) return;
    setBusy(true);
    setError(null);
    try {
      await runVault(atoms.apply, { environmentId, input: review.input });
      setReview(null);
      setEditor(null);
      refresh();
    } catch (cause) {
      setError(message(cause));
    }
    setBusy(false);
  };
  const start = (kind: "collection" | "account") => {
    setEditor(kind);
    setEditingId(null);
    setName("");
    setApp("");
    setRole("");
    setItem(null);
    setDevelopmentOnly(false);
    setError(null);
  };
  const editAccount = (account: VaultTestAccount) => {
    start("account");
    setEditingId(account.id);
    setName(account.label);
    setRole(account.role);
    setItem({ id: account.itemId, version: account.itemVersion, label: account.label });
  };
  const renameCollection = () => {
    if (!collection) return;
    start("collection");
    setEditingId(collection.id);
    setName(collection.label);
    setApp(collection.application);
    setTarget(collection.target);
  };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Group dedicated test identities by application and environment. Reservations are exclusive
        to this Loom connection. Release or expiry quarantines an account until you check it clean.
      </p>
      <LoomSettingsActions>
        <Button disabled={!canWrite || busy || !snapshot} onClick={() => start("collection")}>
          Create collection
        </Button>
        <Button variant="outline" disabled={busy} onClick={refresh}>
          Refresh accounts
        </Button>
      </LoomSettingsActions>
      {!canWrite ? (
        <LoomSettingsNotice>
          Your connection can inspect test accounts but cannot change them.
        </LoomSettingsNotice>
      ) : null}
      <LoomSettingsNotice>
        Provisioning, automatic reset and login delivery are not available yet.
      </LoomSettingsNotice>
      {notice ? <LoomSettingsNotice role="status">{notice}</LoomSettingsNotice> : null}
      {error || result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          {error ?? (result._tag === "Failure" ? message(Cause.squash(result.cause)) : "")}
        </LoomSettingsNotice>
      ) : null}
      {editor ? (
        <LoomSettingsPanel
          title={
            editor === "collection"
              ? editingId
                ? "Rename collection"
                : "New test collection"
              : editingId
                ? "Edit account reference"
                : "New test account"
          }
          description={
            editor === "collection"
              ? "Organize dedicated identities for one application and test environment."
              : "Choose an existing Vault account. Added accounts start in quarantine and grant no login access."
          }
        >
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <LoomSettingsField label={editor === "collection" ? "Collection name" : "Account name"}>
              <Input
                aria-label={editor === "collection" ? "Collection name" : "Account name"}
                value={name}
                disabled={busy || !!review}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </LoomSettingsField>
            {editor === "collection" ? (
              <LoomSettingsField
                label="Application"
                description={
                  editingId ? "The application cannot be changed after creation." : undefined
                }
              >
                <Input
                  aria-label="Application"
                  value={app}
                  disabled={busy || !!review || editingId !== null}
                  maxLength={120}
                  onChange={(e) => setApp(e.target.value)}
                />
              </LoomSettingsField>
            ) : (
              <LoomSettingsField label="Role">
                <Input
                  aria-label="Role"
                  value={role}
                  disabled={busy || !!review}
                  maxLength={120}
                  onChange={(e) => setRole(e.target.value)}
                />
              </LoomSettingsField>
            )}
          </div>
          {editor === "collection" ? (
            <LoomSettingsField
              label="Test environment"
              description={
                editingId ? "The environment cannot be changed after creation." : undefined
              }
            >
              <Select
                value={target}
                disabled={busy || !!review || editingId !== null}
                onValueChange={(value) => {
                  if (value === "test" || value === "development" || value === "staging")
                    setTarget(value);
                }}
              >
                <SelectTrigger aria-label="Test environment">
                  <SelectValue>
                    {target === "test"
                      ? "Test"
                      : target === "development"
                        ? "Development"
                        : "Staging"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="test">Test</SelectItem>
                  <SelectItem value="development">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                </SelectPopup>
              </Select>
            </LoomSettingsField>
          ) : (
            <>
              <fieldset className="flex min-w-0 flex-col gap-3">
                <legend className="mb-2 text-sm font-medium">Vault account</legend>
                <VaultReferencePicker
                  environmentId={environmentId}
                  kind="account"
                  disabled={busy || !!review}
                  onSelect={(reference) => {
                    setItem(reference.item);
                    if (!name) setName(reference.item.label);
                  }}
                />
                {item ? (
                  <LoomSettingsNotice role="status">
                    Selected {item.label}, version {item.version}
                  </LoomSettingsNotice>
                ) : null}
              </fieldset>
              <label className="flex items-start gap-2 text-sm leading-relaxed">
                <Checkbox
                  checked={developmentOnly}
                  disabled={busy || !!review}
                  onCheckedChange={setDevelopmentOnly}
                />
                This is a dedicated test account, separate from personal and production accounts.
              </label>
            </>
          )}
          <LoomSettingsActions>
            <Button disabled={busy || !canWrite || !!review} onClick={save}>
              Review changes
            </Button>
            <Button variant="outline" disabled={busy || !!review} onClick={() => setEditor(null)}>
              Cancel
            </Button>
          </LoomSettingsActions>
        </LoomSettingsPanel>
      ) : null}
      {!snapshot ? (
        <LoomSettingsNotice role="status">
          {result._tag === "Failure"
            ? "Account inspection is unavailable. Refresh accounts to try again."
            : "Loading test accounts…"}
        </LoomSettingsNotice>
      ) : (
        <>
          {!snapshot.collections.length ? (
            <LoomSettingsNotice>
              No test account collections. Create one for a dedicated test app.
            </LoomSettingsNotice>
          ) : (
            <>
              <LoomSettingsField label="Collection">
                <Select
                  value={collection?.id ?? ""}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (!value) return;
                    setSelected(value);
                    setEditor(null);
                  }}
                >
                  <SelectTrigger aria-label="Test account collections">
                    <SelectValue>
                      {collection?.label ?? "Choose a collection"}
                      {collection?.archived ? " (archived)" : ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {snapshot.collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                        {c.archived ? " (archived)" : ""}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </LoomSettingsField>
              {collection ? (
                <LoomSettingsPanel
                  title={collection.label}
                  description={`${collection.application} · ${collection.target}${collection.archived ? " · Archived" : ""}`}
                >
                  <LoomSettingsActions>
                    <Button
                      disabled={!canWrite || busy || collection.archived}
                      onClick={() => start("account")}
                    >
                      Add account reference
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!canWrite || busy}
                      onClick={renameCollection}
                    >
                      Rename collection
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!canWrite || busy}
                      onClick={() =>
                        prepare(
                          {
                            type: "collection-archive",
                            id: collection.id,
                            archived: !collection.archived,
                          },
                          collection.archived ? "Restore collection" : "Archive collection",
                          "Active reservations must end before this change. Account credentials remain unchanged.",
                        )
                      }
                    >
                      {collection.archived ? "Restore collection" : "Archive collection"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        copy.copyToClipboard(vaultTestAccountDestination(collection.id), undefined)
                      }
                    >
                      Copy agent grant destination
                    </Button>
                  </LoomSettingsActions>
                  <LoomSettingsDetails title="Agent grant destination">
                    <p className="wrap-anywhere text-sm leading-relaxed">
                      <code>{vaultTestAccountDestination(collection.id)}</code>
                    </p>
                  </LoomSettingsDetails>
                  {!snapshot.accounts.some((a) => a.collectionId === collection.id) ? (
                    <LoomSettingsNotice>
                      No accounts in this collection. Add an existing Vault account reference.
                    </LoomSettingsNotice>
                  ) : null}
                  <ul className="divide-y divide-border">
                    {snapshot.accounts
                      .filter((a) => a.collectionId === collection.id)
                      .map((account) => (
                        <li
                          key={account.id}
                          className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1">
                              <h4 className="wrap-anywhere text-sm font-medium">{account.label}</h4>
                              <p className="wrap-anywhere text-sm text-muted-foreground">
                                {account.role}
                              </p>
                            </div>
                            <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                              {vaultTestAccountState(account, now)}
                            </span>
                          </div>
                          {account.lease && vaultTestAccountState(account, now) === "reserved" ? (
                            <p className="text-sm leading-relaxed">
                              {account.lease.owner === snapshot.actor
                                ? "Reserved by this connection"
                                : "Reserved by another connection"}{" "}
                              · Until {new Date(account.lease.expiresAt).toLocaleString()}
                            </p>
                          ) : null}
                          <LoomSettingsActions>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !canWrite ||
                                busy ||
                                collection.archived ||
                                vaultTestAccountState(account, now) === "reserved" ||
                                account.state === "retired"
                              }
                              onClick={() => editAccount(account)}
                            >
                              Edit account reference
                            </Button>
                            {vaultTestAccountActions(
                              account,
                              snapshot.actor,
                              collection.archived,
                              now,
                            ).map((action) => (
                              <Button
                                key={action.label}
                                size="sm"
                                variant="outline"
                                disabled={!canWrite || busy}
                                onClick={() =>
                                  prepare(
                                    action.change,
                                    `${action.label}: ${account.label}`,
                                    action.description,
                                  )
                                }
                              >
                                {action.label}
                              </Button>
                            ))}
                          </LoomSettingsActions>
                          <LoomSettingsDetails title="Vault account reference">
                            <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                              <div className="min-w-0 space-y-1">
                                <dt className="text-muted-foreground">Account ID</dt>
                                <dd className="wrap-anywhere">{account.itemId}</dd>
                              </div>
                              <div className="space-y-1">
                                <dt className="text-muted-foreground">Version</dt>
                                <dd>{account.itemVersion}</dd>
                              </div>
                            </dl>
                          </LoomSettingsDetails>
                        </li>
                      ))}
                  </ul>
                </LoomSettingsPanel>
              ) : null}
            </>
          )}
        </>
      )}
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{review?.title}</DialogTitle>
            <DialogDescription>{review?.description}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-6 pb-5">
            {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
            <p className="text-sm leading-relaxed text-muted-foreground">
              After a conflict, cancel this review and refresh. Retrying a lost response reuses the
              same operation.
            </p>
            <LoomSettingsActions>
              <Button disabled={!canWrite || busy || !snapshot} onClick={apply}>
                {busy ? "Saving…" : "Confirm"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
                Cancel
              </Button>
            </LoomSettingsActions>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
