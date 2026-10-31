import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  BOTS_COMPLETIONS_FEATURE,
  type BotCompletionDestination,
  type BotCompletionDelivery,
} from "@t3tools/contracts/fork";
import {
  botCompletionDeliveryLabel,
  GROK_ROUTINE_GUIDE,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Redacted from "effect/Redacted";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useEnvironment } from "~/state/environments";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryErrorNotice, LibraryField } from "../project-library/LibraryControls";
import { bots, useBotsHost, useRefreshOnReconnect } from "./state";

const failureText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The completion request failed.";

export function useBotCompletionSelection(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
  initialDestinationId = "",
) {
  const host = useEnvironment(environmentId);
  const supported = supportsLoomFeature(
    host?.serverConfig?.environment.capabilities,
    BOTS_COMPLETIONS_FEATURE,
  );
  const query = useEnvironmentQuery(
    supported && projectId
      ? bots.completionDestinations({ environmentId, input: { projectId } })
      : null,
  );
  const [choice, setChoice] = useState<{ projectId: ProjectId | null; id: string }>({
    projectId,
    id: initialDestinationId,
  });
  const value = choice.projectId === projectId ? choice.id : "";
  const destinations =
    query.data?.destinations.filter(
      (destination) =>
        destination.projectId === projectId &&
        destination.enabled &&
        destination.deletedAt === null,
    ) ?? [];
  const valid = value === "" || destinations.some((destination) => destination.id === value);
  return {
    supported,
    projectId,
    query,
    destinations,
    value,
    destinationId: value || undefined,
    valid,
    select: (id: string) => setChoice({ projectId, id }),
    reset: (nextProjectId: ProjectId | null, id: string) =>
      setChoice({ projectId: nextProjectId, id }),
  };
}

