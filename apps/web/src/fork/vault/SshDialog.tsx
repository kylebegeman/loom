import { LoomSettingsActions, LoomSettingsNotice } from "../settings/parts";
import { useId, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  VaultSshGenerate,
  type VaultSshProbeResult,
  type VaultSshTrust,
} from "@t3tools/contracts/fork";
import { createVaultSshAtoms, parseVaultSshPublicKey } from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
const ssh = createVaultSshAtoms(connectionAtomRuntime);
const newId = () => randomUUID().replaceAll("-", "");
const decodeGenerate = Schema.decodeUnknownOption(VaultSshGenerate);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "SSH management failed. Refresh and try again.";
const failure = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  result._tag === "Failure" ? message(Cause.squash(result.cause)) : null;
export function VaultSshDialog({
  environmentId,
  itemId,
  onClose,
}: {
  environmentId: EnvironmentId;
  itemId: string | null;
  onClose: () => void;
}) {
  const [id, setId] = useState(itemId),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{id ? "SSH key" : "Create SSH key"}</DialogTitle>
          <DialogDescription>
            {id
              ? "Public identity, verified host trust and a connection test for this environment."
              : "Create a dedicated development key, then register its public key and verify the host."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[70vh] min-w-0 flex-col gap-5 overflow-y-auto px-6 pb-5">
          {id ? (
            <SshDetails
              key={id}
              environmentId={environmentId}
              id={id}
              busy={busy}
              setBusy={setBusy}
            />
          ) : (
            <SshCreator
              environmentId={environmentId}
              busy={busy}
              setBusy={setBusy}
              onCreated={setId}
            />
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
function SshCreator({
  environmentId,
  busy,
  setBusy,
  onCreated,
}: {
  environmentId: EnvironmentId;
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
  const allowed = useAtomValue(ssh.generate.permissionAtom(environmentId));
  const fieldId = useId();
  const changed = () => {
    setOperationId(newId());
    setError(null);
  };
  const create = async () => {
    if (busy || !allowed) return;
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
      const result = await runVault(ssh.generate, { environmentId, input: decoded.value });
      onCreated(result.item.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label htmlFor={`${fieldId}-name`} className="flex flex-col gap-2 text-sm">
        Key name
        <Input
          id={`${fieldId}-name`}
          autoFocus
          value={label}
          maxLength={200}
          disabled={busy}
          onChange={(event) => {
            setLabel(event.target.value);
            changed();
          }}
        />
      </label>
      <label htmlFor={`${fieldId}-host`} className="flex flex-col gap-2 text-sm">
        Host name or IPv4 address
        <Input
          id={`${fieldId}-host`}
          autoCapitalize="none"
          autoComplete="off"
          value={hostname}
          maxLength={253}
          disabled={busy}
          onChange={(event) => {
            setHostname(event.target.value);
            changed();
          }}
        />
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label htmlFor={`${fieldId}-user`} className="flex flex-col gap-2 text-sm">
          SSH user
          <Input
            id={`${fieldId}-user`}
            autoCapitalize="none"
            autoComplete="off"
            value={username}
            maxLength={64}
            disabled={busy}
            onChange={(event) => {
              setUsername(event.target.value);
              changed();
            }}
          />
        </label>
        <label htmlFor={`${fieldId}-port`} className="flex flex-col gap-2 text-sm">
          Port
          <Input
            id={`${fieldId}-port`}
            inputMode="numeric"
            value={port}
            maxLength={5}
            disabled={busy}
            onChange={(event) => {
              setPort(event.target.value);
              changed();
            }}
          />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        The private key stays in Vault. Host trust starts empty, so this key cannot connect until
        you verify and save a host key.
      </p>
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {!allowed ? (
        <LoomSettingsNotice role="status">
          Vault write access is required to create keys.
        </LoomSettingsNotice>
      ) : null}
      <Button type="submit" disabled={!allowed || busy}>
        {busy ? "Creating key…" : "Create key"}
      </Button>
    </form>
  );
}
function SshDetails({
  environmentId,
  id,
  busy,
  setBusy,
}: {
  environmentId: EnvironmentId;
  id: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const query = ssh.info({ environmentId, input: { id } }),
    result = useAtomValue(query),
    info = Option.getOrNull(AsyncResult.value(result));
  const canTrust = useAtomValue(ssh.trust.permissionAtom(environmentId)),
    canProbe = useAtomValue(ssh.probe.permissionAtom(environmentId));
  const [hostKey, setHostKey] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [removing, setRemoving] = useState(false),
    [operationId, setOperationId] = useState(newId);
  const [action, setAction] = useState<"trust" | "probe" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null),
    [probe, setProbe] = useState<VaultSshProbeResult | null>(null);
  const copy = useCopyToClipboard({
    target: "SSH public key",
    onError: (cause) => setError(message(cause)),
  });
  const fieldId = useId(),
    candidate = parseVaultSshPublicKey(hostKey);
  const writable = info?.item.state === "active" && canTrust && !result.waiting && !failure(result);
  const refresh = () => {
    setNotice(null);
    setProbe(null);
    setConfirmed(false);
    appAtomRegistry.refresh(query);
  };
  const changeTrust = async () => {
    if (!info || busy || !writable || !confirmed || (!removing && !candidate)) return;
    const input: VaultSshTrust = {
      id,
      operationId,
      expectedVersion: info.item.version,
      hostKey: removing ? null : candidate!.key,
    };
    // Keep focus in the modal before the active action becomes disabled.
    feedback.current?.focus();
    setBusy(true);
    setAction("trust");
    setError(null);
    setNotice(null);
    setProbe(null);
    try {
      await runVault(ssh.trust, { environmentId, input });
      setNotice(
        removing
          ? "Host trust removed. New SSH operations are blocked."
          : "Verified host trust saved.",
      );
      setHostKey("");
      setConfirmed(false);
      setRemoving(false);
      setOperationId(newId());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setAction(null);
      setBusy(false);
    }
  };
  const test = async () => {
    if (!info || busy || !canProbe) return;
    // Keep focus in the modal before the active action becomes disabled.
    feedback.current?.focus();
    setBusy(true);
    setAction("probe");
    setError(null);
    setNotice(null);
    setProbe(null);
    try {
      setProbe(
        await runVault(ssh.probe, {
          environmentId,
          input: { id, expectedVersion: info.item.version },
        }),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setAction(null);
      setBusy(false);
    }
  };
  if (!info)
    return (
      <>
        <LoomSettingsNotice role={failure(result) ? "alert" : "status"}>
          {failure(result) ?? "Loading SSH key…"}
        </LoomSettingsNotice>
        <Button variant="outline" disabled={busy} onClick={refresh}>
          Retry loading key
        </Button>
      </>
    );
  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="break-words text-sm font-medium">{info.item.label}</h3>
        <p className="break-all text-sm">{info.destination}</p>
        <p className="text-xs text-muted-foreground">
          Version {info.item.version}
          {info.item.state !== "active" ? " · Archived" : ""}
        </p>
      </div>
      {failure(result) ? (
        <LoomSettingsNotice role="alert">{failure(result)}</LoomSettingsNotice>
      ) : null}
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm font-medium">Public key</p>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
          {info.publicKey}
        </pre>
        <p className="break-all text-xs">{info.fingerprint}</p>
        <Button
          size="sm"
          variant="outline"
          autoFocus
          onClick={() => copy.copyToClipboard(info.publicKey, undefined)}
        >
          {copy.isCopied ? "Public key copied" : "Copy public key"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Register this public key on the intended host. Never register the private key.
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm font-medium">Host trust</p>
        <p className="text-sm">
          {info.target.hostKey
            ? "A host key is pinned."
            : "Untrusted host. Save a verified host key before connecting."}
        </p>
        {info.hostFingerprint ? (
          <p className="break-all text-xs">Current: {info.hostFingerprint}</p>
        ) : null}
        {!removing ? (
          <>
            <label htmlFor={`${fieldId}-key`} className="flex flex-col gap-2 text-sm">
              Verified host public key
              <Textarea
                id={`${fieldId}-key`}
                value={hostKey}
                disabled={!writable || busy}
                autoCapitalize="none"
                autoComplete="off"
                maxLength={4096}
                placeholder="ssh-ed25519 AAAA…"
                onChange={(event) => {
                  setHostKey(event.target.value);
                  setConfirmed(false);
                  setOperationId(newId());
                  setError(null);
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Compare the fingerprint with the intended host through a trusted channel. A key scan
              alone does not establish trust.
            </p>
            {candidate ? (
              <p className="break-all text-xs">Proposed: {candidate.fingerprint}</p>
            ) : hostKey ? (
              <LoomSettingsNotice role="alert">
                Enter a valid Ed25519 SSH public key.
              </LoomSettingsNotice>
            ) : null}
          </>
        ) : (
          <p className="text-sm">
            Remove trust for this destination? New SSH operations will be blocked. The dedicated key
            and its remote registration remain.
          </p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={confirmed}
            disabled={!writable || busy || (!removing && !candidate)}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
          />
          <span>
            {removing
              ? "I want to remove this host's trust."
              : "I verified the proposed fingerprint on the intended host."}
          </span>
        </label>
        <LoomSettingsActions>
          <Button
            size="sm"
            variant={removing ? "destructive" : "default"}
            disabled={!writable || busy || !confirmed || (!removing && !candidate)}
            onClick={() => void changeTrust()}
          >
            {action === "trust"
              ? "Saving…"
              : removing
                ? "Confirm trust removal"
                : "Save verified host key"}
          </Button>
          {info.target.hostKey ? (
            <Button
              size="sm"
              variant={removing ? "outline" : "destructive-outline"}
              disabled={!writable || busy}
              onClick={() => {
                setRemoving(!removing);
                setConfirmed(false);
                setError(null);
                setOperationId(newId());
              }}
            >
              {removing ? "Keep host trust" : "Remove host trust"}
            </Button>
          ) : null}
        </LoomSettingsActions>
        {!canTrust ? (
          <p className="text-sm text-muted-foreground">
            Vault write access is required to change host trust.
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm font-medium">Connection test</p>
        <p className="text-sm text-muted-foreground">
          Run a fixed, harmless command from the Loom server as {info.target.username}. This checks
          this key and pinned host; provider and Git setup are separate.
        </p>
        <LoomSettingsActions>
          <Button
            size="sm"
            disabled={
              !canProbe ||
              busy ||
              info.item.state !== "active" ||
              !info.target.hostKey ||
              result.waiting ||
              !!failure(result)
            }
            onClick={() => void test()}
          >
            {action === "probe" ? "Testing SSH…" : "Test SSH connection"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
            Refresh key
          </Button>
        </LoomSettingsActions>
      </div>
      <div ref={feedback} tabIndex={-1} className="space-y-3">
        {notice ? <LoomSettingsNotice role="status">{notice}</LoomSettingsNotice> : null}
        {probe && probe.version === info.item.version ? (
          <LoomSettingsNotice role="status">
            SSH connection succeeded at {new Date(probe.checkedAt).toLocaleTimeString()} using
            version {probe.version}.
          </LoomSettingsNotice>
        ) : null}
        {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      </div>
    </>
  );
}
