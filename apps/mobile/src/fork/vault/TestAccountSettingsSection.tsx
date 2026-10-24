import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
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
  createVaultReferenceAtoms,
  supportsLoomFeature,
  vaultTestAccountActions,
  vaultTestAccountDeadlines,
  vaultTestAccountState,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { useVaultTime } from "./useVaultTime";
const atoms = createVaultTestAccountAtoms(connectionAtomRuntime);
const references = createVaultReferenceAtoms(connectionAtomRuntime);
const id = () => uuidv4().replaceAll("-", "");
const valid = Schema.is(VaultTestAccountMutation);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Account management failed. Refresh and try again.";
export function VaultTestAccountSettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId),
    canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-test-accounts")) return null;
  return (
    <SettingsSection title="Vault test accounts">
      {canRead ? (
        <Manager key={environmentId} environmentId={environmentId} connected={connected} />
      ) : (
        <Text>Your connection does not include test account inspection.</Text>
      )}
    </SettingsSection>
  );
}
function Manager({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const snapshot = useEnvironmentQuery(
    connected ? atoms.snapshot({ environmentId, input: {} }) : null,
  );
  const command = useAtomCommand(atoms.apply, { reportFailure: false });
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
  const data = snapshot.data;
  const now = useVaultTime(vaultTestAccountDeadlines(data?.accounts ?? []), data?.checkedAt);
  const collection =
    data?.collections.find((c) => c.id === selected) ?? data?.collections[0] ?? null;
  const prepare = (change: VaultTestAccountChange, title: string, description: string) => {
    if (!data || !connected) return;
    const input = { operationId: id(), expectedRevision: data.revision, change };
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
    if (!review || busy || !connected) return;
    setBusy(true);
    setError(null);
    await command({ environmentId, input: review.input })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setReview(null);
        setEditor(null);
        snapshot.refresh();
      })
      .catch((cause: unknown) => setError(message(cause)))
      .finally(() => setBusy(false));
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
  const disabled = busy || !connected || !canWrite || !data;
  return (
    <View className="gap-4">
      <Text>
        Dedicated test identities grouped by app and environment. Reservations belong to this Loom
        connection. Release or expiry quarantines the account until you check it clean.
      </Text>
      <Text className="text-foreground-muted">
        Provisioning, automatic reset and login delivery are not available yet.
      </Text>
      {!connected ? <Text>Reconnect this computer to manage test accounts.</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        <Button label="Refresh accounts" disabled={!connected || busy} onPress={snapshot.refresh} />
        <Button label="Create collection" disabled={disabled} onPress={() => start("collection")} />
      </View>
      {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
      {error || snapshot.error ? (
        <Text accessibilityRole="alert">{error ?? snapshot.error}</Text>
      ) : null}
      {snapshot.isPending && !data ? <Text>Loading test accounts…</Text> : null}
      {data ? (
        <>
          {!data.collections.length ? (
            <Text>No test account collections. Create one for a dedicated test app.</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {data.collections.map((c) => (
              <Button
                key={c.id}
                label={`${collection?.id === c.id ? "Selected: " : ""}${c.label}${c.archived ? " (archived)" : ""}`}
                disabled={busy}
                onPress={() => {
                  setSelected(c.id);
                  setEditor(null);
                }}
              />
            ))}
          </View>
          {collection ? (
            <View className="gap-3">
              <Text accessibilityRole="header">
                {collection.application} · {collection.target}
              </Text>
              <Text selectable className="text-foreground-muted">
                Agent grant destination: {vaultTestAccountDestination(collection.id)}
              </Text>
              <Button
                label="Copy agent grant destination"
                disabled={busy}
                onPress={() => {
                  void Clipboard.setStringAsync(vaultTestAccountDestination(collection.id)).then(
                    () => setNotice("Agent grant destination copied."),
                    () =>
                      setNotice(
                        "The destination could not be copied. Select and copy the displayed text.",
                      ),
                  );
                }}
              />
              <Button label="Rename collection" disabled={disabled} onPress={renameCollection} />
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="Add account reference"
                  disabled={disabled || collection.archived}
                  onPress={() => start("account")}
                />
                <Button
                  label={collection.archived ? "Restore collection" : "Archive collection"}
                  disabled={disabled}
                  onPress={() =>
                    prepare(
                      {
                        type: "collection-archive",
                        id: collection.id,
                        archived: !collection.archived,
                      },
                      collection.archived ? "Restore collection" : "Archive collection",
                      "Active reservations must end first. Account credentials remain unchanged.",
                    )
                  }
                />
              </View>
              {!data.accounts.some((a) => a.collectionId === collection.id) ? (
                <Text>
                  No accounts in this collection. Add an existing Vault account reference.
                </Text>
              ) : null}
              {data.accounts
                .filter((a) => a.collectionId === collection.id)
                .map((account) => (
                  <View key={account.id} className="gap-2 rounded-xl border border-border p-3">
                    <Text accessibilityRole="header">
                      {account.label} · {account.role}
                    </Text>
                    <Text>{vaultTestAccountState(account, now)}</Text>
                    <Text className="text-foreground-muted">
                      Vault account {account.itemId} · Version {account.itemVersion}
                    </Text>
                    {account.lease && vaultTestAccountState(account, now) === "reserved" ? (
                      <Text>
                        {account.lease.owner === data.actor
                          ? "Reserved by this connection"
                          : "Reserved by another connection"}{" "}
                        · Until {new Date(account.lease.expiresAt).toLocaleString()}
                      </Text>
                    ) : null}
                    <View className="flex-row flex-wrap gap-2">
                      <Button
                        label="Edit account reference"
                        disabled={
                          disabled ||
                          collection.archived ||
                          vaultTestAccountState(account, now) === "reserved" ||
                          account.state === "retired"
                        }
                        onPress={() => editAccount(account)}
                      />
                      {vaultTestAccountActions(account, data.actor, collection.archived, now).map(
                        (action) => (
                          <Button
                            key={action.label}
                            label={action.label}
                            accessibilityLabel={`${action.label}: ${account.label}`}
                            disabled={disabled}
                            onPress={() =>
                              prepare(
                                action.change,
                                `${action.label}: ${account.label}`,
                                action.description,
                              )
                            }
                          />
                        ),
                      )}
                    </View>
                  </View>
                ))}
            </View>
          ) : null}
        </>
      ) : null}
      {editor && !review ? (
        <View className="gap-3 rounded-xl border border-border p-3">
          <Text accessibilityRole="header">
            {editor === "collection" ? "New test collection" : "New test account"}
          </Text>
          <Text>{editor === "collection" ? "Collection name" : "Account name"}</Text>
          <TextInput
            className="rounded-md border border-border p-3 text-foreground"
            accessibilityLabel={editor === "collection" ? "Collection name" : "Account name"}
            value={name}
            editable={!disabled}
            maxLength={120}
            onChangeText={setName}
          />
          {editor === "collection" ? (
            <>
              <Text>Application</Text>
              <TextInput
                className="rounded-md border border-border p-3 text-foreground"
                accessibilityLabel="Application"
                value={app}
                editable={!disabled && editingId === null}
                maxLength={120}
                onChangeText={setApp}
              />
              <Text>Test environment: {target}</Text>
              <View className="flex-row flex-wrap gap-2">
                {(["test", "development", "staging"] as const).map((t) => (
                  <Button
                    key={t}
                    label={t}
                    disabled={disabled || editingId !== null}
                    onPress={() => setTarget(t)}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <Text>Role</Text>
              <TextInput
                className="rounded-md border border-border p-3 text-foreground"
                accessibilityLabel="Role"
                value={role}
                editable={!disabled}
                maxLength={120}
                onChangeText={setRole}
              />
              <AccountPicker
                environmentId={environmentId}
                connected={connected}
                disabled={disabled}
                select={(value) => {
                  setItem(value);
                  if (!name) setName(value.label);
                }}
              />
              {item ? (
                <Text>
                  Selected {item.label}, version {item.version}
                </Text>
              ) : null}
              <View className="flex-row items-center gap-2">
                <Switch
                  accessibilityLabel="This is a dedicated test account, separate from personal and production accounts"
                  value={developmentOnly}
                  disabled={disabled}
                  onValueChange={setDevelopmentOnly}
                />
                <Text className="flex-1">
                  This is a dedicated test account, separate from personal and production accounts.
                </Text>
              </View>
            </>
          )}
          <View className="flex-row gap-2">
            <Button label="Review changes" disabled={disabled} onPress={save} />
            <Button label="Cancel" disabled={busy} onPress={() => setEditor(null)} />
          </View>
        </View>
      ) : null}
      {review ? (
        <Sheet
          title={review.title}
          dismissible={!busy}
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 p-4 pb-10"
          >
            <Text>{review.description}</Text>
            <Text>
              After a conflict, cancel this review and refresh. Retrying a lost response reuses the
              same operation.
            </Text>
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            <Button label={busy ? "Saving…" : "Confirm"} disabled={disabled} onPress={apply} />
            <Button label="Cancel" disabled={busy} onPress={() => setReview(null)} />
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}
function AccountPicker({
  environmentId,
  connected,
  disabled,
  select,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  disabled: boolean;
  select: (item: VaultItemSummary) => void;
}) {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | null>(null);
  const result = useEnvironmentQuery(
    connected
      ? references.search({
          environmentId,
          input: { query: search, kind: "account", includeArchived: false, cursor },
        })
      : null,
  );
  return (
    <View className="gap-2">
      <Text>Search Vault accounts</Text>
      <TextInput
        className="rounded-md border border-border p-3 text-foreground"
        accessibilityLabel="Search Vault accounts"
        editable={!disabled}
        value={query}
        maxLength={100}
        onChangeText={setQuery}
      />
      <Button
        label="Search accounts"
        disabled={disabled}
        onPress={() => {
          setSearch(query.trim());
          setCursor(null);
          result.refresh();
        }}
      />
      {result.isPending ? <Text>Searching…</Text> : null}
      {result.error ? <Text accessibilityRole="alert">{result.error}</Text> : null}
      {result.data?.items.length === 0 ? (
        <Text>No matching accounts. Create a dedicated Account item in Vault first.</Text>
      ) : null}
      {result.data?.items.map((ref) => (
        <Button
          key={ref.item.id}
          label={`Use ${ref.item.label} (version ${ref.item.version})`}
          disabled={disabled || result.isPending || !!result.error}
          onPress={() => select(ref.item)}
        />
      ))}
      <View className="flex-row gap-2">
        <Button
          label="First account page"
          disabled={disabled || cursor === null}
          onPress={() => setCursor(null)}
        />
        {result.data?.nextCursor ? (
          <Button
            label="Next account page"
            disabled={disabled}
            onPress={() => setCursor(result.data!.nextCursor)}
          />
        ) : null}
      </View>
    </View>
  );
}
