import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { RefreshCwIcon } from "lucide-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  appleRunKindLabel,
  type AppleContainer,
  type AppleDestination,
  type AppleRunRecord,
  type AppleSchemeInfo,
} from "@t3tools/contracts/fork";
import { Atom, AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Alert, Muted, failureOf, formatDuration, valueOf } from "./parts";
import { destinationKey, runKindFor, type AppleAction, type AppleSelection } from "./selection";
import { apple } from "./state";

interface Option {
  readonly value: string;
  readonly label: string;
  readonly group?: string;
  readonly disabled?: boolean;
  /** Shown under the label; for disabled options, how to fix them. */
  readonly hint?: string;
}

const NONE = "";

function Picker({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<Option>;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const groups = [...new Set(options.map((option) => option.group ?? ""))];
  const item = (option: Option) => (
    <SelectItem key={option.value} value={option.value} disabled={option.disabled ?? false}>
      <span className="flex flex-col">
        <span>{option.label}</span>
        {option.hint && <span className="text-muted-foreground text-xs">{option.hint}</span>}
      </span>
    </SelectItem>
  );
  return (
    <label className="flex min-w-0 flex-col gap-1 text-muted-foreground text-xs">
      {label}
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        items={options.map((option) => ({ value: option.value, label: option.label }))}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectPopup>
          {groups.map((group) =>
            group === "" ? (
              options.filter((option) => !option.group).map(item)
            ) : (
              <SelectGroup key={group}>
                <SelectGroupLabel>{group}</SelectGroupLabel>
                {options.filter((option) => option.group === group).map(item)}
              </SelectGroup>
            ),
          )}
        </SelectPopup>
      </Select>
    </label>
  );
}

const deviceHint = (destination: Extract<AppleDestination, { _tag: "device" }>) =>
  !destination.paired
    ? "Pair it in Xcode, Window > Devices and Simulators"
    : destination.developerModeEnabled === false
      ? "Turn on Developer Mode on the device, Settings > Privacy & Security"
      : undefined;

/** Picker groups: Booted, Simulators by runtime, Devices, This Mac, Generic. */
export function destinationOptions(destinations: ReadonlyArray<AppleDestination>): Option[] {
  const options: Option[] = [];
  for (const destination of destinations)
    if (destination._tag === "simulator" && destination.booted)
      options.push({
        value: destinationKey(destination),
        label: `${destination.name} (${destination.runtime})`,
        group: "Booted",
      });
  for (const destination of destinations)
    if (destination._tag === "simulator" && !destination.booted)
      options.push({
        value: destinationKey(destination),
        label: destination.name,
        group: `Simulators, ${destination.runtime}`,
      });
  for (const destination of destinations)
    if (destination._tag === "device") {
      const hint = deviceHint(destination);
      options.push({
        value: destinationKey(destination),
        label: `${destination.name} (${destination.platform} ${destination.osVersion})`,
        group: "Devices",
        disabled: hint !== undefined,
        ...(hint ? { hint } : destination.connection ? { hint: destination.connection } : {}),
      });
    }
  options.push({ value: "mac", label: "This Mac", group: "This Mac" });
  options.push({ value: "generic:iOS", label: "Any iOS device", group: "Generic" });
  options.push({ value: "generic:iOS Simulator", label: "Any iOS simulator", group: "Generic" });
  return options;
}

export function destinationFromKey(
  key: string,
  destinations: ReadonlyArray<AppleDestination>,
): AppleDestination | undefined {
  if (key === "mac") return { _tag: "mac" };
  if (key === "generic:iOS") return { _tag: "generic", platform: "iOS" };
  if (key === "generic:iOS Simulator") return { _tag: "generic", platform: "iOS Simulator" };
  return destinations.find((destination) => destinationKey(destination) === key);
}

/** The scheme to preselect: the remembered one, the one named after the project, or the first. */
export function defaultScheme(
  info: AppleSchemeInfo,
  container: AppleContainer,
  remembered?: string,
) {
  if (remembered && info.schemes.includes(remembered)) return remembered;
  return info.schemes.find((scheme) => scheme === container.name) ?? info.schemes[0];
}

const ACTIONS: ReadonlyArray<{ action: AppleAction; label: string }> = [
  { action: "build", label: "Build" },
  { action: "test", label: "Test" },
  { action: "run", label: "Build and run" },
  { action: "releaseBuild", label: "Release build" },
  { action: "generate", label: "Generate" },
];

const PHASE_LABEL: Record<AppleRunRecord["phase"], string> = {
  resolving: "Resolving",
  building: "Building",
  testing: "Testing",
  installing: "Installing",
  launching: "Launching",
  summarizing: "Summarizing",
  done: "Finishing",
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ActiveRunLine({
  run,
  cancelling,
  onCancel,
}: {
  run: AppleRunRecord;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const now = useNow(true);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
      <span role="status">
        {appleRunKindLabel(run.kind)}:{" "}
        {run.status === "queued" ? "Waiting for a build slot" : PHASE_LABEL[run.phase]}
        ... {formatDuration(run.startedAt, null, now)}
        {run.startedBy === "agent" && <span className="text-muted-foreground"> (agent)</span>}
      </span>
      <Button size="xs" variant="outline" disabled={cancelling} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

const idleInspect = Atom.make(AsyncResult.initial<AppleSchemeInfo, never>());

export function RunControls({
  environmentId,
  threadId,
  containers,
  selection,
  onSelectionChange,
  busy,
  onAction,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  containers: ReadonlyArray<AppleContainer>;
  selection: AppleSelection;
  onSelectionChange: (next: AppleSelection) => void;
  /** A run is going in this workspace; actions wait for it. */
  busy: boolean;
  onAction: (action: AppleAction) => void;
}) {
  const container =
    containers.find((candidate) => candidate.path === selection.container?.path) ??
    (containers.length === 1 ? containers[0] : undefined);
  const xcode =
    container !== undefined &&
    container.kind !== "package" &&
    (container.kind !== "xcodegen" || container.generatedProjectPath !== undefined);
  const [reload, setReload] = useState(false);
  const inspectAtom = xcode
    ? apple.inspect({
        environmentId,
        input: {
          workspace: { threadId },
          container,
          ...(selection.scheme ? { scheme: selection.scheme } : {}),
          ...(reload ? { refresh: true } : {}),
        },
      })
    : idleInspect;
  const inspectResult = useAtomValue(inspectAtom);
  const info = valueOf(inspectResult);
  const destinationsAtom = apple.destinations({ environmentId, input: {} });
  const destinations = valueOf(useAtomValue(destinationsAtom)) ?? [];
  const set = (patch: Partial<AppleSelection>) => onSelectionChange({ ...selection, ...patch });

  // Fill in what the user has not chosen yet, so the shortcuts can start runs.
  const scheme = info && container ? defaultScheme(info, container, selection.scheme) : undefined;
  const destination =
    (selection.destination &&
      destinationFromKey(destinationKey(selection.destination), destinations)) ??
    destinations.find((candidate) => candidate._tag === "simulator" && candidate.booted) ??
    destinations.find((candidate) => candidate._tag === "simulator");
  useEffect(() => {
    if (!container) return;
    const next: AppleSelection = {
      ...selection,
      container,
      ...(scheme ? { scheme } : {}),
      ...(destination ? { destination } : {}),
    };
    if (JSON.stringify(next) !== JSON.stringify(selection)) onSelectionChange(next);
  }, [container, destination, onSelectionChange, scheme, selection]);

  const inspectFailure = failureOf(inspectResult);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Picker
          label="Project"
          value={container?.path ?? NONE}
          placeholder="Choose a project"
          options={containers.map((candidate) => ({
            value: candidate.path,
            label: candidate.path,
          }))}
          onChange={(path) => {
            const next = containers.find((candidate) => candidate.path === path);
            if (next) onSelectionChange({ container: next });
          }}
        />
        {xcode && (
          <Picker
            label="Scheme"
            value={scheme ?? NONE}
            placeholder={info ? "Choose a scheme" : "Loading..."}
            options={(info?.schemes ?? []).map((name) => ({ value: name, label: name }))}
            onChange={(name) => {
              const { testPlan: _testPlan, ...rest } = selection;
              onSelectionChange({ ...rest, scheme: name });
            }}
          />
        )}
        {xcode && info && info.configurations.length > 0 && (
          <Picker
            label="Configuration"
            value={selection.configuration ?? NONE}
            options={[
              { value: NONE, label: "Scheme default" },
              ...info.configurations.map((name) => ({ value: name, label: name })),
            ]}
            onChange={(name) => {
              const { configuration: _configuration, ...rest } = selection;
              onSelectionChange(name === NONE ? rest : { ...rest, configuration: name });
            }}
          />
        )}
        {xcode && (
          <div className="flex items-end gap-1">
            <div className="min-w-0 flex-1">
              <Picker
                label="Destination"
                value={destination ? destinationKey(destination) : NONE}
                placeholder="Choose a destination"
                options={destinationOptions(destinations)}
                onChange={(key) => {
                  const next = destinationFromKey(key, destinations);
                  if (next) set({ destination: next });
                }}
              />
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Reload destinations"
              onClick={() => appAtomRegistry.refresh(destinationsAtom)}
            >
              <RefreshCwIcon />
            </Button>
          </div>
        )}
        {xcode && info && info.testPlans.length > 0 && (
          <Picker
            label="Test plan"
            value={selection.testPlan ?? NONE}
            options={[
              { value: NONE, label: "Scheme default" },
              ...info.testPlans.map((name) => ({ value: name, label: name })),
            ]}
            onChange={(name) => {
              const { testPlan: _testPlan, ...rest } = selection;
              onSelectionChange(name === NONE ? rest : { ...rest, testPlan: name });
            }}
          />
        )}
      </div>
      {xcode && inspectResult._tag === "Initial" && (
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-40" />
          <Muted>Resolving packages and reading schemes...</Muted>
        </div>
      )}
      {inspectFailure && <Alert>{inspectFailure}</Alert>}
      {xcode && info && (
        <div>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => {
              if (reload) appAtomRegistry.refresh(inspectAtom);
              else setReload(true);
            }}
          >
            <RefreshCwIcon />
            Reload schemes
          </Button>
        </div>
      )}
      {container?.kind === "xcodegen" && container.generatedProjectPath === undefined && (
        <Muted>The project has not been generated from {container.path} yet.</Muted>
      )}
      {container && (
        <div className="flex flex-wrap gap-2">
          {ACTIONS.filter(({ action }) => runKindFor(container, action) !== null).map(
            ({ action, label }) => (
              <Button
                key={action}
                size="sm"
                variant={action === "build" ? "default" : "outline"}
                disabled={busy || (xcode && action !== "generate" && !scheme)}
                onClick={() => onAction(action)}
              >
                {label}
              </Button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
