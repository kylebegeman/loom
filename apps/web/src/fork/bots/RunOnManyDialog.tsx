import { useMemo, useState } from "react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { BotBatch, BotDefinition, BotsBatchInput, BotTarget } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { InfoIcon, LayersIcon, ListChecksIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useProjects, useThreadShells } from "~/state/entities";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LibraryDialog,
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { BotTargetField } from "./BotAnywhere";
import { ParameterField } from "./BotRunForm";
import { BotsEmptyList } from "./BotRuns";
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
const PREVIEW_SKELETON_ROWS = ["w-2/5", "w-3/5", "w-1/2"];

const SEARCH_MODES = [
  ["files", "File names"],
  ["contents", "File contents"],
] as const;

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
          <Button shape="pill" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button shape="pill" disabled={busy || !canRun || !ready} onClick={() => void submit()}>
            <LayersIcon />
            {busy ? "Starting…" : runLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {bot.parameters.length === 0 ? (
          <LibraryNotice icon={InfoIcon} tone="warning">
            This bot takes no inputs, so there is nothing for each item to fill.
          </LibraryNotice>
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
          <div className="flex flex-col gap-2">
            <p id="run-on-many-search" className="text-sm font-medium">
              Search
            </p>
            <ToggleGroup
              shape="pill"
              variant="segmented"
              aria-labelledby="run-on-many-search"
              value={[draft.searchMode]}
              onValueChange={(next) => {
                const searchMode = SEARCH_MODES.find(([mode]) => mode === next[0])?.[0];
                if (searchMode) update({ searchMode });
              }}
            >
              {SEARCH_MODES.map(([mode, label]) => (
                <ToggleGroupItem key={mode} value={mode}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
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
        <section aria-label="Preview" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Preview</h3>
          {input === null ? (
            <BotsEmptyList icon={ListChecksIcon} message="Fill in the source to see the items." />
          ) : !settled || (preview.isPending && !preview.data) ? (
            <div
              role="status"
              aria-label="Finding items"
              className="flex flex-col divide-y divide-border rounded-xl border border-border"
            >
              {PREVIEW_SKELETON_ROWS.map((width) => (
                <div key={width} className="px-3.5 py-2.5">
                  <div className={width}>
                    <Skeleton className="h-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : preview.error ? (
            <LibraryErrorNotice error={preview.error} onRetry={preview.refresh} />
          ) : previewed ? (
            <>
              <div className="flex flex-col overflow-hidden rounded-xl border border-border">
                <div className="flex min-w-0 items-center gap-3 border-b border-border px-3.5 py-2.5">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {previewed.sourceSummary}
                  </p>
                  <LibraryStateBadge tone={previewed.invalid.length > 0 ? "danger" : "neutral"}>
                    {total} item{total === 1 ? "" : "s"}
                  </LibraryStateBadge>
                </div>
                {previewed.note ? (
                  <p className="border-b border-border px-3.5 py-2 text-xs text-muted-foreground">
                    {previewed.note}
                  </p>
                ) : null}
                {previewed.items.length > 0 ? (
                  <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto">
                    {previewed.items.map((item) => (
                      <li
                        key={JSON.stringify(item.inputs)}
                        className="truncate px-3.5 py-1.5 font-mono text-xs"
                      >
                        {item.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {total > previewed.items.length + previewed.invalid.length ? (
                  <p className="border-t border-border px-3.5 py-2 text-xs text-muted-foreground">
                    And {total - previewed.items.length - previewed.invalid.length} more.
                  </p>
                ) : null}
              </div>
              {previewed.invalid.length > 0 ? (
                <LibraryNotice icon={TriangleAlertIcon} tone="danger">
                  <p>Fix these items before running:</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {previewed.invalid.map((item) => (
                      <li key={`${item.label}\n${item.message}`} className="wrap-anywhere">
                        <span className="font-mono text-xs">{item.label}</span>: {item.message}
                      </li>
                    ))}
                  </ul>
                </LibraryNotice>
              ) : null}
            </>
          ) : null}
        </section>
        {checkout === undefined && draft.checkoutThreadId !== "" ? (
          <LibraryNotice icon={InfoIcon}>
            That checkout is gone; the project root is used.
          </LibraryNotice>
        ) : null}
        <LibraryErrorNotice error={error} />
        {!canRun ? (
          <LibraryNotice icon={LockIcon}>This connection cannot run bots.</LibraryNotice>
        ) : null}
      </form>
    </LibraryDialog>
  );
}
