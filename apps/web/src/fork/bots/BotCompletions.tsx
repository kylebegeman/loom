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
import {
  ArrowUpRightIcon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react";
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
import {
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
  LibrarySection,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
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

export function GrokCompanionPanel() {
  const host = useBotsHost();
  const environmentId = host.environmentId;
  if (!environmentId || !host.completionsSupported) return null;
  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Grok companion</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Keep your chief Bot informed when Loom finishes a job. Each project has its own
            destinations, and each run chooses whether to send a result.
          </p>
        </div>
        <Button
          variant="outline"
          shape="pill"
          size="sm"
          render={<a href={GROK_ROUTINE_GUIDE} target="_blank" rel="noreferrer" />}
        >
          Setup guide <ArrowUpRightIcon />
        </Button>
      </header>
      <CompletionManagement environmentId={environmentId} />
    </div>
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
  const visibleDestinations =
    destinations.data?.destinations.filter((destination) => destination.deletedAt === null) ?? [];
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
    <div className="grid gap-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full sm:max-w-sm">
          {projects.length ? (
            <LibraryField label="Project">
              <Select
                value={projectId ?? ""}
                disabled={busy}
                onValueChange={(value) => setProject(value ?? "")}
              >
                <SelectTrigger size="sm">
                  <SelectValue>
                    {projects.find((project) => project.id === projectId)?.title ??
                      "Choose a project"}
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
              Add a project on this computer to configure result delivery.
            </p>
          )}
        </div>
        <Button
          shape="pill"
          size="sm"
          variant="outline"
          disabled={!connected || busy}
          onClick={refresh}
        >
          <RefreshCwIcon /> Refresh deliveries
        </Button>
      </div>
      {!connected ? (
        <LibraryNotice icon={PlugZapIcon}>
          Reconnect this computer to update destinations or delivery status.
        </LibraryNotice>
      ) : null}
      <LibraryErrorNotice
        error={error ?? destinations.error ?? deliveries.error}
        onRetry={refresh}
      />
      <div className="grid items-start gap-8 xl:grid-cols-2">
        <LibrarySection
          title="Completion destinations"
          icon={PlugZapIcon}
          count={visibleDestinations.length}
        >
          {destinations.isPending && !destinations.data ? (
            <p className="py-4 text-sm text-muted-foreground">Loading destinations…</p>
          ) : visibleDestinations.length === 0 && projectId && !destinations.error ? (
            <div className="space-y-1 rounded-xl bg-muted/25 p-5">
              <p className="text-sm font-medium">Connect a Grok routine</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Create a webhook routine in Grok, then add its private address and key below.
              </p>
            </div>
          ) : null}
          {visibleDestinations.length ? (
            <div className="divide-y divide-border/60 rounded-xl border border-border/60 px-4">
              {visibleDestinations.map((destination) => (
                <div key={destination.id} className="grid gap-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="min-w-0 text-sm font-medium wrap-anywhere">
                      {destination.label}
                    </h3>
                    <LibraryStateBadge tone={destination.enabled ? "success" : "neutral"}>
                      {destination.enabled ? "Enabled" : "Disabled"}
                    </LibraryStateBadge>
                  </div>
                  <p className="text-xs text-muted-foreground">{destination.host}</p>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0 text-xs text-muted-foreground wrap-anywhere">
                      {destination.id}
                    </span>
                    <div className="flex gap-1.5">
                      <Button
                        shape="pill"
                        size="xs"
                        variant="outline"
                        disabled={busy || !connected || !canEnable}
                        onClick={() => void toggle(destination)}
                      >
                        {destination.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        shape="pill"
                        size="xs"
                        variant="destructive-outline"
                        disabled={busy || !connected || !canRemove}
                        onClick={() => void removeDestination(destination)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Disable to hold pending deliveries. Remove to cancel unsent deliveries and delete saved
            credentials. Delivery history remains.
          </p>
          {canConfigure ? (
            <details className="group rounded-xl bg-muted/20 p-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <PlusIcon aria-hidden className="size-4" /> Add a destination
              </summary>
              <form
                autoComplete="off"
                className="mt-5 grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                  <LibraryField label="Name">
                    <Input
                      disabled={busy}
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      required
                      maxLength={120}
                    />
                  </LibraryField>
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
                </div>
                <LibraryField label="Private routine URL">
                  <Input
                    disabled={busy}
                    type="password"
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
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
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    required
                  />
                </LibraryField>
                <div className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <ShieldCheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <p>
                    Saved addresses and keys stay private. Use a new identifier when replacing
                    credentials.
                  </p>
                </div>
                <div>
                  <Button
                    type="submit"
                    shape="pill"
                    size="sm"
                    disabled={!projectId || !connected || busy || !url || !key}
                  >
                    {busy ? "Saving…" : "Save destination"}
                  </Button>
                </div>
              </form>
            </details>
          ) : null}
        </LibrarySection>
        <LibrarySection
          title="Delivery history"
          icon={SendIcon}
          count={deliveries.data?.deliveries.length}
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Accepted means Grok received the routine request. Confirm an outcome after checking its
            work in Grok. Refresh to see the latest state.
          </p>
          {deliveries.isPending && !deliveries.data ? (
            <p className="py-4 text-sm text-muted-foreground">Loading deliveries…</p>
          ) : deliveries.data?.deliveries.length === 0 ? (
            <div className="space-y-1 rounded-xl bg-muted/25 p-5">
              <p className="text-sm font-medium">Results will appear here</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Choose an enabled destination when starting a bot, batch or pipeline in this
                project.
              </p>
            </div>
          ) : null}
          <div className="divide-y divide-border/60">
            {deliveries.data?.deliveries.map((delivery) => (
              <article key={delivery.id} className="grid gap-3 py-4 first:pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <LibraryStateBadge
                    tone={
                      delivery.receiverOutcome === "completed"
                        ? "success"
                        : delivery.receiverOutcome === "failed" || delivery.status === "failed"
                          ? "danger"
                          : delivery.status === "needs_attention"
                            ? "warning"
                            : delivery.status === "accepted"
                              ? "active"
                              : "neutral"
                    }
                  >
                    {botCompletionDeliveryLabel(delivery)}
                  </LibraryStateBadge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {visibleDestinations.find(
                      (destination) => destination.id === delivery.destinationId,
                    )?.label ?? delivery.destinationId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="capitalize">{delivery.kind}</span> result{" "}
                    <span className="wrap-anywhere">{delivery.jobId}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={delivery.updatedAt}>
                      {new Date(delivery.updatedAt).toLocaleString()}
                    </time>
                    {" · "}
                    {delivery.attempts} {delivery.attempts === 1 ? "attempt" : "attempts"}
                  </p>
                </div>
                {delivery.reason ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {delivery.reason === "outcome_unknown"
                      ? "Check Grok before confirming this outcome. Loom will not send it again automatically."
                      : delivery.reason.replaceAll("_", " ")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    shape="pill"
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
                  (delivery.status === "accepted" ||
                    (delivery.status === "needs_attention" &&
                      delivery.reason === "outcome_unknown")) ? (
                    <>
                      <Button
                        shape="pill"
                        size="xs"
                        variant="outline"
                        disabled={busy || !connected}
                        onClick={() => void recordOutcome(delivery, "completed")}
                      >
                        Confirm Grok completed
                      </Button>
                      <Button
                        shape="pill"
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
              </article>
            ))}
          </div>
        </LibrarySection>
      </div>
    </div>
  );
}
