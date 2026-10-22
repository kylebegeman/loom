import { VaultApprovalInbox } from "./ApprovalInbox";
import { useVaultTime } from "./useVaultTime";
import { useContext, useEffect, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  ThreadId,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  VaultAccessAction,
  VaultGrantDefinition,
  type VaultGrant,
  type VaultGrantMutation,
  type VaultGrantPreview,
  type VaultAccessExplanation,
  type VaultReadinessReport,
  type VaultAccessCatalog,
} from "@t3tools/contracts/fork";
import {
  createVaultAccessAtoms,
  createVaultCoreAtoms,
  supportsLoomFeature,
  VAULT_ACTION_LABELS,
  vaultGrantExpiry,
  vaultDecisionMessage,
  vaultReadinessIsStale,
  vaultAccessContextRows,
} from "@t3tools/client-runtime/fork";
import { RegistryContext } from "@effect/atom-react";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
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
const access = createVaultAccessAtoms(connectionAtomRuntime),
  core = createVaultCoreAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const decodeDefinition = Schema.decodeUnknownOption(VaultGrantDefinition);
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The access operation failed. Refresh and try again.";

export function VaultAccessSettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-grants")) return null;
  return (
    <SettingsSection title="Vault access">
      {canRead ? (
        <AccessManager
          key={`${environmentId}:${canWrite}:${connected}`}
          environmentId={environmentId}
          connected={connected}
          canWrite={canWrite}
        />
      ) : (
        <Text>Your connection does not include Vault inspection.</Text>
      )}
    </SettingsSection>
  );
}
function AccessManager({
  environmentId,
  connected,
  canWrite,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  canWrite: boolean;
}) {
  const snapshot = useEnvironmentQuery(
    connected ? access.snapshot({ environmentId, input: {} }) : null,
  );
  const catalog = useEnvironmentQuery(
    connected ? access.catalog({ environmentId, input: {} }) : null,
  );
  const grantTime = useVaultTime(
    snapshot.data?.grants.flatMap((grant) => [
      grant.definition.notBefore,
      grant.definition.expiresAt,
    ]) ?? [],
  );
  const previewCommand = useAtomCommand(access.preview, { reportFailure: false });
  const [editing, setEditing] = useState<VaultGrant | "new" | null>(null);
  const [pending, setPending] = useState<{
    input: VaultGrantMutation;
    preview: VaultGrantPreview;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [history, setHistory] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const recurring =
    snapshot.data?.grants.filter(
      (grant) => grant.state !== "revoked" && grant.definition.expiresAt === null,
    ) ?? [];
  const refresh = () => {
    setPending(null);
    snapshot.refresh();
    catalog.refresh();
  };
  const preview = async (input: VaultGrantMutation) => {
    setBusy(true);
    setError(null);
    try {
      const result = await previewCommand({ environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setPending({ input, preview: result.value });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-t3-semibold">
        Recurring access
      </Text>
      <Text>
        For GitHub, choose projects and repositories in GitHub access and approve them together.
      </Text>
      <Text className="text-foreground-muted">
        A recurring project grant covers all current and future threads until revoked. Temporary
        requests are listed below.
      </Text>
      {!connected ? <Text>Reconnect this computer to inspect Vault access.</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        <Button label="Refresh access" disabled={!connected || busy} onPress={refresh} />
        <Button
          label={advanced ? "Hide advanced access controls" : "Advanced access controls"}
          tone="primary"
          disabled={busy}
          onPress={() => setAdvanced(!advanced)}
        />
      </View>
      {advanced ? (
        <Button
          label="Add custom grant"
          disabled={!connected || !canWrite || busy || !snapshot.data || !catalog.data}
          onPress={() => setEditing("new")}
        />
      ) : null}
      {error || snapshot.error || catalog.error ? (
        <Text accessibilityRole="alert">{error ?? snapshot.error ?? catalog.error}</Text>
      ) : null}
      {snapshot.isPending && !snapshot.data ? <Text>Loading access policy…</Text> : null}
      {snapshot.data ? (
        <>
          {advanced ? (
            <Text className="text-foreground-muted">Policy revision {snapshot.data.revision}</Text>
          ) : null}
          {(advanced ? snapshot.data.grants : recurring).length === 0 ? (
            <Text>
              No recurring grants yet. Choose projects in GitHub access, or add a custom grant in
              advanced access controls.
            </Text>
          ) : null}
          {(advanced
            ? [...snapshot.data.grants].sort(
                (a, b) =>
                  Number(b.definition.expiresAt === null) - Number(a.definition.expiresAt === null),
              )
            : recurring
          ).map((grant) => (
            <View key={grant.definition.id} className="gap-2 rounded-2xl bg-subtle p-3">
              <Text className="font-t3-semibold">{grant.definition.label}</Text>
              <Text>{vaultGrantExpiry(grant, grantTime)}</Text>
              <Text className="text-foreground-muted">
                {grant.definition.principal.kind}:{" "}
                {catalog.data?.subjects.find(
                  (subject) =>
                    subject.principal.kind === grant.definition.principal.kind &&
                    subject.principal.id === grant.definition.principal.id,
                )?.label ?? grant.definition.principal.id}
              </Text>
              <Text className="text-foreground-muted">
                {grant.definition.itemIds.length} selected items.{" "}
                {grant.definition.actions.map((action) => VAULT_ACTION_LABELS[action]).join(", ")}.
              </Text>
              <Text className="text-foreground-muted">
                {grant.definition.destination ?? "Any destination in scope"}.{" "}
                {grant.definition.expiresAt === null
                  ? "No expiry"
                  : `Expires ${new Date(grant.definition.expiresAt).toLocaleString()}`}
              </Text>
              {grant.definition.parentId ? (
                <Text>Parent grant: {grant.definition.parentId}</Text>
              ) : null}
              {grant.state !== "revoked" ? (
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label="Edit grant"
                    disabled={!canWrite || busy}
                    onPress={() => setEditing(grant)}
                  />
                  <Button
                    label={grant.state === "active" ? "Preview suspension" : "Preview resume"}
                    disabled={!canWrite || busy}
                    onPress={() =>
                      void preview({
                        operationId: newId(),
                        expectedRevision: snapshot.data!.revision,
                        change: {
                          type: "state",
                          id: grant.definition.id,
                          state: grant.state === "active" ? "suspended" : "active",
                        },
                      })
                    }
                  />
                  <Button
                    label="Preview revocation"
                    tone="text"
                    disabled={!canWrite || busy}
                    onPress={() =>
                      void preview({
                        operationId: newId(),
                        expectedRevision: snapshot.data!.revision,
                        change: { type: "state", id: grant.definition.id, state: "revoked" },
                      })
                    }
                  />
                </View>
              ) : (
                <Text>
                  Revocation is permanent. Create a new grant to restore access deliberately.
                </Text>
              )}
            </View>
          ))}
          {advanced && catalog.data ? (
            <AccessCheck
              environmentId={environmentId}
              catalog={catalog.data}
              policyRevision={snapshot.data.revision}
            />
          ) : null}
          <Button
            label={history ? "Hide recent decisions" : "Show recent decisions"}
            onPress={() => setHistory((value) => !value)}
          />
          {history ? (
            <View className="gap-2">
              {snapshot.data.audit.map((event) => (
                <Text key={event.id} className="text-foreground-muted">
                  {new Date(event.at).toLocaleString()}: {event.actor}, {event.type}, {event.reason}
                  , policy {event.policyRevision}
                </Text>
              ))}
              <Text>
                {snapshot.data.omittedAuditEvents} older events omitted. This history records
                authorization, not successful external logins.
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      <VaultApprovalInbox environmentId={environmentId} canWrite={canWrite} connected={connected} />
      {editing !== null && catalog.data && snapshot.data ? (
        <GrantEditor
          environmentId={environmentId}
          catalog={catalog.data}
          grant={editing === "new" ? null : editing}
          revision={snapshot.data.revision}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
      {pending ? (
        <MutationSheet
          environmentId={environmentId}
          pending={pending}
          onClose={() => setPending(null)}
          onSaved={() => {
            setPending(null);
            refresh();
          }}
        />
      ) : null}
    </View>
  );
}
function SubjectPicker({
  catalog,
  value,
  onChange,
  threadsOnly = false,
  disabled = false,
}: {
  catalog: VaultAccessCatalog;
  value: string;
  onChange: (value: string) => void;
  threadsOnly?: boolean;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const available = catalog.subjects.filter(
    (subject) =>
      (!threadsOnly || subject.principal.kind === "thread") &&
      `${subject.label} ${subject.principal.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = catalog.subjects.find(
    (subject) => `${subject.principal.kind}:${subject.principal.id}` === value,
  );
  return (
    <View className="gap-2">
      <Text>
        {threadsOnly ? "Thread" : "Thread or project"}
        {selected ? `: ${selected.label}` : ""}
      </Text>
      <TextInput
        accessibilityLabel="Search threads and projects"
        placeholder="Search threads and projects"
        value={search}
        editable={!disabled}
        onChangeText={setSearch}
      />
      {available.slice(0, 8).map((subject) => {
        const key = `${subject.principal.kind}:${subject.principal.id}`;
        return (
          <Button
            key={key}
            label={`${value === key ? "Selected: " : ""}${subject.principal.kind === "project" ? "All project threads: " : ""}${subject.label}`}
            tone={value === key ? "primary" : "secondary"}
            disabled={disabled}
            onPress={() => onChange(key)}
          />
        );
      })}
      {available.length > 8 || catalog.truncated ? (
        <Text className="text-foreground-muted">
          Search to narrow the workload list. The picker includes up to 250 projects and 250
          threads.
        </Text>
      ) : null}
    </View>
  );
}
function GrantEditor({
  environmentId,
  catalog,
  grant,
  revision,
  onClose,
  onSaved,
}: {
  environmentId: EnvironmentId;
  catalog: VaultAccessCatalog;
  grant: VaultGrant | null;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id] = useState(() => grant?.definition.id ?? newId()),
    [operationId, setOperationId] = useState(newId);
  const [label, setLabel] = useState(grant?.definition.label ?? ""),
    [principal, setPrincipal] = useState(
      grant ? `${grant.definition.principal.kind}:${grant.definition.principal.id}` : "",
    );
  const [items, setItems] = useState<readonly string[]>(grant?.definition.itemIds ?? []),
    [actions, setActions] = useState<readonly VaultAccessAction[]>(
      grant?.definition.actions ?? ["inspect"],
    );
  const [destination, setDestination] = useState(grant?.definition.destination ?? "");
  const [start, setStart] = useState(() =>
    new Date(grant?.definition.notBefore ?? Date.now()).toISOString(),
  );
  const [expiry, setExpiry] = useState(() =>
    grant?.definition.expiresAt === null
      ? ""
      : new Date(grant?.definition.expiresAt ?? Date.now() + 86_400_000).toISOString(),
  );
  const [extraId, setExtraId] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    input: VaultGrantMutation;
    preview: VaultGrantPreview;
  } | null>(null);
  const page = useEnvironmentQuery(
    core.list({ environmentId, input: { cursor, includeArchived: true } }),
  );
  const previewCommand = useAtomCommand(access.preview, { reportFailure: false });
  const applyCommand = useAtomCommand(access.apply, { reportFailure: false });
  const changed = () => {
    setOperationId(newId());
    setError(null);
  };
  const preview = async () => {
    const subject = catalog.subjects.find(
      (value) => `${value.principal.kind}:${value.principal.id}` === principal,
    );
    const definition = decodeDefinition({
      id,
      label,
      principal: subject?.principal ?? grant?.definition.principal,
      projectId: subject?.projectId ?? grant?.definition.projectId ?? null,
      itemIds: items,
      actions,
      destination: destination.trim() || null,
      notBefore: Date.parse(start),
      expiresAt: expiry.trim() ? Date.parse(expiry) : null,
      parentId: grant?.definition.parentId ?? null,
    });
    if (Option.isNone(definition)) {
      setError("Choose a principal, at least one item and action, and valid ISO dates.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: VaultGrantMutation = {
        operationId,
        expectedRevision: revision,
        change: { type: "save", grant: definition.value },
      };
      const result = await previewCommand({ environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setPending({ input, preview: result.value });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyCommand({ environmentId, input: pending.input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={grant ? "Edit access grant" : "Add access grant"}
      dismissible={!busy}
      onClose={onClose}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerClassName="gap-4 px-5 pb-8"
      >
        {pending ? (
          <>
            <PreviewDetails preview={pending.preview} />
            <View className="flex-row flex-wrap gap-2">
              <Button label="Back to editing" disabled={busy} onPress={() => setPending(null)} />
              <Button
                label="Apply reviewed change"
                tone="primary"
                disabled={busy}
                onPress={() => void apply()}
              />
            </View>
          </>
        ) : (
          <>
            <Text>
              Choose exact items and actions. Project grants cover all threads in that project.
            </Text>
            <TextInput
              accessibilityLabel="Grant name"
              placeholder="Grant name"
              value={label}
              maxLength={200}
              editable={!busy}
              onChangeText={(next) => {
                setLabel(next);
                changed();
              }}
            />
            <SubjectPicker
              catalog={catalog}
              value={principal}
              disabled={busy}
              onChange={(next) => {
                setPrincipal(next);
                changed();
              }}
            />
            <Text>Selected items ({items.length}/32)</Text>
            {page.isPending ? <Text accessibilityRole="text">Loading items…</Text> : null}
            {page.data?.items.length === 0 && !page.isPending ? (
              <Text>No items on this page. Add a Vault item or preauthorize an item ID below.</Text>
            ) : null}
            <Button label="Refresh items" disabled={busy} onPress={page.refresh} />
            {page.data?.items.map((item) => (
              <View key={item.id} className="flex-row items-center justify-between gap-2">
                <Text className="flex-1">
                  {item.label}
                  {item.state === "archived" ? " (Archived)" : ""}
                </Text>
                <Switch
                  accessibilityLabel={`Grant access to ${item.label}`}
                  value={items.includes(item.id)}
                  disabled={busy || (!items.includes(item.id) && items.length >= 32)}
                  onValueChange={(checked) => {
                    setItems((previous) =>
                      checked
                        ? [...previous, item.id]
                        : previous.filter((value) => value !== item.id),
                    );
                    changed();
                  }}
                />
              </View>
            ))}
            {page.error ? <Text accessibilityRole="alert">{page.error}</Text> : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="First items"
                disabled={busy || cursor === null}
                onPress={() => setCursor(null)}
              />
              <Button
                label="Next items"
                disabled={busy || !page.data?.nextCursor}
                onPress={() => {
                  if (page.data?.nextCursor) setCursor(page.data.nextCursor);
                }}
              />
            </View>
            <Text selectable className="text-foreground-muted">
              Selected IDs: {items.join(", ") || "None"}
            </Text>
            <TextInput
              accessibilityLabel="Additional item ID"
              placeholder="Existing or pre-authorized item ID"
              value={extraId}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setExtraId}
            />
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Add item ID"
                disabled={busy || !/^[a-f0-9]{32}$/.test(extraId) || items.length >= 32}
                onPress={() => {
                  setItems((previous) => [...new Set([...previous, extraId])]);
                  setExtraId("");
                  changed();
                }}
              />
              <Button
                label="Clear selected items"
                disabled={busy || items.length === 0}
                onPress={() => {
                  setItems([]);
                  changed();
                }}
              />
            </View>
            <Text>Allowed actions</Text>
            {VaultAccessAction.literals.map((action) => (
              <View key={action} className="flex-row items-center justify-between gap-2">
                <Text>{VAULT_ACTION_LABELS[action]}</Text>
                <Switch
                  accessibilityLabel={VAULT_ACTION_LABELS[action]}
                  value={actions.includes(action)}
                  disabled={busy}
                  onValueChange={(checked) => {
                    setActions((previous) =>
                      checked
                        ? [...previous, action]
                        : previous.filter((value) => value !== action),
                    );
                    changed();
                  }}
                />
              </View>
            ))}
            <Text className="text-foreground-muted">
              Use, reveal and export grants still need a supported delivery channel. Delegate
              permits narrower direct-subagent access.
            </Text>
            <Text>Exact destination, optional</Text>
            <TextInput
              accessibilityLabel="Exact destination"
              value={destination}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(next) => {
                setDestination(next);
                changed();
              }}
            />
            <Text>Access duration</Text>
            <View className="flex-row flex-wrap gap-2">
              {[1, 24, 168].map((hours) => (
                <Button
                  key={hours}
                  label={hours === 168 ? "7 days" : hours === 1 ? "1 hour" : `${hours} hours`}
                  disabled={busy}
                  onPress={() => {
                    setExpiry(new Date(Date.now() + hours * 3_600_000).toISOString());
                    changed();
                  }}
                />
              ))}
              <Button
                label="No expiry"
                disabled={busy}
                onPress={() => {
                  setExpiry("");
                  changed();
                }}
              />
            </View>
            <Text>Starts, ISO date and time</Text>
            <TextInput
              accessibilityLabel="Grant starts at"
              value={start}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(next) => {
                setStart(next);
                changed();
              }}
            />
            <Text>Expires, ISO date and time. Leave empty for no expiry.</Text>
            <TextInput
              accessibilityLabel="Grant expires at"
              value={expiry}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(next) => {
                setExpiry(next);
                changed();
              }}
            />
            <Button
              label="Preview grant"
              tone="primary"
              disabled={busy}
              onPress={() => void preview()}
            />
          </>
        )}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        <Button label="Cancel" disabled={busy} onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}
function PreviewDetails({ preview }: { preview: VaultGrantPreview }) {
  return (
    <View className="gap-2">
      <Text className="font-t3-semibold">Review {preview.grant.definition.label}</Text>
      <Text>
        {preview.affectedGrantIds.length} known grant relationships and{" "}
        {preview.knownItemIds.length} item references affected. Policy revision{" "}
        {preview.policyRevision}.
      </Text>
      {preview.unknowns.map((text) => (
        <Text key={text} className="text-foreground-muted">
          {text}
        </Text>
      ))}
    </View>
  );
}
function MutationSheet({
  environmentId,
  pending,
  onClose,
  onSaved,
}: {
  environmentId: EnvironmentId;
  pending: { input: VaultGrantMutation; preview: VaultGrantPreview };
  onClose: () => void;
  onSaved: () => void;
}) {
  const applyCommand = useAtomCommand(access.apply, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await applyCommand({ environmentId, input: pending.input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Review grant change" dismissible={!busy} onClose={onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 pb-8"
      >
        <PreviewDetails preview={pending.preview} />
        <Text>
          Set grant to {pending.preview.grant.state}. Revocation permanently blocks new
          authorization through this grant and its descendants.
        </Text>
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        <Button label="Abandon preview" disabled={busy} onPress={onClose} />
        <Button
          label="Apply reviewed change"
          tone="primary"
          disabled={busy}
          onPress={() => void apply()}
        />
      </ScrollView>
    </Sheet>
  );
}
function AccessCheck({
  environmentId,
  catalog,
  initialItemId = "",
  policyRevision,
}: {
  environmentId: EnvironmentId;
  catalog: VaultAccessCatalog;
  initialItemId?: string;
  policyRevision?: number;
}) {
  const registry = useContext(RegistryContext);
  const [controller, setController] = useState<AbortController | null>(null);
  useEffect(() => () => controller?.abort(), [controller]);
  const [principal, setPrincipal] = useState(""),
    [itemId, setItemId] = useState(initialItemId),
    [destination, setDestination] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const itemPage = useEnvironmentQuery(
    core.list({ environmentId, input: { cursor, includeArchived: true } }),
  );
  const [action, setAction] = useState<VaultAccessAction>("manage");
  const [explanation, setExplanation] = useState<VaultAccessExplanation | null>(null),
    [report, setReport] = useState<VaultReadinessReport | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const checkedTime = useVaultTime([
    report?.freshUntil ?? null,
    explanation?.context?.freshUntil ?? null,
  ]);
  const policyChanged =
    policyRevision !== undefined &&
    explanation !== null &&
    explanation.decision.policyRevision !== policyRevision;
  const changed = () => {
    setExplanation(null);
    setReport(null);
    setError(null);
  };
  const check = async () => {
    const cancellation = new AbortController();
    setController(cancellation);
    setBusy(true);
    setReport(null);
    setExplanation(null);
    setError(null);
    try {
      const input = {
        threadId: ThreadId.make(principal.slice("thread:".length)),
        itemId,
        action,
        destination: destination.trim() || null,
      };
      const options = {
        signal: cancellation.signal,
        refresh: true,
        reportFailure: false,
        reportDefect: false,
      };
      const why = await executeAtomQuery(
        registry,
        access.explain.resultAtom({ environmentId, input }),
        options,
      );
      if (why._tag === "Failure") throw squashAtomCommandFailure(why);
      setExplanation(why.value);
      const ready = await executeAtomQuery(
        registry,
        access.readiness.resultAtom({
          environmentId,
          input: {
            threadId: input.threadId,
            requirements: [{ itemId, action, destination: input.destination }],
          },
        }),
        options,
      );
      if (ready._tag === "Failure") throw squashAtomCommandFailure(ready);
      setReport(ready.value);
    } catch (cause) {
      setError(
        cancellation.signal.aborted
          ? "Check cancelled. Run it again for a fresh result."
          : message(cause),
      );
    } finally {
      setController(null);
      setBusy(false);
    }
  };
  return (
    <View className="gap-3 rounded-2xl bg-subtle p-3">
      <Text className="font-t3-semibold">Why this access?</Text>
      <SubjectPicker
        catalog={catalog}
        value={principal}
        threadsOnly
        disabled={busy}
        onChange={(next) => {
          setPrincipal(next);
          changed();
        }}
      />
      <Text>Select an item</Text>
      {itemPage.data?.items.map((item) => (
        <Button
          key={item.id}
          label={`${item.id === itemId ? "Selected: " : ""}${item.label}`}
          tone={item.id === itemId ? "primary" : "secondary"}
          disabled={busy}
          onPress={() => {
            setItemId(item.id);
            changed();
          }}
        />
      ))}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="First items"
          disabled={busy || cursor === null}
          onPress={() => setCursor(null)}
        />
        <Button
          label="Next items"
          disabled={busy || !itemPage.data?.nextCursor}
          onPress={() => {
            if (itemPage.data?.nextCursor) setCursor(itemPage.data.nextCursor);
          }}
        />
      </View>
      {itemPage.error ? <Text accessibilityRole="alert">{itemPage.error}</Text> : null}
      <TextInput
        accessibilityLabel="Check item ID"
        placeholder="Item ID"
        value={itemId}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(next) => {
          setItemId(next);
          changed();
        }}
      />
      <View className="flex-row flex-wrap gap-2">
        {VaultAccessAction.literals.map((value) => (
          <Button
            key={value}
            label={VAULT_ACTION_LABELS[value]}
            tone={action === value ? "primary" : "secondary"}
            disabled={busy}
            onPress={() => {
              setAction(value);
              changed();
            }}
          />
        ))}
      </View>
      <TextInput
        accessibilityLabel="Check exact destination"
        placeholder="Exact destination, optional"
        value={destination}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onChangeText={(next) => {
          setDestination(next);
          changed();
        }}
      />
      <Button
        label={busy ? "Checking…" : "Explain and check readiness"}
        disabled={busy || !principal || !/^[a-f0-9]{32}$/.test(itemId)}
        onPress={() => void check()}
      />
      {busy ? <Button label="Cancel access check" onPress={() => controller?.abort()} /> : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {policyChanged ? (
        <Text>Policy changed after this check. Run it again for the current decision.</Text>
      ) : null}
      {explanation && !policyChanged ? (
        <>
          <Text>
            {explanation.decision.allowed
              ? "Allowed by policy when checked"
              : "Denied by policy when checked"}
            : {vaultDecisionMessage(explanation.decision.reason)} Policy{" "}
            {explanation.decision.policyRevision}.
          </Text>
          {explanation.decision.grantId ? (
            <Text selectable>
              Grant {explanation.decision.grantId}, revision {explanation.decision.grantRevision}.
              Lineage: {explanation.decision.lineage.join(", ")}
            </Text>
          ) : null}
          {explanation.context ? (
            <View className="gap-2">
              <Text accessibilityRole="header">Related Vault context</Text>
              {vaultAccessContextRows(explanation.context, checkedTime).map((row) => (
                <Text key={row.id} selectable className="text-foreground-muted">
                  {row.text}
                </Text>
              ))}
            </View>
          ) : null}
          {explanation.unknowns.map((text) => (
            <Text key={text} className="text-foreground-muted">
              {text}
            </Text>
          ))}
        </>
      ) : null}
      {report && !policyChanged ? (
        <>
          <Text>
            {vaultReadinessIsStale(report, checkedTime)
              ? "Stale readiness result"
              : report.ready
                ? "Policy and connection checks passed"
                : "Not ready for the requested operation"}
            . Valid until {new Date(report.freshUntil).toLocaleTimeString()} in Loom server context.
          </Text>
          {report.checks.map((check) => (
            <Text key={check.id} className="text-foreground-muted">
              {check.state}: {vaultDecisionMessage(check.reason)}{" "}
              {check.state !== "passed" ? check.repair : ""}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

export function VaultAccessCheckSheet({
  environmentId,
  itemId,
  onClose,
}: {
  environmentId: EnvironmentId;
  itemId: string;
  onClose: () => void;
}) {
  const catalog = useEnvironmentQuery(access.catalog({ environmentId, input: {} }));
  return (
    <Sheet title="Why this access?" onClose={onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerClassName="gap-4 px-5 pb-8"
      >
        {catalog.data ? (
          <AccessCheck
            environmentId={environmentId}
            catalog={catalog.data}
            initialItemId={itemId}
          />
        ) : (
          <Text>{catalog.error ?? "Loading workloads…"}</Text>
        )}
        <Button label="Close access check" onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}
