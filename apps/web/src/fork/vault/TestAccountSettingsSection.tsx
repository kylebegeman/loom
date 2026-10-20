import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import {
  VaultTestAccountMutation,
  type VaultItemSummary,
  type VaultTestAccount,
  type VaultTestAccountChange,
  type VaultTestCollectionDefinition,
} from "@t3tools/contracts/fork";
import {
  createVaultTestAccountAtoms,
  supportsLoomFeature,
  vaultTestAccountActions,
  vaultTestAccountState,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
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
    return <p>Test account collections are unavailable on this computer.</p>;
  if (!canRead) return <p>Your connection does not include test account inspection.</p>;
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
  const prefix = useId();
  const now = useVaultTime(snapshot?.accounts.map((a) => a.lease?.expiresAt ?? null) ?? []);
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
    } finally {
      setBusy(false);
    }
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Keep dedicated test identities grouped by app and environment. Reservations are exclusive to
        this Loom connection. Release or expiry quarantines the account until you check it clean.
      </p>
      <p className="text-sm">
        Provisioning, automatic reset and login delivery are not available yet.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={refresh}>
          Refresh accounts
        </Button>
        <Button disabled={!canWrite || busy || !snapshot} onClick={() => start("collection")}>
          Create collection
        </Button>
      </div>
      {error || result._tag === "Failure" ? (
        <p role="alert">
          {error ?? (result._tag === "Failure" ? message(Cause.squash(result.cause)) : "")}
        </p>
      ) : null}
      {!snapshot ? (
        <p role="status">
          {result._tag === "Failure"
            ? "Account inspection is unavailable."
            : "Loading test accounts…"}
        </p>
      ) : (
        <>
          {!snapshot.collections.length ? (
            <p>No test account collections. Create one for a dedicated test app.</p>
          ) : (
            <>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Test account collections"
              >
                {snapshot.collections.map((c) => (
                  <Button
                    key={c.id}
                    variant={collection?.id === c.id ? "default" : "outline"}
                    disabled={busy}
                    aria-pressed={collection?.id === c.id}
                    onClick={() => {
                      setSelected(c.id);
                      setEditor(null);
                    }}
                  >
                    {c.label}
                    {c.archived ? " (archived)" : ""}
                  </Button>
                ))}
              </div>
              {collection ? (
                <section aria-label={collection.label} className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium">
                    {collection.application} · {collection.target}
                  </h3>
                  <div>
                    <Button
                      variant="outline"
                      disabled={!canWrite || busy}
                      onClick={renameCollection}
                    >
                      Rename collection
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!canWrite || busy || collection.archived}
                      onClick={() => start("account")}
                    >
                      Add account reference
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
                  </div>
                  {!snapshot.accounts.some((a) => a.collectionId === collection.id) ? (
                    <p>No accounts in this collection. Add an existing Vault account reference.</p>
                  ) : null}
                  <ul className="flex flex-col gap-3">
                    {snapshot.accounts
                      .filter((a) => a.collectionId === collection.id)
                      .map((account) => (
                        <li key={account.id} className="flex flex-col gap-2 rounded-md border p-3">
                          <p className="text-sm font-medium">
                            {account.label} · {account.role}
                          </p>
                          <p className="text-sm capitalize">
                            {vaultTestAccountState(account, now)}
                          </p>
                          <p className="break-all text-xs text-muted-foreground">
                            Vault account {account.itemId} · Version {account.itemVersion}
                          </p>
                          {account.lease ? (
                            <p className="text-sm">
                              {account.lease.owner === snapshot.actor
                                ? "Reserved by this connection"
                                : "Reserved by another connection"}{" "}
                              · Until {new Date(account.lease.expiresAt).toLocaleString()}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
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
                          </div>
                        </li>
                      ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </>
      )}
      {editor ? (
        <div
          className="flex flex-col gap-3 rounded-md border p-4"
          aria-label={editor === "collection" ? "New test collection" : "New test account"}
        >
          <label htmlFor={`${prefix}-name`} className="flex flex-col gap-1 text-sm">
            {editor === "collection" ? "Collection name" : "Account name"}
            <Input
              id={`${prefix}-name`}
              value={name}
              disabled={busy || !!review}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {editor === "collection" ? (
            <>
              <label htmlFor={`${prefix}-app`} className="flex flex-col gap-1 text-sm">
                Application
                <Input
                  id={`${prefix}-app`}
                  value={app}
                  disabled={busy || !!review || editingId !== null}
                  maxLength={120}
                  onChange={(e) => setApp(e.target.value)}
                />
              </label>
              <label htmlFor={`${prefix}-target`} className="flex flex-col gap-1 text-sm">
                Test environment
                <select
                  id={`${prefix}-target`}
                  value={target}
                  disabled={busy || !!review || editingId !== null}
                  onChange={(e) => setTarget(e.target.value as typeof target)}
                >
                  <option value="test">Test</option>
                  <option value="development">Development</option>
                  <option value="staging">Staging</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label htmlFor={`${prefix}-role`} className="flex flex-col gap-1 text-sm">
                Role
                <Input
                  id={`${prefix}-role`}
                  value={role}
                  disabled={busy || !!review}
                  maxLength={120}
                  onChange={(e) => setRole(e.target.value)}
                />
              </label>
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
                <p role="status">
                  Selected {item.label}, version {item.version}
                </p>
              ) : null}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={developmentOnly}
                  disabled={busy || !!review}
                  onChange={(e) => setDevelopmentOnly(e.target.checked)}
                />
                This is a dedicated test account, separate from personal and production accounts.
              </label>
            </>
          )}
          <div className="flex gap-2">
            <Button disabled={busy || !canWrite || !!review} onClick={save}>
              Review changes
            </Button>
            <Button variant="outline" disabled={busy || !!review} onClick={() => setEditor(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
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
          {error ? <p role="alert">{error}</p> : null}
          <p className="text-sm">
            After a conflict, cancel this review and refresh. Retrying a lost response reuses the
            same operation.
          </p>
          <div className="flex gap-2">
            <Button disabled={!canWrite || busy || !snapshot} onClick={apply}>
              {busy ? "Saving…" : "Confirm"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
              Cancel
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
