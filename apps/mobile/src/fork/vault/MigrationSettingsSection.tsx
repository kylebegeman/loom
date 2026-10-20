import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Switch, View } from "react-native";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import type { VaultMigrationResult } from "@t3tools/contracts/fork";
import { createVaultMigrationAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Redacted from "effect/Redacted";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { connectionAtomRuntime } from "../../connection/runtime";
import { uuidv4 } from "../../lib/uuid";
import { useVaultTime } from "./useVaultTime";
const atoms = createVaultMigrationAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const unwrap = <A, E>(result: AtomCommandResult<A, E>) => {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
};
export function VaultMigrationSettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId),
    canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-migration-imports"))
    return null;
  return (
    <SettingsSection title="Vault development imports">
      {canRead ? (
        <Imports
          key={`${environmentId}:${connected}`}
          environmentId={environmentId}
          connected={connected}
        />
      ) : (
        <Text>Your connection does not include Vault inspection.</Text>
      )}
    </SettingsSection>
  );
}
function Imports({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [id, setId] = useState(newId),
    [label, setLabel] = useState(""),
    [kind, setKind] = useState<"secret" | "secure-note">("secret"),
    [value, setValue] = useState(""),
    [dedicated, setDedicated] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [enteringValue, setEnteringValue] = useState(false),
    [result, setResult] = useState<VaultMigrationResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const list = useEnvironmentQuery(
      connected ? atoms.list({ environmentId, input: { cursor } }) : null,
    ),
    page = list.isSuccess && !list.isPending ? list.data : null;
  const prepare = useAtomCommand(atoms.prepare, { reportFailure: false }),
    apply = useAtomCommand(atoms.apply, { reportFailure: false }),
    inspect = useAtomCommand(atoms.inspect, { reportFailure: false }),
    cancel = useAtomCommand(atoms.cancel, { reportFailure: false }),
    archive = useAtomCommand(atoms.archive, { reportFailure: false });
  const canWrite = useAtomValue(atoms.prepare.permissionAtom(environmentId)),
    locked = busy || !connected || !canWrite;
  const now = useVaultTime([result?.plan.expiresAt ?? null]),
    pending = result && ["prepared", "applying"].includes(result.plan.state);
  const act = async (work: () => Promise<VaultMigrationResult>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      setResult(next);
      if (!["prepared", "applying"].includes(next.plan.state)) setValue("");
      list.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Import failed. Refresh its status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setResult(null);
    setId(newId());
    setLabel("");
    setValue("");
    setDedicated(false);
    setReviewed(false);
    setEnteringValue(false);
    setError(null);
  };
  return (
    <View className="gap-3">
      <Text>
        Use a dedicated development identity. For SSH, create a fresh Vault key. For GitHub, connect
        a dedicated App or token under Vault GitHub connections.
      </Text>
      <Text>
        Import one development secret or secure note into a new record. This does not read personal
        stores or files, change repository settings, grant workload access or verify a provider
        login.
      </Text>
      <Text>Selected computer: {environmentId}</Text>
      {!connected ? <Text>Reconnect to prepare an import review.</Text> : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {!result ? (
        <View className="gap-3">
          <Text>Development item label</Text>
          <TextInput
            accessibilityLabel="Development import label"
            value={label}
            onChangeText={setLabel}
            maxLength={200}
            editable={!locked}
          />
          <Button
            label={
              kind === "secret"
                ? "Record type: Development secret"
                : "Record type: Development secure note"
            }
            disabled={locked}
            onPress={() => setKind(kind === "secret" ? "secure-note" : "secret")}
          />
          <Text>Private value</Text>
          <TextInput
            accessibilityLabel="Development import value"
            value={value}
            onChangeText={setValue}
            maxLength={65536}
            editable={!locked}
            secureTextEntry={kind === "secret"}
            multiline={kind === "secure-note"}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text>
            This credential is dedicated to development and is not shared with my personal accounts.
          </Text>
          <Switch
            accessibilityLabel="Dedicated development credential"
            value={dedicated}
            onValueChange={setDedicated}
            disabled={locked}
          />
          <Button
            label="Review development import"
            disabled={locked || !dedicated || !label.trim() || !value}
            onPress={() =>
              void act(() =>
                prepare({
                  environmentId,
                  input: {
                    id,
                    label: label.trim(),
                    kind,
                    developmentOnly: true,
                    value: Redacted.make(value),
                  },
                }).then(unwrap),
              )
            }
          />
          <Button label="Clear private input" disabled={busy} onPress={reset} />
        </View>
      ) : (
        <View className="gap-3 rounded-lg border border-border p-3">
          <Text className="font-semibold">
            {result.plan.label} · {result.plan.kind} · {result.plan.state}
          </Text>
          <Text>
            New Vault record: {result.plan.itemId}. Existing records, personal stores and project
            configuration are preserved.
          </Text>
          <Text>Review expires {new Date(result.plan.expiresAt).toLocaleString()}.</Text>
          {result.item ? (
            <Text>
              Stored record version {result.item.version} · {result.item.state}
            </Text>
          ) : null}
          {pending ? (
            <>
              {enteringValue ? (
                <>
                  <Text>Reenter the same private value to retry this review</Text>
                  <TextInput
                    accessibilityLabel="Development import value"
                    value={value}
                    onChangeText={setValue}
                    maxLength={65536}
                    editable={!locked}
                    secureTextEntry={result.plan.kind === "secret"}
                    multiline={result.plan.kind === "secure-note"}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </>
              ) : (
                <Text>Private value is held only for this review and is hidden here.</Text>
              )}
              <Text>I reviewed this new development record and selected computer.</Text>
              <Switch
                accessibilityLabel="Confirm development import review"
                value={reviewed}
                onValueChange={setReviewed}
                disabled={locked}
              />
              {result.plan.state === "prepared" && now >= result.plan.expiresAt ? (
                <Text>This review expired. Cancel it and prepare a new review.</Text>
              ) : null}
              <Button
                label={
                  result.plan.state === "applying"
                    ? "Retry accepted import"
                    : "Import reviewed development record"
                }
                disabled={
                  locked ||
                  !reviewed ||
                  !value ||
                  (result.plan.state === "prepared" && now >= result.plan.expiresAt)
                }
                onPress={() =>
                  void act(() =>
                    apply({
                      environmentId,
                      input: { id: result.plan.id, reviewed: true, value: Redacted.make(value) },
                    }).then(unwrap),
                  )
                }
              />
            </>
          ) : null}
          <Button
            label="Refresh import status"
            disabled={busy || !connected}
            onPress={() =>
              void act(() => inspect({ environmentId, input: { id: result.plan.id } }).then(unwrap))
            }
          />
          {["prepared", "expired"].includes(result.plan.state) ? (
            <Button
              label="Cancel review"
              disabled={locked}
              onPress={() =>
                void act(() =>
                  cancel({ environmentId, input: { id: result.plan.id } }).then(unwrap),
                )
              }
            />
          ) : null}
          {result.canArchive ? (
            <Button
              label="Archive unchanged imported record"
              disabled={locked}
              onPress={() =>
                void act(() =>
                  archive({ environmentId, input: { id: result.plan.id } }).then(unwrap),
                )
              }
            />
          ) : null}
          {!pending ? (
            <Button label="Start another review" disabled={busy} onPress={reset} />
          ) : null}
          {result.plan.state === "imported" ? (
            <Text>
              The record is stored. Configure and verify its adapter before any repository cutover.
              Archiving preserves encrypted history; restore through Vault management.
            </Text>
          ) : null}
        </View>
      )}
      {busy ? <Text>Updating import review…</Text> : null}
      <Text className="font-semibold">Recent import reviews</Text>
      <Button label="Refresh import reviews" disabled={busy || !connected} onPress={list.refresh} />
      {list.isPending ? <Text>Loading import reviews…</Text> : null}
      {list.error ? (
        <Text accessibilityRole="alert">
          Could not load import reviews. Check Vault access and refresh.
        </Text>
      ) : null}
      {page?.items.length === 0 ? <Text>No import reviews on this page.</Text> : null}
      {page?.items.map((entry) => (
        <View key={entry.plan.id} className="gap-2">
          <Text>
            {entry.plan.label} · {entry.plan.state}
          </Text>
          <Button
            label="Open import review"
            disabled={busy || !connected}
            onPress={() => {
              setValue("");
              setEnteringValue(true);
              setReviewed(false);
              void act(() => inspect({ environmentId, input: { id: entry.plan.id } }).then(unwrap));
            }}
          />
        </View>
      ))}
      <Button
        label="First import reviews"
        disabled={!cursor || list.isPending || busy || !connected}
        onPress={() => setCursor(null)}
      />
      <Button
        label="More import reviews"
        disabled={!page?.nextCursor || list.isPending || busy || !connected}
        onPress={() => setCursor(page?.nextCursor ?? null)}
      />
    </View>
  );
}
