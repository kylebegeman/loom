import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  BotBatch,
  BotBatchPreview,
  BotDefinition,
  BotsBatchInput,
  BotTarget,
} from "@t3tools/contracts/fork";
import {
  batchSourceFromDraft,
  botColor,
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
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  FileCodeIcon,
  FolderIcon,
  InfoIcon,
  LayersIcon,
  ListIcon,
  LockIcon,
  SearchIcon,
  TriangleAlertIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
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
import {
  WizardFooter,
  WizardHeader,
  WizardPanel,
  WizardPopup,
  WizardSteps,
} from "~/components/ui/wizard";
import { useProjects, useThreadShells } from "~/state/entities";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
} from "../project-library/LibraryControls";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { useLibraryPermission } from "../project-library/state";
import {
  SOURCE_PROMPTS,
  batchPlanSentence,
  botsErrorReason,
  budgetNote,
  countLines,
  itemParameterNote,
  runOnManyLabel,
  sharedInputErrors,
} from "./batches";
import { BotTargetField } from "./BotAnywhere";
import { BotTile } from "./BotIdentity";
import { ParameterField } from "./BotRunForm";
import { useBotsNavigation } from "./navigation";
import { bots, useBots, useBotsAccess, useBotsHost } from "./state";

const PREVIEW_DEBOUNCE_MS = 400;
/** Enough labels to recognise the source, without a list scrolling inside the scrolling wizard. */
const PREVIEW_SHOWN = 10;
const PREVIEW_SKELETON_ROWS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3"] as const;
const STEPS = ["Items", "Inputs and run"] as const;

const SOURCES: ReadonlyArray<{
  readonly type: BatchSourceType;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
}> = [
  {
    type: "lines",
    label: "Lines",
    icon: ListIcon,
    description: "Each pasted line becomes one item. Blank lines and repeats are dropped.",
  },
  {
    type: "glob",
    label: "Files",
    icon: FileCodeIcon,
    description: "Each tracked file matching a pattern becomes one item.",
  },
  {
    type: "search",
    label: "Search",
    icon: SearchIcon,
    description: "Each file whose name or contents match becomes one item.",
  },
  {
    type: "conflicts",
    label: "Conflicts",
    icon: PullRequestGlyph.merged,
    description: "Each file with a merge conflict becomes one item.",
  },
  {
    type: "pullRequests",
    label: "Pull requests",
    icon: PullRequestGlyph.pullRequest,
    description: "Each open pull request becomes one item.",
  },
];

const SEARCH_MODES = [
  ["files", "File names"],
  ["contents", "File contents"],
] as const;

