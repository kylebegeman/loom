import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  VaultSshGenerate,
  type VaultSshProbeResult,
  type VaultSshTrust,
} from "@t3tools/contracts/fork";
import { createVaultSshAtoms, parseVaultSshPublicKey } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
const ssh = createVaultSshAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const decodeGenerate = Schema.decodeUnknownOption(VaultSshGenerate);
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "SSH management failed. Refresh and try again.";
export function VaultSshSheet({
  environmentId,
  itemId,
  connected,
  onClose,
}: {
  environmentId: EnvironmentId;
  itemId: string | null;
  connected: boolean;
  onClose: () => void;
}) {
  const [id, setId] = useState(itemId),
    [busy, setBusy] = useState(false);
  return (
    <Sheet title={id ? "SSH key" : "Create SSH key"} dismissible={!busy} onClose={onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 px-5 pb-8"
      >
        {id ? (
          <SshDetails
            key={id}
            environmentId={environmentId}
            connected={connected}
            id={id}
            busy={busy}
            setBusy={setBusy}
          />
        ) : (
          <SshCreator
            environmentId={environmentId}
            connected={connected}
            busy={busy}
            setBusy={setBusy}
            onCreated={setId}
          />
        )}
        <Button label="Close" disabled={busy} onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}
function SshCreator({
  environmentId,
  connected,
  busy,
  setBusy,
  onCreated,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [label, setLabel] = useState(""),
    [hostname, setHostname] = useState(""),
    [username, setUsername] = useState(""),
    [port, setPort] = useState("22");
  const [id] = useState(newId),
    [operationId, setOperationId] = useState(newId),
    [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(ssh.generate.permissionAtom(environmentId)),
    generate = useAtomCommand(ssh.generate, { reportFailure: false });
  const changed = () => {
    setOperationId(newId());
    setError(null);
  };
  const create = async () => {
    if (busy || !connected || !allowed) return;
    const decoded = decodeGenerate({
      id,
      operationId,
      label: label.trim(),
      target: {
        hostname: hostname.trim().toLowerCase(),
        username: username.trim(),
        port: Number(port),
        hostKey: null,
      },
    });
    if (Option.isNone(decoded)) {
      setError("Enter a key name, host name or IPv4 address, SSH user and a port from 1 to 65535.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await generate({ environmentId, input: decoded.value });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onCreated(result.value.item.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Text>
        Create a dedicated development key, then register its public key and verify the host.
      </Text>
      <View className="gap-2">
        <Text>Key name</Text>
        <TextInput
          accessibilityLabel="Key name"
          value={label}
          maxLength={200}
          editable={!busy}
          onChangeText={(value) => {
            setLabel(value);
            changed();
          }}
        />
      </View>
      <View className="gap-2">
        <Text>Host name or IPv4 address</Text>
        <TextInput
          accessibilityLabel="Host name or IPv4 address"
          value={hostname}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={253}
          editable={!busy}
          onChangeText={(value) => {
            setHostname(value);
            changed();
          }}
        />
      </View>
      <View className="gap-2">
        <Text>SSH user</Text>
        <TextInput
          accessibilityLabel="SSH user"
          value={username}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={64}
          editable={!busy}
          onChangeText={(value) => {
            setUsername(value);
            changed();
          }}
        />
      </View>
      <View className="gap-2">
        <Text>Port</Text>
        <TextInput
          accessibilityLabel="Port"
          value={port}
          keyboardType="number-pad"
          maxLength={5}
          editable={!busy}
          onChangeText={(value) => {
            setPort(value);
            changed();
          }}
        />
      </View>
      <Text className="text-foreground-muted">
        The private key stays in Vault. Host trust starts empty, so this key cannot connect until
        you verify and save a host key.
      </Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {!allowed ? <Text>Vault write access is required to create keys.</Text> : null}
      <Button
        label={busy ? "Creating key…" : "Create key"}
        tone="primary"
        disabled={!connected || !allowed || busy}
        onPress={() => void create()}
      />
    </>
  );
}
function SshDetails({
  environmentId,
  connected,
  id,
  busy,
  setBusy,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  id: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const query = useEnvironmentQuery(connected ? ssh.info({ environmentId, input: { id } }) : null),
    info = query.data;
  const canTrust = useAtomValue(ssh.trust.permissionAtom(environmentId)),
    canProbe = useAtomValue(ssh.probe.permissionAtom(environmentId));
  const trust = useAtomCommand(ssh.trust, { reportFailure: false }),
    test = useAtomCommand(ssh.probe, { reportFailure: false });
  const [hostKey, setHostKey] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [removing, setRemoving] = useState(false),
    [operationId, setOperationId] = useState(newId);
  const [error, setError] = useState<string | null>(null),
    [probe, setProbe] = useState<VaultSshProbeResult | null>(null),
    [copied, setCopied] = useState(false);
  const [action, setAction] = useState<"trust" | "probe" | null>(null);
  const candidate = parseVaultSshPublicKey(hostKey),
    writable =
      connected && canTrust && info?.item.state === "active" && !query.error && !query.isPending;
  const refresh = () => {
    setProbe(null);
    setConfirmed(false);
    query.refresh();
  };
  const changeTrust = async () => {
    if (!info || busy || !writable || !confirmed || (!removing && !candidate)) return;
    const input: VaultSshTrust = {
      id,
      operationId,
      expectedVersion: info.item.version,
      hostKey: removing ? null : candidate!.key,
    };
    setBusy(true);
    setAction("trust");
    setError(null);
    setProbe(null);
    try {
      const result = await trust({ environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setHostKey("");
      setConfirmed(false);
      setRemoving(false);
      setOperationId(newId());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      setAction(null);
    }
  };
  const probeConnection = async () => {
    if (!info || busy || !connected || !canProbe) return;
    setBusy(true);
    setAction("probe");
    setError(null);
    setProbe(null);
    try {
      const result = await test({
        environmentId,
        input: { id, expectedVersion: info.item.version },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setProbe(result.value);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      setAction(null);
    }
  };
  const copy = async () => {
    if (!info) return;
    try {
      await Clipboard.setStringAsync(info.publicKey);
      setCopied(true);
    } catch {
      setError("Could not copy the public key. Select and copy it below.");
    }
  };
  if (!info)
    return (
      <>
        <Text accessibilityRole={query.error ? "alert" : "text"}>
          {query.error ??
            (connected ? "Loading SSH key…" : "Reconnect this computer to inspect SSH keys.")}
        </Text>
        <Button label="Retry loading key" disabled={!connected || busy} onPress={refresh} />
      </>
    );
  return (
    <>
      <View className="gap-1">
        <Text className="font-t3-semibold">{info.item.label}</Text>
        <Text selectable>{info.destination}</Text>
        <Text className="text-foreground-muted">
          Version {info.item.version}
          {info.item.state !== "active" ? " · Archived" : ""}
        </Text>
      </View>
      {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
      <View className="gap-2">
        <Text className="font-t3-semibold">Public key</Text>
        <Text selectable>{info.publicKey}</Text>
        <Text selectable>{info.fingerprint}</Text>
        <Button
          label={copied ? "Public key copied" : "Copy public key"}
          onPress={() => void copy()}
        />
        <Text className="text-foreground-muted">
          Register this public key on the intended host. Never register the private key.
        </Text>
      </View>
      <View className="gap-2">
        <Text className="font-t3-semibold">Host trust</Text>
        <Text>
          {info.target.hostKey
            ? "A host key is pinned."
            : "Untrusted host. Save a verified host key before connecting."}
        </Text>
        {info.hostFingerprint ? <Text selectable>Current: {info.hostFingerprint}</Text> : null}
        {!removing ? (
          <>
            <Text>Verified host public key</Text>
            <TextInput
              accessibilityLabel="Verified host public key"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={4096}
              placeholder="ssh-ed25519 AAAA…"
              value={hostKey}
              editable={writable && !busy}
              onChangeText={(value) => {
                setHostKey(value);
                setConfirmed(false);
                setOperationId(newId());
                setError(null);
              }}
            />
            <Text className="text-foreground-muted">
              Compare the fingerprint with the intended host through a trusted channel. A key scan
              alone does not establish trust.
            </Text>
            {candidate ? (
              <Text selectable>Proposed: {candidate.fingerprint}</Text>
            ) : hostKey ? (
              <Text accessibilityRole="alert">Enter a valid Ed25519 SSH public key.</Text>
            ) : null}
          </>
        ) : (
          <Text>
            Remove trust for this destination? New SSH operations will be blocked. The dedicated key
            and its remote registration remain.
          </Text>
        )}
        <View className="flex-row items-center gap-3">
          <Text className="flex-1">
            {removing
              ? "I want to remove this host's trust."
              : "I verified the proposed fingerprint on the intended host."}
          </Text>
          <Switch
            accessibilityLabel={
              removing ? "Confirm host trust removal" : "Confirm host fingerprint"
            }
            value={confirmed}
            disabled={!writable || busy || (!removing && !candidate)}
            onValueChange={setConfirmed}
          />
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={
              action === "trust"
                ? "Saving…"
                : removing
                  ? "Confirm trust removal"
                  : "Save verified host key"
            }
            tone="primary"
            disabled={!writable || busy || !confirmed || (!removing && !candidate)}
            onPress={() => void changeTrust()}
          />
          {info.target.hostKey ? (
            <Button
              label={removing ? "Keep host trust" : "Remove host trust"}
              disabled={!writable || busy}
              onPress={() => {
                setRemoving(!removing);
                setConfirmed(false);
                setOperationId(newId());
                setError(null);
              }}
            />
          ) : null}
        </View>
        {!canTrust ? (
          <Text className="text-foreground-muted">
            Vault write access is required to change host trust.
          </Text>
        ) : null}
      </View>
      <View className="gap-2">
        <Text className="font-t3-semibold">Connection test</Text>
        <Text className="text-foreground-muted">
          Run a fixed, harmless command from the Loom server as {info.target.username}. This checks
          this key and pinned host; provider and Git setup are separate.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={action === "probe" ? "Testing SSH…" : "Test SSH connection"}
            tone="primary"
            disabled={
              !connected ||
              !canProbe ||
              busy ||
              info.item.state !== "active" ||
              !info.target.hostKey ||
              !!query.error ||
              query.isPending
            }
            onPress={() => void probeConnection()}
          />
          <Button label="Refresh key" disabled={!connected || busy} onPress={refresh} />
        </View>
        {probe && probe.version === info.item.version ? (
          <Text accessibilityRole="status">
            SSH connection succeeded at {new Date(probe.checkedAt).toLocaleTimeString()} using
            version {probe.version}.
          </Text>
        ) : null}
      </View>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </>
  );
}
