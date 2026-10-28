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
import { ChevronRightIcon } from "lucide-react";
import { Fragment, type RefObject, useRef } from "react";

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
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { MiddleTruncate } from "../ui/middle-truncate";
import { ScrollArea } from "../ui/scroll-area";
import type { RestartingMachine, UpdateEverythingRow } from "./updateEverything.logic";

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
  readonly version: string | null;
  readonly providerCount: number;
  readonly rows: ReadonlyArray<UpdateEverythingRow>;
  readonly restarts: ReadonlyArray<RestartingMachine>;
  readonly onConfirm: () => void;
  // fork: machine-updates: the app install confirm shares this dialog, and both can wait for
  // local agents instead of interrupting them.
  readonly confirmLabel?: string;
  readonly onConfirmWhenIdle?: () => void;
  readonly title?: string; // fork: machine-updates: the app install confirm names its version
}

type UpdateEverythingDialogContentProps = Omit<
  UpdateEverythingDialogProps,
  "open" | "onOpenChange"
> & {
  readonly cancelRef: RefObject<HTMLButtonElement | null>;
};

export function UpdateEverythingDialog({
  open,
  onOpenChange,
  ...content
}: UpdateEverythingDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* Refocusing the trigger after a pointer close shows its focus ring and opens its tooltip. */}
      <AlertDialogPopup
        className="sm:max-w-xl"
        initialFocus={cancelRef}
        finalFocus={(closeType) => closeType === "keyboard"}
      >
        <UpdateEverythingDialogContent {...content} cancelRef={cancelRef} />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

const APP_LABELS = {
  "this-app": "This app",
  server: "Server",
  "desktop-app": "Desktop app",
} as const;

function UpdateEverythingDialogContent({
  version,
  providerCount,
  rows,
  restarts,
  onConfirm,
  cancelRef,
  confirmLabel = "Update", // fork: machine-updates
  onConfirmWhenIdle, // fork: machine-updates
  title, // fork: machine-updates
}: UpdateEverythingDialogContentProps) {
  // fork: machine-updates
  const impact = useAtomValue(
    restartImpactAtom(
      restarts
        .map((machine) => `${machine.continuesThreads ? "+" : "-"}${machine.environmentId}`)
        .join("\n"), // fork: machine-updates
    ),
  );
  const impactLines = describeRestartImpact(impact); // fork: machine-updates
  const restarting = new Set(restarts.map((machine) => machine.environmentId));
  const updating = rows.filter((row) => row.app !== null || row.providers.length > 0);
  const skipped = rows.filter((row) => row.skipped !== null);
  // fork: machine-updates
  const confirmActions = (
    <>
      {onConfirmWhenIdle && restartInterruptsWork(impact) ? (
        <Button variant="outline" onClick={onConfirmWhenIdle}>
          Install when idle
        </Button>
      ) : null}
      <Button onClick={onConfirm}>{confirmLabel}</Button>
    </>
  );

  // fork: machine-updates: the app install confirm has no update list.
  if (title !== undefined) {
    return (
      <>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}?</AlertDialogTitle>
          {impactLines.length > 0 ? (
            <AlertDialogDescription className="whitespace-pre-line">
              {impactLines.join("\n")}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose ref={cancelRef} render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          {confirmActions}
        </AlertDialogFooter>
      </>
    );
  }

  return (
    <>
      <AlertDialogHeader className="shrink-0">
        <AlertDialogTitle>
          Update {updating.length} {updating.length === 1 ? "machine" : "machines"}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {version !== null ? (
            <>
              {/* fork: brand */}
              Loom <span className="font-mono text-xs">{version}</span>
            </>
          ) : null}
          {version !== null && providerCount > 0 ? " · " : null}
          {providerCount > 0
            ? `${providerCount} provider ${providerCount === 1 ? "update" : "updates"}`
            : null}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ScrollArea scrollFade>
        <div className="flex flex-col gap-3 px-6 pb-4">
          {/* Machine names truncate first. Provider lists wrap between names, never inside one. */}
          <div className="grid grid-cols-[minmax(4rem,max-content)_max-content_minmax(min-content,1fr)_max-content] gap-x-4 text-sm">
            <div className="col-span-full grid grid-cols-subgrid border-b pb-1.5 text-muted-foreground text-xs">
              <span>Machine</span>
              {/* fork: brand */}
              <span>Loom</span>
              <span>Providers</span>
              <span />
            </div>
            {updating.map((row) => (
              <div
                key={row.environmentId ?? "this-app"}
                className="col-span-full grid grid-cols-subgrid border-b border-border/50 py-1.5 last:border-b-0"
              >
                <span className="max-w-32 min-w-0">
                  <MiddleTruncate value={row.label} />
                </span>
                <span>
                  {row.app !== null ? APP_LABELS[row.app] : null}
                  {row.app === null && row.skipped !== null ? (
                    <span className="text-muted-foreground">Skipped</span>
                  ) : null}
                  {row.app === "this-app" ? (
                    <span className="block text-muted-foreground text-xs">restarts last</span>
                  ) : null}
                </span>
                <span>
                  {row.providers.map((provider, index) => (
                    <Fragment key={provider}>
                      <span className="whitespace-nowrap">{provider}</span>
                      {index < row.providers.length - 1 ? ", " : null}
                    </Fragment>
                  ))}
                </span>
                <span className="text-right">
                  {row.environmentId !== null && restarting.has(row.environmentId) ? (
                    <RunningThreads environmentId={row.environmentId} />
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          {skipped.length > 0 ? (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground data-panel-open:[&_svg]:rotate-90">
                <ChevronRightIcon className="size-3.5 transition-transform" aria-hidden />
                {skipped.length} skipped
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="grid grid-cols-[minmax(0,max-content)_1fr] gap-x-3 gap-y-0.5 pt-1.5 ps-4.5 text-muted-foreground text-xs">
                  {skipped.map((row) => (
                    <Fragment key={row.environmentId ?? "this-app"}>
                      <span className="max-w-32 min-w-0">
                        <MiddleTruncate value={row.label} />
                      </span>
                      <span className="wrap-anywhere">{row.skipped}</span>
                    </Fragment>
                  ))}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          ) : null}
        </div>
      </ScrollArea>
      <AlertDialogFooter>
        {/* fork: machine-updates */}
        {impactLines.length > 0 ? (
          <p className="self-center whitespace-pre-line text-muted-foreground text-sm max-sm:order-1 max-sm:text-center sm:mr-auto">
            {impactLines.join("\n")}
          </p>
        ) : null}
        <AlertDialogClose ref={cancelRef} render={<Button variant="outline" />}>
          Cancel
        </AlertDialogClose>
        {/* fork: machine-updates */}
        {confirmActions}
      </AlertDialogFooter>
    </>
  );
}

function RunningThreads({ environmentId }: { readonly environmentId: EnvironmentId }) {
  // fork: machine-updates
  const impact = useAtomValue(restartImpactAtom(`-${environmentId}`));
  const count = impact.stopped + impact.continuing; // fork: machine-updates
  return count > 0 ? <span className="whitespace-nowrap text-warning">{count} running</span> : null;
}
