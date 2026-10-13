import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  buildWorkspaceHandoffDestinations,
  selectWorkspaceHandoffDestination,
  WORKSPACE_HANDOFF_LABELS,
  runWorkspaceHandoff,
  supportsLoomFeature,
  type WorkspaceHandoffDestinationGroup,
} from "@t3tools/client-runtime/fork";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogPanel,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { RadioGroup, Radio } from "~/components/ui/radio-group";
import { useProjects, useServerConfigs, useThreadShell } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { runLaneCommand } from "../project-lifecycle/state";
import { FEATURE, handoff, useWorkspaceHandoff } from "./state";

function DestinationComputer({
  group,
  selectedKey,
  locked,
}: {
  group: WorkspaceHandoffDestinationGroup;
  selectedKey: string | undefined;
  locked: boolean;
}) {
  const permitted = useAtomValue(handoff.prepare.permissionAtom(group.environmentId));
  const reason =
    group.blockedReason ?? (!permitted ? "Needs workspace permission on this computer." : null);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{group.label}</p>
      {reason ? (
        <p className="text-sm text-muted-foreground">{reason}</p>
      ) : (
        group.projects.map(({ project, key, repositoryVerified }) => (
          <label
            key={key}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 ${selectedKey === key ? "bg-muted/50" : "hover:bg-muted/30"}`}
          >
            <Radio value={key} disabled={locked} />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block break-words text-sm font-medium">{project.title}</span>
              {group.projects.length > 1 && (
                <span className="block break-all text-xs text-muted-foreground">
                  {project.workspaceRoot}
                </span>
              )}
              {!repositoryVerified && (
                <span className="block text-xs text-muted-foreground">
                  Repository checked before moving.
                </span>
              )}
            </span>
          </label>
        ))
      )}
    </div>
  );
}

function HandoffContent() {
  const state = useWorkspaceHandoff();
  const source = state.source!;
  const sourceShell = useThreadShell(source);
  const projects = useProjects();
  const configs = useServerConfigs();
  const { environments, isReady } = useEnvironments();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const sourceProject = projects.find(
    (project) =>
      project.environmentId === source.environmentId && project.id === sourceShell?.projectId,
  );
  const groups = buildWorkspaceHandoffDestinations({
    sourceEnvironmentId: source.environmentId,
    sourceRepository: sourceProject?.repositoryIdentity,
    offeredRepositoryKey: state.offer?.repositoryKey ?? null,
    projects,
    computers: environments.map((computer) => ({
      environmentId: computer.environmentId,
      label: computer.label,
      connected: computer.entry.enabled && computer.connection.phase === "connected",
      supportsHandoff: supportsLoomFeature(
        computer.serverConfig?.environment.capabilities ??
          configs.get(computer.environmentId)?.environment.capabilities,
        FEATURE,
      ),
    })),
  });
  const selected = selectWorkspaceHandoffDestination(
    groups,
    state.destinationKey || (state.offer ? "" : undefined),
  );
  const destination = state.receipt
    ? { environmentId: state.receipt.destinationEnvironmentId, id: state.receipt.projectId }
    : selected?.project;
  const sourceComputer = environments.find(
    (computer) => computer.environmentId === source.environmentId,
  );
  const destinationComputer = environments.find(
    (computer) => computer.environmentId === destination?.environmentId,
  );
  const sourceLabel =
    sourceComputer?.label ??
    configs.get(source.environmentId)?.environment.label ??
    "Original computer";
  const destinationLabel =
    environments.find((computer) => computer.environmentId === destination?.environmentId)?.label ??
    "Saved computer";
  const sourceAllowed = useAtomValue(handoff.offer.permissionAtom(source.environmentId));
  const destinationAllowed = useAtomValue(
    handoff.prepare.permissionAtom(destination?.environmentId ?? source.environmentId),
  );
  const sourceBusy =
    state.sourceResult === null &&
    (sourceShell?.runtime?.activeRunId != null ||
      threadRuntimeIsActive(sourceShell?.runtime) ||
      (sourceShell?.pendingBackgroundTasks.length ?? 0) > 0 ||
      sourceShell?.source.pendingRuntimeRequest != null);
  const sourceConnected =
    sourceComputer?.entry.enabled && sourceComputer.connection.phase === "connected";
  const sourceSupported = supportsLoomFeature(
    sourceComputer?.serverConfig?.environment.capabilities ??
      configs.get(source.environmentId)?.environment.capabilities,
    FEATURE,
  );
  const sourceReady =
    sourceShell !== null &&
    sourceShell.archivedAt === null &&
    sourceShell.deletedAt === null &&
    sourceConnected &&
    sourceSupported &&
    !sourceBusy;
  const destinationConnected =
    destinationComputer?.entry.enabled && destinationComputer.connection.phase === "connected";
  const destinationSupported = supportsLoomFeature(
    destinationComputer?.serverConfig?.environment.capabilities ??
      (destination ? configs.get(destination.environmentId)?.environment.capabilities : undefined),
    FEATURE,
  );
  const allowed =
    (state.sourceResult !== null || (sourceAllowed && sourceReady)) &&
    destinationAllowed &&
    destinationConnected &&
    destinationSupported;
  const canStartNew =
    sourceAllowed &&
    sourceReady &&
    !state.sourceResult?.sourceSettled &&
    sourceShell?.settledOverride !== "settled";
  const blockedReason =
    state.phase === "done" || running
      ? null
      : sourceBusy
        ? "Finish the current turn and stop background work before moving work."
        : state.sourceResult === null &&
            (sourceShell?.archivedAt != null || sourceShell?.deletedAt != null)
          ? "Restore the original conversation before moving work."
          : state.sourceResult === null && !sourceConnected
            ? `Reconnect ${sourceLabel} to move work.`
            : state.sourceResult === null && !sourceSupported
              ? `Update Loom on ${sourceLabel} to move work.`
              : state.sourceResult === null && sourceShell === null
                ? "The original conversation is unavailable. Reconnect its computer."
                : state.sourceResult === null && !sourceAllowed
                  ? "Workspace permission is required on the original computer."
                  : destination && !destinationConnected
                    ? `Reconnect ${destinationLabel} to finish the move.`
                    : destination && !destinationSupported
                      ? `Update Loom on ${destinationLabel} to finish the move.`
                      : destination && !destinationAllowed
                        ? "Workspace permission is required on the destination computer."
                        : null;
  const locked = running || state.offer !== null;
  const go = async () => {
    if (!destination || running || !allowed) return;
    setRunning(true);
    const destinationKey = state.destinationKey || selected?.key || "";
    useWorkspaceHandoff.setState({ error: null, destinationKey });
    try {
      await runWorkspaceHandoff({
        attempt: {
          offer: state.offer,
          receipt: state.receipt,
          sourceResult: state.sourceResult,
        },
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
            : "The move could not finish. Retry when the other computer is available.",
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
  const manageComputers = () => {
    useWorkspaceHandoff.setState({ open: false });
    void navigate({ to: "/computers" });
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
          <DialogTitle>Move work</DialogTitle>
          <DialogDescription>
            Start a conversation with your recent context on another computer. Your original history
            and attachments stay here.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-1 text-sm">
            <p className="break-words font-medium">
              {state.offer?.title ?? sourceShell?.title ?? "This conversation"}
            </p>
            <p className="text-muted-foreground">
              From {sourceLabel}
              {(state.offer?.branch ?? sourceShell?.branch)
                ? ` on ${state.offer?.branch ?? sourceShell?.branch}`
                : ""}
            </p>
          </div>
          {state.receipt ? (
            <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <p className="font-medium">To {destinationLabel}</p>
              <p className="text-muted-foreground">
                {state.phase === "done"
                  ? "Your conversation is ready to open."
                  : "Your prepared conversation is saved. Retry to finish this move."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p id="handoff-destination-label" className="text-sm font-medium">
                Move to
              </p>
              {!isReady ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading computers…
                </p>
              ) : groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Connect another computer to move work there.
                </p>
              ) : (
                <RadioGroup
                  aria-labelledby="handoff-destination-label"
                  value={selected?.key ?? ""}
                  onValueChange={(value) => {
                    if (typeof value === "string")
                      useWorkspaceHandoff.setState({ destinationKey: value });
                  }}
                >
                  {groups.map((group) => (
                    <DestinationComputer
                      key={group.environmentId}
                      group={group}
                      selectedKey={selected?.key}
                      locked={locked}
                    />
                  ))}
                </RadioGroup>
              )}
              {state.destinationKey && !selected && !state.receipt && (
                <p role="status" className="text-sm text-muted-foreground">
                  The selected destination is unavailable. Reconnect it, or start over to choose
                  another computer.
                </p>
              )}
            </div>
          )}
          {blockedReason && (
            <p role="status" className="text-sm text-muted-foreground">
              {blockedReason}
            </p>
          )}
          {(running || state.phase === "done") && (
            <p role="status" className="text-sm">
              {state.phase === "idle" ? "Move work" : WORKSPACE_HANDOFF_LABELS[state.phase]}
            </p>
          )}
          {state.error && (
            <p role="alert" className="break-words text-sm text-destructive-foreground">
              {state.error}
            </p>
          )}
          {state.sourceResult && !state.sourceResult.sourceSettled && (
            <p className="text-sm text-muted-foreground">
              The original conversation stays active. Its local data is preserved.
            </p>
          )}
          {state.error && state.sourceResult?.sourceSettled && (
            <p className="text-sm text-muted-foreground">
              Your original conversation is already settled. Finish the move to start the saved
              conversation on {destinationLabel}.
            </p>
          )}
          {state.phase !== "done" && !state.sourceResult && !running && (
            <p className="text-xs text-muted-foreground">
              Commit and push your changes first. Loom checks the new workspace before settling this
              conversation.
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          {!running && (
            <Button variant="ghost" onClick={manageComputers}>
              Manage computers
            </Button>
          )}
          {state.receipt && state.phase !== "done" && (
            <Button variant="outline" onClick={openDestination} disabled={running}>
              Open saved conversation
            </Button>
          )}
          {((state.phase === "idle" && state.destinationKey && !selected && !state.receipt) ||
            (state.error && !state.sourceResult?.sourceSettled) ||
            (state.phase === "done" && canStartNew)) && (
            <Button
              variant="outline"
              disabled={running}
              onClick={() =>
                useWorkspaceHandoff.setState({
                  requestId: randomUUID(),
                  destinationKey: "",
                  offer: null,
                  receipt: null,
                  sourceResult: null,
                  error: null,
                  phase: "idle",
                })
              }
            >
              {state.phase === "done" ? "Move again" : "Start over"}
            </Button>
          )}
          {state.phase !== "done" ? (
            <Button onClick={() => void go()} disabled={running || !destination || !allowed}>
              {running
                ? state.phase === "idle"
                  ? "Move work"
                  : WORKSPACE_HANDOFF_LABELS[state.phase]
                : state.sourceResult
                  ? "Finish move"
                  : state.error
                    ? "Retry move"
                    : "Move work"}
            </Button>
          ) : (
            <Button onClick={openDestination}>Open conversation</Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
export function WorkspaceHandoffHost() {
  const source = useWorkspaceHandoff((state) => state.source);
  return source === null ? null : (
    <HandoffContent key={`${source.environmentId}/${source.threadId}`} />
  );
}
