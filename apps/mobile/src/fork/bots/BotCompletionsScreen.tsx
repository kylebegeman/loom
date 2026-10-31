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
import { RowPressable } from "../../components/ui/RowPressable";
import { SymbolView } from "../../components/ui/AppSymbol";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotInput, BotNotice, BotPage, BotSection } from "./BotControls";
import { bots, useBotsCapabilities, useBotsReconnect } from "./state";
import { BotsOutline, BotsSection } from "./BotIdentity";

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
          Add a destination in Bots → Grok companion first.
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
  const [projectOpen, setProjectOpen] = useState(false);
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
      <View className="gap-2">
        <Text accessibilityRole="header" className="text-2xl font-t3-semibold">
          Keep Grok in the loop
        </Text>
        <Text className="text-sm text-foreground-muted">
          Send job results to your chief Bot and track delivery here. Each job chooses whether to
          send a result.
        </Text>
      </View>
      {!host.completionsSupported ? (
        <Text>Update this computer to manage completion destinations.</Text>
      ) : (
        <>
          {projects.length ? (
            <BotsOutline>
              <RowPressable
                accessibilityRole="button"
                accessibilityLabel={`Project: ${projects.find((entry) => entry.id === projectId)?.title ?? "Choose a project"}`}
                accessibilityState={{ expanded: projectOpen, disabled: busy }}
                disabled={busy}
                onPress={() => setProjectOpen(!projectOpen)}
                className="min-h-16 flex-row items-center gap-3 p-4"
              >
                <SymbolView name="folder" size={21} tintColorClassName="accent-icon-muted" />
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-xs text-foreground-muted">Project</Text>
                  <Text className="text-sm font-t3-medium">
                    {projects.find((entry) => entry.id === projectId)?.title ?? "Choose a project"}
                  </Text>
                </View>
                <SymbolView
                  name={projectOpen ? "chevron.up" : "chevron.down"}
                  size={12}
                  tintColorClassName="accent-icon-muted"
                />
              </RowPressable>
              {projectOpen ? (
                <View className="border-t border-border-subtle p-4">
                  <BotChoice
                    label="Choose a project"
                    value={projectId ?? ""}
                    options={projects.map((project) => ({
                      value: project.id,
                      label: project.title,
                    }))}
                    disabled={busy}
                    onChange={(value) => {
                      setProject(value);
                      setProjectOpen(false);
                    }}
                  />
                </View>
              ) : null}
            </BotsOutline>
          ) : (
            <Text>Add a project on this computer before configuring completion delivery.</Text>
          )}
          {!host.connected ? (
            <Text>Reconnect {host.label} to change destinations or refresh delivery status.</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Refresh deliveries"
              icon="arrow.clockwise"
              tone="text"
              disabled={!host.connected || busy}
              onPress={refresh}
            />
            <Button
              label="Setup guide"
              icon="arrow.up.right"
              tone="text"
              onPress={() =>
                void Linking.openURL(GROK_ROUTINE_GUIDE).catch(() =>
                  setError("Could not open the Grok routines guide."),
                )
              }
            />
          </View>
          <BotNotice
            error={error ?? destinations.error ?? deliveries.error}
            {...(error || destinations.error || deliveries.error ? { onRetry: refresh } : {})}
          />
          <BotsSection title="Completion destinations">
            <BotsOutline>
              {destinations.isPending && !destinations.data ? (
                <Text>Loading destinations…</Text>
              ) : null}
              {destinations.data?.destinations.filter(
                (destination) => destination.deletedAt === null,
              ).length === 0 ? (
                <View className="gap-1 p-4">
                  <Text className="text-sm font-t3-medium">Connect your chief Bot</Text>
                  <Text className="text-sm text-foreground-muted">
                    Create a webhook routine in Grok, then add its private URL and key here.
                  </Text>
                </View>
              ) : null}
              {destinations.data?.destinations
                .filter((destination) => destination.deletedAt === null)
                .map((destination, index) => (
                  <View
                    key={destination.id}
                    className={index > 0 ? "gap-3 border-t border-border-subtle p-4" : "gap-3 p-4"}
                  >
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="min-w-0 flex-1 gap-1">
                        <Text className="font-t3-medium">{destination.label}</Text>
                        <Text className="text-xs text-foreground-muted">{destination.host}</Text>
                      </View>
                      <LibraryStateBadge
                        tone={destination.enabled ? "success" : "neutral"}
                        label={destination.enabled ? "Enabled" : "Disabled"}
                      />
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                      <Button
                        label={destination.enabled ? "Disable" : "Enable"}
                        tone="text"
                        disabled={!host.connected || busy || !canEnable}
                        onPress={() => void toggle(destination)}
                      />
                      <RowPressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${destination.label}`}
                        accessibilityState={{ disabled: !host.connected || busy || !canRemove }}
                        disabled={!host.connected || busy || !canRemove}
                        onPress={() => void removeDestination(destination)}
                        className="min-h-12 items-center justify-center self-start rounded-full px-4 active:opacity-70"
                      >
                        <Text className="text-sm font-t3-medium text-danger-foreground">
                          Remove
                        </Text>
                      </RowPressable>
                    </View>
                  </View>
                ))}
            </BotsOutline>
            <Text className="text-xs text-foreground-muted">
              Disable to hold pending deliveries. Removing a destination removes its credentials;
              recorded history remains.
            </Text>
          </BotsSection>
          {canConfigure ? (
            <View className="gap-4">
              <Button
                label={adding ? "Close destination form" : "Add completion destination"}
                icon={adding ? "xmark" : "plus"}
                disabled={busy}
                onPress={() => setAdding(!adding)}
              />
              {adding ? (
                <BotSection title="Private routine details">
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
                    tone="primary"
                    disabled={
                      !projectId || !host.connected || busy || !id || !label || !url || !key
                    }
                    onPress={() => void save()}
                  />
                </BotSection>
              ) : null}
            </View>
          ) : null}
          <BotsSection title="Recent deliveries">
            <Text className="text-xs text-foreground-muted">
              Refresh to check progress. Accepted means Grok received the request; a confirmed
              outcome records its follow-up work. Check Grok before recording an unknown outcome.
            </Text>
            <BotsOutline>
              {deliveries.isPending && !deliveries.data ? (
                <Text>Loading deliveries…</Text>
              ) : deliveries.data?.deliveries.length === 0 ? (
                <Text className="p-4 text-sm text-foreground-muted">
                  No results sent yet. Choose this destination when starting a project job.
                </Text>
              ) : null}
              {deliveries.data?.deliveries.map((delivery, index) => (
                <View
                  key={delivery.id}
                  className={index > 0 ? "gap-3 border-t border-border-subtle p-4" : "gap-3 p-4"}
                >
                  <Text className="text-sm font-t3-medium">
                    {botCompletionDeliveryLabel(delivery)}
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    {delivery.kind === "run"
                      ? "Bot run"
                      : delivery.kind === "batch"
                        ? "Batch"
                        : "Pipeline"}{" "}
                    · {new Date(delivery.updatedAt).toLocaleString()} · {delivery.attempts}{" "}
                    {delivery.attempts === 1 ? "attempt" : "attempts"}
                  </Text>
                  {delivery.reason ? (
                    <Text className="text-xs text-foreground-muted">{delivery.reason}</Text>
                  ) : null}
                  <Button label="Open job" tone="text" onPress={() => openJob(delivery)} />
                  {canAcknowledge &&
                  (delivery.status === "accepted" ||
                    (delivery.status === "needs_attention" &&
                      delivery.reason === "outcome_unknown")) ? (
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
            </BotsOutline>
          </BotsSection>
          <Text className="text-xs text-foreground-muted">
            Grok Bot coordinates hosted work. Grok Build is the separate coding provider in Loom.
          </Text>
        </>
      )}
    </BotPage>
  );
}
