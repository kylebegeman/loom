import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ListChecksIcon,
  PlusIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  TabletSmartphoneIcon,
  XIcon,
} from "lucide-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  DEVICE_QA_FLOWS_DIR,
  deviceQaTargetKey,
  type DeviceQaRun,
  type DeviceQaRunsEvent,
  type DeviceQaStatus,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { deviceEnvironment, useDeviceState } from "~/state/device";
import { useProject, useThreadShell } from "~/state/entities";
import type { ForkPanelProps } from "../panels/types";
import { ArgentSetup, type Workspace } from "./ArgentSetup";
import { deviceOptions, pickDevice, type DeviceQaOption } from "./devices";
import { EvidenceList } from "./EvidenceList";
import { FlowList, RecordWithAgent } from "./FlowList";
import { FlowRunView, RunHistory } from "./FlowRunView";
import { InstallForm } from "./InstallForm";
import { Alert, EmptyNote, Muted, Section, failureOf, useAction, valueOf } from "./parts";
import { PillTabPanel, PillTabs, type PillTab } from "./PillTabs";
import {
  deviceQa,
  noteLocalDevices,
  noteRecording,
  noteRuns,
  runCommand,
  selectedTargetOf,
  useDeviceQaTargetStore,
} from "./state";

type Tab = "flows" | "evidence" | "install";

/** Runs listed in the history; the server keeps more per project (settings). */
const HISTORY_SHOWN = 20;
/** Stopped simulators and emulators offered when nothing is booted. */
const START_OFFERED = 4;

const optionLabel = (option: DeviceQaOption) =>
  [
    `${option.name}, ${option.version}`,
    option.hostLabel ? ` on ${option.hostLabel}` : "",
    option.local ? "" : " (screenshots only)",
  ].join("");

function OptionText({ option }: { option: DeviceQaOption }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate">{option.name}</span>
      <span className="shrink-0 text-muted-foreground">{option.version}</span>
      {option.hostLabel && (
        <span className="truncate text-muted-foreground">on {option.hostLabel}</span>
      )}
    </span>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4" aria-busy="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-2/3" />
      <Muted>{text}</Muted>
    </div>
  );
}

/** A small static mark on a tab: a run in progress or a recording. */
function TabDot({ tone, label }: { tone: "info" | "destructive"; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={
        tone === "info" ? "size-1.5 rounded-full bg-info" : "size-1.5 rounded-full bg-destructive"
      }
    />
  );
}

