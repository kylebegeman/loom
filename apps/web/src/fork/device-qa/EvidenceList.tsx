import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  CameraIcon,
  CircleIcon,
  ClipboardListIcon,
  FilmIcon,
  ImagesIcon,
  ListChecksIcon,
  PackageIcon,
  PaperclipIcon,
  PlayIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  DEVICE_QA_MAX_RECORDING_SECONDS,
  type DeviceQaEvidence,
  type DeviceQaEvidenceList,
} from "@t3tools/contracts/fork";
import { useAssetUrlState } from "~/assets/assetUrls";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { Spinner } from "~/components/ui/spinner";
import { ensureLocalApi } from "~/localApi";
import type { DeviceQaOption } from "./devices";
import {
  Alert,
  CopyButton,
  Done,
  EmptyNote,
  Meta,
  Muted,
  Section,
  formatBytes,
  formatElapsed,
  formatSeconds,
  useAction,
  useNow,
  valueOf,
} from "./parts";
import { attachEvidence } from "./attach";
import { deviceQa, runCommand } from "./state";

const THUMB =
  "flex h-20 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted";

function Thumbnail({ threadRef, item }: { threadRef: ScopedThreadRef; item: DeviceQaEvidence }) {
  const asset = useAssetUrlState(
    threadRef.environmentId,
    item.kind === "screenshot" && item.status === "ready" && item.path
      ? { _tag: "media-file", threadId: threadRef.threadId, path: item.path }
      : null,
  );
  if (item.kind !== "screenshot") {
    const Icon =
      item.kind === "recording"
        ? FilmIcon
        : item.kind === "install"
          ? PackageIcon
          : ClipboardListIcon;
    return (
      <div className={THUMB}>
        <Icon className="size-5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className={THUMB}>
      {asset._tag === "Success" ? (
        <a href={asset.url} target="_blank" rel="noreferrer" className="size-full">
          <img
            src={asset.url}
            alt={item.label ?? "Screenshot"}
            loading="lazy"
            className="size-full object-contain"
          />
        </a>
      ) : asset._tag === "Loading" ? (
        <Spinner className="size-4" />
      ) : (
        <CameraIcon className="size-5 text-muted-foreground" />
      )}
    </div>
  );
}

/** Plays a recording through a signed asset URL, which works over every connection. */
function RecordingPlayer({ threadRef, path }: { threadRef: ScopedThreadRef; path: string }) {
  const asset = useAssetUrlState(threadRef.environmentId, {
    _tag: "media-file",
    threadId: threadRef.threadId,
    path,
  });
  if (asset._tag === "Loading") return <Spinner className="size-4" />;
  if (asset._tag === "Failure") return <Alert>The recording could not be loaded.</Alert>;
  return (
    <video
      src={asset.url}
      controls
      preload="metadata"
      className="max-h-96 w-full rounded-lg border bg-black"
    />
  );
}

const KIND_LABEL = {
  screenshot: "Screenshot",
  recording: "Recording",
  install: "Install",
  "flow-report": "Flow report",
} as const;

const itemFacts = (item: DeviceQaEvidence) => [
  item.deviceName,
  item.width !== null && item.height !== null && `${item.width}×${item.height}`,
  item.durationMs !== null && formatSeconds(item.durationMs / 1000),
  item.sizeBytes !== null && formatBytes(item.sizeBytes),
  new Date(item.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }),
];

