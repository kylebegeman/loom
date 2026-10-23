import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_TRIGGER_EVENT_FIELDS,
  type BotDefinition,
  type BotPipeline,
  type BotTrigger,
  type BotTriggerEventKind,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useProjects } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { Choice } from "./RunOnManyDialog";
import {
  emptyTriggerDraft,
  guessMapping,
  TRIGGER_KIND_LABELS,
  triggerDraftFrom,
  triggerInputFromDraft,
  WEEKDAY_LABELS,
  type MappingDraft,
  type MappingMode,
  type TriggerDraft,
  type TriggerFollow,
} from "@t3tools/client-runtime/fork";
import { bots } from "./state";

const KIND_HINTS: Record<BotTriggerEventKind, string> = {
  "pull-request-checks-failing":
    "Fires when a linked pull request's checks turn failing, and again for a new failing commit.",
  "pull-request-opened": "Fires the first time Loom sees a linked pull request open.",
  "thread-settled": "Fires when a thread in the project settles. Bot runs never start it.",
  "merge-conflict":
    "Fires when the fork integrate script reports conflicts. Each file runs as one batch item.",
  webhook:
    "Fires on each request to the trigger's address. Map inputs from body, headers or query.",
  schedule: "Fires on an interval or at a local time of day.",
};

