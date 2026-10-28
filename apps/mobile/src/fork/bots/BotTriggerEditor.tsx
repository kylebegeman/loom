import { useState } from "react";
import { ScrollView, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_TRIGGER_EVENT_FIELDS,
  type BotDefinition,
  type BotPipeline,
  type BotTrigger,
  type BotTriggerEventKind,
} from "@t3tools/contracts/fork";
import {
  emptyTriggerDraft,
  guessMapping,
  triggerDraftFrom,
  triggerInputFromDraft,
  TRIGGER_KIND_LABELS,
  WEEKDAY_LABELS,
  type MappingDraft,
  type TriggerDraft,
} from "@t3tools/client-runtime/fork";
import { commandValue } from "./runLogic";
import { useBotActionLifetime } from "./useBotActionLifetime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { useProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotInput, BotNotice, BotSection, BotToggle } from "./BotControls";
import { bots } from "./state";

export function BotTriggerEditor({
  environmentId,
  bot,
  trigger,
  pipelines,
  canSave,
  stableSupported,
  onSaved,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly trigger: BotTrigger | null;
  readonly pipelines: ReadonlyArray<BotPipeline>;
  readonly canSave: boolean;
  readonly stableSupported: boolean;
  readonly onSaved: (trigger: BotTrigger) => void;
  readonly onClose: () => void;
}) {
  const active = useBotActionLifetime();
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const pipelineOf = (id: string | null | undefined) =>
    pipelines.find((pipeline) => pipeline.id === id);
  const [draft, setDraft] = useState<TriggerDraft>(() =>
    trigger === null
      ? emptyTriggerDraft(bot)
      : triggerDraftFrom(bot, trigger, pipelineOf(trigger.pipelineId) ?? bot),
  );
  const target = pipelineOf(draft.pipelineId) ?? bot;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useAtomCommand(bots.saveTrigger, { reportFailure: false });
  const update = (patch: Partial<TriggerDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const mapping = (name: string, patch: Partial<MappingDraft>) =>
    setDraft((current) => ({
      ...current,
      mapping: {
        ...current.mapping,
        [name]: { mode: "none", field: "", value: "", ...current.mapping[name], ...patch },
      },
    }));
  const pullRequest =
    draft.kind === "pull-request-checks-failing" || draft.kind === "pull-request-opened";
  const built = triggerInputFromDraft(bot, draft, trigger, target);
  const submit = async () => {
    if (busy || !canSave) return;
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    await save({ environmentId, input: built.input })
      .then((result) => {
        const saved = commandValue(result);
        if (active.current) onSaved(saved);
      })
      .catch((cause: unknown) => {
        if (active.current)
          setError(cause instanceof Error ? cause.message : "Could not save the trigger.");
      });
    if (active.current) setBusy(false);
  };
  return (
    <Sheet
      title={trigger ? `Edit ${trigger.name}` : `New trigger for ${bot.name}`}
      dismissible={!busy}
      onClose={onClose}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View className="gap-4 p-4 pb-12">
          <Text>
            A trigger starts a real run when its event arrives. The bot keeps its own limits.
          </Text>
          <BotInput
            label="Name"
            value={draft.name}
            disabled={busy}
            onChangeText={(name) => update({ name })}
          />
          {pipelines.length > 0 || draft.pipelineId !== "" ? (
            <BotChoice
              label="Starts"
              value={draft.pipelineId}
              disabled={busy || trigger !== null}
              options={[
                { value: "", label: bot.name },
                ...pipelines.map((pipeline) => ({
                  value: pipeline.id as string,
                  label: pipeline.name,
                })),
                ...(draft.pipelineId !== "" && !pipelineOf(draft.pipelineId)
                  ? [
                      {
                        value: draft.pipelineId,
                        label: `Unavailable pipeline: ${draft.pipelineId}`,
                      },
                    ]
                  : []),
              ]}
              onChange={(pipelineId) =>
                update({
                  pipelineId,
                  mapping: guessMapping(pipelineOf(pipelineId) ?? bot, draft.kind),
                })
              }
            />
          ) : null}
          <BotChoice<BotTriggerEventKind>
            label="When"
            value={draft.kind}
            disabled={busy}
            options={Object.entries(TRIGGER_KIND_LABELS)
              .filter(([value]) => value !== "merge-conflict")
              .map(([value, label]) => ({
                value: value as BotTriggerEventKind,
                label,
              }))}
            onChange={(kind) =>
              update({
                kind,
                mapping: trigger === null ? guessMapping(target, kind) : draft.mapping,
              })
            }
          />
          {pullRequest || draft.kind === "thread-settled" ? (
            <BotChoice
              label="Project"
              value={draft.projectId}
              disabled={busy}
              options={[
                ...(draft.kind === "thread-settled" ? [] : [{ value: "", label: "Any project" }]),
                ...projects.map((project) => ({
                  value: project.id as string,
                  label: project.title,
                })),
                ...(draft.projectId && !projects.some((p) => p.id === draft.projectId)
                  ? [{ value: draft.projectId, label: `Unavailable project: ${draft.projectId}` }]
                  : []),
              ]}
              onChange={(projectId) => update({ projectId })}
            />
          ) : null}
          {pullRequest ? (
            <>
              <BotInput
                label="Repository (optional)"
                placeholder="owner/name"
                value={draft.repository}
                disabled={busy}
                onChangeText={(repository) => update({ repository })}
              />
              <BotInput
                label="Branch pattern (optional)"
                placeholder="release/*"
                value={draft.branchPattern}
                disabled={busy}
                onChangeText={(branchPattern) => update({ branchPattern })}
              />
            </>
          ) : null}
          {draft.kind === "schedule" ? (
            <BotSection title="Schedule">
              <Text>Times use the server's local timezone.</Text>
              <BotChoice
                label="Schedule type"
                value={draft.scheduleType}
                disabled={busy}
                options={[
                  { value: "interval", label: "Every interval" },
                  { value: "fixed_time", label: "At a time" },
                ]}
                onChange={(scheduleType) => update({ scheduleType })}
              />
              {draft.scheduleType === "interval" ? (
                <BotInput
                  label="Every (minutes)"
                  keyboardType="number-pad"
                  value={draft.everyMinutes}
                  disabled={busy}
                  onChangeText={(everyMinutes) => update({ everyMinutes })}
                />
              ) : (
                <>
                  <BotInput
                    label="Time of day (24-hour HH:MM)"
                    placeholder="09:00"
                    value={draft.timeOfDay}
                    disabled={busy}
                    onChangeText={(timeOfDay) => update({ timeOfDay })}
                  />
                  <Text>Days. Leave all off for every day.</Text>
                  {WEEKDAY_LABELS.map((label, day) => (
                    <BotToggle
                      key={label}
                      label={label}
                      value={draft.weekdays.includes(day)}
                      disabled={busy}
                      onChange={(enabled) =>
                        update({
                          weekdays: enabled
                            ? [...draft.weekdays, day]
                            : draft.weekdays.filter((value) => value !== day),
                        })
                      }
                    />
                  ))}
                </>
              )}
            </BotSection>
          ) : null}
          {draft.kind === "webhook" ? (
            <BotSection title="Webhook authentication">
              <BotToggle
                label="Check an HMAC-SHA256 signature"
                value={draft.signed}
                disabled={busy}
                onChange={(signed) => update({ signed })}
              />
              {draft.signed ? (
                <>
                  <BotInput
                    label="Signature header"
                    value={draft.signatureHeader}
                    disabled={busy}
                    onChangeText={(signatureHeader) => update({ signatureHeader })}
                  />
                  <BotInput
                    label="Signature prefix"
                    value={draft.signaturePrefix}
                    disabled={busy}
                    onChangeText={(signaturePrefix) => update({ signaturePrefix })}
                  />
                  <BotChoice
                    label="Signature encoding"
                    value={draft.signatureEncoding}
                    disabled={busy}
                    options={[
                      { value: "hex", label: "Hex" },
                      { value: "base64", label: "Base64" },
                    ]}
                    onChange={(signatureEncoding) => update({ signatureEncoding })}
                  />
                  <BotInput
                    label={
                      trigger?.webhook?.hasSecret
                        ? "Shared secret (blank keeps existing)"
                        : "Shared secret"
                    }
                    secureTextEntry
                    value={draft.secret}
                    disabled={busy}
                    onChangeText={(secret) => update({ secret })}
                  />
                </>
              ) : null}
            </BotSection>
          ) : null}
          {target.parameters.length > 0 ? (
            <BotSection title="Inputs">
              {target.parameters.map((parameter) => {
                const entry = draft.mapping[parameter.name] ?? {
                  mode: "none" as const,
                  field: "",
                  value: "",
                };
                return (
                  <View
                    key={parameter.name}
                    className="gap-3 rounded-xl border border-border-subtle p-3"
                  >
                    <BotChoice
                      label={`${parameter.label}${parameter.required && parameter.default === undefined ? " (required)" : ""}`}
                      value={entry.mode}
                      disabled={busy}
                      options={[
                        { value: "field", label: "From the event" },
                        { value: "value", label: "Fixed value" },
                        {
                          value: "none",
                          label: parameter.default === undefined ? "Leave empty" : "Use default",
                        },
                      ]}
                      onChange={(mode) => mapping(parameter.name, { mode })}
                    />
                    {entry.mode === "field" ? (
                      draft.kind === "webhook" ? (
                        <BotInput
                          label={`${parameter.label} event field`}
                          placeholder="body.pull_request.number"
                          value={entry.field}
                          disabled={busy}
                          onChangeText={(field) => mapping(parameter.name, { field })}
                        />
                      ) : (
                        <BotChoice
                          label={`${parameter.label} event field`}
                          value={entry.field}
                          disabled={busy}
                          options={BOT_TRIGGER_EVENT_FIELDS[draft.kind].map((field) => ({
                            value: field,
                            label: field,
                          }))}
                          onChange={(field) => mapping(parameter.name, { field })}
                        />
                      )
                    ) : entry.mode === "value" ? (
                      parameter.type === "boolean" ? (
                        <BotToggle
                          label={`${parameter.label} value`}
                          value={entry.value === "true"}
                          disabled={busy}
                          onChange={(value) => mapping(parameter.name, { value: String(value) })}
                        />
                      ) : parameter.type === "choice" ? (
                        <BotChoice
                          label={`${parameter.label} value`}
                          value={entry.value}
                          disabled={busy}
                          options={(parameter.choices ?? []).map((value) => ({
                            value,
                            label: value,
                          }))}
                          onChange={(value) => mapping(parameter.name, { value })}
                        />
                      ) : (
                        <BotInput
                          label={`${parameter.label} value`}
                          value={entry.value}
                          multiline={parameter.type === "text"}
                          keyboardType={
                            parameter.type === "number" ? "numbers-and-punctuation" : "default"
                          }
                          disabled={busy}
                          onChangeText={(value) => mapping(parameter.name, { value })}
                        />
                      )
                    ) : null}
                  </View>
                );
              })}
            </BotSection>
          ) : null}
          <BotInput
            label="Cooldown (minutes)"
            keyboardType="number-pad"
            value={draft.cooldownMinutes}
            disabled={busy}
            onChangeText={(cooldownMinutes) => update({ cooldownMinutes })}
          />
          <BotInput
            label="Maximum runs per day"
            keyboardType="number-pad"
            value={draft.dailyLimit}
            disabled={busy}
            onChangeText={(dailyLimit) => update({ dailyLimit })}
          />
          {draft.pipelineId === "" ? (
            <BotChoice
              label="Version to run"
              value={draft.follow}
              disabled={busy}
              options={[
                {
                  value: "pinned",
                  label: `Pinned version ${trigger?.pinnedVersion ?? bot.version}`,
                },
                { value: "latest", label: "Latest version" },
                ...(stableSupported || draft.follow === "stable"
                  ? [{ value: "stable" as const, label: "Stable version (latest if none)" }]
                  : []),
              ]}
              onChange={(follow) => update({ follow })}
            />
          ) : null}
          <BotToggle
            label="Trigger enabled"
            value={draft.enabled}
            disabled={busy}
            onChange={(enabled) => update({ enabled })}
          />
          {draft.kind === "webhook" || draft.kind === "merge-conflict" ? (
            <Text>The webhook address appears on the saved trigger.</Text>
          ) : null}
          <BotNotice
            error={error}
            detail={!canSave ? "This connection cannot save triggers." : undefined}
          />
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={busy ? "Saving…" : "Save trigger"}
              tone="primary"
              disabled={busy || !canSave}
              onPress={() => void submit()}
            />
            <Button label="Cancel" disabled={busy} onPress={onClose} />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}
