import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { CameraIcon, ClipboardCheckIcon, SquareIcon } from "lucide-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { DeviceSummary, ScopedThreadRef } from "@t3tools/contracts";
import type { DeviceQaEvidenceList } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useServerConfigs } from "~/state/entities";
import { valueOf } from "./parts";
import { FEATURE, captureScreenshot, deviceQa, openPanel, stopRecording } from "./state";

function Actions({ threadRef, device }: { threadRef: ScopedThreadRef; device: DeviceSummary }) {
  const { environmentId, threadId } = threadRef;
  const evidence = valueOf(
    useAtomValue(deviceQa.evidence({ environmentId, input: { threadId } })),
  ) as DeviceQaEvidenceList | null;
  const [busy, setBusy] = useState(false);
  const target = { hostId: device.hostId, deviceId: device.id, platform: device.platform };
  const recording = evidence?.recording;
  const recordingHere =
    recording &&
    recording.target.hostId === device.hostId &&
    recording.target.deviceId === device.id
      ? recording
      : null;

  return (
    <div className="flex shrink-0 items-center justify-end gap-1 border-b px-2 py-1">
      <Button
        size="xs"
        variant="ghost"
        disabled={busy}
        aria-label={recordingHere ? "Stop recording" : "Capture evidence"}
        onClick={async () => {
          setBusy(true);
          try {
            if (recordingHere) await stopRecording(environmentId, recordingHere.evidenceId);
            else await captureScreenshot(threadRef, target);
          } finally {
            setBusy(false);
          }
        }}
      >
        {recordingHere ? (
          <>
            <span className="size-2 rounded-full bg-destructive" aria-hidden />
            <SquareIcon />
            Stop
          </>
        ) : (
          <>
            <CameraIcon />
            Capture evidence
          </>
        )}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => openPanel(threadRef, target)}>
        <ClipboardCheckIcon />
        Device QA
      </Button>
    </div>
  );
}

/** Device panel toolbar row (packet seam); nothing without a Loom server that has Device QA. */
export function DeviceQaToolbarActions({
  threadRef,
  device,
}: {
  threadRef: ScopedThreadRef;
  device: DeviceSummary;
}) {
  const config = useServerConfigs().get(threadRef.environmentId);
  if (!loomFeaturesOf(config?.environment.capabilities).includes(FEATURE)) return null;
  return <Actions threadRef={threadRef} device={device} />;
}
