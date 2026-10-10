import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ProjectLifecycleSettings,
  type LaneFreeScope,
  type LaneLease,
  type ProjectLifecycleLane,
  type ProjectLifecycleStatus,
} from "@t3tools/contracts/fork";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { SettingsRow } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { ensureLocalApi } from "~/localApi";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { FEATURE, formatGb, lanes, runLaneCommand } from "./state";

const validateSettings = Schema.decodeSync(ProjectLifecycleSettings);

/** Tracks one action at a time and reports its result under the form. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const act = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage({ text: success, failed: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), failed: true });
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, act };
}

function ActionMessage({ message }: { message: { text: string; failed: boolean } | null }) {
  return message ? (
    <p role={message.failed ? "alert" : "status"} className="text-sm">
      {message.text}
    </p>
  ) : null;
}

function GbInput({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      aria-label={label}
      type="number"
      size="sm"
      className="w-full sm:w-24"
      min={min}
      max={4000}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function SettingsForm({
  environmentId,
  initial,
  hasLanes,
  autoSlots,
}: {
  environmentId: EnvironmentId;
  initial: ProjectLifecycleSettings;
  hasLanes: boolean;
  /** Shown while the setting is automatic; null until the status arrives. */
  autoSlots: number | null;
}) {
  const [settings, setSettings] = useState(initial);
  const { busy, message, act } = useAction();
  const canSave = useAtomValue(lanes.updateSettings.permissionAtom(environmentId));
  const set = <K extends keyof ProjectLifecycleSettings>(
    key: K,
    value: ProjectLifecycleSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));
  const save = () =>
    act(async () => {
      await runLaneCommand(lanes.updateSettings, {
        environmentId,
        input: validateSettings(settings),
      });
      appAtomRegistry.refresh(lanes.settings({ environmentId, input: {} }));
    }, "Settings saved.");
  return (
    <div className="flex flex-col gap-3">
      <SettingsRow
        title="Give each checkout a lane"
        description="Agents get a capped space for temporary files and build output. Lanes are removed when their threads settle or are archived."
        control={
          <Switch
            aria-label="Give each checkout a lane"
            checked={settings.enabled}
            onCheckedChange={(checked) => set("enabled", checked)}
          />
        }
      />
      <SettingsRow
        title="Lanes folder"
        description={
          hasLanes ? "Discard every lane before moving the folder." : "Created when needed."
        }
      >
        <div className="flex flex-col gap-2 pb-2">
          <Input
            aria-label="Lanes folder"
            value={settings.lanesRoot}
            disabled={hasLanes}
            onChange={(event) => set("lanesRoot", event.target.value)}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        title="Lane cap (GB)"
        description="Applies to new lanes."
        control={
          <GbInput
            label="Lane cap"
            min={1}
            value={settings.defaultCapGb}
            onChange={(value) => set("defaultCapGb", value)}
          />
        }
      />
      <SettingsRow
        title="Xcode project lane cap (GB)"
        description="Xcode builds keep DerivedData and packages in the lane."
        control={
          <GbInput
            label="Xcode project lane cap"
            min={1}
            value={settings.appleCapGb}
            onChange={(value) => set("appleCapGb", value)}
          />
        }
      />
      <SettingsRow
        title="Keep free on this disk (GB)"
        description="Below this, running agents are asked to free space and lanes stop growing."
        control={
          <GbInput
            label="Keep free on this disk"
            min={0}
            value={settings.reserveGb}
            onChange={(value) => set("reserveGb", value)}
          />
        }
      />
      <SettingsRow
        title="Build slots"
        description="Heavy builds this machine runs at once; others wait their turn. Leave blank for automatic."
        control={
          <Input
            aria-label="Build slots"
            type="number"
            size="sm"
            className="w-full sm:w-36"
            min={1}
            max={64}
            placeholder={autoSlots === null ? "Automatic" : `Automatic (${autoSlots})`}
            value={settings.buildSlots ?? ""}
            onChange={(event) =>
              set("buildSlots", event.target.value === "" ? null : Number(event.target.value))
            }
          />
        }
      />
      <div className="flex flex-col gap-3 px-3 pb-3 sm:px-4">
        <div>
          <Button
            disabled={busy || !canSave}
            title={canSave ? undefined : "This connection cannot edit storage settings."}
            onClick={() => void save()}
          >
            Save settings
          </Button>
        </div>
        <ActionMessage message={message} />
      </div>
    </div>
  );
}

