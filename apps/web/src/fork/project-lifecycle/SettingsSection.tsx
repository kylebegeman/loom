import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ProjectLifecycleSettings,
  type LaneFreeScope,
  type LaneLease,
  type ProjectLifecycleLane,
  type ProjectLifecycleStatus,
  type UnrecordedLane,
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
import {
  LoomSettingsActions,
  LoomSettingsContent,
  LoomSettingsField,
  LoomSettingsDetails,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import { ensureLocalApi } from "~/localApi";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { FEATURE, formatGb, lanes, runLaneCommand } from "./state";

const validateSettings = Schema.decodeSync(ProjectLifecycleSettings);
const isValidSettings = Schema.is(ProjectLifecycleSettings);

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
    }
    setBusy(false);
  };
  return { busy, message, act, clearMessage: () => setMessage(null) };
}

function ActionMessage({ message }: { message: { text: string; failed: boolean } | null }) {
  return message ? (
    <LoomSettingsNotice role={message.failed ? "alert" : "status"}>
      {message.text}
    </LoomSettingsNotice>
  ) : null;
}

function GbInput({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  onChange: (value: string) => void;
}) {
  const number = Number(value);
  const invalid = value.trim() === "" || !Number.isInteger(number) || number < min || number > 4000;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Input
        aria-label={label}
        type="number"
        size="sm"
        min={min}
        max={4000}
        value={value}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid && (
        <p role="alert" className="text-sm text-destructive-foreground">
          Enter a whole number from {min} to 4000 GB.
        </p>
      )}
    </div>
  );
}

