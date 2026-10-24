import { VaultHealthContext } from "./HealthContext";
import { VaultAccessCheckSheet } from "./AccessSettingsSection";
import { useVaultTime } from "./useVaultTime";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ScrollView, Switch, View } from "react-native";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { type VaultHealthMutation, type VaultHealthIssue } from "@t3tools/contracts/fork";
import {
  createVaultHealthAtoms,
  createVaultCoreAtoms,
  supportsLoomFeature,
  vaultHealthMessage,
  vaultHealthRecheckMessage,
  vaultHealthVisibleState,
  vaultHealthInboxGroups,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
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
const atoms = createVaultHealthAtoms(connectionAtomRuntime),
  core = createVaultCoreAtoms(connectionAtomRuntime);
export function VaultHealthSettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId),
    canRead = useEnvironmentScope(environmentId, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-health")) return null;
  return (
    <SettingsSection title="Vault maintenance">
      {canRead ? (
        <Inbox
          key={`${environmentId}:${connected}:${canWrite}`}
          environmentId={environmentId}
          connected={connected}
          canWrite={canWrite}
          supportsSshValidation={supportsLoomFeature(
            config?.environment.capabilities,
            "vault-health-ssh-validation",
          )}
        />
      ) : (
        <Text>Your connection does not include Vault inspection.</Text>
      )}
    </SettingsSection>
  );
}
function Inbox({
  environmentId,
  connected,
  canWrite,
  supportsSshValidation,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  canWrite: boolean;
  supportsSshValidation: boolean;
}) {
  const snapshot = useEnvironmentQuery(
    connected ? atoms.snapshot({ environmentId, input: {} }) : null,
  );
  const snapshotData = snapshot.isSuccess && !snapshot.isPending ? snapshot.data : null;
  const apply = useAtomCommand(atoms.apply, { reportFailure: false }),
    recheck = useAtomCommand(atoms.recheck, { reportFailure: false });
  const canApply = useAtomValue(atoms.apply.permissionAtom(environmentId));
  const [contextIssue, setContextIssue] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [itemId, setItemId] = useState(""),
    [itemLabel, setItemLabel] = useState("Choose an item"),
    [expires, setExpires] = useState(""),
    [repository, setRepository] = useState(""),
    [automatic, setAutomatic] = useState(false),
    [sshValidation, setSshValidation] = useState(false),
    [history, setHistory] = useState(false),
    [picking, setPicking] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const page = useEnvironmentQuery(
    connected ? core.list({ environmentId, input: { cursor, includeArchived: false } }) : null,
  );
  const [reviewing, setReviewing] = useState<string | null>(null);
  const now = useVaultTime(snapshotData?.issues.map((issue) => issue.snoozedUntil) ?? []);
  const locked =
    !snapshotData ||
    busy ||
    !canWrite ||
    !canApply ||
    !connected ||
    snapshot.isPending ||
    !!snapshot.error;
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    await work()
      .then(() => snapshot.refresh())
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : "Could not update health. Refresh and retry.",
        );
      })
      .finally(() => setBusy(false));
  };
  const change = async (change: VaultHealthMutation["change"]) => {
    if (!snapshotData) return;
    const result = await apply({
      environmentId,
      input: {
        operationId: uuidv4().replaceAll("-", ""),
        expectedRevision: snapshotData.revision,
        change,
      },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  };
  const issueAction = (
    issue: VaultHealthIssue,
    action: "snooze" | "unsnooze" | "dismiss" | "reopen",
  ) =>
    act(() =>
      change({
        action,
        issueId: issue.id,
        until: action === "snooze" ? Date.now() + 86400_000 : null,
      }),
    );
  return (
    <View className="gap-3">
      <Text>
        Review expiry and failed development access. Provider outages do not revoke credentials.
        Background checks require an enabled rule.
      </Text>
      {!connected ? <Text>Reconnect to check Vault health.</Text> : null}
      <Button
        label="Refresh health"
        disabled={busy || !connected}
        onPress={() => {
          setError(null);
          setNotice(null);
          snapshot.refresh();
        }}
      />
      <Button
        label={history ? "Hide resolved and dismissed" : "Show resolved and dismissed"}
        onPress={() => setHistory(!history)}
      />
      {snapshot.isPending ? <Text>Loading Vault health…</Text> : null}
      {error || snapshot.error ? (
        <Text accessibilityRole="alert">
          {error ?? "Could not load Vault health. Check the backend and refresh."}
        </Text>
      ) : null}
      {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
      {snapshotData?.issues.filter((i) => history || !["dismissed", "resolved"].includes(i.state))
        .length === 0 ? (
        <Text>No active maintenance issues.</Text>
      ) : null}
      {snapshotData
        ? vaultHealthInboxGroups(snapshotData, history).map((group) => (
            <View key={group.id} className="gap-3">
              {group.label ? (
                <>
                  <Text accessibilityRole="header" className="font-semibold">
                    Outage reports: {group.label}
                  </Text>
                  <Text>
                    {group.issues.length} affected items. Reports share a destination; they may have
                    different causes. Review and update each item separately.
                  </Text>
                </>
              ) : null}
              {group.issues.map((issue) => (
                <View key={issue.id} className="gap-2 rounded-lg border border-border p-3">
                  <Text className="font-semibold">
                    {issue.itemLabel}: {issue.category}
                  </Text>
                  <Text>{vaultHealthMessage(issue)}</Text>
                  <Button label="Review access" onPress={() => setReviewing(issue.itemId)} />
                  <Button
                    label={
                      contextIssue === issue.id
                        ? "Hide project references"
                        : "Show project references"
                    }
                    onPress={() => setContextIssue(contextIssue === issue.id ? null : issue.id)}
                  />
                  {contextIssue === issue.id ? (
                    <VaultHealthContext
                      environmentId={environmentId}
                      itemId={issue.itemId}
                      connected={connected}
                    />
                  ) : null}
                  <Text>
                    {vaultHealthVisibleState(issue, now)} · {issue.occurrences} occurrences
                  </Text>
                  <Text>Last seen {new Date(issue.lastSeenAt).toLocaleString()}</Text>
                  <Button
                    label="Recheck"
                    disabled={locked}
                    onPress={() =>
                      void act(async () => {
                        const result = await recheck({
                          environmentId,
                          input: { itemId: issue.itemId },
                        });
                        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                        setNotice(vaultHealthRecheckMessage(result.value.outcome));
                      })
                    }
                  />
                  <Button
                    label={issue.state === "snoozed" ? "Unsnooze" : "Snooze 1 day"}
                    disabled={locked}
                    onPress={() =>
                      void issueAction(issue, issue.state === "snoozed" ? "unsnooze" : "snooze")
                    }
                  />
                  <Button
                    label={["dismissed", "resolved"].includes(issue.state) ? "Reopen" : "Dismiss"}
                    disabled={locked}
                    onPress={() =>
                      void issueAction(
                        issue,
                        ["dismissed", "resolved"].includes(issue.state) ? "reopen" : "dismiss",
                      )
                    }
                  />
                </View>
              ))}
            </View>
          ))
        : null}
      {snapshotData?.omittedIssues ? (
        <Text>{snapshotData.omittedIssues} older issues omitted by retention.</Text>
      ) : null}
      <Text className="font-semibold">Expiry and validation rule</Text>
      <Button label={itemLabel} disabled={locked} onPress={() => setPicking(true)} />
      <Text>Declared expiry, ISO date (optional)</Text>
      <TextInput
        accessibilityLabel="Declared expiry"
        value={expires}
        onChangeText={setExpires}
        editable={!locked}
        placeholder="2027-01-01T00:00:00Z"
      />
      {supportsSshValidation &&
      (sshValidation || page.data?.items.find((item) => item.id === itemId)?.kind === "ssh-key") ? (
        <View className="gap-2">
          <Text>
            Validate the saved SSH connection using its trusted host key and a fixed no-op command
          </Text>
          <Switch
            accessibilityLabel="Validate SSH connection"
            value={sshValidation}
            disabled={locked}
            onValueChange={(value) => {
              setSshValidation(value);
              if (value) setRepository("");
            }}
          />
        </View>
      ) : null}
      <Text>GitHub repository to validate (optional)</Text>
      <TextInput
        accessibilityLabel="Health GitHub repository"
        value={repository}
        onChangeText={setRepository}
        editable={!locked && !sshValidation}
        autoCapitalize="none"
        placeholder="owner/repo"
      />
      <Text>Run checks automatically, at most every 15 minutes</Text>
      <Switch
        accessibilityLabel="Automatic health checks"
        value={automatic}
        disabled={locked}
        onValueChange={setAutomatic}
      />
      <Button
        label="Save health rule"
        disabled={locked || !itemId}
        onPress={() =>
          void act(async () => {
            const expiresAt = expires ? Date.parse(expires) : null;
            if (expiresAt !== null && !Number.isFinite(expiresAt))
              throw new Error("Enter a valid expiry date.");
            await change({
              action: "configure",
              rule: {
                itemId,
                expiresAt,
                warningDays: 7,
                githubRepository: repository.trim() || null,
                ...(supportsSshValidation ? { sshValidation } : {}),
                automatic,
                nextCheckAt: 0,
              },
            });
            setNotice("Health rule saved.");
          })
        }
      />
      <Button
        label="Check selected item"
        disabled={locked || !itemId}
        onPress={() =>
          void act(async () => {
            const result = await recheck({ environmentId, input: { itemId } });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            setNotice(vaultHealthRecheckMessage(result.value.outcome));
          })
        }
      />
      <Button
        label="Remove rule"
        disabled={locked || !itemId}
        onPress={() => void act(() => change({ action: "remove-rule", itemId }))}
      />
      {reviewing ? (
        <VaultAccessCheckSheet
          environmentId={environmentId}
          itemId={reviewing}
          onClose={() => setReviewing(null)}
        />
      ) : null}
      {picking ? (
        <Sheet title="Choose a Vault item" onClose={() => setPicking(false)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-3 p-4"
          >
            {page.isPending ? <Text>Loading items…</Text> : null}
            {page.error ? <Text accessibilityRole="alert">Could not load Vault items.</Text> : null}
            {page.data?.items.length === 0 ? <Text>No active items in this page.</Text> : null}
            {page.data?.items.map((item) => (
              <Button
                key={item.id}
                label={item.label}
                onPress={() => {
                  const rule = snapshotData?.rules.find((r) => r.itemId === item.id);
                  setItemId(item.id);
                  setItemLabel(item.label);
                  setExpires(rule?.expiresAt ? new Date(rule.expiresAt).toISOString() : "");
                  setRepository(rule?.githubRepository ?? "");
                  setAutomatic(rule?.automatic ?? false);
                  setSshValidation(rule?.sshValidation ?? false);
                  setPicking(false);
                }}
              />
            ))}
            <Button label="First items" disabled={!cursor} onPress={() => setCursor(null)} />
            <Button
              label="More items"
              disabled={!page.data?.nextCursor}
              onPress={() => setCursor(page.data?.nextCursor ?? null)}
            />
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}