function ShellRow({
  environmentId,
  shell,
}: {
  environmentId: EnvironmentId;
  shell: ProjectLifecycleStatus["shell"];
}) {
  const { busy, message, act } = useAction();
  const canEdit = useAtomValue(lanes.installShell.permissionAtom(environmentId));
  return (
    <div className="flex flex-col gap-2">
      <SettingsRow
        title="Terminal integration"
        description={`Routes TMPDIR and Xcode build output into the lane when a shell is inside a checkout. Edits ${shell.profilePath}.`}
        control={
          <Button
            variant="outline"
            disabled={busy || !canEdit}
            onClick={() =>
              void act(
                () =>
                  runLaneCommand(shell.installed ? lanes.removeShell : lanes.installShell, {
                    environmentId,
                    input: {},
                  }),
                shell.installed
                  ? "Removed. New shells no longer use lanes."
                  : "Installed. New shells use lanes.",
              )
            }
          >
            {shell.installed ? "Remove" : "Install"}
          </Button>
        }
      />
      {message && (
        <div className="px-3 sm:px-4">
          <ActionMessage message={message} />
        </div>
      )}
    </div>
  );
}

const LEASE_KIND: Record<LaneLease["kind"], { name: string; release: string }> = {
  process: { name: "Process", release: "It and the processes it started are stopped." },
  simulator: { name: "Simulator", release: "The simulator is shut down and deleted." },
  container: { name: "Container", release: "The container is removed." },
  volume: { name: "Volume", release: "The volume and its data are deleted." },
};

function LeaseList({
  lane,
  disabled,
  onRelease,
}: {
  lane: ProjectLifecycleLane;
  disabled: boolean;
  onRelease: (lease: LaneLease) => void;
}) {
  if (lane.leases.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {lane.leases.map((lease) => (
        <li key={`${lease.kind}:${lease.ref}`} className="flex items-center justify-between gap-2">
          <span className="min-w-0 break-all">
            {LEASE_KIND[lease.kind].name}: {lease.label}
            {lease.label === lease.ref ? null : (
              <span className="text-muted-foreground"> ({lease.ref})</span>
            )}
          </span>
          <Button size="xs" variant="outline" disabled={disabled} onClick={() => onRelease(lease)}>
            Release
          </Button>
        </li>
      ))}
    </ul>
  );
}

function LaneRow({
  environmentId,
  lane,
}: {
  environmentId: EnvironmentId;
  lane: ProjectLifecycleLane;
}) {
  const { busy, message, act } = useAction();
  const canEdit = useAtomValue(lanes.free.permissionAtom(environmentId));
  const used = lane.usedBytes === null ? null : lane.usedBytes / lane.capBytes;
  const free = (scope: LaneFreeScope, label: string) => (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || !canEdit || lane.state !== "ready"}
      onClick={() =>
        void act(
          () => runLaneCommand(lanes.free, { environmentId, input: { laneId: lane.id, scope } }),
          `${label} cleared.`,
        )
      }
    >
      Free {label}
    </Button>
  );
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {lane.projectName} / {lane.name}
        </span>
        <span className="text-sm text-muted-foreground">
          {formatGb(lane.usedBytes)} of {formatGb(lane.capBytes)}
          {used !== null && ` (${Math.round(used * 100)}%)`}
          {lane.state !== "ready" && `, ${lane.state}`}
          {lane.running && ", agent running"}
        </span>
      </div>
      <p className="break-all text-xs text-muted-foreground">
        {lane.checkoutPath}
        {lane.ports && `. Ports ${lane.ports.first} to ${lane.ports.last}.`}
      </p>
      {lane.message && <p className="text-xs text-muted-foreground">{lane.message}</p>}
      <LeaseList
        lane={lane}
        disabled={busy || !canEdit}
        onRelease={async (lease) => {
          const confirmed = await ensureLocalApi().dialogs.confirm(
            `Release ${LEASE_KIND[lease.kind].name.toLowerCase()} ${lease.label}? ${LEASE_KIND[lease.kind].release}`,
          );
          if (!confirmed) return;
          await act(
            () =>
              runLaneCommand(lanes.releaseLease, {
                environmentId,
                input: { laneId: lane.id, kind: lease.kind, ref: lease.ref },
              }),
            "Released.",
          );
        }}
      />
      <div className="flex flex-wrap gap-2">
        {free("tmp", "tmp")}
        {free("build", "build")}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canEdit}
          onClick={() =>
            void act(
              () => runLaneCommand(lanes.grow, { environmentId, input: { laneId: lane.id } }),
              "Lane grown.",
            )
          }
        >
          Grow
        </Button>
        {lane.state !== "ready" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canEdit}
            onClick={() =>
              void act(
                () => runLaneCommand(lanes.mount, { environmentId, input: { laneId: lane.id } }),
                "Lane mounted.",
              )
            }
          >
            Mount
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive-outline"
          disabled={busy || !canEdit}
          onClick={async () => {
            const confirmed = await ensureLocalApi().dialogs.confirm(
              `Discard the ${lane.name} lane for ${lane.projectName}? Its tmp, build and data folders are deleted, its processes are stopped, and its simulators, containers and volumes are deleted. The checkout is not touched.`,
            );
            if (!confirmed) return;
            await act(
              () => runLaneCommand(lanes.discard, { environmentId, input: { laneId: lane.id } }),
              "Lane discarded.",
            );
          }}
        >
          Discard
        </Button>
      </div>
      <ActionMessage message={message} />
    </li>
  );
}