function SettingsForm({
  environmentId,
  initial,
  hasLanes,
  autoSlots,
  saveAction,
}: {
  environmentId: EnvironmentId;
  initial: ProjectLifecycleSettings;
  hasLanes: boolean;
  autoSlots: number | null;
  saveAction: ReturnType<typeof useAction>;
}) {
  const [settings, setSettings] = useState(initial);
  const initialNumbers = {
    defaultCapGb: String(initial.defaultCapGb),
    appleCapGb: String(initial.appleCapGb),
    reserveGb: String(initial.reserveGb),
    buildSlots: initial.buildSlots === null ? "" : String(initial.buildSlots),
  };
  const [numbers, setNumbers] = useState(initialNumbers);
  const { busy, message, act, clearMessage } = saveAction;
  const canSave = useAtomValue(lanes.updateSettings.permissionAtom(environmentId));
  const draft = {
    ...settings,
    defaultCapGb: Number(numbers.defaultCapGb),
    appleCapGb: Number(numbers.appleCapGb),
    reserveGb: Number(numbers.reserveGb),
    buildSlots: numbers.buildSlots.trim() === "" ? null : Number(numbers.buildSlots),
  };
  const valid =
    numbers.defaultCapGb.trim() !== "" &&
    numbers.appleCapGb.trim() !== "" &&
    numbers.reserveGb.trim() !== "" &&
    isValidSettings(draft);
  const dirty = !valid || JSON.stringify(draft) !== JSON.stringify(initial);
  const set = <K extends keyof ProjectLifecycleSettings>(
    key: K,
    value: ProjectLifecycleSettings[K],
  ) => {
    clearMessage();
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const setNumber = (key: keyof typeof numbers, value: string) => {
    clearMessage();
    setNumbers((current) => ({ ...current, [key]: value }));
  };
  const save = () =>
    act(async () => {
      await runLaneCommand(lanes.updateSettings, { environmentId, input: validateSettings(draft) });
      appAtomRegistry.refresh(lanes.settings({ environmentId, input: {} }));
    }, "Settings saved.");
  return (
    <LoomSettingsContent className="flex flex-col gap-5">
      <fieldset disabled={busy || !canSave} className="flex min-w-0 flex-col gap-5">
        <LoomSettingsPanel
          title="Workspace lanes"
          description="Give each checkout its own space for temporary files and build output."
        >
          <SettingsRow
            className="px-0 sm:px-0"
            title="Give each checkout a lane"
            description="Lanes are removed when their threads settle or are archived."
            control={
              <Switch
                aria-label="Give each checkout a lane"
                checked={settings.enabled}
                onCheckedChange={(checked) => set("enabled", checked)}
              />
            }
          />
          <LoomSettingsField
            label="Lanes folder"
            description={
              hasLanes
                ? "Discard every lane before moving this folder."
                : "An absolute path on this environment. Created when needed."
            }
          >
            <Input
              aria-label="Lanes folder"
              value={settings.lanesRoot}
              disabled={hasLanes}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => set("lanesRoot", event.target.value)}
            />
          </LoomSettingsField>
        </LoomSettingsPanel>
        <LoomSettingsPanel
          title="Storage limits"
          description="Capacity is measured in GB. Lane caps apply to new lanes."
        >
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <LoomSettingsField
              label="Default lane cap"
              description="1 to 4000 GB for each new lane."
            >
              <GbInput
                label="Lane cap"
                min={1}
                value={numbers.defaultCapGb}
                onChange={(value) => setNumber("defaultCapGb", value)}
              />
            </LoomSettingsField>
            <LoomSettingsField
              label="Xcode lane cap"
              description="1 to 4000 GB, including DerivedData and packages."
            >
              <GbInput
                label="Xcode project lane cap"
                min={1}
                value={numbers.appleCapGb}
                onChange={(value) => setNumber("appleCapGb", value)}
              />
            </LoomSettingsField>
            <LoomSettingsField
              label="Disk space to keep free"
              description="0 to 4000 GB. Below this reserve, lanes stop growing and agents are asked to free space."
            >
              <GbInput
                label="Keep free on this disk"
                min={0}
                value={numbers.reserveGb}
                onChange={(value) => setNumber("reserveGb", value)}
              />
            </LoomSettingsField>
          </div>
        </LoomSettingsPanel>
        <LoomSettingsPanel
          title="Build concurrency"
          description="Limit heavy builds on this environment. Other builds wait their turn."
        >
          <LoomSettingsField
            label="Build slots"
            description={`Leave blank for automatic${autoSlots === null ? "." : ` (${autoSlots} slots on this machine).`} Otherwise enter 1 to 64.`}
          >
            <div className="w-full sm:max-w-48">
              <Input
                aria-label="Build slots"
                type="number"
                size="sm"
                min={1}
                max={64}
                placeholder="Automatic"
                value={numbers.buildSlots}
                onChange={(event) => setNumber("buildSlots", event.target.value)}
              />
            </div>
          </LoomSettingsField>
        </LoomSettingsPanel>
      </fieldset>
      <LoomSettingsNotice role={busy ? "status" : undefined}>
        {busy
          ? "Saving settings..."
          : dirty
            ? "You have unsaved changes."
            : "Settings are up to date."}
      </LoomSettingsNotice>
      {dirty && !valid && (
        <LoomSettingsNotice role="alert">
          Check the storage limits, build slots and folder before saving.
        </LoomSettingsNotice>
      )}
      <LoomSettingsActions>
        <Button
          disabled={busy || !canSave || !dirty || !valid}
          title={canSave ? undefined : "This connection cannot edit storage settings."}
          onClick={() => void save()}
        >
          Save settings
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setSettings(initial);
              setNumbers(initialNumbers);
              clearMessage();
            }}
          >
            Discard changes
          </Button>
        )}
      </LoomSettingsActions>
      <ActionMessage message={message} />
    </LoomSettingsContent>
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
        description={
          <span className="wrap-anywhere">
            Routes TMPDIR and Xcode build output into the lane when a shell is inside a checkout.
            Edits {shell.profilePath}.
          </span>
        }
        status={shell.installed ? "Installed for new shells" : "Not installed"}
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
        <LoomSettingsContent className="flex flex-col gap-3">
          <ActionMessage message={message} />
        </LoomSettingsContent>
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
    <ul className="flex min-w-0 flex-col gap-2 text-sm">
      {lane.leases.map((lease) => (
        <li
          key={`${lease.kind}:${lease.ref}`}
          className="flex min-w-0 flex-wrap items-start justify-between gap-2"
        >
          <span className="min-w-0 break-all">
            {LEASE_KIND[lease.kind].name}: {lease.label}
            {lease.label === lease.ref ? null : (
              <span className="text-muted-foreground"> ({lease.ref})</span>
            )}
          </span>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRelease(lease)}>
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
    <li className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-words font-medium">
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
      {lane.checkoutMissing && (
        <LoomSettingsNotice>
          {lane.checkoutMissing.freesAt === null
            ? "Checkout gone. Kept while an agent runs."
            : `Checkout gone, frees at ${new Date(lane.checkoutMissing.freesAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}
        </LoomSettingsNotice>
      )}
      {lane.message && <LoomSettingsNotice>{lane.message}</LoomSettingsNotice>}
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
      <LoomSettingsActions>
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
      </LoomSettingsActions>
      <ActionMessage message={message} />
    </li>
  );
}

function UnrecordedLaneRow({
  environmentId,
  folder,
}: {
  environmentId: EnvironmentId;
  folder: UnrecordedLane;
}) {
  const { busy, message, act } = useAction();
  const canEdit = useAtomValue(lanes.discardUnrecorded.permissionAtom(environmentId));
  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 break-all text-sm">
          {folder.project} / {folder.name}
          <span className="block text-xs text-muted-foreground">{folder.path}</span>
        </span>
        <Button
          size="sm"
          variant="destructive-outline"
          disabled={busy || !canEdit}
          onClick={async () => {
            const confirmed = await ensureLocalApi().dialogs.confirm(
              `Discard ${folder.path}? Loom has no record of this lane. Its disk image is detached and the folder is deleted. Registered checkouts inside it are never removed.`,
            );
            if (!confirmed) return;
            await act(
              () =>
                runLaneCommand(lanes.discardUnrecorded, {
                  environmentId,
                  input: { path: folder.path },
                }),
              "Folder discarded.",
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
    <div className="flex min-w-0 flex-col gap-2 text-sm">
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
    <div className="flex min-w-0 flex-col">
      <LoomSettingsContent className="flex flex-col gap-3">
        <p className="break-words text-sm leading-relaxed text-muted-foreground">
          {status.hostFreeBytes === null
            ? "Free space unknown."
            : `${formatGb(status.hostFreeBytes)} free of ${formatGb(status.hostTotalBytes)}.`}{" "}
          {status.backend === "image"
            ? "Lanes are capped disk images."
            : "Lanes are folders with a soft cap."}{" "}
        </p>
        <p className="text-sm text-muted-foreground wrap-anywhere">{status.lanesRoot}</p>
        {status.belowReserve && (
          <LoomSettingsNotice role="alert">
            Free space is below the {formatGb(status.reserveBytes)} reserve.
          </LoomSettingsNotice>
        )}
      </LoomSettingsContent>
      <LoomSettingsContent>
        <LoomSettingsDetails title="Terminal integration">
          <ShellRow environmentId={environmentId} shell={status.shell} />
        </LoomSettingsDetails>
      </LoomSettingsContent>
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsDetails title="Current build activity">
          <BuildSlots status={status} />
        </LoomSettingsDetails>
        <LoomSettingsPanel title="Current lanes">
          {status.lanes.length === 0 ? (
            <LoomSettingsNotice>
              No lanes yet. A lane is created when an agent starts working in a checkout.
            </LoomSettingsNotice>
          ) : (
            <ul className="flex min-w-0 flex-col divide-y divide-border">
              {status.lanes.map((lane) => (
                <LaneRow key={lane.id} environmentId={environmentId} lane={lane} />
              ))}
            </ul>
          )}
        </LoomSettingsPanel>
        {status.unrecordedLanes.length > 0 && (
          <LoomSettingsPanel
            title="Unrecorded lanes"
            description="Folders in the lanes folder that Loom has no record of. They stay until you discard them."
          >
            <ul className="flex min-w-0 flex-col divide-y divide-border">
              {status.unrecordedLanes.map((folder) => (
                <UnrecordedLaneRow
                  key={folder.path}
                  environmentId={environmentId}
                  folder={folder}
                />
              ))}
            </ul>
          </LoomSettingsPanel>
        )}
      </LoomSettingsContent>
    </div>
  );
}

function EnvironmentStorage({ environmentId }: { environmentId: EnvironmentId }) {
  const saveAction = useAction();
  const settingsResult = useAtomValue(lanes.settings({ environmentId, input: {} }));
  const statusResult = useAtomValue(lanes.status({ environmentId, input: {} }));
  if (settingsResult._tag === "Failure")
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice role="alert">
          {String(Cause.squash(settingsResult.cause))}
        </LoomSettingsNotice>
        <LoomSettingsActions>
          <Button
            variant="outline"
            onClick={() => appAtomRegistry.refresh(lanes.settings({ environmentId, input: {} }))}
          >
            Try again
          </Button>
        </LoomSettingsActions>
      </LoomSettingsContent>
    );
  const settings = Option.getOrNull(AsyncResult.value(settingsResult));
  const status = Option.getOrNull(AsyncResult.value(statusResult));
  if (!settings)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice role="status">Loading storage settings...</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  return (
    <div className="flex min-w-0 flex-col">
      <SettingsForm
        key={JSON.stringify(settings)}
        environmentId={environmentId}
        initial={settings}
        saveAction={saveAction}
        hasLanes={(status?.lanes.length ?? 0) > 0}
        autoSlots={settings.buildSlots === null ? (status?.buildSlots.count ?? null) : null}
      />
      {statusResult._tag === "Failure" && (
        <LoomSettingsContent className="flex flex-col gap-3">
          <LoomSettingsNotice role="alert">
            {String(Cause.squash(statusResult.cause))}
          </LoomSettingsNotice>
          <LoomSettingsActions>
            <Button
              variant="outline"
              onClick={() => appAtomRegistry.refresh(lanes.status({ environmentId, input: {} }))}
            >
              Retry storage status
            </Button>
          </LoomSettingsActions>
        </LoomSettingsContent>
      )}
      {status && <StatusView environmentId={environmentId} status={status} />}
    </div>
  );
}

export function ProjectLifecycleSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment)
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>Select a connected environment to manage storage.</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      FEATURE,
    )
  )
    return (
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>This environment does not support lanes.</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  return (
    <EnvironmentStorage key={environment.environmentId} environmentId={environment.environmentId} />
  );
}
