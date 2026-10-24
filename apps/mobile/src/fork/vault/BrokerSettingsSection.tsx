import { useState } from "react";
import { ScrollView, Share, Switch, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import {
  VaultBrokerInvitation,
  VaultBrokerPublicKey,
  type VaultBrokerBegin,
  type VaultBrokerMutation,
} from "@t3tools/contracts/fork";
import {
  createVaultBrokerAtoms,
  supportsLoomFeature,
  vaultBrokerState,
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
const brokers = createVaultBrokerAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Broker management failed. Refresh and try again.";
const encodeInvitation = Schema.encodeSync(Schema.fromJsonString(VaultBrokerInvitation));
const isBrokerPublicKey = Schema.is(VaultBrokerPublicKey);
export function VaultBrokerSettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId),
    canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-brokers")) return null;
  return (
    <SettingsSection title="Vault brokers">
      {canRead ? (
        <BrokerManager key={environmentId} environmentId={environmentId} connected={connected} />
      ) : (
        <Text>Your connection does not include broker inspection.</Text>
      )}
    </SettingsSection>
  );
}
function BrokerManager({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const snapshot = useEnvironmentQuery(
    connected ? brokers.snapshot({ environmentId, input: {} }) : null,
  );
  const beginCommand = useAtomCommand(brokers.begin, { reportFailure: false }),
    applyCommand = useAtomCommand(brokers.apply, { reportFailure: false });
  const canInvite = useAtomValue(brokers.begin.permissionAtom(environmentId)),
    canApply = useAtomValue(brokers.apply.permissionAtom(environmentId));
  const now = useVaultTime(snapshot.data?.machines.map((machine) => machine.leaseUntil) ?? []);
  const [adding, setAdding] = useState(false),
    [invitation, setInvitation] = useState<typeof VaultBrokerInvitation.Type | null>(null);
  const [label, setLabel] = useState(""),
    [publicKey, setPublicKey] = useState(""),
    [platform, setPlatform] = useState<"linux" | "darwin">("linux");
  const [review, setReview] = useState<{
    input: VaultBrokerMutation;
    label: string;
    fingerprint: string;
    description: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [pendingBegin, setPendingBegin] = useState<VaultBrokerBegin | null>(null);
  const changed = () => {
    setPendingBegin(null);
    setError(null);
  };
  const begin = async () => {
    if (busy || !snapshot.data) return;
    if (!isBrokerPublicKey(publicKey.trim()) || !label.trim()) {
      setError("Enter a broker name and the public key from Loom's broker identity command.");
      return;
    }
    setBusy(true);
    setError(null);
    const input = pendingBegin ?? {
      operationId: newId(),
      expectedRevision: snapshot.data.revision,
      publicKey: publicKey.trim(),
      label: label.trim(),
      platform,
    };
    setPendingBegin(input);
    await beginCommand({ environmentId, input })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setAdding(false);
        setInvitation(result.value);
        setPendingBegin(null);
        snapshot.refresh();
      })
      .catch((cause: unknown) => setError(message(cause)))
      .finally(() => setBusy(false));
  };
  const apply = async () => {
    if (!review || busy) return;
    setBusy(true);
    setError(null);
    await applyCommand({ environmentId, input: review.input })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setReview(null);
        snapshot.refresh();
      })
      .catch((cause: unknown) => setError(message(cause)))
      .finally(() => setBusy(false));
  };
  const inspectChange = (
    change: VaultBrokerMutation["change"],
    name: string,
    fingerprint: string,
    description: string,
  ) => {
    if (!snapshot.data) return;
    setConfirmed(false);
    setError(null);
    setReview({
      input: { operationId: newId(), expectedRevision: snapshot.data.revision, change },
      label: name,
      fingerprint,
      description,
    });
  };
  return (
    <View className="gap-4">
      <Text>
        Machines trusted to run a Vault broker. Enrollment grants no item access. SSH signing and
        credential delivery still need supported channels.
      </Text>
      <Text className="text-foreground-muted">
        Foreground macOS/Linux service mode. No boot service is installed. Heartbeats renew online
        every minute and lapse after two minutes.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button label="Refresh brokers" disabled={!connected || busy} onPress={snapshot.refresh} />
        <Button
          label="Enroll broker"
          tone="primary"
          disabled={!connected || !canInvite || busy}
          onPress={() => {
            setAdding(true);
            setError(null);
          }}
        />
      </View>
      {error || snapshot.error ? (
        <Text accessibilityRole="alert">{error ?? snapshot.error}</Text>
      ) : null}
      {!snapshot.data ? (
        <Text>
          {!connected
            ? "Reconnect this computer to inspect brokers."
            : snapshot.error
              ? "Broker inspection is unavailable. Refresh to try again."
              : "Loading brokers…"}
        </Text>
      ) : (
        <>
          <Text>Registry revision {snapshot.data.revision}</Text>
          {snapshot.data.machines.length === 0 ? (
            <Text>
              No enrolled brokers. Generate a broker identity, then create an invitation here.
            </Text>
          ) : (
            snapshot.data.machines.map((machine) => (
              <View key={machine.id} className="gap-2 rounded-xl bg-surface-secondary p-3">
                <Text className="font-t3-semibold">{machine.label}</Text>
                <Text>{vaultBrokerState(machine, now)}</Text>
                <Text>
                  {machine.platform === "darwin" ? "macOS" : "Linux"} · Foreground service
                </Text>
                <Text selectable>{machine.fingerprint}</Text>
                <Text>
                  {machine.lastSeenAt === null
                    ? "No heartbeat yet"
                    : `Last seen ${new Date(machine.lastSeenAt).toLocaleString()}`}
                </Text>
                {machine.state === "active" ? (
                  <Button
                    label="Review disable"
                    disabled={!connected || !canApply || busy}
                    onPress={() =>
                      inspectChange(
                        { type: "disable", machineId: machine.id },
                        machine.label,
                        machine.fingerprint,
                        "Disable this identity permanently and reject new heartbeats. Re-enrollment requires a new key in a separate broker identity directory.",
                      )
                    }
                  />
                ) : (
                  <Text>
                    Enroll a new identity to restore this machine. Previously copied credentials are
                    outside this control.
                  </Text>
                )}
              </View>
            ))
          )}
          {snapshot.data.enrollments.map((enrollment) => (
            <View key={enrollment.id} className="gap-2 rounded-xl bg-surface-secondary p-3">
              <Text className="font-t3-semibold">{enrollment.label}</Text>
              <Text>
                {enrollment.state === "awaiting-approval"
                  ? "Proof received. Compare fingerprints before approving."
                  : "Waiting for the broker to claim its invitation."}
              </Text>
              <Text>Expires {new Date(enrollment.expiresAt).toLocaleString()}</Text>
              <Text selectable>{enrollment.fingerprint}</Text>
              {enrollment.state === "awaiting-approval" ? (
                <Button
                  label="Review approval"
                  disabled={!connected || !canApply || busy}
                  onPress={() =>
                    inspectChange(
                      {
                        type: "approve",
                        enrollmentId: enrollment.id,
                        fingerprint: enrollment.fingerprint,
                      },
                      enrollment.label,
                      enrollment.fingerprint,
                      "Compare the full fingerprint with the broker identity output on the intended host. Approval verifies machine identity and grants no item access.",
                    )
                  }
                />
              ) : null}
              <Button
                label="Review cancellation"
                disabled={!connected || !canApply || busy}
                onPress={() =>
                  inspectChange(
                    { type: "cancel", enrollmentId: enrollment.id },
                    enrollment.label,
                    enrollment.fingerprint,
                    "Cancel this invitation. A new invitation is required to continue enrollment.",
                  )
                }
              />
            </View>
          ))}
        </>
      )}
      {adding ? (
        <Sheet title="Enroll a Vault broker" dismissible={!busy} onClose={() => setAdding(false)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="gap-4 px-5 pb-8"
          >
            <Text>
              Run Loom's broker identity command on the host first. Enter its public key here; its
              private key stays on that host.
            </Text>
            <TextInput
              accessibilityLabel="Broker name"
              placeholder="Broker name"
              value={label}
              editable={!busy}
              onChangeText={(value) => {
                setLabel(value);
                changed();
              }}
              maxLength={120}
            />
            <TextInput
              accessibilityLabel="Broker public key"
              placeholder="Broker public key"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              value={publicKey}
              editable={!busy}
              onChangeText={(value) => {
                setPublicKey(value);
                changed();
              }}
            />
            <View className="flex-row gap-2">
              <Button
                label="Linux"
                tone={platform === "linux" ? "primary" : "secondary"}
                disabled={busy}
                onPress={() => {
                  setPlatform("linux");
                  changed();
                }}
              />
              <Button
                label="macOS"
                tone={platform === "darwin" ? "primary" : "secondary"}
                disabled={busy}
                onPress={() => {
                  setPlatform("darwin");
                  changed();
                }}
              />
            </View>
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            <Button
              label={busy ? "Creating invitation…" : "Create invitation"}
              tone="primary"
              disabled={!connected || !canInvite || busy}
              onPress={() => void begin()}
            />
            <Button label="Cancel" disabled={busy} onPress={() => setAdding(false)} />
          </ScrollView>
        </Sheet>
      ) : null}
      {invitation ? (
        <Sheet title="Claim this invitation" onClose={() => setInvitation(null)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 px-5 pb-8"
          >
            <Text>
              Share this public challenge with the intended broker and save it as an invitation JSON
              file. Only the matching private key can claim it. Then return here, refresh and review
              approval.
            </Text>
            <Text selectable>{invitation.fingerprint}</Text>
            <Text>Expires {new Date(invitation.expiresAt).toLocaleString()}</Text>
            <Button
              label="Share invitation"
              tone="primary"
              onPress={() => {
                void Share.share({
                  message: encodeInvitation(invitation),
                  title: "Loom Vault enrollment invitation",
                }).catch(() => setError("Could not share this invitation. Try again."));
              }}
            />
            <Text selectable>{encodeInvitation(invitation)}</Text>
            <Button label="Done" onPress={() => setInvitation(null)} />
          </ScrollView>
        </Sheet>
      ) : null}
      {review ? (
        <Sheet title={`Review ${review.label}`} dismissible={!busy} onClose={() => setReview(null)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 px-5 pb-8"
          >
            <Text>{review.description}</Text>
            <Text selectable>{review.fingerprint}</Text>
            <View className="flex-row items-center gap-3">
              <Text className="flex-1">
                {review.input.change.type === "approve"
                  ? "I compared this fingerprint with the intended broker."
                  : "I reviewed this change and its recovery requirements."}
              </Text>
              <Switch
                accessibilityLabel="Confirm broker review"
                value={confirmed}
                disabled={busy}
                onValueChange={setConfirmed}
              />
            </View>
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            <Button label="Abandon review" disabled={busy} onPress={() => setReview(null)} />
            <Button
              label={busy ? "Applying…" : "Apply reviewed change"}
              tone="primary"
              disabled={!connected || !canApply || !confirmed || busy}
              onPress={() => void apply()}
            />
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}
