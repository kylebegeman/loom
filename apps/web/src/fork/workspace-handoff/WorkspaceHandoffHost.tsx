import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { runWorkspaceHandoff, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { useProjects, useServerConfigs, useThreadShell } from "~/state/entities";
import { runLaneCommand } from "../project-lifecycle/state";
import { FEATURE, handoff, useWorkspaceHandoff } from "./state";

const labels = {
  checking: "Checking source work…",
  preparing: "Preparing destination…",
  settling: "Finishing source handoff…",
  continuing: "Starting continuation…",
  done: "Continuation ready",
  idle: "Prepare and continue",
};

function HandoffContent() {
  const state = useWorkspaceHandoff();
  const source = state.source!;
  const sourceShell = useThreadShell(source);
  const projects = useProjects();
  const configs = useServerConfigs();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const destinations = projects.filter(
    (project) =>
      project.environmentId !== source.environmentId &&
      supportsLoomFeature(configs.get(project.environmentId)?.environment.capabilities, FEATURE),
  );
  const selected = destinations.find(
    (project) => `${project.environmentId}/${project.id}` === state.destinationKey,
  );
  const destination = state.receipt
    ? { environmentId: state.receipt.destinationEnvironmentId, id: state.receipt.projectId }
    : selected;
  const sourceAllowed = useAtomValue(handoff.offer.permissionAtom(source.environmentId));
  const destinationAllowed = useAtomValue(
    handoff.prepare.permissionAtom(destination?.environmentId ?? source.environmentId),
  );
  const allowed = (state.sourceResult !== null || sourceAllowed) && destinationAllowed;
  const canStartNew =
    sourceAllowed && sourceShell !== null && sourceShell.settledOverride !== "settled";
  const go = async () => {
    if (!destination || running || !allowed) return;
    setRunning(true);
    useWorkspaceHandoff.setState({ error: null });
    try {
      await runWorkspaceHandoff({
        attempt: state,
        offer: () =>
          runLaneCommand(handoff.offer, {
            environmentId: source.environmentId,
            input: { threadId: source.threadId, requestId: state.requestId },
          }),
        prepare: (offer) =>
          runLaneCommand(handoff.prepare, {
            environmentId: destination.environmentId,
            input: { offer, projectId: destination.id },
          }),
        finish: (offer, receipt) =>
          runLaneCommand(handoff.finish, {
            environmentId: source.environmentId,
            input: { offer, receipt },
          }),
        resume: (offer, receipt) =>
          runLaneCommand(handoff.resume, {
            environmentId: destination.environmentId,
            input: { offer, receipt },
          }),
        progress: (phase, attempt) => {
          useWorkspaceHandoff.setState({ ...attempt, phase });
        },
      });
    } catch (error) {
      useWorkspaceHandoff.setState({
        phase: "idle",
        error:
          error instanceof Error
            ? error.message
            : "Handoff could not finish. The original conversation is preserved. Retry when the destination is available.",
      });
    } finally {
      setRunning(false);
    }
  };
  const openDestination = () => {
    if (!state.receipt) return;
    useWorkspaceHandoff.setState({ open: false });
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: state.receipt.destinationEnvironmentId,
        threadId: state.receipt.threadId,
      },
    });
  };
  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!running) useWorkspaceHandoff.setState({ open });
      }}
    >
      <DialogPopup showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle>Continue on another machine</DialogTitle>
          <DialogDescription>
            Prepare the published code and workspace setup on the destination, then start a linked
            continuation. The original conversation keeps its history and attachments.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <label htmlFor="handoff-destination" className="text-sm font-medium">
            Destination project
          </label>
          <Select
            value={state.destinationKey || null}
            disabled={running || state.offer !== null}
            onValueChange={(value) => useWorkspaceHandoff.setState({ destinationKey: value ?? "" })}
          >
            <SelectTrigger id="handoff-destination" aria-label="Destination project">
              <SelectValue placeholder="Choose a project on another host">
                {selected
                  ? `${configs.get(selected.environmentId)?.environment.label ?? "Connected host"} · ${selected.title}`
                  : state.receipt
                    ? "Saved destination"
                    : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {destinations.map((project) => (
                <SelectItem
                  key={`${project.environmentId}/${project.id}`}
                  value={`${project.environmentId}/${project.id}`}
                >
                  {configs.get(project.environmentId)?.environment.label} · {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          {destinations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {state.receipt
                ? "Reconnect the destination host to finish this saved handoff."
                : "Connect another Loom host and add this repository there. It will appear here once that host supports handoff."}
            </p>
          )}
          {state.phase !== "done" && !allowed && (
            <p className="text-sm text-muted-foreground">
              {state.sourceResult === null && !sourceAllowed
                ? "Workspace operation permission is required on the original host."
                : "Workspace operation permission is required on the destination host."}
            </p>
          )}
          {state.offer && (
            <p className="text-sm text-muted-foreground">
              Branch: {state.offer.branch}.{" "}
              {state.offer.contextTruncated
                ? "Recent conversation context will be included."
                : "Conversation context will be included."}
            </p>
          )}
          {(running || state.phase === "done") && (
            <p role="status" className="text-sm">
              {labels[state.phase]}
            </p>
          )}
          {state.error && (
            <p role="alert" className="text-sm text-destructive-foreground">
              {state.error}
            </p>
          )}
          {state.sourceResult && (
            <p className="text-sm text-muted-foreground">{state.sourceResult.reason}</p>
          )}
          {state.error && state.sourceResult?.sourceSettled && (
            <p className="text-sm text-muted-foreground">
              Retry to deliver to the prepared conversation. The original is already settled, and
              its history is preserved.
            </p>
          )}
        </div>
        <DialogFooter>
          {state.receipt && state.phase !== "done" && (
            <Button variant="outline" onClick={openDestination} disabled={running}>
              Open destination
            </Button>
          )}
          {((state.error && !state.sourceResult?.sourceSettled) ||
            (state.phase === "done" && canStartNew)) && (
            <Button
              variant="outline"
              disabled={running}
              onClick={() =>
                useWorkspaceHandoff.setState({
                  requestId: randomUUID(),
                  offer: null,
                  receipt: null,
                  sourceResult: null,
                  error: null,
                  phase: "idle",
                })
              }
            >
              {state.phase === "done" ? "New handoff" : "Start over"}
            </Button>
          )}
          {state.phase !== "done" && (
            <Button onClick={() => void go()} disabled={running || !destination || !allowed}>
              {running
                ? labels[state.phase]
                : state.sourceResult
                  ? "Retry continuation"
                  : state.error
                    ? "Retry handoff"
                    : "Prepare and continue"}
            </Button>
          )}
          {state.phase === "done" && (
            <Button onClick={openDestination}>Continue on destination</Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
export function WorkspaceHandoffHost() {
  const source = useWorkspaceHandoff((state) => state.source);
  return source === null ? null : <HandoffContent />;
}
