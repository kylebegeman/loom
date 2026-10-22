import { useMemo, useState } from "react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { BotBatch, BotDefinition, BotsBatchInput, BotTarget } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { useProjects, useThreadShells } from "~/state/entities";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { BotTargetField } from "./BotAnywhere";
import { ParameterField } from "./BotRunForm";
import {
  batchSourceFromDraft,
  checkoutChoices,
  defaultItemParameter,
  emptyBatchSourceDraft,
  initialRunValues,
  needsProject,
  readsFiles,
  runInputs,
  sourceNeedsProject,
  type BatchSourceDraft,
  type BatchSourceType,
} from "@t3tools/client-runtime/fork";
import { bots, useBotsHost } from "./state";

const PREVIEW_DEBOUNCE_MS = 400;

const SOURCE_LABELS: Record<BatchSourceType, string> = {
  lines: "Pasted lines",
  glob: "Files matching a pattern",
  conflicts: "Merge conflicts",
  pullRequests: "Open pull requests",
  search: "Search results",
};

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<readonly [T, string]>;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  return (
    <LibraryField label={label}>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => next !== null && onChange(next as T)}
      >
        <SelectTrigger size="sm">
          <SelectValue>{options.find(([key]) => key === value)?.[1] ?? "Choose…"}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {options.map(([key, text]) => (
            <SelectItem key={key} value={key} label={text}>
              <span className="block truncate">{text}</span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </LibraryField>
  );
}

/** Runs one bot over many items: a source, the input each item fills, and inputs they share. */
export function RunOnManyDialog({
  environmentId,
  bot,
  canRun,
  onStarted,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly canRun: boolean;
  readonly onStarted: (batch: BotBatch) => void;
  readonly onClose: () => void;
}) {
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [draft, setDraft] = useState<BatchSourceDraft>(emptyBatchSourceDraft);
  const [itemParameter, setItemParameter] = useState(() => defaultItemParameter(bot));
  const [values, setValues] = useState(() => initialRunValues(bot));
  const fixedProjectId =
    (bot.workspace.type === "project" ? bot.workspace.projectId : null) ?? bot.scopeProjectId;
  const pickProject =
    needsProject(bot) || (bot.workspace.type === "scratch" && sourceNeedsProject(draft.type));
  const [chosenProjectId, setChosenProjectId] = useState(() => projects[0]?.id ?? "");
  const projectId = fixedProjectId ?? (pickProject ? chosenProjectId : "");
  const fileSource = readsFiles(draft.type);
  const shells = useThreadShells(fileSource);
  const checkouts = fileSource
    ? checkoutChoices(
        shells.filter((shell) => shell.environmentId === environmentId),
        projectId,
      )
    : [];
  const checkout = checkouts.find((choice) => choice.threadId === draft.checkoutThreadId);
  const update = (patch: Partial<BatchSourceDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const source = batchSourceFromDraft(draft);
  const shared = runInputs(
    bot,
    Object.fromEntries(Object.entries(values).filter(([name]) => name !== itemParameter)),
  );
  const input: BotsBatchInput | null =
    source === null || itemParameter === ""
      ? null
      : {
          botId: bot.id,
          source,
          itemParameter,
          ...(projectId === "" ? {} : { projectId: projectId as ProjectId }),
          ...(Object.keys(shared).length === 0 ? {} : { sharedInputs: shared }),
        };
  // A string key, since a new object every render would never settle the debounce.
  const sentKey = useDebouncedValue(JSON.stringify(input), PREVIEW_DEBOUNCE_MS);
  const sent = useMemo(() => JSON.parse(sentKey) as BotsBatchInput | null, [sentKey]);
  const settled = sentKey === JSON.stringify(input);
  const preview = useEnvironmentQuery(
    sent === null ? null : bots.previewBatch({ environmentId, input: sent }),
  );
  const previewed = settled && sent !== null ? preview.data : null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runBatch = useAtomCommand(bots.runBatch, { reportFailure: false });
  const anywhereSupported = useBotsHost().anywhereSupported;
  const [target, setTarget] = useState<BotTarget>({ type: "here" });

  const total = previewed?.total ?? 0;
  const ready = previewed !== null && previewed.invalid.length === 0 && total > 0;
  const submit = async () => {
    if (busy || !canRun || input === null || !ready) return;
    setBusy(true);
    setError(null);
    try {
      // Items are found on this computer; only their runs go where the target says.
      const result = await runBatch({
        environmentId,
        input: target.type === "here" ? input : { ...input, target },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onStarted(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not run ${bot.name}.`);
    } finally {
      setBusy(false);
    }
  };

  const otherParameters = bot.parameters.filter((parameter) => parameter.name !== itemParameter);
  const runLabel =
    draft.type === "conflicts"
      ? `Resolve all ${total} conflict${total === 1 ? "" : "s"}`
      : `Run on ${total} item${total === 1 ? "" : "s"}`;

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Run ${bot.name} on many`}
      description="Choose where the items come from and which input each one fills. Every item runs with the bot's own limits."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !canRun || !ready} onClick={() => void submit()}>
            {busy ? "Starting…" : runLabel}
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
        {bot.parameters.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            This bot takes no inputs, so there is nothing for each item to fill.
          </p>
        ) : null}
        <Choice
          label="Items"
          value={draft.type}
          options={Object.entries(SOURCE_LABELS) as ReadonlyArray<[BatchSourceType, string]>}
          onChange={(type) => update({ type })}
        />
        {draft.type === "lines" ? (
          <LibraryField label="One item per line">
            <Textarea
              rows={6}
              value={draft.lines}
              onChange={(event) => update({ lines: event.target.value })}
            />
          </LibraryField>
        ) : null}
        {draft.type === "glob" ? (
          <LibraryField label="Pattern">
            <Input
              placeholder="apps/web/src/**/*.tsx"
              value={draft.pattern}
              onChange={(event) => update({ pattern: event.target.value })}
            />
          </LibraryField>
        ) : null}
        {draft.type === "search" ? (
          <Choice
            label="Search"
            value={draft.searchMode}
            options={[
              ["files", "File names"],
              ["contents", "File contents"],
            ]}
            onChange={(searchMode) => update({ searchMode })}
          />
        ) : null}
        {draft.type === "search" || draft.type === "pullRequests" ? (
          <LibraryField label={draft.type === "search" ? "Text" : "Filter (optional)"}>
            <Input
              value={draft.query}
              onChange={(event) => update({ query: event.target.value })}
            />
          </LibraryField>
        ) : null}
        {pickProject && fixedProjectId === null ? (
          <Choice
            label="Project"
            value={chosenProjectId}
            options={projects.map((project) => [project.id, project.title] as const)}
            onChange={(next) => {
              setChosenProjectId(next);
              update({ checkoutThreadId: "" });
            }}
          />
        ) : null}
        {fileSource && projectId !== "" ? (
          <Choice
            label="Checkout"
            value={draft.checkoutThreadId}
            options={[
              ["", "Project root"] as const,
              ...checkouts.map((choice) => [choice.threadId as string, choice.label] as const),
            ]}
            onChange={(checkoutThreadId) => update({ checkoutThreadId })}
          />
        ) : null}
        {anywhereSupported ? (
          <BotTargetField
            environmentId={environmentId}
            botId={bot.id}
            projectId={projectId === "" ? null : (projectId as ProjectId)}
            value={target}
            onChange={setTarget}
          />
        ) : null}
        {bot.parameters.length > 1 ? (
          <Choice
            label="Each item fills"
            value={itemParameter}
            options={bot.parameters.map((parameter) => [parameter.name, parameter.label] as const)}
            onChange={setItemParameter}
          />
        ) : null}
        {otherParameters.length > 0 ? (
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Shared by every item</legend>
            {otherParameters.map((parameter) => (
              <ParameterField
                key={parameter.name}
                parameter={parameter}
                value={values[parameter.name] ?? ""}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [parameter.name]: value }))
                }
              />
            ))}
          </fieldset>
        ) : null}
        <section
          aria-label="Preview"
          className="space-y-2 rounded-lg border border-border p-3 text-sm"
        >
          {input === null ? (
            <p className="text-muted-foreground">Fill in the source to see the items.</p>
          ) : !settled || (preview.isPending && !preview.data) ? (
            <p role="status" className="text-muted-foreground">
              Finding items…
            </p>
          ) : preview.error ? (
            <p role="alert" className="text-destructive-foreground">
              {preview.error}
            </p>
          ) : previewed ? (
            <>
              <p className="font-medium">{previewed.sourceSummary}</p>
              {previewed.note ? <p className="text-muted-foreground">{previewed.note}</p> : null}
              <ul className="space-y-0.5">
                {previewed.items.map((item) => (
                  <li key={JSON.stringify(item.inputs)} className="truncate">
                    {item.label}
                  </li>
                ))}
              </ul>
              {total > previewed.items.length + previewed.invalid.length ? (
                <p className="text-muted-foreground">
                  And {total - previewed.items.length - previewed.invalid.length} more.
                </p>
              ) : null}
              {previewed.invalid.length > 0 ? (
                <div role="alert" className="text-destructive-foreground">
                  <p>Fix these items before running:</p>
                  <ul>
                    {previewed.invalid.map((item) => (
                      <li key={`${item.label}\n${item.message}`}>
                        {item.label}: {item.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
        {checkout === undefined && draft.checkoutThreadId !== "" ? (
          <p role="status" className="text-sm text-muted-foreground">
            That checkout is gone; the project root is used.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
        {!canRun ? (
          <p role="status" className="text-sm text-muted-foreground">
            This connection cannot run bots.
          </p>
        ) : null}
      </form>
    </LibraryDialog>
  );
}
