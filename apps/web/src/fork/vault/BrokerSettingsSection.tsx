import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import {
  VaultBrokerPublicKey,
  type VaultBrokerInvitation,
  type VaultBrokerMutation,
  type VaultBrokerPlatform,
  type VaultBrokerBegin,
} from "@t3tools/contracts/fork";
import {
  createVaultBrokerAtoms,
  supportsLoomFeature,
  vaultBrokerState,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
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
const brokers = createVaultBrokerAtoms(connectionAtomRuntime);
const newId = () => randomUUID().replaceAll("-", "");
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Broker management failed. Refresh and try again.";
const encodeInvitation = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      protocol: Schema.Literal(1),
      environmentId: Schema.String,
      enrollmentId: Schema.String,
      nonce: Schema.String,
      fingerprint: Schema.String,
      expiresAt: Schema.Number,
    }),
  ),
);
const isBrokerPublicKey = Schema.is(VaultBrokerPublicKey);
export function VaultBrokerSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-brokers",
    )
  )
    return <p className="text-sm">Vault brokers are unavailable on this server.</p>;
  if (!canRead)
    return <p className="text-sm">Your connection does not include broker inspection.</p>;
  return (
    <BrokerManager key={environment.environmentId} environmentId={environment.environmentId} />
  );
}
function BrokerManager({ environmentId }: { environmentId: EnvironmentId }) {
  const atom = brokers.snapshot({ environmentId, input: {} }),
    result = useAtomValue(atom);
  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const canInvite = useAtomValue(brokers.begin.permissionAtom(environmentId)),
    canApply = useAtomValue(brokers.apply.permissionAtom(environmentId));
  const now = useVaultTime(snapshot?.machines.map((machine) => machine.leaseUntil) ?? []);
  const [adding, setAdding] = useState(false),
    [invitation, setInvitation] = useState<VaultBrokerInvitation | null>(null);
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
  const [label, setLabel] = useState(""),
    [publicKey, setPublicKey] = useState(""),
    [platform, setPlatform] = useState<typeof VaultBrokerPlatform.Type>("linux");
  const refresh = () => {
    appAtomRegistry.refresh(atom);
  };
  const begin = async () => {
    if (busy || !snapshot) return;
    if (!isBrokerPublicKey(publicKey.trim()) || !label.trim()) {
      setError("Enter a broker name and the public key printed by Loom's broker identity command.");
      return;
    }
    setBusy(true);
    setError(null);
    const input = pendingBegin ?? {
      operationId: newId(),
      expectedRevision: snapshot.revision,
      publicKey: publicKey.trim(),
      label: label.trim(),
      platform,
    };
    setPendingBegin(input);
    try {
      const value = await runVault(brokers.begin, { environmentId, input });
      setInvitation(value);
      setAdding(false);
      setPendingBegin(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!review || busy) return;
    setBusy(true);
    setError(null);
    try {
      await runVault(brokers.apply, { environmentId, input: review.input });
      setReview(null);
      refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!invitation) return;
    const url = URL.createObjectURL(
      new Blob([encodeInvitation(invitation)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "loom-vault-enrollment.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const inspectChange = (
    change: VaultBrokerMutation["change"],
    name: string,
    fingerprint: string,
    description: string,
  ) => {
    if (!snapshot) return;
    setConfirmed(false);
    setError(null);
    setReview({
      input: { operationId: newId(), expectedRevision: snapshot.revision, change },
      label: name,
      fingerprint,
      description,
    });
  };
  const changed = () => {
    setPendingBegin(null);
    setError(null);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Machines trusted to run a Vault broker</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
            Refresh brokers
          </Button>
          <Button
            size="sm"
            disabled={!canInvite || busy}
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
          >
            Enroll broker
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Enrollment verifies machine identity. Credential delivery and SSH signing still need their
        own supported channels and workload grants. No boot service is installed.
      </p>
      {error || result._tag === "Failure" ? (
        <p role="alert" className="text-sm">
          {error ?? (result._tag === "Failure" ? message(Cause.squash(result.cause)) : "")}
        </p>
      ) : null}
      {!snapshot ? (
        <p role="status" className="text-sm">
          {result._tag === "Failure"
            ? "Broker inspection is unavailable. Refresh to try again."
            : "Loading brokers…"}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Registry revision {snapshot.revision}. Heartbeats renew online every minute and lapse
            after two minutes.
          </p>
          {snapshot.machines.length === 0 ? (
            <p className="text-sm">
              No enrolled brokers. Generate a broker identity, then create an invitation here.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {snapshot.machines.map((machine) => (
                <div key={machine.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{machine.label}</p>
                    <span className="text-sm">{vaultBrokerState(machine, now)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {machine.platform === "darwin" ? "macOS" : "Linux"} · Foreground service ·{" "}
                    {machine.lastSeenAt === null
                      ? "No heartbeat yet"
                      : `Last seen ${new Date(machine.lastSeenAt).toLocaleString()}`}
                  </p>
                  <p className="break-all font-mono text-xs">{machine.fingerprint}</p>
                  {machine.state === "active" ? (
                    <div>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!canApply || busy}
                        onClick={() =>
                          inspectChange(
                            { type: "disable", machineId: machine.id },
                            machine.label,
                            machine.fingerprint,
                            "Disable this identity permanently and reject new heartbeats. Re-enrollment requires a new broker key in a separate identity directory.",
                          )
                        }
                      >
                        Review disable
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Enroll a new identity to restore this machine. Previously copied credentials
                      are outside this control.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {snapshot.enrollments.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Enrollment invitations</p>
              {snapshot.enrollments.map((enrollment) => (
                <div key={enrollment.id} className="flex flex-col gap-2 rounded-lg bg-muted p-4">
                  <p className="text-sm font-medium">{enrollment.label}</p>
                  <p className="text-sm">
                    {enrollment.state === "awaiting-approval"
                      ? "Proof received. Compare fingerprints before approving."
                      : "Waiting for the broker to claim its invitation."}{" "}
                    Expires {new Date(enrollment.expiresAt).toLocaleString()}.
                  </p>
                  <p className="break-all font-mono text-xs">{enrollment.fingerprint}</p>
                  <div className="flex flex-wrap gap-2">
                    {enrollment.state === "awaiting-approval" ? (
                      <Button
                        size="sm"
                        disabled={!canApply || busy}
                        onClick={() =>
                          inspectChange(
                            {
                              type: "approve",
                              enrollmentId: enrollment.id,
                              fingerprint: enrollment.fingerprint,
                            },
                            enrollment.label,
                            enrollment.fingerprint,
                            "Approve this proven machine identity. Compare the full fingerprint with the broker identity output on the intended host. This grants no item access.",
                          )
                        }
                      >
                        Review approval
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canApply || busy}
                      onClick={() =>
                        inspectChange(
                          { type: "cancel", enrollmentId: enrollment.id },
                          enrollment.label,
                          enrollment.fingerprint,
                          "Cancel this invitation. A new invitation is required to continue enrollment.",
                        )
                      }
                    >
                      Review cancellation
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <details>
            <summary className="cursor-pointer text-sm">Recent broker activity</summary>
            <div className="mt-3 flex flex-col gap-2">
              {snapshot.events.map((event) => (
                <p key={event.id} className="text-xs text-muted-foreground">
                  {new Date(event.at).toLocaleString()}: {event.kind} · {event.machineId}
                </p>
              ))}
              <p className="text-xs text-muted-foreground">
                {snapshot.omittedEvents} older events omitted. Heartbeats do not prove credential
                use or successful SSH access.
              </p>
            </div>
          </details>
        </>
      )}
      <Dialog
        open={adding}
        onOpenChange={(open) => {
          if (!busy) setAdding(open);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Enroll a Vault broker</DialogTitle>
            <DialogDescription>
              Run Loom's broker identity command on the host first. Copy its public key here; its
              private key stays in that host's private identity directory.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-6 pb-5"
            onSubmit={(event) => {
              event.preventDefault();
              void begin();
            }}
          >
            <label className="flex flex-col gap-2 text-sm">
              Broker name
              <Input
                autoFocus
                value={label}
                maxLength={120}
                disabled={busy}
                onChange={(event) => {
                  setLabel(event.target.value);
                  changed();
                }}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Broker public key
              <Textarea
                value={publicKey}
                disabled={busy}
                autoComplete="off"
                onChange={(event) => {
                  setPublicKey(event.target.value);
                  changed();
                }}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Platform
              <select
                value={platform}
                disabled={busy}
                className="rounded-md border border-input bg-background p-2"
                onChange={(event) => {
                  setPlatform(event.target.value === "darwin" ? "darwin" : "linux");
                  changed();
                }}
              >
                <option value="linux">Linux</option>
                <option value="darwin">macOS</option>
              </select>
            </label>
            {error ? (
              <p role="alert" className="text-sm">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canInvite || busy}>
                {busy ? "Creating invitation…" : "Create invitation"}
              </Button>
            </div>
          </form>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={invitation !== null}
        onOpenChange={(open) => {
          if (!open) setInvitation(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Claim this invitation</DialogTitle>
            <DialogDescription>
              Download this public challenge and give it to the intended broker. Only its matching
              private key can claim it. Then return here, refresh and review approval.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 pb-5">
            <p className="break-all font-mono text-xs">{invitation?.fingerprint}</p>
            <p className="text-sm">
              Expires {invitation ? new Date(invitation.expiresAt).toLocaleString() : ""}.
            </p>
            <div className="flex gap-2">
              <Button onClick={download}>Download invitation</Button>
              <Button variant="outline" onClick={() => setInvitation(null)}>
                Done
              </Button>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Review {review?.label}</DialogTitle>
            <DialogDescription>{review?.description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 pb-5">
            <p className="break-all font-mono text-xs">{review?.fingerprint}</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {review?.input.change.type === "approve"
                ? "I compared this fingerprint with the intended broker."
                : "I reviewed this change and its recovery requirements."}
            </label>
            {error ? (
              <p role="alert" className="text-sm">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
                Abandon review
              </Button>
              <Button disabled={!canApply || !confirmed || busy} onClick={() => void apply()}>
                {busy ? "Applying…" : "Apply reviewed change"}
              </Button>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