export function BotCompletionField({
  selection,
  disabled = false,
}: {
  readonly selection: ReturnType<typeof useBotCompletionSelection>;
  readonly disabled?: boolean;
}) {
  if (!selection.supported) return null;
  if (!selection.projectId)
    return (
      <p className="text-xs text-muted-foreground">
        Completion delivery requires a job bound to one project.
      </p>
    );
  return (
    <div className="grid gap-2">
      <LibraryField label="Send completion to Grok Bot (optional)">
        <Select
          value={selection.value}
          disabled={disabled || selection.query.isPending}
          onValueChange={(value) => selection.select(value ?? "")}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {selection.value
                ? (selection.destinations.find((destination) => destination.id === selection.value)
                    ?.label ?? "Destination unavailable")
                : "Keep the result in Loom"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">Keep the result in Loom</SelectItem>
            {selection.destinations.map((destination) => (
              <SelectItem key={destination.id} value={destination.id}>
                {destination.label} · {destination.host}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LibraryField>
      <p className="text-xs text-muted-foreground">
        Only enabled destinations for this project are offered. Grok receiving a callback does not
        mean its follow-up work is finished.
      </p>
      {!selection.query.isPending &&
      !selection.query.error &&
      selection.destinations.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Add a destination under Bots → Grok companion first.
        </p>
      ) : null}
      <LibraryErrorNotice
        error={
          selection.query.error ??
          (!selection.valid
            ? "The selected destination is unavailable. Choose another destination or keep the result in Loom."
            : null)
        }
        onRetry={selection.query.refresh}
      />
    </div>
  );
}

export function GrokCompanionSection() {
  const host = useBotsHost();
  const environmentId = host.environmentId;
  const [open, setOpen] = useState(false);
  if (!environmentId || !host.completionsSupported) return null;
  return (
    <section className="grid gap-3 rounded-xl border border-border p-4" aria-label="Grok companion">
      <div className="grid gap-1">
        <h2 className="text-sm font-medium">Grok companion</h2>
        <p className="text-xs text-muted-foreground">
          Grok Bot coordinates hosted work beside Loom. Grok Build remains a separate coding
          provider.
        </p>
      </div>
      <details
        className="grid gap-3"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm">
          Completion destinations and delivery history
        </summary>
        <div className="pt-4">
          {open ? <CompletionManagement environmentId={environmentId} /> : null}
        </div>
      </details>
    </section>
  );
}

function CompletionManagement({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const host = useEnvironment(environmentId);
  const connected = host?.connection.phase === "connected";
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [chosenProject, setProject] = useState<string>(projects[0]?.id ?? "");
  const projectId = projects.find((project) => project.id === chosenProject)?.id ?? null;
  const destinations = useEnvironmentQuery(
    projectId ? bots.completionDestinations({ environmentId, input: { projectId } }) : null,
  );
  const deliveries = useEnvironmentQuery(
    projectId ? bots.completionDeliveries({ environmentId, input: { projectId } }) : null,
  );
  useRefreshOnReconnect(connected, destinations.refresh);
  useRefreshOnReconnect(connected, deliveries.refresh);
  const configure = useAtomCommand(bots.completionConfigure, { reportFailure: false });
  const setEnabled = useAtomCommand(bots.completionSetEnabled, { reportFailure: false });
  const remove = useAtomCommand(bots.completionRemove, { reportFailure: false });
  const acknowledge = useAtomCommand(bots.completionAcknowledge, { reportFailure: false });
  const canConfigure = useAtomValue(bots.completionConfigure.permissionAtom(environmentId));
  const canEnable = useAtomValue(bots.completionSetEnabled.permissionAtom(environmentId));
  const canRemove = useAtomValue(bots.completionRemove.permissionAtom(environmentId));
  const canAcknowledge = useAtomValue(bots.completionAcknowledge.permissionAtom(environmentId));
  const [id, setId] = useState("grok-companion");
  const [label, setLabel] = useState("Grok companion");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    destinations.refresh();
    deliveries.refresh();
  };
  const save = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    const result = await configure({
      environmentId,
      input: {
        id,
        label,
        projectId,
        url: Redacted.make(url),
        key: Redacted.make(key),
        enabled: true,
      },
    });
    if (result._tag === "Failure") setError(failureText(squashAtomCommandFailure(result)));
    else {
      setUrl("");
      setKey("");
      refresh();
    }
    setBusy(false);
  };
  const toggle = async (destination: BotCompletionDestination) => {
    setBusy(true);
    setError(null);
    const result = await setEnabled({
      environmentId,
      input: { id: destination.id, enabled: !destination.enabled },
    });
    if (result._tag === "Failure") setError(failureText(squashAtomCommandFailure(result)));
    else refresh();
    setBusy(false);
  };
  const removeDestination = async (destination: BotCompletionDestination) => {
    setBusy(true);
    setError(null);
    const result = await remove({ environmentId, input: { id: destination.id } });
    if (result._tag === "Failure") setError(failureText(squashAtomCommandFailure(result)));
    else refresh();
    setBusy(false);
  };
  const recordOutcome = async (
    delivery: BotCompletionDelivery,
    outcome: "completed" | "failed",
  ) => {
    setBusy(true);
    setError(null);
    const result = await acknowledge({
      environmentId,
      input: { deliveryId: delivery.id, projectId: delivery.projectId, outcome },
    });
    if (result._tag === "Failure") setError(failureText(squashAtomCommandFailure(result)));
    else refresh();
    setBusy(false);
  };
  return (
    <div className="grid gap-5">
      <p className="text-xs text-muted-foreground">
        Create a webhook routine in Grok, then save its URL and key here. The destination belongs to
        one project. Each job chooses whether to send its completion.{" "}
        <a
          href={GROK_ROUTINE_GUIDE}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Grok routines guide
        </a>
      </p>
      {projects.length ? (
        <LibraryField label="Project">
          <Select
            value={projectId ?? ""}
            disabled={busy}
            onValueChange={(value) => setProject(value ?? "")}
          >
            <SelectTrigger size="sm">
              <SelectValue>
                {projects.find((project) => project.id === projectId)?.title ?? "Choose a project"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LibraryField>
      ) : (
        <p className="text-sm text-muted-foreground">
          Add a project on this computer before configuring completion delivery.
        </p>
      )}
      {!connected ? (
        <p className="text-sm text-muted-foreground">
          Reconnect this computer to change destinations or refresh delivery status.
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={!connected || busy} onClick={refresh}>
          Refresh deliveries
        </Button>
      </div>
      <LibraryErrorNotice
        error={error ?? destinations.error ?? deliveries.error}
        onRetry={refresh}
      />
      {destinations.isPending && !destinations.data ? (
        <p className="text-xs text-muted-foreground">Loading destinations…</p>
      ) : null}
      {destinations.data?.destinations
        .filter((destination) => destination.deletedAt === null)
        .map((destination) => (
          <div
            key={destination.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{destination.label}</p>
              <p className="text-xs text-muted-foreground">
                {destination.host} · {destination.enabled ? "Enabled" : "Disabled"} ·{" "}
                {destination.id}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={busy || !connected || !canEnable}
                onClick={() => void toggle(destination)}
              >
                {destination.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={busy || !connected || !canRemove}
                onClick={() => void removeDestination(destination)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      {destinations.data?.destinations.filter((destination) => destination.deletedAt === null)
        .length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No completion destination for this project yet.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Disabling holds pending deliveries. Removing a destination cancels its pending deliveries
        and removes its credentials; history remains.
      </p>
      {canConfigure ? (
        <details>
          <summary className="cursor-pointer text-sm">Add a completion destination</summary>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <LibraryField label="Identifier">
              <Input
                disabled={busy}
                value={id}
                onChange={(event) => setId(event.target.value)}
                required
                pattern="[a-z0-9][a-z0-9-]{0,63}"
                autoComplete="off"
              />
            </LibraryField>
            <LibraryField label="Label">
              <Input
                disabled={busy}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
                maxLength={120}
              />
            </LibraryField>
            <LibraryField label="Grok routine URL">
              <Input
                disabled={busy}
                type="password"
                autoComplete="new-password"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </LibraryField>
            <LibraryField label="Webhook key">
              <Input
                disabled={busy}
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required
              />
            </LibraryField>
            <p className="text-xs text-muted-foreground">
              Saved URLs and keys are never shown. To replace credentials, create a destination with
              a new identifier.
            </p>
            <div>
              <Button
                type="submit"
                size="sm"
                disabled={!projectId || !connected || busy || !url || !key}
              >
                Save destination
              </Button>
            </div>
          </form>
        </details>
      ) : null}
      <div className="grid gap-3">
        <h3 className="text-sm font-medium">Recent deliveries</h3>
        <p className="text-xs text-muted-foreground">
          This is a snapshot. Refresh to check progress. Accepted means Grok received the routine
          request; only an acknowledged outcome confirms its follow-up work. If the outcome is
          unknown, check Grok before recording it.
        </p>
        {deliveries.isPending && !deliveries.data ? (
          <p className="text-xs text-muted-foreground">Loading deliveries…</p>
        ) : deliveries.data?.deliveries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No completion deliveries for this project yet.
          </p>
        ) : null}
        {deliveries.data?.deliveries.map((delivery) => (
          <div key={delivery.id} className="grid gap-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{botCompletionDeliveryLabel(delivery)}</p>
            <p className="text-xs text-muted-foreground">
              {delivery.kind} · {delivery.jobId} · {delivery.attempts} attempts ·{" "}
              {new Date(delivery.updatedAt).toLocaleString()}
            </p>
            {delivery.reason ? (
              <p className="text-xs text-muted-foreground">{delivery.reason}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="outline"
                render={
                  <Link
                    to="/loom/bots"
                    search={
                      delivery.kind === "run"
                        ? { runId: delivery.jobId }
                        : delivery.kind === "batch"
                          ? { batch: delivery.jobId }
                          : { pipelineRun: delivery.jobId }
                    }
                  />
                }
              >
                Open job
              </Button>
              {canAcknowledge &&
              (delivery.status === "accepted" || delivery.status === "needs_attention") ? (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || !connected}
                    onClick={() => void recordOutcome(delivery, "completed")}
                  >
                    Confirm Grok completed
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || !connected}
                    onClick={() => void recordOutcome(delivery, "failed")}
                  >
                    Confirm Grok failed
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
