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
    return <LoomSettingsNotice>Vault brokers are unavailable on this server.</LoomSettingsNotice>;
  if (!canRead)
    return (
      <LoomSettingsNotice>Your connection does not include broker inspection.</LoomSettingsNotice>
    );
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
    }
    setBusy(false);
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
    }
    setBusy(false);
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
    <div className="flex min-w-0 flex-col gap-5">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Enroll the machines you trust to run a Vault broker. Enrollment verifies machine identity;
        credential delivery and SSH signing still need supported channels and workload grants.
      </p>
      <LoomSettingsActions>
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
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
          Refresh brokers
        </Button>
      </LoomSettingsActions>
      {error || result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          {error ?? (result._tag === "Failure" ? message(Cause.squash(result.cause)) : "")}
        </LoomSettingsNotice>
      ) : null}
      {!snapshot ? (
        <LoomSettingsNotice role="status">
          {result._tag === "Failure"
            ? "Broker inspection is unavailable. Refresh to try again."
            : "Loading brokers…"}
        </LoomSettingsNotice>
      ) : (
        <>
          {snapshot.enrollments.length > 0 ? (
            <LoomSettingsPanel
              title="Enrollment invitations"
              description="Claim the invitation on the intended host, then compare its fingerprint before approving."
            >
              <ul className="divide-y divide-border">
                {snapshot.enrollments.map((enrollment) => (
                  <li
                    key={enrollment.id}
                    className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="space-y-1">
                      <h4 className="wrap-anywhere text-sm font-medium">{enrollment.label}</h4>
                      <p className="text-sm leading-relaxed">
                        {enrollment.state === "awaiting-approval"
                          ? "Proof received. Compare fingerprints before approving."
                          : "Waiting for the broker to claim its invitation."}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Expires {new Date(enrollment.expiresAt).toLocaleString()}.
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs text-muted-foreground">Broker fingerprint</p>
                      <p className="wrap-anywhere font-mono text-xs leading-relaxed">
                        {enrollment.fingerprint}
                      </p>
                    </div>
                    <LoomSettingsActions>
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
                    </LoomSettingsActions>
                  </li>
                ))}
              </ul>
            </LoomSettingsPanel>
          ) : null}
          <LoomSettingsPanel
            title="Enrolled machines"
            description="Brokers run as foreground services. Enrollment does not install a boot service."
          >
            {snapshot.machines.length === 0 ? (
              <LoomSettingsNotice>
                No enrolled brokers. Generate a broker identity on the host, then create an
                invitation here.
              </LoomSettingsNotice>
            ) : (
              <ul className="divide-y divide-border">
                {snapshot.machines.map((machine) => (
                  <li
                    key={machine.id}
                    className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <h4 className="wrap-anywhere text-sm font-medium">{machine.label}</h4>
                        <p className="text-sm text-muted-foreground">
                          {machine.platform === "darwin" ? "macOS" : "Linux"}
                        </p>
                      </div>
                      <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                        {vaultBrokerState(machine, now)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {machine.lastSeenAt === null
                        ? "No heartbeat yet"
                        : `Last seen ${new Date(machine.lastSeenAt).toLocaleString()}`}
                    </p>
                    {machine.state === "active" ? (
                      <LoomSettingsActions>
                        <Button
                          size="sm"
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
                      </LoomSettingsActions>
                    ) : (
                      <LoomSettingsNotice>
                        Enroll a new identity to restore this machine. Previously copied credentials
                        are outside this control.
                      </LoomSettingsNotice>
                    )}
                    <LoomSettingsDetails title="Machine fingerprint">
                      <p className="wrap-anywhere font-mono text-xs leading-relaxed">
                        {machine.fingerprint}
                      </p>
                    </LoomSettingsDetails>
                  </li>
                ))}
              </ul>
            )}
          </LoomSettingsPanel>
          <LoomSettingsDetails title="Recent broker activity">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Registry revision {snapshot.revision}. Heartbeats renew online every minute and lapse
              after two minutes. A heartbeat does not prove credential use or successful SSH access.
            </p>
            {snapshot.events.length ? (
              <ul className="divide-y divide-border">
                {snapshot.events.map((event) => (
                  <li key={event.id} className="space-y-1 py-2 text-xs">
                    <p>
                      {new Date(event.at).toLocaleString()} · {event.kind}
                    </p>
                    <p className="wrap-anywhere text-muted-foreground">{event.machineId}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No recent broker activity.</p>
            )}
            <p className="text-xs text-muted-foreground">
              {snapshot.omittedEvents} older events omitted.
            </p>
          </LoomSettingsDetails>
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
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <LoomSettingsField label="Broker name">
                <Input
                  aria-label="Broker name"
                  autoFocus
                  value={label}
                  maxLength={120}
                  disabled={busy}
                  onChange={(event) => {
                    setLabel(event.target.value);
                    changed();
                  }}
                />
              </LoomSettingsField>
              <LoomSettingsField label="Platform">
                <Select
                  value={platform}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (!value) return;
                    setPlatform(value === "darwin" ? "darwin" : "linux");
                    changed();
                  }}
                >
                  <SelectTrigger aria-label="Broker platform">
                    <SelectValue>{platform === "darwin" ? "macOS" : "Linux"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="linux">Linux</SelectItem>
                    <SelectItem value="darwin">macOS</SelectItem>
                  </SelectPopup>
                </Select>
              </LoomSettingsField>
            </div>
            <LoomSettingsField
              label="Broker public key"
              description="Paste the public key printed by Loom's broker identity command."
            >
              <Textarea
                aria-label="Broker public key"
                value={publicKey}
                disabled={busy}
                autoComplete="off"
                onChange={(event) => {
                  setPublicKey(event.target.value);
                  changed();
                }}
              />
            </LoomSettingsField>
            {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
            <LoomSettingsActions>
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
            </LoomSettingsActions>
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
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">Broker fingerprint</p>
              <p className="wrap-anywhere font-mono text-xs leading-relaxed">
                {invitation?.fingerprint}
              </p>
            </div>
            <p className="text-sm">
              Expires {invitation ? new Date(invitation.expiresAt).toLocaleString() : ""}.
            </p>
            <LoomSettingsActions>
              <Button onClick={download}>Download invitation</Button>
              <Button variant="outline" onClick={() => setInvitation(null)}>
                Done
              </Button>
            </LoomSettingsActions>
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
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">Broker fingerprint</p>
              <p className="wrap-anywhere font-mono text-xs leading-relaxed">
                {review?.fingerprint}
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={confirmed} disabled={busy} onCheckedChange={setConfirmed} />
              {review?.input.change.type === "approve"
                ? "I compared this fingerprint with the intended broker."
                : "I reviewed this change and its recovery requirements."}
            </label>
            {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
            <LoomSettingsActions>
              <Button variant="outline" disabled={busy} onClick={() => setReview(null)}>
                Abandon review
              </Button>
              <Button disabled={!canApply || !confirmed || busy} onClick={() => void apply()}>
                {busy ? "Applying…" : "Apply reviewed change"}
              </Button>
            </LoomSettingsActions>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