const GLOB_EXAMPLES = ["src/**/*.ts", "**/*.test.ts", "docs/**/*.md"] as const;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<readonly [T, string]>;
  readonly onChange: (value: T) => void;
}) {
  return (
    <LibraryField label={label}>
      <Select
        value={value}
        onValueChange={(next) => {
          const option = options.find(([key]) => key === next);
          if (option) onChange(option[0]);
        }}
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

/** The Run on many wizard (`many`), over whichever page is open. */
export function BatchesOverlays() {
  const nav = useBotsNavigation();
  const botId = nav.search.many;
  return botId === undefined ? null : <ManyDialog key={botId} botId={botId} />;
}

function ManyDialog({ botId }: { readonly botId: string }) {
  const nav = useBotsNavigation();
  const { host, bots: allBots, list } = useBots();
  const { canSave } = useBotsAccess();
  const environmentId = host.environmentId;
  if (environmentId === null) return null;
  const close = nav.close;
  if (!host.batchesSupported)
    return (
      <BlockedDialog
        title="Batches need a newer server"
        description={`Update ${host.environment?.label ?? "the bots host"} to run a bot on many items.`}
        onClose={close}
      />
    );
  const bot = allBots.find((candidate) => candidate.id === botId);
  if (bot === undefined) {
    if (list.data === null && list.error === null) return null;
    return list.data === null ? (
      <BlockedDialog
        title="Could not load bots"
        description={list.error ?? "The bots host did not answer."}
        action={
          <Button shape="pill" onClick={list.refresh}>
            Try again
          </Button>
        }
        onClose={close}
      />
    ) : (
      <BlockedDialog
        title="This bot no longer exists"
        description="It may have been deleted. Batches it ran are still under Runs."
        onClose={close}
      />
    );
  }
  if (bot.archivedAt !== null)
    return (
      <BlockedDialog
        title={`${bot.name} is archived`}
        description="Restore it to run it on many items."
        action={
          <Button shape="pill" render={<Link to="/loom/bots" search={{ bot: bot.id }} />}>
            Open {bot.name}
          </Button>
        }
        onClose={close}
      />
    );
  if (bot.parameters.length === 0)
    return (
      <BlockedDialog
        title={`${bot.name} takes no inputs`}
        description={`A batch fills one input per item. Add an input to ${bot.name} to run it on many items.`}
        action={
          canSave ? (
            <Button
              shape="pill"
              render={<Link to="/loom/bots" search={{ bot: bot.id, edit: true }} />}
            >
              Edit {bot.name}
            </Button>
          ) : null
        }
        onClose={close}
      />
    );
  return (
    <RunOnManyWizard
      environmentId={environmentId}
      bot={bot}
      onStarted={(batch) => {
        const from = nav.search.bot;
        // Closing first replaces the wizard's entry, so Back from the batch never reopens it.
        nav.close();
        nav.open({ batch: batch.id, ...(from ? { bot: from } : {}) });
      }}
      onClose={close}
    />
  );
}

/** Why the wizard cannot open for this bot, with the one way forward. */
function BlockedDialog({
  title,
  description,
  action,
  onClose,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup>
        <WizardHeader title={title} description={description} />
        <WizardFooter>
          <Button shape="pill" variant="ghost" onClick={onClose}>
            Close
          </Button>
          {action}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

/**
 * Runs one bot over many items in two steps: where the items come from, beside a live preview of
 * them, then the input each fills, the inputs they share, and what starting will do.
 */
function RunOnManyWizard({
  environmentId,
  bot,
  onStarted,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly onStarted: (batch: BotBatch) => void;
  readonly onClose: () => void;
}) {
  const host = useBotsHost();
  const canStart = useLibraryPermission(bots.runBatch, environmentId) && host.connected;
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<BatchSourceDraft>(emptyBatchSourceDraft);
  const [itemParameter, setItemParameter] = useState(() => defaultItemParameter(bot));
  const [values, setValues] = useState(() => initialRunValues(bot));
  const [chosenProjectId, setChosenProjectId] = useState<ProjectId | null>(null);
  const [target, setTarget] = useState<BotTarget>({ type: "here" });
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runBatch = useAtomCommand(bots.runBatch, { reportFailure: false });

  const fixedProjectId =
    (bot.workspace.type === "project" ? bot.workspace.projectId : null) ?? bot.scopeProjectId;
  const pickProject =
    fixedProjectId === null &&
    (needsProject(bot) || (bot.workspace.type === "scratch" && sourceNeedsProject(draft.type)));
  const chosenProject =
    projects.find((project) => project.id === chosenProjectId) ?? projects[0] ?? null;
  const projectId = fixedProjectId ?? (pickProject ? (chosenProject?.id ?? null) : null);
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const fileSource = readsFiles(draft.type);
  const shells = useThreadShells(fileSource);
  const checkouts =
    fileSource && projectId !== null
      ? checkoutChoices(
          shells.filter((shell) => shell.environmentId === environmentId),
          projectId,
        )
      : [];
  const checkoutGone =
    fileSource &&
    draft.checkoutThreadId !== "" &&
    !checkouts.some((choice) => choice.threadId === draft.checkoutThreadId);
  const update = (patch: Partial<BatchSourceDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const chooseSource = (type: BatchSourceType) =>
    // A checkout only means something to sources that read files, so others drop it.
    update(readsFiles(type) ? { type } : { type, checkoutThreadId: "" });

  const source = batchSourceFromDraft(checkoutGone ? { ...draft, checkoutThreadId: "" } : draft);
  const projectMissing = pickProject && projectId === null;
  const shared = runInputs(
    bot,
    Object.fromEntries(Object.entries(values).filter(([name]) => name !== itemParameter)),
  );
  const sharedErrors = sharedInputErrors(bot.parameters, itemParameter, values);
  const sharedErrorCount = Object.keys(sharedErrors).length;
  const input: BotsBatchInput | null =
    source === null || itemParameter === "" || projectMissing
      ? null
      : {
          botId: bot.id,
          source,
          itemParameter,
          ...(projectId === null ? {} : { projectId }),
          ...(Object.keys(shared).length === 0 ? {} : { sharedInputs: shared }),
        };
  // Debounced as a string, since a new object every render would never settle.
  const inputKey = JSON.stringify(input);
  const sentKey = useDebouncedValue(inputKey, PREVIEW_DEBOUNCE_MS);
  const sent = useMemo(() => JSON.parse(sentKey) as BotsBatchInput | null, [sentKey]);
  const settled = sentKey === inputKey;
  const preview = useEnvironmentQuery(
    sent === null ? null : bots.previewBatch({ environmentId, input: sent }),
  );
  const previewed = input === null || sent === null ? null : preview.data;
  const refused = preview.error !== null && botsErrorReason(preview.failure) === "invalid";
  const total = previewed?.total ?? 0;
  const itemsReady = settled && previewed !== null && preview.error === null && total > 0;
  const invalidItems = itemsReady ? previewed.invalid : [];
  const canSubmit =
    !busy && canStart && itemsReady && (invalidItems.length === 0 || sharedErrorCount > 0);

  const targetQuery = useEnvironmentQuery(
    host.anywhereSupported && target.type === "environment"
      ? bots.targets({
          environmentId,
          input: { botId: bot.id, ...(projectId === null ? {} : { projectId }) },
        })
      : null,
  );
  const targetLabel =
    target.type === "environment"
      ? (targetQuery.data?.targets.find(
          (candidate) => candidate.environmentId === target.environmentId,
        )?.label ?? null)
      : null;

  const submit = async () => {
    setAttempted(true);
    if (!canSubmit || input === null || sharedErrorCount > 0 || invalidItems.length > 0) return;
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
      setError(
        cause instanceof Error && cause.message ? cause.message : `Could not run ${bot.name}.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const accessNotice = !host.connected ? (
    <LibraryNotice icon={WifiOffIcon} tone="warning">
      Offline. The batch can start once {host.environment?.label ?? "the bots host"} reconnects.
    </LibraryNotice>
  ) : !canStart ? (
    <LibraryNotice icon={LockIcon}>
      This connection can look at items but cannot start batches.
    </LibraryNotice>
  ) : null;
  const sourceInfo = SOURCES.find((candidate) => candidate.type === draft.type);
  const itemParam = bot.parameters.find((parameter) => parameter.name === itemParameter);
  const shareable = bot.parameters.filter((parameter) => parameter.name !== itemParameter);
  const firstItem = previewed?.items[0];
  const firstValue = firstItem?.inputs[itemParameter];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup size="wide">
        {/* WizardPopup takes no style, and its portal sits outside the page's color scope. */}
        <div className="contents" style={projectColorStyle(botColor(bot))}>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (step === 0) {
                if (itemsReady) setStep(1);
              } else void submit();
            }}
          >
            <WizardHeader
              title={`Run ${bot.name} on many`}
              identity={
                <div className="flex min-w-0 items-center gap-3">
                  <BotTile bot={bot} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold tracking-tight">
                      Run {bot.name} on many
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      v{bot.version}, once per item, with the bot's own limits
                    </p>
                  </div>
                </div>
              }
            >
              <WizardSteps
                steps={STEPS}
                currentStep={step}
                summaries={[itemsReady ? plural(total, "item") : null, null]}
                showSummaries
                isStepDisabled={(index) => index === 1 && !itemsReady}
                onStepChange={setStep}
              />
            </WizardHeader>
            <WizardPanel>
              <div key={step} className="grid gap-5">
                {accessNotice}
                {step === 0 ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <ToggleGroup
                        shape="pill"
                        variant="segmented"
                        aria-label="Where the items come from"
                        value={[draft.type]}
                        onValueChange={(next) => {
                          const chosen = SOURCES.find((candidate) => candidate.type === next[0]);
                          if (chosen) chooseSource(chosen.type);
                        }}
                      >
                        {SOURCES.map(({ type, label, icon: Icon }) => (
                          <ToggleGroupItem key={type} value={type} aria-label={label}>
                            <Icon aria-hidden />
                            <span className="max-sm:sr-only">{label}</span>
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <p className="text-xs text-muted-foreground">
                        {sourceInfo?.description} A batch holds up to 200 items.
                      </p>
                    </div>
                    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
                      <div className="grid min-w-0 gap-4">
                        <SourceFields
                          draft={draft}
                          update={update}
                          checkoutLabel={
                            draft.checkoutThreadId === "" || checkoutGone
                              ? null
                              : (checkouts.find(
                                  (choice) => choice.threadId === draft.checkoutThreadId,
                                )?.label ?? null)
                          }
                        />
                        {pickProject && projects.length === 0 ? (
                          <LibraryNotice icon={FolderIcon}>
                            {needsProject(bot)
                              ? `${bot.name} runs in a project you choose, and this computer has none yet. Add a project first.`
                              : `${draft.type === "pullRequests" ? "Pull requests" : "Files"} are read from a project, and this computer has none yet. Add a project to use this source.`}
                          </LibraryNotice>
                        ) : null}
                        {(pickProject && projects.length > 0) ||
                        (fileSource && projectId !== null) ? (
                          <div className="grid gap-4 sm:grid-cols-2">
                            {pickProject && projects.length > 0 ? (
                              <Choice
                                label="Project"
                                value={chosenProject?.id ?? ""}
                                options={projects.map(
                                  (candidate) => [candidate.id, candidate.title] as const,
                                )}
                                onChange={(next) => {
                                  setChosenProjectId(
                                    projects.find((candidate) => candidate.id === next)?.id ?? null,
                                  );
                                  update({ checkoutThreadId: "" });
                                }}
                              />
                            ) : null}
                            {fileSource && projectId !== null ? (
                              <Choice
                                label="Checkout"
                                value={checkoutGone ? "" : draft.checkoutThreadId}
                                options={[
                                  ["", "Project root"] as const,
                                  ...checkouts.map(
                                    (choice) => [String(choice.threadId), choice.label] as const,
                                  ),
                                ]}
                                onChange={(checkoutThreadId) => update({ checkoutThreadId })}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        {!pickProject && sourceNeedsProject(draft.type) && project ? (
                          <p className="text-xs text-muted-foreground">
                            Read from {project.title}, the project {bot.name} works in.
                          </p>
                        ) : null}
                        {checkoutGone ? (
                          <LibraryNotice icon={InfoIcon}>
                            That checkout is gone, so the project root is used.
                          </LibraryNotice>
                        ) : null}
                      </div>
                      <PreviewPane
                        prompt={
                          projectMissing
                            ? "Choose a project to find its items."
                            : draft.type === "lines" ||
                                draft.type === "glob" ||
                                draft.type === "search"
                              ? SOURCE_PROMPTS[draft.type]
                              : null
                        }
                        idle={input === null}
                        settled={settled}
                        previewed={previewed}
                        error={preview.error}
                        refused={refused}
                        onRetry={preview.refresh}
                        sharedErrorCount={sharedErrorCount}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-2">
                      {bot.parameters.length > 1 ? (
                        <Choice
                          label="Each item fills"
                          value={itemParameter}
                          options={bot.parameters.map(
                            (parameter) => [parameter.name, parameter.label] as const,
                          )}
                          onChange={setItemParameter}
                        />
                      ) : (
                        <p className="text-sm">
                          Each item fills{" "}
                          <span className="font-medium">{itemParam?.label ?? itemParameter}</span>,
                          the only input {bot.name} takes.
                        </p>
                      )}
                      {firstItem && firstValue !== undefined ? (
                        <p className="min-w-0 truncate text-xs text-muted-foreground">
                          The first item sets {itemParam?.label ?? itemParameter} to{" "}
                          <span className="font-mono text-foreground">{String(firstValue)}</span>
                        </p>
                      ) : null}
                      {itemParameterNote(itemParam) ? (
                        <p className="text-xs text-muted-foreground">
                          {itemParameterNote(itemParam)}
                        </p>
                      ) : null}
                    </div>
                    {shareable.length > 0 ? (
                      <fieldset className="grid gap-4 sm:grid-cols-2">
                        <legend className="mb-3 text-sm font-medium">Shared by every item</legend>
                        {shareable.map((parameter) => (
                          <div
                            key={parameter.name}
                            className={parameter.type === "text" ? "sm:col-span-2" : undefined}
                          >
                            <ParameterField
                              parameter={parameter}
                              value={values[parameter.name] ?? ""}
                              onChange={(value) =>
                                setValues((current) => ({ ...current, [parameter.name]: value }))
                              }
                              error={attempted ? (sharedErrors[parameter.name] ?? null) : null}
                            />
                          </div>
                        ))}
                      </fieldset>
                    ) : null}
                    {host.anywhereSupported ? (
                      <BotTargetField
                        environmentId={environmentId}
                        botId={bot.id}
                        projectId={projectId}
                        value={target}
                        onChange={setTarget}
                      />
                    ) : null}
                    <section
                      aria-label="What starting does"
                      className="flex flex-col gap-1 rounded-xl bg-muted/50 px-4 py-3 text-sm dark:bg-accent/50"
                    >
                      {itemsReady ? (
                        <>
                          <p className="font-medium">
                            {batchPlanSentence({
                              bot,
                              total,
                              type: draft.type,
                              target,
                              targetLabel,
                            })}
                          </p>
                          {budgetNote(bot, total) ? (
                            <p className="text-xs text-muted-foreground">
                              {budgetNote(bot, total)}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p role="status" className="text-muted-foreground">
                          Checking the items…
                        </p>
                      )}
                    </section>
                    {invalidItems.length > 0 && sharedErrorCount === 0 ? (
                      <LibraryNotice
                        icon={TriangleAlertIcon}
                        tone="danger"
                        action={
                          <Button
                            shape="pill"
                            size="xs"
                            variant="outline"
                            onClick={() => setStep(0)}
                          >
                            Back to items
                          </Button>
                        }
                      >
                        <p>
                          {invalidItems.length === 1
                            ? "One item cannot run as it is:"
                            : "Some items cannot run as they are:"}
                        </p>
                        <InvalidList invalid={invalidItems} />
                      </LibraryNotice>
                    ) : null}
                    <LibraryErrorNotice error={error} />
                  </>
                )}
              </div>
            </WizardPanel>
            <WizardFooter
              leading={
                step === 1 ? (
                  <Button shape="pill" variant="outline" onClick={() => setStep(0)}>
                    Back
                  </Button>
                ) : undefined
              }
            >
              <Button shape="pill" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {step === 0 ? (
                <Button shape="pill" type="submit" disabled={!itemsReady}>
                  Next
                </Button>
              ) : (
                <Button shape="pill" type="submit" disabled={!canSubmit}>
                  <LayersIcon />
                  {busy ? "Starting…" : runOnManyLabel(draft.type, total)}
                </Button>
              )}
            </WizardFooter>
          </form>
        </div>
      </WizardPopup>
    </Dialog>
  );
}

function SourceFields({
  draft,
  update,
  checkoutLabel,
}: {
  readonly draft: BatchSourceDraft;
  readonly update: (patch: Partial<BatchSourceDraft>) => void;
  readonly checkoutLabel: string | null;
}) {
  switch (draft.type) {
    case "lines": {
      const count = countLines(draft.lines);
      return (
        <div className="grid gap-1.5">
          <LibraryField label="One item per line">
            <Textarea
              rows={8}
              value={draft.lines}
              placeholder={"apps/web/src/App.tsx\napps/web/src/main.tsx"}
              onChange={(event) => update({ lines: event.target.value })}
            />
          </LibraryField>
          <p className="text-xs tabular-nums text-muted-foreground">
            {count === 0 ? "Nothing pasted yet." : `${plural(count, "distinct line")}.`}
          </p>
        </div>
      );
    }
    case "glob":
      return (
        <div className="grid gap-2">
          <LibraryField label="Pattern">
            <Input
              placeholder="apps/web/src/**/*.tsx"
              value={draft.pattern}
              onChange={(event) => update({ pattern: event.target.value })}
            />
          </LibraryField>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">For example</span>
            {GLOB_EXAMPLES.map((example) => (
              <Button
                key={example}
                shape="pill"
                size="xs"
                variant="outline"
                onClick={() => update({ pattern: example })}
              >
                <span className="font-mono">{example}</span>
              </Button>
            ))}
          </div>
        </div>
      );
    case "search":
      return (
        <div className="grid gap-3">
          <div className="flex flex-col gap-2">
            <p id="run-on-many-search" className="text-sm font-medium">
              Match
            </p>
            <ToggleGroup
              shape="pill"
              variant="segmented"
              aria-labelledby="run-on-many-search"
              value={[draft.searchMode]}
              onValueChange={(next) => {
                const mode = SEARCH_MODES.find(([candidate]) => candidate === next[0])?.[0];
                if (mode) update({ searchMode: mode });
              }}
            >
              {SEARCH_MODES.map(([mode, label]) => (
                <ToggleGroupItem key={mode} value={mode}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <LibraryField label="Text">
            <Input
              value={draft.query}
              placeholder={draft.searchMode === "files" ? "Button" : "TODO"}
              onChange={(event) => update({ query: event.target.value })}
            />
          </LibraryField>
        </div>
      );
    case "pullRequests":
      return (
        <LibraryField label="Filter (optional)">
          <Input
            value={draft.query}
            placeholder="Leave blank for every open pull request"
            onChange={(event) => update({ query: event.target.value })}
          />
        </LibraryField>
      );
    case "conflicts":
      return (
        <p className="text-sm text-muted-foreground">
          Finds every file with a merge conflict in {checkoutLabel ?? "the project root"}. Choose a
          checkout below for a merge in progress in a thread's worktree.
        </p>
      );
  }
}

function InvalidList({ invalid }: { readonly invalid: BotBatchPreview["invalid"] }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {invalid.map((item) => (
        <li key={`${item.label}\n${item.message}`} className="wrap-anywhere">
          <span className="font-mono text-xs">{item.label}</span>: {item.message}
        </li>
      ))}
    </ul>
  );
}

/** What the source finds, beside the fields that shape it, so a change shows its effect at once. */
function PreviewPane({
  prompt,
  idle,
  settled,
  previewed,
  error,
  refused,
  onRetry,
  sharedErrorCount,
}: {
  /** What to fill in before there is anything to show. */
  readonly prompt: string | null;
  readonly idle: boolean;
  readonly settled: boolean;
  readonly previewed: BotBatchPreview | null;
  readonly error: string | null;
  /** The server turned the source down, such as for matching nothing; retrying cannot help. */
  readonly refused: boolean;
  readonly onRetry: () => void;
  readonly sharedErrorCount: number;
}) {
  let body: ReactNode;
  if (idle)
    body = (
      <p className="text-sm text-muted-foreground">
        {prompt ?? "Fill in the source to see its items."}
      </p>
    );
  else if (error !== null && settled)
    body = refused ? (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No items</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    ) : (
      <LibraryErrorNotice error={error} onRetry={onRetry} />
    );
  else if (previewed === null)
    body = (
      <div role="status" aria-label="Finding items" className="flex flex-col gap-2.5">
        <Skeleton className="h-7 w-16" />
        {PREVIEW_SKELETON_ROWS.map((width) => (
          <div key={width} className={width}>
            <Skeleton className="h-3" />
          </div>
        ))}
      </div>
    );
  else {
    const more = previewed.total - Math.min(previewed.items.length, PREVIEW_SHOWN);
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {previewed.total}
            </span>
            <span className="text-sm text-muted-foreground">
              {previewed.total === 1 ? "item" : "items"}
            </span>
            {settled ? null : (
              <span role="status" className="ms-auto text-xs text-muted-foreground">
                Updating…
              </span>
            )}
          </p>
          <p className="text-xs wrap-anywhere text-muted-foreground">{previewed.sourceSummary}</p>
        </div>
        {previewed.items.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {previewed.items.slice(0, PREVIEW_SHOWN).map((item) => (
              <li key={JSON.stringify(item.inputs)} className="truncate py-1.5 font-mono text-xs">
                {item.label}
              </li>
            ))}
          </ul>
        ) : null}
        {more > 0 ? (
          <p className="text-xs tabular-nums text-muted-foreground">and {more} more</p>
        ) : null}
        {previewed.note ? <p className="text-xs text-muted-foreground">{previewed.note}</p> : null}
        {previewed.invalid.length > 0 ? (
          sharedErrorCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Some items wait on inputs every item shares. Set them in the next step.
            </p>
          ) : (
            <div className="flex flex-col gap-1 text-xs text-destructive-foreground">
              <p className="font-medium">
                {previewed.invalid.length === 1
                  ? "One item cannot run as it is:"
                  : "Some items cannot run as they are:"}
              </p>
              <InvalidList invalid={previewed.invalid} />
            </div>
          )
        ) : null}
      </div>
    );
  }
  return (
    <section
      aria-label="Items found"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border px-4 py-3.5"
    >
      <h3 className="text-xs font-medium text-muted-foreground">Items found</h3>
      {body}
    </section>
  );
}
