import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Switch, View } from "react-native";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotParameter, BotTarget } from "@t3tools/contracts/fork";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotPage, BotNotice } from "./BotControls";
import { bots, useBotsCapabilities, useBotsCollection } from "./state";
import { useBotActionLifetime } from "./useBotActionLifetime";
import {
  checkoutChoices,
  commandValue,
  failureMessage,
  fixedProject,
  initialRunValues,
  needsProject,
  parameterInputs,
  runsInCheckout,
} from "./runLogic";

export function RunChoice({
  label,
  value,
  choices,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly choices: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly detail?: string;
    readonly disabled?: boolean;
  }>;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const selected = choices.find((choice) => choice.value === value);
  return (
    <View className="gap-2">
      <Text className="font-t3-semibold">{label}</Text>
      <Button
        label={selected?.label ?? "Choose…"}
        accessibilityLabel={`${label}: ${selected?.label ?? "Choose"}`}
        disabled={disabled}
        onPress={() => setExpanded((open) => !open)}
      />
      {selected?.detail ? (
        <Text className="text-sm text-foreground-muted">{selected.detail}</Text>
      ) : null}
      {expanded ? (
        <View className="overflow-hidden rounded-2xl">
          {choices.map((choice) => (
            <ListChoiceRow
              key={choice.value}
              label={choice.label}
              description={choice.detail}
              selected={choice.value === value}
              disabled={disabled || choice.disabled}
              onPress={() => {
                onChange(choice.value);
                setExpanded(false);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function BotParameterFields({
  parameters,
  values,
  onChange,
  disabled = false,
}: {
  readonly parameters: ReadonlyArray<BotParameter>;
  readonly values: Record<string, string>;
  readonly onChange: (name: string, value: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <>
      {parameters.map((parameter) => (
        <View key={parameter.name} className="gap-2">
          {parameter.type === "choice" ? (
            <RunChoice
              label={`${parameter.label}${parameter.required ? "" : " (optional)"}`}
              value={values[parameter.name] ?? ""}
              choices={[
                ...(parameter.required ? [] : [{ value: "", label: "Use default" }]),
                ...(parameter.choices ?? []).map((choice) => ({ value: choice, label: choice })),
              ]}
              onChange={(value) => onChange(parameter.name, value)}
              disabled={disabled}
            />
          ) : parameter.type === "boolean" ? (
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 font-t3-semibold">{parameter.label}</Text>
              <Switch
                accessibilityLabel={parameter.label}
                disabled={disabled}
                value={values[parameter.name] === "true"}
                onValueChange={(value) => onChange(parameter.name, String(value))}
              />
            </View>
          ) : (
            <>
              <Text className="font-t3-semibold">
                {parameter.label}
                {parameter.required ? "" : " (optional)"}
              </Text>
              <TextInput
                accessibilityLabel={parameter.label}
                value={values[parameter.name] ?? ""}
                editable={!disabled}
                onChangeText={(value) => onChange(parameter.name, value)}
                multiline={parameter.type === "text"}
                keyboardType={parameter.type === "number" ? "numbers-and-punctuation" : "default"}
                autoCapitalize="none"
              />
            </>
          )}
          {parameter.description ? (
            <Text className="text-sm text-foreground-muted">{parameter.description}</Text>
          ) : null}
        </View>
      ))}
    </>
  );
}

export function useBotRunDestination(
  environmentId: EnvironmentId,
  bot: BotDefinition,
  options?: { readonly sourceProject?: boolean; readonly fileSource?: boolean },
) {
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const shells = useThreadShells().filter((thread) => thread.environmentId === environmentId);
  const [chosenProjectId, setChosenProjectId] = useState<string>(projects[0]?.id ?? "");
  const projectRequired = needsProject(bot) || Boolean(options?.sourceProject);
  const projectId = fixedProject(bot) ?? (projectRequired ? chosenProjectId : "");
  const choices = checkoutChoices(shells, projectId);
  const [checkoutId, setCheckoutId] = useState("");
  const checkout = choices.find((choice) => choice.threadId === checkoutId);
  const [target, setTarget] = useState<BotTarget>({ type: "here" });
  const usesCheckout = Boolean(
    options?.fileSource || (runsInCheckout(bot) && target.type === "here"),
  );
  return {
    projects,
    projectRequired,
    projectId,
    chosenProjectId,
    setProjectId: (id: string) => {
      setChosenProjectId(id);
      setCheckoutId("");
    },
    choices,
    checkoutId,
    setCheckoutId,
    checkoutThreadId: usesCheckout ? (checkout?.threadId ?? null) : null,
    usesCheckout,
    target,
    setTarget,
  };
}

export function BotRunDestinationFields({
  environmentId,
  bot,
  destination,
  disabled = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly destination: ReturnType<typeof useBotRunDestination>;
  readonly disabled?: boolean;
}) {
  const capabilities = useBotsCapabilities(environmentId);
  const targets = useEnvironmentQuery(
    capabilities.anywhereSupported
      ? bots.targets({
          environmentId,
          input: {
            botId: bot.id,
            ...(destination.projectId ? { projectId: destination.projectId as ProjectId } : {}),
          },
        })
      : null,
  );
  const { target } = destination;
  const fixedProjectId = fixedProject(bot);
  const value = target.type === "environment" ? `environment:${target.environmentId}` : target.type;
  return (
    <>
      {fixedProjectId ? (
        <Text>
          Project:{" "}
          {destination.projects.find((project) => project.id === fixedProjectId)?.title ??
            fixedProjectId}
        </Text>
      ) : null}
      {destination.projectRequired && fixedProjectId === null ? (
        <RunChoice
          label="Project"
          value={destination.chosenProjectId}
          choices={destination.projects.map((project) => ({
            value: project.id,
            label: project.title,
          }))}
          onChange={destination.setProjectId}
          disabled={disabled}
        />
      ) : null}
      {destination.projectRequired && destination.projects.length === 0 ? (
        <Text>No projects on this computer. Add a project before running this bot.</Text>
      ) : null}
      {targets.data?.library === "available" && targets.data.targets.length > 1 ? (
        <RunChoice
          label="Run on"
          value={value}
          choices={[
            { value: "here", label: "This computer" },
            {
              value: "best",
              label: "Best available",
              detail: "The ready computer with the most free slots. This computer wins a tie.",
            },
            ...targets.data.targets
              .filter((candidate) => !candidate.isThisComputer)
              .map((candidate) => ({
                value: `environment:${candidate.environmentId}`,
                label: candidate.label,
                detail: candidate.ready
                  ? `${candidate.freeSlots} free slots`
                  : candidate.reasons.join(" "),
                disabled: !candidate.ready,
              })),
          ]}
          disabled={disabled}
          onChange={(next) =>
            destination.setTarget(
              next.startsWith("environment:")
                ? {
                    type: "environment",
                    environmentId: next.slice("environment:".length) as EnvironmentId,
                  }
                : next === "best"
                  ? { type: "best" }
                  : { type: "here" },
            )
          }
        />
      ) : null}
      {targets.error ? <BotNotice error={targets.error} /> : null}
      {destination.usesCheckout && destination.projectId ? (
        <RunChoice
          label="Checkout"
          value={destination.checkoutId}
          choices={[
            { value: "", label: "Project root" },
            ...destination.choices.map((choice) => ({
              value: choice.threadId,
              label: choice.label,
            })),
          ]}
          onChange={destination.setCheckoutId}
          disabled={disabled}
        />
      ) : null}
      {destination.checkoutId && !destination.checkoutThreadId && destination.usesCheckout ? (
        <Text>
          The selected checkout is no longer available. Choose another checkout or Project root
          before continuing.
        </Text>
      ) : null}
    </>
  );
}

function BotRunForm({
  environmentId,
  bot,
  callerThreadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly callerThreadId?: string;
}) {
  const navigation = useNavigation();
  const capabilities = useBotsCapabilities(environmentId);
  const allowed = useAtomValue(bots.run.permissionAtom(environmentId));
  const canRun = capabilities.connected && allowed && bot.archivedAt === null;
  const [values, setValues] = useState(() => initialRunValues(bot));
  const [notify, setNotify] = useState(false);
  const destination = useBotRunDestination(environmentId, bot);
  const checkoutMissing =
    !callerThreadId &&
    destination.usesCheckout &&
    destination.checkoutId !== "" &&
    destination.checkoutThreadId === null;
  const run = useAtomCommand(bots.run, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useBotActionLifetime();
  const submit = async () => {
    if (busy || !canRun || checkoutMissing) return;
    if (!callerThreadId && destination.projectRequired && !destination.projectId) {
      setError("Choose a project first.");
      return;
    }
    setError(null);
    setBusy(true);
    await Promise.resolve()
      .then(() =>
        run({
          environmentId,
          input: {
            botId: bot.id,
            inputs: parameterInputs(bot.parameters, values),
            ...(callerThreadId
              ? { callerThreadId: callerThreadId as ThreadId, ...(notify ? { notify: true } : {}) }
              : {
                  ...(destination.projectId
                    ? { projectId: destination.projectId as ProjectId }
                    : {}),
                  ...(destination.checkoutThreadId
                    ? { checkoutThreadId: destination.checkoutThreadId }
                    : {}),
                }),
            ...(destination.target.type === "here" ? {} : { target: destination.target }),
          },
        }),
      )
      .then((result) => {
        if (!active.current) return;
        const started = commandValue(result);
        navigation.navigate("BotsRunDetail", { environmentId, runId: started.id });
      })
      .catch((cause: unknown) => {
        if (active.current) setError(failureMessage(cause, "Could not start this bot."));
      });
    if (active.current) setBusy(false);
  };
  return (
    <>
      <Text className="text-foreground-muted">
        {bot.description || "Fill in the inputs, then run."}
      </Text>
      {bot.parameters.length ? (
        <BotParameterFields
          parameters={bot.parameters}
          values={values}
          onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
          disabled={busy}
        />
      ) : (
        <Text>This bot takes no inputs.</Text>
      )}
      {callerThreadId ? (
        <>
          <Text>Uses the project and checkout from the calling thread.</Text>
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1">Post the result to this thread</Text>
            <Switch
              accessibilityLabel="Post the result to this thread"
              disabled={busy}
              value={notify}
              onValueChange={setNotify}
            />
          </View>
        </>
      ) : (
        <BotRunDestinationFields
          environmentId={environmentId}
          bot={bot}
          destination={destination}
          disabled={busy}
        />
      )}
      <BotNotice
        error={error}
        detail={
          bot.archivedAt !== null
            ? "Restore this bot before running it."
            : !capabilities.connected
              ? "Reconnect this computer to start a run."
              : !allowed
                ? "This connection cannot run bots."
                : null
        }
      />
      <Button
        label={busy ? "Starting…" : `Run ${bot.name}`}
        loading={busy}
        tone="primary"
        disabled={!canRun || checkoutMissing}
        onPress={() => void submit()}
      />
    </>
  );
}

export function BotRunRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: string; botId: string; callerThreadId?: string }>) {
  const environmentId = route.params.environmentId as EnvironmentId;
  const collection = useBotsCollection(environmentId);
  const bot = collection.bots.find((candidate) => candidate.id === route.params.botId);
  return (
    <BotPage title={bot ? `Run ${bot.name}` : "Run bot"} back>
      <BotNotice error={collection.query.error} />
      {bot ? (
        <BotRunForm
          key={`${environmentId}:${bot.id}:${bot.version}:${route.params.callerThreadId ?? ""}`}
          environmentId={environmentId}
          bot={bot}
          callerThreadId={route.params.callerThreadId}
        />
      ) : (
        <Text>
          {collection.query.isPending
            ? "Loading bot…"
            : collection.query.error
              ? "Could not load this bot. Reconnect and try again."
              : "This bot is no longer available on this computer."}
        </Text>
      )}
    </BotPage>
  );
}