function DevicePicker({
  threadRef,
  options,
  device,
}: {
  threadRef: ScopedThreadRef;
  options: ReadonlyArray<DeviceQaOption>;
  device: DeviceQaOption | null;
}) {
  const select = useDeviceQaTargetStore((state) => state.select);
  const items = options.map((option) => ({ value: option.key, label: optionLabel(option) }));
  if (options.length === 0) return null;
  return (
    <Select
      value={device?.key ?? null}
      items={items}
      onValueChange={(key) => {
        const option = options.find((candidate) => candidate.key === key);
        if (option) select(threadRef, option.target);
      }}
    >
      <SelectTrigger size="sm" aria-label="Device" className="w-auto min-w-0 max-w-full">
        <SmartphoneIcon />
        <SelectValue placeholder="Choose a device" className="min-w-0">
          {(key: string | null) => {
            const option = options.find((candidate) => candidate.key === key);
            return option ? <OptionText option={option} /> : "Choose a device";
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            <span className="flex min-w-0 flex-col">
              <OptionText option={option} />
              {!option.local && (
                <span className="text-muted-foreground text-xs">
                  {option.physical ? "Physical device" : "Another host"}, screenshots only
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** Nothing booted: point at the Device panel and offer to start a stopped simulator here. */
function NoDevice({ threadRef }: { threadRef: ScopedThreadRef }) {
  const { state } = useDeviceState(threadRef.environmentId);
  const start = useAction();
  const stopped = state.devices
    .filter((device) => !device.booted && !device.physical)
    .slice(0, START_OFFERED);
  return (
    <div className="flex flex-col gap-2">
      <EmptyNote
        icon={<TabletSmartphoneIcon />}
        title="No device running"
        action={
          stopped.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {stopped.map((device) => (
                <Button
                  key={`${device.hostId}:${device.id}`}
                  size="xs"
                  variant="outline"
                  disabled={start.busy}
                  onClick={() =>
                    void start.act(() =>
                      runCommand(deviceEnvironment.open, {
                        environmentId: threadRef.environmentId,
                        input: {
                          threadId: threadRef.threadId,
                          hostId: device.hostId,
                          deviceId: device.id,
                          platform: device.platform,
                        },
                      }),
                    )
                  }
                >
                  Start {device.name}
                </Button>
              ))}
            </div>
          )
        }
      >
        Boot a simulator or emulator in the Device panel, or start one here.
      </EmptyNote>
      {start.error && <Alert>{start.error}</Alert>}
    </div>
  );
}

/** A run from the history, or one an evidence item points at that the history no longer lists. */
function SelectedRun({
  threadRef,
  runId,
  runs,
}: {
  threadRef: ScopedThreadRef;
  runId: string;
  runs: ReadonlyArray<DeviceQaRun>;
}) {
  const listed = runs.find((run) => run.id === runId);
  if (listed) return <FlowRunView key={listed.id} threadRef={threadRef} run={listed} />;
  return <FetchedRun threadRef={threadRef} runId={runId} />;
}

function FetchedRun({ threadRef, runId }: { threadRef: ScopedThreadRef; runId: string }) {
  const result = useAtomValue(
    deviceQa.run({ environmentId: threadRef.environmentId, input: { runId } }),
  );
  const failure = failureOf(result);
  if (failure) return <Alert>{failure}</Alert>;
  const detail = valueOf(result);
  if (!detail) return <Muted>Loading run...</Muted>;
  return <FlowRunView threadRef={threadRef} run={detail.run} />;
}

function FlowsTab({
  threadRef,
  workspace,
  status,
  runs,
  device,
  selectedRunId,
  onSelectRun,
}: {
  threadRef: ScopedThreadRef;
  workspace: Workspace | null;
  status: DeviceQaStatus;
  runs: ReadonlyArray<DeviceQaRun>;
  device: DeviceQaOption | null;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}) {
  const { environmentId, threadId } = threadRef;
  const flowsAtom = deviceQa.flows({ environmentId, input: { threadId } });
  const flowsResult = useAtomValue(flowsAtom);
  const flows = valueOf(flowsResult);
  const [recording, setRecording] = useState(false);
  const start = useAction();
  const activeRun = runs.find((run) => run.status === "running") ?? null;
  const canRun =
    status.argent.installed && device?.local === true && activeRun === null && !start.busy;
  const shownRunId = selectedRunId ?? runs[0]?.id ?? null;
  const deviceName = (run: DeviceQaRun) =>
    status.localDevices.find((entry) => entry.target.deviceId === run.target.deviceId)?.name ??
    run.target.deviceId;

  const runFlows = (paths: ReadonlyArray<string>) =>
    void start.act(async () => {
      if (!device) throw new Error("Choose a device first.");
      const run = await runCommand(deviceQa.runFlows, {
        environmentId,
        input: { threadId, target: device.target, paths },
      });
      onSelectRun(run.id);
    });

  const record = (
    <Button
      size="xs"
      variant={recording ? "ghost" : "outline"}
      aria-expanded={recording}
      onClick={() => setRecording(!recording)}
    >
      {recording ? <XIcon /> : <PlusIcon />}
      {recording ? "Close" : "Record with the agent"}
    </Button>
  );
  const flowCount = flows?.flows.length ?? 0;

  return (
    <>
      <ArgentSetup threadRef={threadRef} workspace={workspace} argent={status.argent} />
      <Section
        title="Flows"
        description={
          flows && flowCount > 0
            ? `${flowCount} ${flowCount === 1 ? "flow" : "flows"} in ${DEVICE_QA_FLOWS_DIR}`
            : undefined
        }
        actions={
          <>
            {record}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Look for flows again"
              onClick={() => appAtomRegistry.refresh(flowsAtom)}
            >
              <RefreshCwIcon />
            </Button>
          </>
        }
      >
        {recording && (
          <RecordWithAgent
            threadRef={threadRef}
            device={device}
            onDone={() => setRecording(false)}
          />
        )}
        {device && !device.local && (
          <Muted>
            Flows run on simulators and emulators. Choose a booted simulator or emulator above.
          </Muted>
        )}
        {start.error && <Alert>{start.error}</Alert>}
        {failureOf(flowsResult) ? (
          <Alert>{failureOf(flowsResult)}</Alert>
        ) : !flows ? (
          <Loading text="Reading .argent/flows..." />
        ) : flows.flows.length === 0 ? (
          !recording && (
            <EmptyNote
              icon={<ListChecksIcon />}
              title="No flows yet"
              action={
                <Button size="xs" variant="outline" onClick={() => setRecording(true)}>
                  <PlusIcon />
                  Record with the agent
                </Button>
              }
            >
              Flows are YAML files in {DEVICE_QA_FLOWS_DIR}. Describe a path through the app and the
              agent records it.
            </EmptyNote>
          )
        ) : (
          <FlowList
            threadRef={threadRef}
            flows={flows.flows}
            truncated={flows.truncated}
            canRun={canRun}
            onRun={runFlows}
          />
        )}
      </Section>
      {shownRunId && (
        <Section
          title={
            shownRunId === activeRun?.id
              ? "Current run"
              : selectedRunId !== null
                ? "Selected run"
                : "Latest result"
          }
        >
          <SelectedRun threadRef={threadRef} runId={shownRunId} runs={runs} />
        </Section>
      )}
      {runs.length > 0 && (
        <Section title="History" description="Recent runs in this project, newest first.">
          <RunHistory
            runs={runs.slice(0, HISTORY_SHOWN)}
            selectedId={shownRunId}
            deviceName={deviceName}
            onSelect={onSelectRun}
          />
        </Section>
      )}
    </>
  );
}

function Body({
  threadRef,
  workspace,
}: {
  threadRef: ScopedThreadRef;
  workspace: Workspace | null;
}) {
  const { environmentId, threadId } = threadRef;
  const input = { threadId };
  const statusAtom = deviceQa.status({ environmentId, input });
  const statusResult = useAtomValue(statusAtom);
  const runsResult = useAtomValue(deviceQa.runs({ environmentId, input }));
  const evidenceResult = useAtomValue(deviceQa.evidence({ environmentId, input }));
  const status = valueOf(statusResult);
  const runs = (valueOf(runsResult) as DeviceQaRunsEvent | null)?.runs;
  const evidence = valueOf(evidenceResult);
  const { state: hub } = useDeviceState(environmentId);
  const chosen = useDeviceQaTargetStore((store) => selectedTargetOf(store.byThread, threadRef));
  const [tab, setTab] = useState<Tab>("flows");
  // A picked run stays shown until a newer one starts, from this panel, the palette or an agent.
  const [picked, setPicked] = useState<{ runId: string; newest: string | undefined } | null>(null);
  const newestRunId = runs?.[0]?.id;
  const selectedRunId = picked !== null && picked.newest === newestRunId ? picked.runId : null;
  const selectRun = (runId: string) => setPicked({ runId, newest: newestRunId });

  const options = useMemo(
    () => deviceOptions(status?.localDevices ?? [], hub),
    [status?.localDevices, hub],
  );
  const watched = hub.sessions.filter((session) => session.threadId === threadId);
  const device = pickDevice(options, chosen, watched);

  useEffect(() => {
    if (status) noteLocalDevices(environmentId, status.localDevices);
  }, [environmentId, status]);
  useEffect(() => {
    if (evidence) noteRecording(environmentId, evidence.recording);
  }, [environmentId, evidence]);
  useEffect(() => {
    if (runs) noteRuns(threadRef, runs);
  }, [runs, threadRef]);
  // A device the Device panel hands over while the panel is open is shown at once.
  const chosenKey = chosen ? deviceQaTargetKey(chosen) : null;
  useEffect(() => {
    if (chosenKey !== null) appAtomRegistry.refresh(statusAtom);
  }, [chosenKey, statusAtom]);

  const failure = failureOf(statusResult) ?? failureOf(runsResult) ?? failureOf(evidenceResult);
  const running = runs?.some((run) => run.status === "running") ?? false;
  const tabs: ReadonlyArray<PillTab<Tab>> = [
    {
      value: "flows",
      label: "Flows",
      adornment: running ? <TabDot tone="info" label="A run is in progress" /> : undefined,
    },
    {
      value: "evidence",
      label: "Evidence",
      adornment: evidence?.recording ? (
        <TabDot tone="destructive" label="Recording" />
      ) : evidence && evidence.totalCount > 0 ? (
        <span className="text-muted-foreground tabular-nums">{evidence.totalCount}</span>
      ) : undefined,
    },
    { value: "install", label: "Install" },
  ];
  const loaded = status && runs && evidence ? { status, runs, evidence } : null;
  const content = (render: (data: NonNullable<typeof loaded>) => ReactNode) =>
    failure ? (
      <div className="px-4 py-4">
        <Alert>{failure}</Alert>
      </div>
    ) : loaded === null ? (
      <Loading text="Looking for devices, flows and evidence..." />
    ) : (
      render(loaded)
    );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex flex-col gap-3 px-4 pt-3 pb-4">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <h1 className="shrink-0 font-semibold text-sm">Device QA</h1>
          <div className="flex min-w-0 items-center justify-end gap-1">
            {status ? (
              <DevicePicker threadRef={threadRef} options={options} device={device} />
            ) : (
              !failure && <Skeleton className="h-7 w-40" />
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Look for devices and argent again"
              onClick={() => appAtomRegistry.refresh(statusAtom)}
            >
              <RefreshCwIcon />
            </Button>
          </div>
        </div>
        {status && options.length === 0 && <NoDevice threadRef={threadRef} />}
      </header>
      <PillTabs label="Device QA view" tabs={tabs} value={tab} onValueChange={setTab}>
        <PillTabPanel value="flows">
          {content((data) => (
            <FlowsTab
              threadRef={threadRef}
              workspace={workspace}
              status={data.status}
              runs={data.runs}
              device={device}
              selectedRunId={selectedRunId}
              onSelectRun={selectRun}
            />
          ))}
        </PillTabPanel>
        <PillTabPanel value="evidence">
          {content((data) => (
            <EvidenceList
              threadRef={threadRef}
              device={device}
              list={data.evidence}
              onOpenRun={(runId) => {
                selectRun(runId);
                setTab("flows");
              }}
            />
          ))}
        </PillTabPanel>
        <PillTabPanel value="install">
          {content(() => (
            <Section
              title="Install a build"
              description="Put a simulator build or an APK on the chosen device."
            >
              <InstallForm threadRef={threadRef} device={device} />
            </Section>
          ))}
        </PillTabPanel>
      </PillTabs>
    </div>
  );
}

export default function DeviceQaPanel({ threadRef, visible }: ForkPanelProps) {
  const shell = useThreadShell(threadRef);
  const project = useProject(
    useMemo(
      () => (shell ? scopeProjectRef(threadRef.environmentId, shell.projectId) : null),
      [shell, threadRef.environmentId],
    ),
  );
  if (!shell)
    return (
      <div className="p-3">
        <Muted>
          Device QA uses this thread's workspace. Send a message to start the thread first.
        </Muted>
      </div>
    );
  // Hidden panels drop their streams; a running flow or recording continues on the server.
  if (!visible) return null;
  return (
    <Body
      threadRef={threadRef}
      workspace={
        project ? { workspaceRoot: project.workspaceRoot, worktreePath: shell.worktreePath } : null
      }
    />
  );
}