/** Creates or edits one trigger for one bot. */
export function BotTriggerEditor({
  environmentId,
  bot,
  trigger,
  canSave,
  stableSupported,
  pipelines,
  onClose,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly trigger: BotTrigger | null;
  readonly canSave: boolean;
  /** Older servers keep no stable version. */
  readonly stableSupported: boolean;
  /** Pipelines whose first step runs this bot; a trigger can start one instead. */
  readonly pipelines: ReadonlyArray<BotPipeline>;
  readonly onClose: () => void;
  readonly onSaved: (trigger: BotTrigger) => void;
}) {
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const pipelineOf = (pipelineId: string | null | undefined) =>
    pipelines.find((pipeline) => pipeline.id === pipelineId);
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
  const setMapping = (name: string, patch: Partial<MappingDraft>) =>
    setDraft((current) => ({
      ...current,
      mapping: {
        ...current.mapping,
        [name]: { ...(current.mapping[name] ?? { mode: "none", field: "", value: "" }), ...patch },
      },
    }));

  const result = triggerInputFromDraft(bot, draft, trigger, target);
  const submit = async () => {
    if (busy || !canSave) return;
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await save({ environmentId, input: result.input });
      if (saved._tag === "Failure") throw squashAtomCommandFailure(saved);
      onSaved(saved.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the trigger.");
    } finally {
      setBusy(false);
    }
  };

  const pullRequest =
    draft.kind === "pull-request-checks-failing" || draft.kind === "pull-request-opened";
  const fields = BOT_TRIGGER_EVENT_FIELDS[draft.kind];
  const projectOptions = projects.map((project) => [project.id as string, project.title] as const);

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={trigger === null ? `New trigger for ${bot.name}` : `Edit ${trigger.name}`}
      description="A trigger runs the bot when something happens. Runs keep the bot's own limits."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !canSave} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save trigger"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LibraryField label="Name">
          <Input value={draft.name} onChange={(event) => update({ name: event.target.value })} />
        </LibraryField>
        {pipelines.length > 0 || draft.pipelineId !== "" ? (
          <Choice
            label="Starts"
            value={draft.pipelineId}
            disabled={trigger !== null}
            options={[
              ["", bot.name] as const,
              ...pipelines.map((pipeline) => [pipeline.id as string, pipeline.name] as const),
              ...(draft.pipelineId !== "" && pipelineOf(draft.pipelineId) === undefined
                ? [[draft.pipelineId, draft.pipelineId] as const]
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
        <Choice
          label="When"
          value={draft.kind}
          options={
            Object.entries(TRIGGER_KIND_LABELS) as ReadonlyArray<[BotTriggerEventKind, string]>
          }
          onChange={(kind) =>
            update({
              kind,
              mapping: trigger === null ? guessMapping(target, kind) : draft.mapping,
            })
          }
        />
        <p className="-mt-2 text-xs text-muted-foreground">{KIND_HINTS[draft.kind]}</p>
        {pullRequest || draft.kind === "thread-settled" ? (
          <Choice
            label="Project"
            value={draft.projectId}
            options={
              draft.kind === "thread-settled"
                ? projectOptions
                : [["", "Any project"] as const, ...projectOptions]
            }
            onChange={(projectId) => update({ projectId })}
          />
        ) : null}
        {pullRequest ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <LibraryField label="Repository (optional)">
              <Input
                placeholder="owner/name"
                value={draft.repository}
                onChange={(event) => update({ repository: event.target.value })}
              />
            </LibraryField>
            <LibraryField label="Branch (optional)">
              <Input
                placeholder="release/*"
                value={draft.branchPattern}
                onChange={(event) => update({ branchPattern: event.target.value })}
              />
            </LibraryField>
          </div>
        ) : null}
        {draft.kind === "schedule" ? (
          <div className="grid gap-3">
            <ToggleGroup
              variant="outline"
              size="sm"
              aria-label="Schedule"
              value={[draft.scheduleType]}
              onValueChange={(values) => {
                const next = values[0];
                if (next === "interval" || next === "fixed_time") update({ scheduleType: next });
              }}
            >
              <Toggle value="interval">Every interval</Toggle>
              <Toggle value="fixed_time">At a time</Toggle>
            </ToggleGroup>
            {draft.scheduleType === "interval" ? (
              <LibraryField label="Every (minutes)">
                <Input
                  inputMode="numeric"
                  value={draft.everyMinutes}
                  onChange={(event) => update({ everyMinutes: event.target.value })}
                />
              </LibraryField>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="time"
                  nativeInput
                  aria-label="Time of day"
                  className="w-32"
                  value={draft.timeOfDay}
                  onChange={(event) => update({ timeOfDay: event.target.value })}
                />
                <ToggleGroup
                  multiple
                  variant="outline"
                  size="sm"
                  aria-label="Days"
                  value={draft.weekdays.map(String)}
                  onValueChange={(values) => update({ weekdays: values.map(Number) })}
                >
                  {WEEKDAY_LABELS.map((label, day) => (
                    <Toggle key={label} value={String(day)}>
                      {label}
                    </Toggle>
                  ))}
                </ToggleGroup>
              </div>
            )}
          </div>
        ) : null}
        {draft.kind === "webhook" ? (
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.signed} onCheckedChange={(signed) => update({ signed })} />
              Check an HMAC-SHA256 signature
            </label>
            {draft.signed ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <LibraryField label="Header">
                  <Input
                    value={draft.signatureHeader}
                    onChange={(event) => update({ signatureHeader: event.target.value })}
                  />
                </LibraryField>
                <LibraryField label="Prefix">
                  <Input
                    value={draft.signaturePrefix}
                    onChange={(event) => update({ signaturePrefix: event.target.value })}
                  />
                </LibraryField>
                <Choice
                  label="Encoding"
                  value={draft.signatureEncoding}
                  options={[
                    ["hex", "hex"],
                    ["base64", "base64"],
                  ]}
                  onChange={(signatureEncoding) => update({ signatureEncoding })}
                />
                <LibraryField label="Secret">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={trigger?.webhook?.hasSecret ? "Unchanged" : "Shared secret"}
                    value={draft.secret}
                    onChange={(event) => update({ secret: event.target.value })}
                  />
                </LibraryField>
              </div>
            ) : null}
          </div>
        ) : null}
        {target.parameters.length > 0 ? (
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Inputs</legend>
            {target.parameters.map((parameter) => {
              const entry = draft.mapping[parameter.name] ?? {
                mode: "none" as const,
                field: "",
                value: "",
              };
              const modes: ReadonlyArray<readonly [MappingMode, string]> = [
                ["field", "From the event"],
                ["value", "Fixed value"],
                ["none", parameter.default === undefined ? "Leave empty" : "Use the default"],
              ];
              return (
                <div key={parameter.name} className="grid gap-2 sm:grid-cols-2">
                  <Choice
                    label={`${parameter.label}${
                      parameter.required && parameter.default === undefined ? " (required)" : ""
                    }`}
                    value={entry.mode}
                    options={modes}
                    onChange={(mode) => setMapping(parameter.name, { mode })}
                  />
                  {entry.mode === "field" ? (
                    draft.kind === "webhook" ? (
                      <LibraryField label="Field">
                        <Input
                          placeholder="body.pull_request.number"
                          value={entry.field}
                          onChange={(event) =>
                            setMapping(parameter.name, { field: event.target.value })
                          }
                        />
                      </LibraryField>
                    ) : (
                      <Choice
                        label="Field"
                        value={entry.field}
                        options={fields.map((field) => [field, field] as const)}
                        onChange={(field) => setMapping(parameter.name, { field })}
                      />
                    )
                  ) : entry.mode === "value" ? (
                    parameter.type === "boolean" ? (
                      <Choice
                        label="Value"
                        value={entry.value === "true" ? "true" : "false"}
                        options={[
                          ["true", "Yes"],
                          ["false", "No"],
                        ]}
                        onChange={(value) => setMapping(parameter.name, { value })}
                      />
                    ) : (
                      <LibraryField label="Value">
                        <Input
                          value={entry.value}
                          onChange={(event) =>
                            setMapping(parameter.name, { value: event.target.value })
                          }
                        />
                      </LibraryField>
                    )
                  ) : null}
                </div>
              );
            })}
          </fieldset>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <LibraryField label="Cooldown (minutes)">
            <Input
              inputMode="numeric"
              value={draft.cooldownMinutes}
              onChange={(event) => update({ cooldownMinutes: event.target.value })}
            />
          </LibraryField>
          <LibraryField label="Runs per day, at most">
            <Input
              inputMode="numeric"
              value={draft.dailyLimit}
              onChange={(event) => update({ dailyLimit: event.target.value })}
            />
          </LibraryField>
        </div>
        {draft.pipelineId !== "" ? null : (
          <Choice<TriggerFollow>
            label="Version to run"
            value={draft.follow}
            options={[
              [
                "pinned",
                trigger ? `v${trigger.pinnedVersion}, saved with this trigger` : `v${bot.version}`,
              ],
              ["latest", "The latest version"],
              ...(stableSupported || draft.follow === "stable"
                ? [["stable", "The stable version, or the latest while none is marked"] as const]
                : []),
            ]}
            onChange={(follow) => update({ follow })}
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} />
          On
        </label>
        {draft.kind === "webhook" || draft.kind === "merge-conflict" ? (
          <p className="text-xs text-muted-foreground">
            {trigger?.webhook
              ? "The address is shown on the trigger."
              : "The address appears after you save."}
          </p>
        ) : null}
        {error !== null || ("error" in result && trigger !== null) ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error ?? ("error" in result ? result.error : null)}
          </p>
        ) : null}
        {!canSave ? (
          <p role="status" className="text-sm text-muted-foreground">
            This connection cannot change triggers.
          </p>
        ) : null}
      </form>
    </LibraryDialog>
  );
}