function BuildSlots({ status }: { status: ProjectLifecycleStatus }) {
  const { count, holders } = status.buildSlots;
  const laneName = (laneId: string | null) => {
    const lane = status.lanes.find((candidate) => candidate.id === laneId);
    return lane ? `${lane.projectName} / ${lane.name}` : "Outside lanes";
  };
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-muted-foreground">
        {holders.length} of {count} build {count === 1 ? "slot" : "slots"} in use.
      </p>
      {holders.length > 0 && (
        <ul className="flex flex-col gap-1">
          {holders.map((holder) => (
            <li key={holder.slot} className="break-all">
              {laneName(holder.laneId)}:{" "}
              <span className="text-muted-foreground">{holder.command}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusView({
  environmentId,
  status,
}: {
  environmentId: EnvironmentId;
  status: ProjectLifecycleStatus;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 px-3 sm:px-4">
        <p className="text-sm text-muted-foreground">
          {status.hostFreeBytes === null
            ? "Free space unknown."
            : `${formatGb(status.hostFreeBytes)} free of ${formatGb(status.hostTotalBytes)}.`}{" "}
          {status.backend === "image"
            ? "Lanes are capped disk images."
            : "Lanes are folders with a soft cap."}{" "}
          {status.lanesRoot}
        </p>
        {status.belowReserve && (
          <p role="alert" className="text-sm">
            Free space is below the {formatGb(status.reserveBytes)} reserve.
          </p>
        )}
      </div>
      <ShellRow environmentId={environmentId} shell={status.shell} />
      <div className="flex flex-col gap-3 px-3 pb-3 sm:px-4">
        <BuildSlots status={status} />
        {status.lanes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lanes yet. A lane is created when an agent starts working in a checkout.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {status.lanes.map((lane) => (
              <LaneRow key={lane.id} environmentId={environmentId} lane={lane} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EnvironmentStorage({ environmentId }: { environmentId: EnvironmentId }) {
  const settingsResult = useAtomValue(lanes.settings({ environmentId, input: {} }));
  const statusResult = useAtomValue(lanes.status({ environmentId, input: {} }));
  if (settingsResult._tag === "Failure")
    return <p role="alert">{String(Cause.squash(settingsResult.cause))}</p>;
  const settings = Option.getOrNull(AsyncResult.value(settingsResult));
  const status = Option.getOrNull(AsyncResult.value(statusResult));
  if (!settings) return <p>Loading storage settings...</p>;
  return (
    <div className="flex flex-col gap-6">
      <SettingsForm
        key={JSON.stringify(settings)}
        environmentId={environmentId}
        initial={settings}
        hasLanes={(status?.lanes.length ?? 0) > 0}
        autoSlots={settings.buildSlots === null ? (status?.buildSlots.count ?? null) : null}
      />
      {status && <StatusView environmentId={environmentId} status={status} />}
    </div>
  );
}

export function ProjectLifecycleSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment) return <p>Select a connected environment to manage storage.</p>;
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      FEATURE,
    )
  )
    return <p>This environment does not support lanes.</p>;
  return (
    <EnvironmentStorage key={environment.environmentId} environmentId={environment.environmentId} />
  );
}
