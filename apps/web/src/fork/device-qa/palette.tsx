import { ClipboardCheckIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import {
  FEATURE,
  cancelLastRun,
  captureScreenshot,
  lastRunOf,
  openPanel,
  recordingOf,
  runLastFlow,
  stopRecording,
  targetFor,
} from "./state";

export const deviceQaPaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ activeThreadRef, loomFeatures }) => {
    if (!activeThreadRef || !loomFeatures.includes(FEATURE)) return [];
    const base = {
      kind: "action" as const,
      icon: <ClipboardCheckIcon className="size-4" />,
      description: "Device QA",
      searchTerms: ["argent", "flow", "simulator", "emulator", "screenshot", "evidence", "QA"],
    };
    const device = targetFor(activeThreadRef);
    const lastRun = lastRunOf(activeThreadRef);
    const recording = recordingOf(activeThreadRef.environmentId);
    return [
      {
        ...base,
        value: "action:loom:device-qa:open",
        title: "Device QA: Open",
        run: async () => openPanel(activeThreadRef),
      },
      ...(device
        ? [
            {
              ...base,
              value: "action:loom:device-qa:capture",
              title: "Device QA: Capture screenshot",
              run: () => captureScreenshot(activeThreadRef, device),
            },
          ]
        : []),
      ...(lastRun && lastRun.status !== "running"
        ? [
            {
              ...base,
              value: "action:loom:device-qa:run-last-flow",
              title: "Device QA: Run last flow",
              run: () => runLastFlow(activeThreadRef),
            },
          ]
        : []),
      ...(lastRun?.status === "running"
        ? [
            {
              ...base,
              value: "action:loom:device-qa:cancel",
              title: "Device QA: Cancel flow run",
              run: () => cancelLastRun(activeThreadRef),
            },
          ]
        : []),
      ...(recording
        ? [
            {
              ...base,
              value: "action:loom:device-qa:stop-recording",
              title: "Device QA: Stop recording",
              run: () => stopRecording(activeThreadRef.environmentId, recording.evidenceId),
            },
          ]
        : []),
    ];
  },
};
