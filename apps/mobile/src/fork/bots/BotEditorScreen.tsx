import { useAtomValue } from "@effect/atom-react";
import { useNavigation, usePreventRemove, type StaticScreenProps } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  BOTS_MAX_PARAMETERS,
  BOTS_MAX_VAULT_SLOTS,
  type BotDefinition,
  type BotDraftResult,
  type BotParameterType,
  type VaultAccessAction,
} from "@t3tools/contracts/fork";
import {
  botDraft,
  emptyBotDraft,
  hasBotDraftChanges,
  newParameterDraft,
  newVaultSlotDraft,
  saveInputFromDraft,
  slugFromName,
  type BotDraft,
  type BotParameterDraft,
  type BotVaultSlotDraft,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { scheduledTaskDefaultModel } from "../../features/settings/scheduledTaskDraft";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotInput, BotNotice, BotPage, BotSection, BotToggle } from "./BotControls";
import { BotModelField } from "./BotModelField";
import { RUNTIME_MODE_LABELS } from "./runLogic";
import { bots, useBotsCapabilities, useBotsCollection } from "./state";

const RUNTIME_OPTIONS = (
  ["approval-required", "auto-accept-edits", "auto", "full-access"] as const
).map((value) => ({ value, label: RUNTIME_MODE_LABELS[value] }));
const WORKSPACE_OPTIONS = [
  { value: "scratch", label: "Fresh scratch folder" },
  { value: "project", label: "Project checkout" },
  { value: "worktree", label: "New worktree" },
  { value: "checkout", label: "Checkout it is run for" },
] as const;
const PARAMETER_OPTIONS: ReadonlyArray<{ value: BotParameterType; label: string }> = [
  { value: "string", label: "Short text" },
  { value: "text", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes or no" },
  { value: "choice", label: "Choice" },
];
const VAULT_OPTIONS: ReadonlyArray<{ value: VaultAccessAction; label: string }> = [
  { value: "use", label: "Use it" },
  { value: "inspect", label: "See its details" },
  { value: "reveal", label: "Reveal its value" },
  { value: "manage", label: "Change it" },
  { value: "export", label: "Export it" },
  { value: "delegate", label: "Hand it on" },
];

export function BotParameterEditor({
  parameter,
  onChange,
  onRemove,
  disabled = false,
}: {
  readonly parameter: BotParameterDraft;
  readonly onChange: (parameter: BotParameterDraft) => void;
  readonly onRemove: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <View className="gap-3 rounded-2xl bg-grouped-card p-4">
      <BotInput
        label="Input name"
        value={parameter.name}
        onChangeText={(name) => onChange({ ...parameter, name })}
        disabled={disabled}
        placeholder="file"
      />
      <BotInput
        label="Input label"
        value={parameter.label}
        onChangeText={(label) => onChange({ ...parameter, label })}
        disabled={disabled}
        placeholder="File"
      />
      <BotInput
        label="Input description"
        value={parameter.description}
        onChangeText={(description) => onChange({ ...parameter, description })}
        disabled={disabled}
        placeholder="Hint shown when running the bot"
      />
      <BotChoice
        label="Input type"
        value={parameter.type}
        options={PARAMETER_OPTIONS}
        onChange={(type) => onChange({ ...parameter, type })}
        disabled={disabled}
      />
      <BotToggle
        label="Required input"
        value={parameter.required}
        onChange={(required) => onChange({ ...parameter, required })}
        disabled={disabled}
      />
      {parameter.type === "boolean" ? (
        <BotChoice
          label="Default value"
          value={parameter.defaultValue}
          options={[
            { value: "", label: "No default" },
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]}
          onChange={(defaultValue) => onChange({ ...parameter, defaultValue })}
          disabled={disabled}
        />
      ) : (
        <BotInput
          label="Default value"
          value={parameter.defaultValue}
          onChangeText={(defaultValue) => onChange({ ...parameter, defaultValue })}
          disabled={disabled}
          multiline={parameter.type === "text"}
          keyboardType={parameter.type === "number" ? "numbers-and-punctuation" : "default"}
        />
      )}
      {parameter.type === "choice" ? (
        <BotInput
          label="Choices, one per line"
          value={parameter.choices}
          onChangeText={(choices) => onChange({ ...parameter, choices })}
          disabled={disabled}
          multiline
        />
      ) : null}
      <Button
        label={`Remove input${parameter.label ? ` ${parameter.label}` : ""}`}
        tone="danger"
        disabled={disabled}
        onPress={onRemove}
      />
    </View>
  );
}

function VaultSlotEditor({
  slot,
  onChange,
  onRemove,
  disabled,
}: {
  readonly slot: BotVaultSlotDraft;
  readonly onChange: (slot: BotVaultSlotDraft) => void;
  readonly onRemove: () => void;
  readonly disabled: boolean;
}) {
  return (
    <View className="gap-3 rounded-2xl bg-grouped-card p-4">
      <BotInput
        label="Vault slot name"
        value={slot.name}
        onChangeText={(name) => onChange({ ...slot, name })}
        placeholder="github-token"
        disabled={disabled}
      />
      <BotInput
        label="Vault slot label"
        value={slot.label}
        onChangeText={(label) => onChange({ ...slot, label })}
        placeholder="GitHub token"
        disabled={disabled}
      />
      <BotChoice
        label="Allowed Vault action"
        value={slot.action}
        options={VAULT_OPTIONS}
        onChange={(action) => onChange({ ...slot, action })}
        disabled={disabled}
      />
      <BotInput
        label="Allowed destination (optional)"
        value={slot.destination}
        onChangeText={(destination) => onChange({ ...slot, destination })}
        placeholder="https://api.github.com"
        disabled={disabled}
      />
      <Button
        label={`Remove Vault slot${slot.label ? ` ${slot.label}` : ""}`}
        tone="danger"
        disabled={disabled}
        onPress={onRemove}
      />
    </View>
  );
}

type CreateParams = { environmentId: string; sourceThreadId?: string; suggestionId?: string };
type EditParams = { environmentId: string; botId: string };

export function BotCreateRouteScreen({ route }: StaticScreenProps<CreateParams>) {
  return (
    <BotEditorRoute
      key={`${route.params.environmentId}:new:${route.params.sourceThreadId ?? ""}`}
      {...route.params}
    />
  );
}
export function BotEditRouteScreen({ route }: StaticScreenProps<EditParams>) {
  return (
    <BotEditorRoute key={`${route.params.environmentId}:${route.params.botId}`} {...route.params} />
  );
}

function BotEditorRoute({
  environmentId: rawEnvironmentId,
  botId,
  sourceThreadId,
  suggestionId,
}: {
  readonly environmentId: string;
  readonly botId?: string;
  readonly sourceThreadId?: string;
  readonly suggestionId?: string;
}) {
  const environmentId = EnvironmentId.make(rawEnvironmentId);
  const host = useBotsCapabilities(environmentId);
  const collection = useBotsCollection(environmentId);
  const config = useEnvironmentServerConfig(environmentId);
  const currentBot =
    botId === undefined ? null : collection.bots.find((entry) => entry.id === botId);
  const [loadedBot, setLoadedBot] = useState(currentBot ?? null);
  if (currentBot && loadedBot === null) setLoadedBot(currentBot);
  const bot = currentBot ?? loadedBot;
  if (botId !== undefined && !bot) {
    return (
      <BotPage title="Edit bot" back>
        <BotNotice
          error={collection.query.error}
          detail={
            !host.connected
              ? "Reconnect to this computer to edit its bots."
              : collection.query.isPending
                ? "Loading bot…"
                : "This bot is no longer available."
          }
          onRetry={collection.refresh}
        />
      </BotPage>
    );
  }
  if (!host.supported && loadedBot === null) {
    return (
      <BotPage title={botId === undefined ? "New bot" : "Edit bot"} back>
        <BotNotice
          detail={
            host.connected
              ? "This computer does not support Bots yet. Update its server to manage bots."
              : "Reconnect to this computer to manage bots."
          }
        />
      </BotPage>
    );
  }
  return (
    <BotEditor
      key={botId ?? "new"}
      environmentId={environmentId}
      bot={bot ?? null}
      unavailable={botId !== undefined && currentBot === undefined}
      initialDraft={bot ? botDraft(bot) : emptyBotDraft(scheduledTaskDefaultModel(config, null))}
      {...(sourceThreadId === undefined ? {} : { sourceThreadId })}
      {...(suggestionId === undefined ? {} : { suggestionId })}
    />
  );
}

function BotEditor({
  environmentId,
  bot,
  initialDraft,
  sourceThreadId,
  suggestionId,
  unavailable,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition | null;
  readonly initialDraft: BotDraft;
  readonly unavailable: boolean;
  readonly sourceThreadId?: string;
  readonly suggestionId?: string;
}) {
  const navigation = useNavigation();
  const host = useBotsCapabilities(environmentId);
  const config = useEnvironmentServerConfig(environmentId);
  const projects = useProjects().filter(
    (entry) => entry.environmentId === environmentId && !entry.isScratch,
  );
  const [baseline, setBaseline] = useState(initialDraft);
  const [draft, setDraft] = useState(initialDraft);
  // Version 0 tells the server this creates a bot, so a taken id fails instead of overwriting.
  const [expectedVersion, setExpectedVersion] = useState(bot?.version ?? 0);
  const [idTouched, setIdTouched] = useState(bot !== null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<ReadonlyArray<string>>([]);
  const [fromThread, setFromThread] = useState<BotDraftResult | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const attempts = useRef(0);
  const canSave = useAtomValue(bots.save.permissionAtom(environmentId));
  const canDraft = useAtomValue(bots.draftFromThread.permissionAtom(environmentId));
  const canRefine = useAtomValue(bots.refineDraft.permissionAtom(environmentId));
  const canSuggest = useAtomValue(bots.suggestEdit.permissionAtom(environmentId));
  const canRestore = useAtomValue(bots.restoreStarter.permissionAtom(environmentId));
  const canReplay = useAtomValue(bots.replay.permissionAtom(environmentId));
  const save = useAtomCommand(bots.save, { reportFailure: false });
  const draftFromThread = useAtomCommand(bots.draftFromThread, { reportFailure: false });
  const refine = useAtomCommand(bots.refineDraft, { reportFailure: false });
  const suggest = useAtomCommand(bots.suggestEdit, { reportFailure: false });
  const restoreStarter = useAtomCommand(bots.restoreStarter, { reportFailure: false });
  const dismissSuggestion = useAtomCommand(bots.dismissSuggestion, {
    label: "Dismiss saved bot suggestion",
  });
  const sourceRequest = useRef<{
    readonly attempt: number;
    readonly request: ReturnType<typeof draftFromThread>;
    delivered: boolean;
  } | null>(null);
  const mounted = useRef(false);
  const hasChanges = hasBotDraftChanges(baseline, draft);
  const disabled =
    busy || drafting !== null || unavailable || !host.connected || !host.supported || !canSave;
  const update = (patch: Partial<BotDraft>) => setDraft((current) => ({ ...current, ...patch }));
  usePreventRemove(!saved && (hasChanges || busy || drafting !== null), ({ data }) => {
    if (busy) {
      Dialog.alert("Saving bot", "Wait for the bot to finish saving before leaving.");
      return;
    }
    Dialog.confirm({
      title: "Discard changes?",
      message: "Your unsaved bot changes will be lost.",
      confirmText: "Discard changes",
      destructive: true,
      onConfirm: () => {
        attempts.current += 1;
        navigation.dispatch(data.action);
      },
    });
  });
  useEffect(() => {
    if (!saved) return;
    const frame = requestAnimationFrame(() => {
      if (navigation.isFocused()) navigation.goBack();
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, saved]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyModelDraft = (status: string, work: () => ReturnType<typeof draftFromThread>) => {
    const attempt = ++attempts.current;
    setDrafting(status);
    setError(null);
    void work()
      .then((result) => {
        if (!mounted.current || attempt !== attempts.current) return;
        if (result._tag === "Failure") {
          const cause = squashAtomCommandFailure(result);
          setError(cause instanceof Error ? cause.message : "Could not draft the bot.");
        } else {
          setDraft(botDraft(result.value.draft));
          if (bot === null) setFromThread(result.value);
          setIdTouched(true);
          setNotes(result.value.notes);
        }
        setDrafting(null);
      })
      .catch((cause: unknown) => {
        if (!mounted.current || attempt !== attempts.current) return;
        setError(cause instanceof Error ? cause.message : "Could not draft the bot.");
        setDrafting(null);
      });
  };
  const createFromThread = () => {
    if (
      !sourceThreadId ||
      !host.connected ||
      !host.fromThreadSupported ||
      !canDraft ||
      drafting !== null
    )
      return;
    const start = () =>
      void applyModelDraft("Drafting from the thread. This can take up to three minutes.", () =>
        draftFromThread({ environmentId, input: { threadId: ThreadId.make(sourceThreadId) } }),
      );
    if (hasChanges)
      Dialog.confirm({
        title: "Replace this draft?",
        message: "Drafting from the thread replaces your unsaved changes.",
        confirmText: "Draft from thread",
        onConfirm: start,
      });
    else start();
  };
  useEffect(() => {
    if (!sourceThreadId || !host.connected || !host.fromThreadSupported || !canDraft) return;
    // Reuse one request when effects reconnect or replay during a native development render.
    if (sourceRequest.current === null) {
      const attempt = ++attempts.current;
      sourceRequest.current = {
        attempt,
        delivered: false,
        request: draftFromThread({
          environmentId,
          input: { threadId: ThreadId.make(sourceThreadId) },
        }),
      };
      setDrafting("Drafting from the thread. This can take up to three minutes.");
    }
    const pending = sourceRequest.current;
    if (pending.delivered) return;
    const { attempt, request } = pending;
    let active = true;
    void request.then((result) => {
      if (!active || attempt !== attempts.current) return;
      pending.delivered = true;
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not draft the bot.");
      } else {
        setDraft(botDraft(result.value.draft));
        setFromThread(result.value);
        setIdTouched(true);
        setNotes(result.value.notes);
      }
      setDrafting(null);
    });
    return () => {
      active = false;
    };
  }, [
    sourceThreadId,
    host.connected,
    host.fromThreadSupported,
    canDraft,
    environmentId,
    draftFromThread,
  ]);

  const submit = () => {
    if (disabled || (bot !== null && bot.version !== expectedVersion)) return;
    const checked = saveInputFromDraft(draft, expectedVersion);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError(null);
    void save({ environmentId, input: checked.input })
      .then((result) => {
        if (!mounted.current) return;
        if (result._tag === "Failure") {
          const cause = squashAtomCommandFailure(result);
          const message = cause instanceof Error ? cause.message : "Could not save the bot.";
          // Older servers word a taken id as a stale edit, which would confuse someone creating a bot.
          setError(
            bot === null && message.startsWith("This bot changed since")
              ? `Another bot already uses the id ${checked.input.id}. Choose another id.`
              : message,
          );
          setBusy(false);
        } else {
          if (suggestionId)
            void dismissSuggestion({ environmentId, input: { suggestionId, dismissed: true } });
          setSaved(true);
        }
      })
      .catch((cause: unknown) => {
        if (!mounted.current) return;
        setError(cause instanceof Error ? cause.message : "Could not save the bot.");
        setBusy(false);
      });
  };
  const suggestEdit = () => {
    if (!bot || disabled || !canSuggest) return;
    const start = () =>
      void applyModelDraft("Reading runs rated Bad. This can take up to three minutes.", () =>
        suggest({ environmentId, input: { botId: bot.id } }),
      );
    if (hasChanges)
      Dialog.confirm({
        title: "Replace this draft?",
        message:
          "The suggestion replaces your unsaved changes. The saved bot stays unchanged until you save.",
        confirmText: "Suggest an edit",
        onConfirm: start,
      });
    else start();
  };
  const refineDraft = () => {
    if (!fromThread || disabled || !canRefine) return;
    const checked = saveInputFromDraft(draft, undefined);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    void applyModelDraft(
      "Refining with the thread's model. This can take up to three minutes.",
      () =>
        refine({
          environmentId,
          input: { threadId: fromThread.sourceThreadId, draft: checked.input },
        }),
    );
  };
  const restore = () => {
    const starterId = bot?.origin?.starterId;
    if (!starterId || disabled || !canRestore) return;
    Dialog.confirm({
      title: "Restore starter?",
      message:
        "Replace this bot's instructions, inputs and settings with its starter. Its model and where it is available stay.",
      confirmText: "Restore starter",
      destructive: true,
      onConfirm: () => {
        setBusy(true);
        setError(null);
        void restoreStarter({ environmentId, input: { starterId } }).then((result) => {
          if (result._tag === "Failure") {
            const cause = squashAtomCommandFailure(result);
            setError(cause instanceof Error ? cause.message : "Could not restore the starter.");
            setBusy(false);
          } else setSaved(true);
        });
      },
    });
  };
  const projectOptions = (value: string, anyLabel: string) => [
    { value: "", label: anyLabel },
    ...projects.map((project) => ({ value: String(project.id), label: project.title })),
    ...(value !== "" && !projects.some((project) => project.id === value)
      ? [{ value, label: `Unavailable project: ${value}` }]
      : []),
  ];
  const stale = bot !== null && bot.version !== expectedVersion;
  return (
    <BotPage title={bot ? `Edit ${bot.name}` : sourceThreadId ? "Save as bot" : "New bot"} back>
      <BotNotice
        error={error}
        detail={
          unavailable
            ? "This bot was removed on this computer. Your unsaved draft is kept here."
            : !host.connected
              ? "Reconnect to this computer to save. Your draft is kept here."
              : !canSave
                ? "You do not have permission to change bots on this computer."
                : "Every run uses these instructions and settings, whoever starts it."
        }
      />
      {stale ? (
        <View className="gap-2">
          <Text className="text-sm text-foreground-muted">
            This bot changed elsewhere. Reload the latest version before saving.
          </Text>
          <Button
            label="Reload latest bot"
            disabled={busy || drafting !== null}
            onPress={() =>
              Dialog.confirm({
                title: "Reload latest bot?",
                message: "Your unsaved changes will be replaced with the latest saved version.",
                confirmText: "Reload",
                onConfirm: () => {
                  const latest = botDraft(bot);
                  setDraft(latest);
                  setBaseline(latest);
                  setExpectedVersion(bot.version);
                  setError(null);
                },
              })
            }
          />
        </View>
      ) : null}
      {drafting !== null ? (
        <View className="gap-2">
          <Text accessibilityLiveRegion="polite">{drafting}</Text>
          <Button
            label="Stop waiting"
            onPress={() => {
              attempts.current += 1;
              setDrafting(null);
            }}
          />
        </View>
      ) : (
        [...new Set(notes)].map((note) => (
          <Text key={note} className="text-sm text-foreground-muted">
            {note}
          </Text>
        ))
      )}
      <BotSection title="Definition">
        <BotInput
          label="Name"
          value={draft.name}
          onChangeText={(name) => update(idTouched ? { name } : { name, id: slugFromName(name) })}
          disabled={disabled}
        />
        <BotInput
          label="Id"
          value={draft.id}
          onChangeText={(id) => {
            setIdTouched(true);
            update({ id });
          }}
          disabled={disabled || bot !== null}
        />
        <BotInput
          label="Description"
          value={draft.description}
          onChangeText={(description) => update({ description })}
          placeholder="What this bot is for"
          disabled={disabled}
        />
        <BotInput
          label="Instructions"
          value={draft.instructions}
          onChangeText={(instructions) => update({ instructions })}
          placeholder="Review {{file}} for correctness. Report each problem with its line."
          multiline
          disabled={disabled}
        />
      </BotSection>
      <BotSection
        title="Inputs"
        description="Use {{name}} in the instructions to substitute an input."
      >
        {draft.parameters.length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            No inputs. This bot can run without a form.
          </Text>
        ) : null}
        {draft.parameters.map((parameter) => (
          <BotParameterEditor
            key={parameter.key}
            parameter={parameter}
            disabled={disabled}
            onChange={(next) =>
              update({
                parameters: draft.parameters.map((entry) =>
                  entry.key === parameter.key ? next : entry,
                ),
              })
            }
            onRemove={() =>
              update({
                parameters: draft.parameters.filter((entry) => entry.key !== parameter.key),
              })
            }
          />
        ))}
        <Button
          label="Add input"
          disabled={disabled || draft.parameters.length >= BOTS_MAX_PARAMETERS}
          onPress={() => update({ parameters: [...draft.parameters, newParameterDraft()] })}
        />
      </BotSection>
      <BotSection title="Execution">
        <BotModelField
          environmentId={environmentId}
          value={draft.modelSelection}
          onChange={(modelSelection) => update({ modelSelection })}
          disabled={disabled}
          runtimeMode={draft.runtimeMode}
          onRuntimeModeChange={(runtimeMode) => update({ runtimeMode })}
        />
        {draft.modelSelection === null && config ? (
          <Button
            label="Use default model"
            disabled={disabled}
            onPress={() => update({ modelSelection: scheduledTaskDefaultModel(config, null) })}
          />
        ) : null}
        <BotChoice
          label="Permissions"
          value={draft.runtimeMode}
          options={RUNTIME_OPTIONS}
          onChange={(runtimeMode) => update({ runtimeMode })}
          disabled={disabled}
        />
        <BotChoice
          label="Mode"
          value={draft.interactionMode}
          options={[
            { value: "default", label: "Do the work" },
            { value: "plan", label: "Plan only" },
          ]}
          onChange={(interactionMode) => update({ interactionMode })}
          disabled={disabled}
        />
        <BotChoice
          label="Workspace"
          value={draft.workspace}
          options={WORKSPACE_OPTIONS.filter(
            (option) =>
              option.value !== "checkout" ||
              host.startersSupported ||
              draft.workspace === "checkout",
          )}
          onChange={(workspace) => update({ workspace })}
          disabled={disabled}
        />
        {draft.workspace !== "scratch" ? (
          <BotChoice
            label="Project"
            value={draft.projectId}
            options={projectOptions(draft.projectId, "Choose when running")}
            onChange={(projectId) => update({ projectId })}
            disabled={disabled}
          />
        ) : null}
        {draft.workspace === "worktree" ? (
          <BotInput
            label="Base branch (optional)"
            value={draft.baseRef}
            onChangeText={(baseRef) => update({ baseRef })}
            disabled={disabled}
          />
        ) : null}
        <BotChoice
          label="Available in"
          value={draft.scopeProjectId}
          options={projectOptions(draft.scopeProjectId, "Every project")}
          onChange={(scopeProjectId) => update({ scopeProjectId })}
          disabled={disabled}
        />
        <BotInput
          label="Time limit (minutes)"
          value={draft.timeoutMinutes}
          onChangeText={(timeoutMinutes) => update({ timeoutMinutes })}
          keyboardType="number-pad"
          disabled={disabled}
        />
        <BotInput
          label="Runs at once"
          value={draft.maxConcurrentRuns}
          onChangeText={(maxConcurrentRuns) => update({ maxConcurrentRuns })}
          keyboardType="number-pad"
          disabled={disabled}
        />
        {host.verdictsSupported || draft.output === "verdict" ? (
          <BotChoice
            label="Reply"
            value={draft.output}
            options={[
              { value: "text", label: "Text" },
              { value: "verdict", label: "Verdict" },
            ]}
            onChange={(output) => update({ output })}
            disabled={disabled || !host.verdictsSupported}
          />
        ) : null}
      </BotSection>
      {host.budgetsSupported || draft.runsPerDay !== "" || draft.tokensPerDay !== "" ? (
        <BotSection title="Budget" description="Rolling 24-hour limits. Leave empty for no limit.">
          <BotInput
            label="Runs per 24 hours"
            value={draft.runsPerDay}
            onChangeText={(runsPerDay) => update({ runsPerDay })}
            keyboardType="number-pad"
            disabled={disabled || !host.budgetsSupported}
          />
          <BotInput
            label="Tokens per 24 hours"
            value={draft.tokensPerDay}
            onChangeText={(tokensPerDay) => update({ tokensPerDay })}
            keyboardType="number-pad"
            disabled={disabled || !host.budgetsSupported}
          />
        </BotSection>
      ) : null}
      {host.anywhereSupported || draft.vaultSlots.length > 0 ? (
        <BotSection
          title="Vault slots"
          description="Describe credentials the bot needs. After saving, bind each slot to a Vault item on this computer. Values are never stored in the definition."
        >
          {draft.vaultSlots.map((slot) => (
            <VaultSlotEditor
              key={slot.key}
              slot={slot}
              disabled={disabled || !host.anywhereSupported}
              onChange={(next) =>
                update({
                  vaultSlots: draft.vaultSlots.map((entry) =>
                    entry.key === slot.key ? next : entry,
                  ),
                })
              }
              onRemove={() =>
                update({ vaultSlots: draft.vaultSlots.filter((entry) => entry.key !== slot.key) })
              }
            />
          ))}
          <Button
            label="Add Vault slot"
            disabled={
              disabled || !host.anywhereSupported || draft.vaultSlots.length >= BOTS_MAX_VAULT_SLOTS
            }
            onPress={() => update({ vaultSlots: [...draft.vaultSlots, newVaultSlotDraft()] })}
          />
        </BotSection>
      ) : null}
      <Button
        label={busy ? "Saving…" : "Save bot"}
        tone="primary"
        disabled={disabled || stale}
        loading={busy}
        onPress={() => void submit()}
      />
      {fromThread ? (
        <Button label="Refine with model" disabled={disabled || !canRefine} onPress={refineDraft} />
      ) : sourceThreadId && !drafting ? (
        <Button
          label="Retry draft from thread"
          disabled={disabled || !canDraft || !host.fromThreadSupported}
          onPress={createFromThread}
        />
      ) : null}
      {bot && host.versionsSupported ? (
        <Button
          label="Try draft on past runs"
          disabled={disabled || !canReplay || bot.archivedAt !== null}
          onPress={() => {
            const checked = saveInputFromDraft(draft, undefined);
            if (!checked.ok) {
              setError(checked.message);
              return;
            }
            navigation.navigate("BotsReplay", {
              environmentId,
              botId: bot.id,
              draft: checked.input,
            });
          }}
        />
      ) : null}
      {bot && host.versionsSupported ? (
        <Button
          label="Suggest an edit"
          disabled={disabled || !canSuggest || bot.archivedAt !== null}
          onPress={suggestEdit}
        />
      ) : null}
      {bot?.origin && host.startersSupported ? (
        <Button label="Restore starter" disabled={disabled || !canRestore} onPress={restore} />
      ) : null}
      <Button label="Cancel" tone="text" disabled={busy} onPress={() => navigation.goBack()} />
    </BotPage>
  );
}
