import { useState } from "react";
import { Linking, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, type ProjectId } from "@t3tools/contracts";
import type { BotCompletionDestination, BotCompletionDelivery } from "@t3tools/contracts/fork";
import { botCompletionDeliveryLabel, GROK_ROUTINE_GUIDE } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Redacted from "effect/Redacted";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotInput, BotNotice, BotPage, BotSection } from "./BotControls";
import { bots, useBotsCapabilities, useBotsReconnect } from "./state";

const failureText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The completion request failed.";

export function useBotCompletionSelection(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
  initialDestinationId = "",
) {
  const host = useBotsCapabilities(environmentId);
  const query = useEnvironmentQuery(
    host.completionsSupported && projectId
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
  return {
    supported: host.completionsSupported,
    projectId,
    query,
    destinations,
    value,
    destinationId: value || undefined,
    valid: value === "" || destinations.some((destination) => destination.id === value),
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
      <Text className="text-xs text-foreground-muted">
        Completion delivery requires a job bound to one project.
      </Text>
    );
  return (
    <View className="gap-2">
      <BotChoice
        label="Send completion to Grok Bot (optional)"
        value={selection.value}
        options={[
          { value: "", label: "Keep the result in Loom" },
          ...selection.destinations.map((destination) => ({
            value: destination.id,
            label: destination.label,
            description: destination.host,
          })),
        ]}
        disabled={disabled || selection.query.isPending}
        onChange={selection.select}
      />
      <Text className="text-xs text-foreground-muted">
        Only enabled destinations for this project are offered. Grok receiving a callback does not
        mean its follow-up work is finished.
      </Text>
      {!selection.query.isPending &&
      !selection.query.error &&
      selection.destinations.length === 0 ? (
        <Text className="text-xs text-foreground-muted">
          Add a destination from the Bots tools menu under Grok companion first.
        </Text>
      ) : null}
      <BotNotice
        error={
          selection.query.error ??
          (!selection.valid
            ? "The selected destination is unavailable. Choose another destination or keep the result in Loom."
            : null)
        }
        {...(selection.query.error ? { onRetry: selection.query.refresh } : {})}
      />
    </View>
  );
}

export function BotCompletionsRouteScreen({ route }: StaticScreenProps<{ environmentId: string }>) {
  return (
    <CompletionManagement
      key={route.params.environmentId}
      environmentId={EnvironmentId.make(route.params.environmentId)}
    />
  );
}

function CompletionManagement({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigation = useNavigation();
  const host = useBotsCapabilities(environmentId);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [chosenProject, setProject] = useState<string>(projects[0]?.id ?? "");
  const projectId = projects.find((project) => project.id === chosenProject)?.id ?? null;
  const destinations = useEnvironmentQuery(
    host.completionsSupported && projectId
      ? bots.completionDestinations({ environmentId, input: { projectId } })
      : null,
  );
  const deliveries = useEnvironmentQuery(
    host.completionsSupported && projectId
      ? bots.completionDeliveries({ environmentId, input: { projectId } })
      : null,
  );
  useBotsReconnect(host.connected, destinations.refresh);
  useBotsReconnect(host.connected, deliveries.refresh);
  const configure = useAtomCommand(bots.completionConfigure, { reportFailure: false });
  const setEnabled = useAtomCommand(bots.completionSetEnabled, { reportFailure: false });
  const remove = useAtomCommand(bots.completionRemove, { reportFailure: false });
  const acknowledge = useAtomCommand(bots.completionAcknowledge, { reportFailure: false });
  const canConfigure = useAtomValue(bots.completionConfigure.permissionAtom(environmentId));
  const canEnable = useAtomValue(bots.completionSetEnabled.permissionAtom(environmentId));
  const canRemove = useAtomValue(bots.completionRemove.permissionAtom(environmentId));
  const canAcknowledge = useAtomValue(bots.completionAcknowledge.permissionAtom(environmentId));
  const [adding, setAdding] = useState(false);
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
      setAdding(false);
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
  const openJob = (delivery: BotCompletionDelivery) => {
    if (delivery.kind === "run")
      navigation.navigate("BotsRunDetail", { environmentId, runId: delivery.jobId });
    else if (delivery.kind === "batch")
      navigation.navigate("BotsBatches", { environmentId, batchId: delivery.jobId });
    else navigation.navigate("BotsPipelines", { environmentId, runId: delivery.jobId });
  };
  return (
    <BotPage title="Grok companion">
      <Text className="text-sm text-foreground-muted">
        Grok Bot coordinates hosted work beside Loom. Grok Build remains a separate coding provider.
        Create a webhook routine in Grok and save its URL and key here. Each job chooses whether to
        send its completion.
      </Text>
      <Button
        label="Grok routines guide"
        tone="text"
        onPress={() =>
          void Linking.openURL(GROK_ROUTINE_GUIDE).catch(() =>
            setError("Could not open the Grok routines guide."),
          )
        }
      />
      {!host.completionsSupported ? (
        <Text>Update this computer to manage completion destinations.</Text>
      ) : (
        <>
          {projects.length ? (
            <BotChoice
              label="Project"
              value={projectId ?? ""}
              options={projects.map((project) => ({ value: project.id, label: project.title }))}
              disabled={busy}
              onChange={setProject}
            />
          ) : (
            <Text>Add a project on this computer before configuring completion delivery.</Text>
          )}
          {!host.connected ? (
            <Text>Reconnect {host.label} to change destinations or refresh delivery status.</Text>
          ) : null}
          <Button label="Refresh deliveries" disabled={!host.connected || busy} onPress={refresh} />
          <BotNotice
            error={error ?? destinations.error ?? deliveries.error}
            {...(error || destinations.error || deliveries.error ? { onRetry: refresh } : {})}
          />
          <BotSection
            title="Completion destinations"
            description="Disabling holds pending deliveries. Removing a destination cancels pending deliveries and removes its credentials; history remains."
          >
            {destinations.isPending && !destinations.data ? (
              <Text>Loading destinations…</Text>
            ) : null}
            {destinations.data?.destinations.filter((destination) => destination.deletedAt === null)
              .length === 0 ? (
              <Text>No completion destination for this project yet.</Text>
            ) : null}
            {destinations.data?.destinations
              .filter((destination) => destination.deletedAt === null)
              .map((destination) => (
                <View
                  key={destination.id}
                  className="gap-2 rounded-xl border border-border-subtle p-3"
                >
                  <Text className="font-t3-medium">{destination.label}</Text>
                  <Text className="text-xs text-foreground-muted">
                    {destination.host} · {destination.enabled ? "Enabled" : "Disabled"} ·{" "}
                    {destination.id}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label={destination.enabled ? "Disable" : "Enable"}
                      disabled={!host.connected || busy || !canEnable}
                      onPress={() => void toggle(destination)}
                    />
                    <Button
                      label="Remove"
                      tone="danger"
                      disabled={!host.connected || busy || !canRemove}
                      onPress={() => void removeDestination(destination)}
                    />
                  </View>
                </View>
              ))}
          </BotSection>
          {canConfigure ? (
            <BotSection title="Add a destination">
              <Button
                label={adding ? "Close destination form" : "Add completion destination"}
                disabled={busy}
                onPress={() => setAdding(!adding)}
              />
              {adding ? (
                <>
                  <BotInput label="Identifier" value={id} onChangeText={setId} disabled={busy} />
                  <BotInput label="Label" value={label} onChangeText={setLabel} disabled={busy} />
                  <BotInput
                    label="Grok routine URL"
                    secureTextEntry
                    value={url}
                    onChangeText={setUrl}
                    disabled={busy}
                  />
                  <BotInput
                    label="Webhook key"
                    secureTextEntry
                    value={key}
                    onChangeText={setKey}
                    disabled={busy}
                  />
                  <Text className="text-xs text-foreground-muted">
                    Saved URLs and keys are never shown. To replace credentials, create a
                    destination with a new identifier.
                  </Text>
                  <Button
                    label="Save destination"
                    disabled={
                      !projectId || !host.connected || busy || !id || !label || !url || !key
                    }
                    onPress={() => void save()}
                  />
                </>
              ) : null}
            </BotSection>
          ) : null}
          <BotSection
            title="Recent deliveries"
            description="This is a snapshot. Refresh to check progress. Accepted means Grok received the routine request; an acknowledged outcome confirms follow-up work. If the outcome is unknown, check Grok before recording it."
          >
            {deliveries.isPending && !deliveries.data ? (
              <Text>Loading deliveries…</Text>
            ) : deliveries.data?.deliveries.length === 0 ? (
              <Text>No completion deliveries for this project yet.</Text>
            ) : null}
            {deliveries.data?.deliveries.map((delivery) => (
              <View key={delivery.id} className="gap-2 rounded-xl border border-border-subtle p-3">
                <Text className="font-t3-medium">{botCompletionDeliveryLabel(delivery)}</Text>
                <Text className="text-xs text-foreground-muted">
                  {delivery.kind} · {delivery.jobId} · {delivery.attempts} attempts ·{" "}
                  {new Date(delivery.updatedAt).toLocaleString()}
                </Text>
                {delivery.reason ? (
                  <Text className="text-xs text-foreground-muted">{delivery.reason}</Text>
                ) : null}
                <Button label="Open job" onPress={() => openJob(delivery)} />
                {canAcknowledge &&
                (delivery.status === "accepted" || delivery.status === "needs_attention") ? (
                  <>
                    <Button
                      label="Confirm Grok completed"
                      disabled={!host.connected || busy}
                      onPress={() => void recordOutcome(delivery, "completed")}
                    />
                    <Button
                      label="Confirm Grok failed"
                      disabled={!host.connected || busy}
                      onPress={() => void recordOutcome(delivery, "failed")}
                    />
                  </>
                ) : null}
              </View>
            ))}
          </BotSection>
        </>
      )}
    </BotPage>
  );
}
