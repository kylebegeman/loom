import { useAtomValue } from "@effect/atom-react";
// fork: machine-updates
import {
  collectRestartImpact,
  describeRestartImpact,
  type RestartImpact,
  restartInterruptsWork,
  sameRestartImpact,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option"; // fork: machine-updates
import { Atom } from "effect/reactivity";

import { environmentThreadShells } from "~/state/threads";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import type { RestartingMachine, SkippedMachine } from "./updateEverything.logic";

// fork: machine-updates: keyed by one `+id` (continues threads) or `-id` line per restarting
// server. Thread shells keep streaming while the dialog is open, so an unchanged impact keeps
// its identity and the dialog does not re-render.
const restartImpactAtom = Atom.family((servers: string) =>
  Atom.make((get): RestartImpact => {
    const impact = collectRestartImpact(
      servers
        .split("\n")
        .filter((server) => server !== "")
        .map((server) => ({
          continuesThreads: server.startsWith("+"), // fork: machine-updates
          threads: get(
            environmentThreadShells.environmentThreadsAtom(EnvironmentId.make(server.slice(1))),
          ),
        })),
    );
    const previous = Option.getOrNull(get.self<RestartImpact>());
    return previous !== null && sameRestartImpact(previous, impact) ? previous : impact;
  }).pipe(Atom.withLabel(`update-everything-restart-impact:${servers}`)),
);

interface UpdateEverythingDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly summary: string;
  readonly lines: ReadonlyArray<string>;
  readonly restarts: ReadonlyArray<RestartingMachine>;
  readonly skipped: ReadonlyArray<SkippedMachine>;
  readonly onConfirm: () => void;
  // fork: machine-updates: the app install confirm shares this dialog, and both can wait for
  // local agents instead of interrupting them.
  readonly confirmLabel?: string;
  readonly onConfirmWhenIdle?: () => void;
}

export function UpdateEverythingDialog({
  open,
  onOpenChange,
  ...content
}: UpdateEverythingDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* Refocusing the trigger after a pointer close shows its focus ring and opens its tooltip. */}
      <AlertDialogPopup finalFocus={(closeType) => closeType === "keyboard"}>
        <UpdateEverythingDialogContent {...content} />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function UpdateEverythingDialogContent({
  summary,
  lines,
  restarts,
  skipped,
  onConfirm,
  confirmLabel = "Update", // fork: machine-updates
  onConfirmWhenIdle, // fork: machine-updates
}: Omit<UpdateEverythingDialogProps, "open" | "onOpenChange">) {
  // fork: machine-updates
  const impact = useAtomValue(
    restartImpactAtom(
      restarts
        .map((machine) => `${machine.continuesThreads ? "+" : "-"}${machine.environmentId}`)
        .join("\n"), // fork: machine-updates
    ),
  );
  const impactLines = describeRestartImpact(impact);

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{summary}?</AlertDialogTitle>
        {/* fork: machine-updates: the app install confirm has no update list. */}
        {lines.length > 0 ? (
          <AlertDialogDescription className="whitespace-pre-line">
            {lines.join("\n")}
          </AlertDialogDescription>
        ) : null}
        {/* fork: machine-updates */}
        {impactLines.length > 0 ? (
          <p className="whitespace-pre-line pt-2 text-sm">{impactLines.join("\n")}</p>
        ) : null}
        {skipped.length > 0 ? (
          <p className="whitespace-pre-line pt-2 text-sm">
            {skipped.map((machine) => `Skips ${machine.label}: ${machine.reason}`).join("\n")}
          </p>
        ) : null}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
        {/* fork: machine-updates */}
        {onConfirmWhenIdle && restartInterruptsWork(impact) ? (
          <Button variant="outline" onClick={onConfirmWhenIdle}>
            Install when idle
          </Button>
        ) : null}
        <Button onClick={onConfirm}>{confirmLabel}</Button>
      </AlertDialogFooter>
    </>
  );
}