function EvidenceRow({
  threadRef,
  item,
  onOpenRun,
}: {
  threadRef: ScopedThreadRef;
  item: DeviceQaEvidence;
  onOpenRun: (runId: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const action = useAction();
  const ready = item.status === "ready";
  // A failed flow report records a failed run; the report itself is written and worth attaching.
  const report = item.kind === "flow-report";
  const attachable = ready || (report && item.path !== null);
  return (
    <li className="flex flex-col gap-3 px-3 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Thumbnail threadRef={threadRef} item={item} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate font-medium text-sm">
              {item.label ?? KIND_LABEL[item.kind]}
            </span>
            {item.createdBy === "agent" && <Badge variant="outline">Agent</Badge>}
            {item.status === "recording" && <Badge variant="error">Recording</Badge>}
            {item.status === "finalizing" && <Badge variant="secondary">Saving</Badge>}
            {item.status === "failed" && <Badge variant="error">Failed</Badge>}
          </div>
          {item.label !== null && (
            <span className="text-muted-foreground text-xs">{KIND_LABEL[item.kind]}</span>
          )}
          <Meta items={itemFacts(item)} />
          {item.status === "failed" && !report && item.detail && (
            <span className="break-words text-destructive-foreground text-xs">{item.detail}</span>
          )}
          {item.kind === "install" && item.detail && (
            <span className="truncate font-mono text-muted-foreground text-xs">{item.detail}</span>
          )}
          <div className="flex flex-wrap items-center gap-1 pt-1.5">
            {attachable && (
              <Button
                size="xs"
                variant="outline"
                disabled={action.busy}
                onClick={() => void action.act(() => attachEvidence(threadRef, item))}
              >
                <PaperclipIcon />
                Attach
              </Button>
            )}
            {item.kind === "recording" && ready && item.path && (
              <Button
                size="xs"
                variant="outline"
                aria-expanded={playing}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <XIcon /> : <PlayIcon />}
                {playing ? "Hide" : "Play"}
              </Button>
            )}
            {report && item.detail && (
              <Button size="xs" variant="outline" onClick={() => onOpenRun(item.detail!)}>
                <ListChecksIcon />
                Open run
              </Button>
            )}
            {item.path && <CopyButton value={item.path} label="Copy path" variant="ghost" />}
            {item.status !== "recording" && item.status !== "finalizing" && (
              <Button
                size="icon-xs"
                variant="ghost-destructive"
                aria-label="Delete"
                className="ml-auto"
                disabled={action.busy}
                onClick={() =>
                  void action.act(() =>
                    runCommand(deviceQa.deleteEvidence, {
                      environmentId: threadRef.environmentId,
                      input: { evidenceId: item.id },
                    }),
                  )
                }
              >
                <Trash2Icon />
              </Button>
            )}
          </div>
        </div>
      </div>
      {playing && item.path && <RecordingPlayer threadRef={threadRef} path={item.path} />}
      {action.error && <Alert>{action.error}</Alert>}
    </li>
  );
}

function CaptureControls({
  threadRef,
  device,
  list,
}: {
  threadRef: ScopedThreadRef;
  device: DeviceQaOption | null;
  list: DeviceQaEvidenceList;
}) {
  const { environmentId, threadId } = threadRef;
  const settings = valueOf(useAtomValue(deviceQa.settings({ environmentId, input: {} })));
  const [clean, setClean] = useState<boolean | null>(null);
  const capture = useAction();
  const stop = useAction();
  const { recording } = list;
  const now = useNow(recording !== null);
  const cleanable = device?.local === true && device.target.platform === "ios";
  const cleanStatusBar = cleanable && (clean ?? settings?.defaultCleanStatusBar ?? true);

  const start = (kind: "screenshot" | "recording") =>
    void capture.act(async () => {
      if (!device) throw new Error("Choose a device first.");
      await runCommand(deviceQa.capture, {
        environmentId,
        input: {
          threadId,
          target: device.target,
          kind,
          cleanStatusBar,
          ...(kind === "recording" ? { maxSeconds: DEVICE_QA_MAX_RECORDING_SECONDS } : {}),
        },
      });
    });

  const stopRecording = (evidenceId: string) =>
    void stop.act(() =>
      runCommand(deviceQa.stopRecording, { environmentId, input: { evidenceId } }),
    );

  return (
    <div className="flex flex-col gap-3">
      {recording ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border bg-destructive/6 px-3 py-2.5 dark:bg-destructive/10"
        >
          <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium text-sm">
              {recording.threadId === threadId ? "Recording" : "Recording in another thread"}
            </span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatElapsed(recording.startedAt, null, now)} of up to{" "}
              {formatSeconds(DEVICE_QA_MAX_RECORDING_SECONDS)}
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={stop.busy}
            onClick={() => stopRecording(recording.evidenceId)}
          >
            <SquareIcon />
            Stop
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={device === null || capture.busy}
          onClick={() => start("screenshot")}
        >
          <CameraIcon />
          Screenshot
        </Button>
        {!recording && (
          <Button
            size="sm"
            variant="outline"
            disabled={device?.local !== true || capture.busy}
            onClick={() => start("recording")}
          >
            <CircleIcon />
            Record screen
          </Button>
        )}
      </div>
      {cleanable && (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium text-sm">Clean status bar</span>
            <span className="text-muted-foreground text-xs">
              Shows 9:41 with full battery and signal, then restores it.
            </span>
          </span>
          <Switch
            checked={cleanStatusBar}
            onCheckedChange={(checked) => setClean(checked === true)}
          />
        </label>
      )}
      {device && !device.local && (
        <Muted>
          {device.physical ? "Physical devices" : "Devices on other hosts"} take screenshots only.
          Recordings and installs need a booted simulator or emulator on this environment.
        </Muted>
      )}
      {capture.error && <Alert>{capture.error}</Alert>}
      {stop.error && <Alert>{stop.error}</Alert>}
    </div>
  );
}

export function EvidenceList({
  threadRef,
  device,
  list,
  onOpenRun,
}: {
  threadRef: ScopedThreadRef;
  device: DeviceQaOption | null;
  list: DeviceQaEvidenceList;
  onOpenRun: (runId: string) => void;
}) {
  const remove = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const size = formatBytes(list.totalBytes);
  const deleteAll = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete ${list.totalCount} items (${size}) captured in this thread? This cannot be undone.`,
    );
    if (!confirmed) return;
    setNotice(null);
    await remove.act(async () => {
      const result = await runCommand(deviceQa.deleteAllEvidence, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      setNotice(
        `Deleted ${result.deletedCount} items, freed ${formatBytes(result.freedBytes)}.` +
          (result.skippedActive > 0 ? " The active recording was kept." : ""),
      );
    });
  };
  return (
    <>
      <Section
        title="Capture"
        description={device ? `From ${device.name}` : "Choose a device to capture from."}
      >
        <CaptureControls threadRef={threadRef} device={device} list={list} />
      </Section>
      <Section
        title="Evidence"
        description={
          list.totalCount > 0
            ? `${list.totalCount} ${list.totalCount === 1 ? "item" : "items"}, ${size}`
            : undefined
        }
        actions={
          list.totalCount > 0 && (
            <Button
              size="xs"
              variant="ghost-destructive"
              disabled={remove.busy}
              onClick={() => void deleteAll()}
            >
              <Trash2Icon />
              Delete all for this thread
            </Button>
          )
        }
      >
        {remove.error && <Alert>{remove.error}</Alert>}
        {notice && <Done>{notice}</Done>}
        {list.items.length === 0 ? (
          <EmptyNote icon={<ImagesIcon />} title="Nothing captured yet">
            Screenshots, recordings, installs and flow reports from this thread collect here, from
            you or an agent.
          </EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
            {list.items.map((item) => (
              <EvidenceRow key={item.id} threadRef={threadRef} item={item} onOpenRun={onOpenRun} />
            ))}
          </ul>
        )}
        {list.items.length < list.totalCount && (
          <Muted>The newest {list.items.length} items are listed.</Muted>
        )}
      </Section>
    </>
  );
}
