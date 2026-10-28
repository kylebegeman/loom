import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useCanGoBack } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_MAX_PARAMETERS,
  BOTS_PIPELINE_MAX_ROUNDS,
  BOTS_PIPELINE_MAX_STEPS,
  BOTS_PIPELINE_TEMPLATE_MAX,
  BOTS_VERSIONS_MAX_LIMIT,
  slugFromName,
  type BotDefinition,
  type BotParameter,
  type BotPipeline,
  type BotPipelineGate,
  type BotPipelineId,
  type BotPipelineInput,
} from "@t3tools/contracts/fork";
import {
  emptyPipelineDraft,
  needsProject,
  newParameterDraft,
  pipelineDraft,
  pipelineInputFromDraft,
  type BotParameterDraft,
  type PipelineDraft,
  type PipelineFailChoice,
  type PipelineStepDraft,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EllipsisIcon,
  FlagIcon,
  LayersIcon,
  LockIcon,
  PlusIcon,
  RefreshCwIcon,
  TextCursorInputIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Input } from "~/components/ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryEditorBar, useUnsavedChangesGuard } from "../project-library/LibraryEditor";
import {
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { BotTargetField } from "./BotAnywhere";
import { Choice, ParameterRow } from "./BotEditor";
import { BotTile, runTime } from "./BotIdentity";
import { BotModelPicker } from "./BotModelPicker";
import {
  PIPELINES_TAB,
  PipelineTile,
  WithReason,
  actionReason,
  pipelineColorStyle,
  plural,
} from "./BotPipelines";
import { useBotsNavigation } from "./navigation";
import {
  builderProblems,
  canTakeInputName,
  canTakeStepId,
  changeStepBot,
  draftProblems,
  expectedVersionFor,
  gateSummary,
  inputUsage,
  insertStep,
  isDraftDirty,
  itemSources,
  loopTargets,
  mappingSummary,
  moveStep,
  removeStep,
  renameInputReferences,
  renameReferences,
  saveRequest,
  stepReaders,
  stepSources,
  type BuilderProblem,
  type StepSource,
} from "./pipelineDraft";
import {
  bots,
  useBots,
  useBotsAccess,
  useBotsHost,
  usePipelines,
  useRefreshOnReconnect,
} from "./state";

const CHECK_DEBOUNCE_MS = 400;
/** The open-card key of the pipeline's inputs, which sit first in the flow like a step. */
const INPUTS_KEY = "inputs";

const FAIL_LABELS: Record<PipelineFailChoice, string> = {
  stop: "Stop the pipeline",
  continue: "Carry on",
  loop: "Go back to a step",
};
const GATE_LABELS: Record<BotPipelineGate, string> = {
  stop: "Stop the pipeline",
  continue: "Carry on",
};
const ROUND_CHOICES = Array.from({ length: BOTS_PIPELINE_MAX_ROUNDS }, (_, index) =>
  String(index + 1),
);
const VERSION_LABELS = { latest: "Latest", stable: "Stable", number: "A fixed version" } as const;

// Select values that are not references, kept apart from `{{…}}` templates.
const EMPTY = "empty";
const CUSTOM = "custom";
const FIXED_PREFIX = "fixed:";
const VERSION_PREFIX = "v:";

/** A pipeline's builder as its own page; a null id builds a new pipeline. */
export function PipelineBuilderPage({ pipelineId }: { readonly pipelineId: BotPipelineId | null }) {
  const { environmentId } = useBotsHost();
  return environmentId ? (
    <BuilderLoader environmentId={environmentId} pipelineId={pipelineId} />
  ) : null;
}

function BuilderLoader({
  environmentId,
  pipelineId,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipelineId: BotPipelineId | null;
}) {
  const host = useBotsHost();
  const { list, pipelines } = usePipelines(environmentId, true, host.connected);
  // A save elsewhere while the host was away never arrives by the watch, and spotting it is how
  // the builder warns before saving over it.
  useRefreshOnReconnect(host.connected, list.refresh);
  const found =
    pipelineId === null ? undefined : pipelines.find((pipeline) => pipeline.id === pipelineId);
  // Holds the version the builder opened, so a delete or save elsewhere never unmounts the edits.
  const [opened, setOpened] = useState<BotPipeline | null>(null);
  if (found !== undefined && opened?.id !== found.id) setOpened(found);
  const editing = pipelineId !== null && opened?.id === pipelineId ? opened : null;

  if (pipelineId === null || editing !== null)
    return (
      <PipelineBuilder
        key={editing?.id ?? "new"}
        environmentId={environmentId}
        opened={editing}
        pipelines={pipelines}
        listed={list.data !== null}
        refreshList={list.refresh}
      />
    );
  if (list.error && !list.data)
    return <LibraryErrorNotice error={list.error} onRetry={list.refresh} />;
  if (!list.data)
    return (
      <div role="status" aria-label="Loading the pipeline" className="flex flex-col gap-4">
        <Skeleton className="h-10 w-1/2" />
        {["first", "second", "third"].map((key) => (
          <Skeleton key={key} shape="card" className="h-16 w-full max-w-3xl" />
        ))}
      </div>
    );
  return (
    <LibraryEmpty
      icon={WorkflowIcon}
      title="This pipeline no longer exists"
      action={
        <Button
          shape="pill"
          size="sm"
          variant="outline"
          render={<Link to="/loom/bots" search={PIPELINES_TAB} />}
        >
          Back to pipelines
        </Button>
      }
    >
      It was deleted, or the link names a pipeline this computer never had.
    </LibraryEmpty>
  );
}

/** Whether a location still shows this builder, so opening a sheet over it never asks. */
const sameBuilder = (search: unknown, opened: BotPipeline | null) => {
  if (typeof search !== "object" || search === null) return false;
  return opened === null
    ? "newPipeline" in search && search.newPipeline === true
    : "editPipeline" in search && search.editPipeline === opened.id;
};

function PipelineBuilder({
  environmentId,
  opened,
  pipelines,
  listed,
  refreshList,
}: {
  readonly environmentId: EnvironmentId;
  /** The pipeline as it was opened; null builds a new one. */
  readonly opened: BotPipeline | null;
  /** Every saved pipeline, kept live, to spot a taken id or a newer save. */
  readonly pipelines: ReadonlyArray<BotPipeline>;
  readonly listed: boolean;
  readonly refreshList: () => void;
}) {
  const nav = useBotsNavigation();
  const canGoBack = useCanGoBack();
  const access = useBotsAccess();
  const { host, bots: allBots, list: botList } = useBots();
  const save = useAtomCommand(bots.savePipeline, { reportFailure: false });
  const isNew = opened === null;

  const [initial, setInitial] = useState<PipelineDraft>(() =>
    opened === null ? emptyPipelineDraft() : pipelineDraft(opened),
  );
  const [draft, setDraft] = useState<PipelineDraft>(initial);
  const [baseVersion, setBaseVersion] = useState(() => expectedVersionFor(opened));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [idEdited, setIdEdited] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // The id readers point at for each step and input. It trails a half-typed id that collides
  // with another, so references never merge into the other step's while someone types.
  const stepRefIds = useRef(new Map<string, string>());
  const inputRefNames = useRef(new Map<string, string>());

  const botsById = useMemo(() => new Map(allBots.map((bot) => [bot.id, bot])), [allBots]);
  const botOf = (botId: string) => botsById.get(botId);
  // Until the bot list loads, a step's bot is unknown rather than missing.
  const botsLoaded = botList.data !== null;
  const runnable = allBots.filter((bot) => bot.archivedAt === null);
  const takenIds = useMemo(() => new Set(pipelines.map((pipeline) => pipeline.id)), [pipelines]);
  const latest =
    opened === null ? undefined : pipelines.find((pipeline) => pipeline.id === opened.id);
  const stale = latest !== undefined && latest.version !== baseVersion;
  const gone = !isNew && listed && latest === undefined && baseVersion !== 0;
  // Once "Save as new" is chosen for a deleted pipeline, saving creates it again.
  const savingAsNew = !isNew && baseVersion === 0;

  // The form's own rules apply at once; the server's check follows once typing settles.
  const local = draftProblems(draft, { takenIds, isNew: baseVersion === 0 });
  const built = pipelineInputFromDraft(draft);
  const localErrors = local.some((problem) => problem.severity === "error");
  // A string key settles the debounce; a fresh object every render never would.
  const builtKey = built.ok && !localErrors ? JSON.stringify(built.input) : "";
  const sentKey = useDebouncedValue(builtKey, CHECK_DEBOUNCE_MS);
  const sent = useMemo(
    () => (sentKey === "" ? null : (JSON.parse(sentKey) as BotPipelineInput)),
    [sentKey],
  );
  const check = useEnvironmentQuery(
    sent !== null && host.connected
      ? bots.checkPipeline({ environmentId, input: { pipeline: sent } })
      : null,
  );
  const checking = builtKey !== "" && host.connected && (sentKey !== builtKey || check.isPending);
  const checked = builtKey !== "" && sentKey === builtKey ? (check.data?.problems ?? []) : [];
  const formProblem: ReadonlyArray<BuilderProblem> =
    !built.ok && !localErrors
      ? [{ stepKey: null, field: "form", message: built.message, severity: "error" }]
      : [];
  const problems = builderProblems(draft, [...local, ...formProblem], checked);
  const errors = problems.filter((problem) => problem.severity === "error");
  const warnings = problems.filter((problem) => problem.severity === "warning");
  const pipelineProblems = (field: string) =>
    problems.filter((problem) => problem.stepKey === null && problem.field === field);

  const dirty = isDraftDirty(initial, draft);
  const changed = dirty || baseVersion !== expectedVersionFor(opened);
  const { leave } = useUnsavedChangesGuard({
    dirty,
    message: "Leave without saving? Your changes to this pipeline will be lost.",
    staysOpen: (next) => next.pathname === "/loom/bots" && sameBuilder(next.search, opened),
  });
  const backSearch = opened === null ? PIPELINES_TAB : { pipeline: opened.id };

  // Each edit computes the next draft from this render's, since updaters must stay pure.
  const setStep = (key: string, next: PipelineStepDraft) =>
    setDraft({ ...draft, steps: draft.steps.map((step) => (step.key === key ? next : step)) });
  const changeStepId = (key: string, id: string) => {
    const step = draft.steps.find((candidate) => candidate.key === key);
    if (step === undefined) return;
    const next = {
      ...draft,
      steps: draft.steps.map((candidate) =>
        candidate.key === key ? { ...candidate, id } : candidate,
      ),
    };
    const from = stepRefIds.current.get(key) ?? step.id.trim();
    const to = id.trim();
    if (!canTakeStepId(next, key, to)) {
      stepRefIds.current.set(key, from);
      setDraft(next);
      return;
    }
    stepRefIds.current.set(key, to);
    setDraft(renameReferences(next, from, to));
  };
  const changeBot = (key: string, bot: BotDefinition) => {
    const next = changeStepBot(draft, key, bot);
    const id = next.steps.find((step) => step.key === key)?.id;
    if (id !== undefined) stepRefIds.current.set(key, id.trim());
    setDraft(next);
  };
  const addStep = (index: number, bot: BotDefinition) => {
    const inserted = insertStep(draft, index, bot);
    if (inserted.key === "") return;
    setDraft(inserted.draft);
    setOpenKey(inserted.key);
    setAnnouncement(`Added ${bot.name} as step ${index + 1}.`);
    const key = inserted.key;
    requestAnimationFrame(() =>
      document.getElementById(`step-${key}`)?.scrollIntoView({ block: "nearest" }),
    );
  };
  const move = (key: string, by: -1 | 1) => {
    const next = moveStep(draft, key, by);
    if (next === draft) return;
    setDraft(next);
    const index = next.steps.findIndex((step) => step.key === key);
    setAnnouncement(`Moved ${next.steps[index]?.id ?? "the step"} to step ${index + 1}.`);
    // Keep focus on the arrow that was pressed, or its twin once the step reaches an end.
    const [wanted, twin] = by === -1 ? ["up", "down"] : ["down", "up"];
    requestAnimationFrame(() => {
      const button = document.getElementById(`move-${wanted}-${key}`);
      if (button instanceof HTMLButtonElement && !button.disabled) button.focus();
      else document.getElementById(`move-${twin}-${key}`)?.focus();
    });
  };
  const remove = async (step: PipelineStepDraft) => {
    const readers = stepReaders(draft, step.id.trim()).map((reader) => reader.stepId);
    if (
      readers.length > 0 &&
      !(await ensureLocalApi().dialogs.confirm(
        `Remove ${step.id}? ${readers.join(" and ")} ${readers.length === 1 ? "reads" : "read"} what it hands on and will need another source.`,
      ))
    )
      return;
    setDraft(removeStep(draft, step.key));
    if (openKey === step.key) setOpenKey(null);
    setAnnouncement(`Removed ${step.id}.`);
  };
  const changeParameter = (next: BotParameterDraft) => {
    const previous = draft.parameters.find((parameter) => parameter.key === next.key);
    let updated: PipelineDraft = {
      ...draft,
      parameters: draft.parameters.map((parameter) =>
        parameter.key === next.key ? next : parameter,
      ),
    };
    if (previous !== undefined && previous.name !== next.name) {
      const from = inputRefNames.current.get(next.key) ?? previous.name.trim();
      const to = next.name.trim();
      if (canTakeInputName(updated, next.key, to)) {
        updated = renameInputReferences(updated, from, to);
        inputRefNames.current.set(next.key, to);
      } else inputRefNames.current.set(next.key, from);
    }
    setDraft(updated);
  };
  const removeParameter = async (parameter: BotParameterDraft) => {
    const readers = inputUsage(draft).get(parameter.name.trim()) ?? [];
    if (
      readers.length > 0 &&
      !(await ensureLocalApi().dialogs.confirm(
        `Remove the input ${parameter.label || parameter.name}? ${readers.join(" and ")} ${readers.length === 1 ? "reads" : "read"} it.`,
      ))
    )
      return;
    setDraft({
      ...draft,
      parameters: draft.parameters.filter((candidate) => candidate.key !== parameter.key),
    });
  };
  const moveParameter = (key: string, by: -1 | 1) => {
    const from = draft.parameters.findIndex((parameter) => parameter.key === key);
    const to = from + by;
    const moved = draft.parameters[from];
    if (from === -1 || moved === undefined || to < 0 || to >= draft.parameters.length) return;
    const parameters = draft.parameters.filter((parameter) => parameter.key !== key);
    parameters.splice(to, 0, moved);
    setDraft({ ...draft, parameters });
  };
  const changeName = (name: string) =>
    setDraft({ ...draft, name, ...(isNew && !idEdited ? { id: slugFromName(name) } : {}) });

  const loadLatest = async () => {
    if (latest === undefined) return;
    if (
      dirty &&
      !(await ensureLocalApi().dialogs.confirm(
        "Load the version saved since? Your edits here will be replaced.",
      ))
    )
      return;
    const next = pipelineDraft(latest);
    stepRefIds.current.clear();
    inputRefNames.current.clear();
    setInitial(next);
    setDraft(next);
    setBaseVersion(latest.version);
    setOpenKey(null);
    setError(null);
  };

  // The server checks again on save, so a check still out never holds Save back; waiting on it
  // would make the button flicker with every keystroke and swallow a quick Cmd+S.
  const blocked = !access.canSavePipelines || saving || errors.length > 0 || !changed;
  // With problems, Save stays pressable and leads to the first one instead of doing nothing.
  const saveDisabled = !access.canSavePipelines || saving || (errors.length === 0 && !changed);

  const showFirstProblem = () => {
    setRevealed(true);
    const first = errors[0] ?? warnings[0];
    if (first === undefined) return;
    const stepKey = first.stepKey ?? (first.field.startsWith("parameters") ? INPUTS_KEY : null);
    if (stepKey !== null) {
      setOpenKey(stepKey);
      requestAnimationFrame(() =>
        document.getElementById(`step-${stepKey}`)?.scrollIntoView({ block: "start" }),
      );
      return;
    }
    if (first.field === "id") setIdEdited(true);
    if (first.field === "steps") {
      requestAnimationFrame(() => document.getElementById("add-step")?.focus());
      return;
    }
    requestAnimationFrame(() =>
      document.getElementById(first.field === "id" ? "pipeline-id" : "pipeline-name")?.focus(),
    );
  };

  const submit = async () => {
    if (errors.length > 0) {
      showFirstProblem();
      return;
    }
    if (blocked) return;
    const request = saveRequest(draft, baseVersion);
    if (!request.ok) {
      setError(request.message);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await save({ environmentId, input: request.input });
    // On success the page leaves, so the bar keeps saying Saving until it does.
    if (result._tag === "Success") {
      const saved = result.value;
      // The builder never stays behind in history: an edit returns where it was opened, and a
      // new pipeline's page takes the builder's place.
      leave(() => {
        if (!isNew && canGoBack) window.history.back();
        else nav.show({ pipeline: saved.id });
      });
      return;
    }
    setSaving(false);
    const cause = squashAtomCommandFailure(result);
    const message = cause instanceof Error ? cause.message : "Could not save the pipeline.";
    refreshList();
    const id = draft.id.trim();
    // Saving as new expects nothing under the id, so this refusal means the id is taken. Older
    // servers word it as a stale edit, which would confuse someone who never opened one.
    if (baseVersion === 0 && message.startsWith("This pipeline changed since"))
      setError(`Another pipeline already uses the id ${id}. Choose another id.`);
    else setError(message);
  };

  const cancel = async () => {
    if (
      dirty &&
      !(await ensureLocalApi().dialogs.confirm("Discard your changes to this pipeline?"))
    )
      return;
    leave(() => {
      if (canGoBack) window.history.back();
      else nav.show(backSearch);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
    // Dialogs portal out of the page but still bubble here; a save belongs to the page itself.
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    void submit();
  };

  // The bar says what is most pressing first.
  const firstError = errors[0];
  const statusTone = checking
    ? null
    : firstError !== undefined
      ? ("error" as const)
      : warnings.length > 0
        ? ("warning" as const)
        : null;
  const statusText = saving
    ? "Saving…"
    : !host.connected
      ? "Offline. Reconnect to check and save this pipeline."
      : !access.canSavePipelines
        ? "This connection can look at pipelines but not save them."
        : isNew && !dirty
          ? "Name the pipeline and add its first step."
          : checking
            ? "Checking the pipeline…"
            : firstError !== undefined
              ? `${firstError.message}${errors.length > 1 ? ` ${plural(errors.length - 1, "more problem")} to fix.` : ""}`
              : warnings.length > 0
                ? `Ready to save, with ${plural(warnings.length, "warning")}: ${warnings[0]?.message ?? ""}`
                : check.error
                  ? `Could not check the pipeline: ${check.error} Saving checks it again.`
                  : !changed
                    ? "No changes yet."
                    : baseVersion === 0
                      ? `Ready to save as ${draft.id.trim()}.`
                      : `Ready to save as v${baseVersion + 1}.`;
  // Typing restarts the check, so only where it settles is announced, and only once per message.
  const [spokenStatus, setSpokenStatus] = useState("");
  if (!checking && statusText !== spokenStatus) setSpokenStatus(statusText);

  const id = draft.id.trim();
  const nameProblems = revealed || nameTouched ? pipelineProblems("name") : [];
  const idProblems = revealed || id !== "" ? pipelineProblems("id") : [];
  const stepsProblems = revealed ? pipelineProblems("steps") : [];
  const otherProblems = problems.filter(
    (problem) =>
      problem.stepKey === null &&
      !["name", "id", "steps"].includes(problem.field) &&
      !problem.field.startsWith("parameters"),
  );
  const insertReason =
    draft.steps.length >= BOTS_PIPELINE_MAX_STEPS
      ? `A pipeline holds up to ${BOTS_PIPELINE_MAX_STEPS} steps.`
      : !botsLoaded
        ? botList.error
          ? "The bots could not load."
          : "Loading bots…"
        : runnable.length === 0
          ? "Make a bot first. Each step runs one."
          : null;

  return (
    <div
      style={id ? pipelineColorStyle(id) : undefined}
      onKeyDown={onKeyDown}
      className="flex min-h-full flex-col gap-8"
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <header className="flex items-start gap-4">
        <PipelineTile pipelineId={id} size="xl" neutral={id === ""} />
        <div className="grid max-w-2xl min-w-0 flex-1 gap-2">
          <Input
            id="pipeline-name"
            size="lg"
            aria-label="Pipeline name"
            aria-invalid={nameProblems.length ? true : undefined}
            placeholder="Name this pipeline"
            value={draft.name}
            maxLength={120}
            autoFocus={isNew}
            onChange={(event) => changeName(event.target.value)}
            onBlur={() => setNameTouched(true)}
          />
          <FieldProblems problems={nameProblems} />
          <Textarea
            size="sm"
            aria-label="Description"
            placeholder="What it does, in a sentence. Shown on its card and its page."
            value={draft.description}
            maxLength={1000}
            rows={2}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
          <PipelineIdLine
            locked={!isNew}
            id={draft.id}
            editing={idEdited || idProblems.length > 0}
            problems={idProblems}
            onEdit={() => setIdEdited(true)}
            onChange={(next) => {
              setIdEdited(true);
              setDraft({ ...draft, id: next });
            }}
            onReset={() => {
              setIdEdited(false);
              setDraft({ ...draft, id: slugFromName(draft.name) });
            }}
          />
        </div>
      </header>

      {stale && !saving && latest !== undefined ? (
        <LibraryNotice
          icon={RefreshCwIcon}
          tone="warning"
          action={
            <span className="flex gap-1.5">
              <Button shape="pill" size="xs" variant="outline" onClick={() => void loadLatest()}>
                Load it
              </Button>
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                onClick={() => setBaseVersion(latest.version)}
              >
                Keep mine
              </Button>
            </span>
          }
        >
          {latest.name} was saved somewhere else while you edited, and is now v{latest.version}.
          Load that version, or keep your edits and save over it.
        </LibraryNotice>
      ) : null}
      {gone && !saving ? (
        <LibraryNotice
          icon={CircleAlertIcon}
          tone="warning"
          action={
            <Button shape="pill" size="xs" variant="outline" onClick={() => setBaseVersion(0)}>
              Save as new
            </Button>
          }
        >
          This pipeline was deleted while you edited it, with its triggers. Save it as new to keep
          your edits.
        </LibraryNotice>
      ) : null}
      {botList.error && !botList.data ? (
        <LibraryErrorNotice error={botList.error} onRetry={botList.refresh} />
      ) : null}
      <FieldProblems problems={otherProblems} />

      <ol aria-label="Steps" className="flex w-full max-w-3xl flex-col">
        <InputsCard
          draft={draft}
          open={openKey === INPUTS_KEY}
          problems={problems.filter(
            (problem) => problem.stepKey === null && problem.field.startsWith("parameters"),
          )}
          onToggle={() => setOpenKey(openKey === INPUTS_KEY ? null : INPUTS_KEY)}
          onAdd={() =>
            setDraft({ ...draft, parameters: [...draft.parameters, newParameterDraft()] })
          }
          onChange={changeParameter}
          onRemove={(parameter) => void removeParameter(parameter)}
          onMove={moveParameter}
        />
        {draft.steps.map((step, index) => (
          <StepItem
            key={step.key}
            environmentId={environmentId}
            draft={draft}
            step={step}
            index={index}
            botOf={botOf}
            botsLoaded={botsLoaded}
            allBots={allBots}
            insertChoices={insertReason === null ? runnable : []}
            open={openKey === step.key}
            problems={problems.filter((problem) => problem.stepKey === step.key)}
            onInsertBefore={(bot) => addStep(index, bot)}
            onToggle={() => setOpenKey(openKey === step.key ? null : step.key)}
            onChange={(next) => setStep(step.key, next)}
            onChangeId={(next) => changeStepId(step.key, next)}
            onChangeBot={(bot) => changeBot(step.key, bot)}
            onMove={(by) => move(step.key, by)}
            onRemove={() => void remove(step)}
          />
        ))}
        <Connector />
        <li className="flex flex-col gap-2">
          {runnable.length === 0 && botsLoaded ? (
            <LibraryNotice
              icon={WorkflowIcon}
              action={
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  render={<Link to="/loom/bots" search={{ newBot: true }} />}
                >
                  New bot
                </Button>
              }
            >
              Each step runs a bot, and there are none to run yet.
            </LibraryNotice>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <AddStepMenu
                id="add-step"
                bots={runnable}
                reason={insertReason}
                label={draft.steps.length ? "Add a step" : "Add the first step"}
                onPick={(bot) => addStep(draft.steps.length, bot)}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {draft.steps.length} of {BOTS_PIPELINE_MAX_STEPS} steps
              </span>
            </div>
          )}
          <FieldProblems problems={stepsProblems} />
        </li>
        <Connector />
        <li className="flex items-center gap-3 ps-3 text-sm text-muted-foreground">
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted dark:bg-accent"
          >
            <FlagIcon className="size-4" />
          </span>
          Ends with a report of what every step found.
        </li>
      </ol>

      <div className="mt-auto flex flex-col gap-3">
        <LibraryErrorNotice error={error} />
        <p role="status" className="sr-only">
          {spokenStatus}
        </p>
        <LibraryEditorBar
          status={
            statusTone === null ? (
              statusText
            ) : (
              <ProblemLink tone={statusTone} onClick={showFirstProblem}>
                {statusText}
              </ProblemLink>
            )
          }
        >
          <Button shape="pill" size="sm" variant="ghost" onClick={() => void cancel()}>
            Cancel
          </Button>
          <WithReason
            reason={actionReason(host.connected, access.canSavePipelines, "save pipelines")}
          >
            <Button shape="pill" size="sm" disabled={saveDisabled} onClick={() => void submit()}>
              {saving
                ? "Saving…"
                : gone || savingAsNew
                  ? "Save as new"
                  : isNew
                    ? "Save pipeline"
                    : "Save changes"}
            </Button>
          </WithReason>
        </LibraryEditorBar>
      </div>
    </div>
  );
}

function ProblemLink({
  tone,
  onClick,
  children,
}: {
  readonly tone: "error" | "warning";
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-sm text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        tone === "error" ? "text-destructive-foreground" : "text-warning-foreground",
      )}
    >
      <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}

function FieldProblems({ problems }: { readonly problems: ReadonlyArray<BuilderProblem> }) {
  if (problems.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {problems.map((problem) => (
        <li
          key={`${problem.field}\u0000${problem.message}`}
          className={cn(
            "flex items-start gap-1.5 text-xs font-normal",
            problem.severity === "error"
              ? "text-destructive-foreground"
              : "text-warning-foreground",
          )}
        >
          <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          {problem.message}
        </li>
      ))}
    </ul>
  );
}

function PipelineIdLine({
  locked,
  id,
  editing,
  problems,
  onEdit,
  onChange,
  onReset,
}: {
  readonly locked: boolean;
  readonly id: string;
  readonly editing: boolean;
  readonly problems: ReadonlyArray<BuilderProblem>;
  readonly onEdit: () => void;
  readonly onChange: (id: string) => void;
  readonly onReset: () => void;
}) {
  if (locked)
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon aria-hidden className="size-3" />
        <span className="font-mono">{id}</span>
        <span>· Ids stay fixed once saved, so links and triggers keep working.</span>
      </p>
    );
  if (!editing)
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        Saves as <span className="font-mono text-foreground">{id.trim() || "…"}</span>
        <Button shape="pill" size="xs" variant="ghost" onClick={onEdit}>
          Change
        </Button>
      </p>
    );
  return (
    <div className="grid max-w-md gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          id="pipeline-id"
          size="sm"
          aria-label="Pipeline id"
          aria-invalid={problems.length ? true : undefined}
          value={id}
          maxLength={64}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button shape="pill" size="xs" variant="ghost" onClick={onReset}>
          Use the name
        </Button>
      </div>
      <FieldProblems problems={problems} />
      <p className="text-xs text-muted-foreground">
        Lowercase letters, digits and dashes. It cannot change after the first save.
      </p>
    </div>
  );
}

/** The rule between two cards of the flow, with a way to add a step there. */
function Connector({ children }: { readonly children?: ReactNode }) {
  // Not a list item of its own, so the steps list counts only the cards.
  return (
    <li role="none" className="group/insert relative flex h-8 items-center">
      <span aria-hidden className="absolute inset-y-0 start-7 w-px bg-border" />
      {children ? (
        <span className="relative ms-4 flex opacity-0 transition-opacity duration-150 group-focus-within/insert:opacity-100 group-hover/insert:opacity-100 pointer-coarse:opacity-100">
          {children}
        </span>
      ) : null}
    </li>
  );
}

/** Bots to add as a step, split by whether they give a verdict to branch on. */
function AddStepMenu({
  id,
  bots: choices,
  reason,
  label,
  compact = false,
  onPick,
}: {
  readonly id?: string;
  readonly bots: ReadonlyArray<BotDefinition>;
  readonly reason: string | null;
  readonly label: string;
  readonly compact?: boolean;
  readonly onPick: (bot: BotDefinition) => void;
}) {
  const group = (title: string, list: ReadonlyArray<BotDefinition>) =>
    list.length ? (
      <MenuGroup>
        <MenuGroupLabel>{title}</MenuGroupLabel>
        {list.map((bot) => (
          <MenuItem key={bot.id} onClick={() => onPick(bot)}>
            <BotTile bot={bot} size="sm" />
            <span className="min-w-0 flex-1 truncate">{bot.name}</span>
            {needsProject(bot) ? (
              <span className="shrink-0 text-xs text-muted-foreground">Needs a project</span>
            ) : null}
          </MenuItem>
        ))}
      </MenuGroup>
    ) : null;
  return (
    <WithReason reason={reason}>
      <Menu>
        <MenuTrigger
          id={id}
          disabled={reason !== null}
          render={
            compact ? (
              <Button shape="pill" size="icon-xs" variant="outline" aria-label={label} />
            ) : (
              <Button shape="pill" size="sm" variant="outline" />
            )
          }
        >
          <PlusIcon />
          {compact ? null : label}
        </MenuTrigger>
        <MenuPopup side="bottom" align="start">
          {group(
            "Gives a verdict",
            choices.filter((bot) => bot.output === "verdict"),
          )}
          {group(
            "Replies in text",
            choices.filter((bot) => bot.output !== "verdict"),
          )}
        </MenuPopup>
      </Menu>
    </WithReason>
  );
}

/** One card of the flow; its header opens the body, and opening one card closes the others. */
function FlowCard({
  label,
  open,
  onToggle,
  header,
  children,
}: {
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly header: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      render={<section aria-label={label} className="rounded-xl border border-border bg-card" />}
    >
      {header}
      {/* No height animation: opening a card scrolls it into place while the last one closes. */}
      <CollapsiblePanel animate={false}>{children}</CollapsiblePanel>
    </Collapsible>
  );
}

function CardToggle({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  return (
    <CollapsibleTrigger className="flex min-w-0 flex-1 items-start gap-3 rounded-lg p-1 text-start outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
      {children}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "mt-2 size-4 shrink-0 text-muted-foreground transition-transform duration-150",
          open && "rotate-180",
        )}
      />
    </CollapsibleTrigger>
  );
}

function InputsCard({
  draft,
  open,
  problems,
  onToggle,
  onAdd,
  onChange,
  onRemove,
  onMove,
}: {
  readonly draft: PipelineDraft;
  readonly open: boolean;
  readonly problems: ReadonlyArray<BuilderProblem>;
  readonly onToggle: () => void;
  readonly onAdd: () => void;
  readonly onChange: (parameter: BotParameterDraft) => void;
  readonly onRemove: (parameter: BotParameterDraft) => void;
  readonly onMove: (key: string, by: -1 | 1) => void;
}) {
  const usage = inputUsage(draft);
  const full = draft.parameters.length >= BOTS_MAX_PARAMETERS;
  const errors = problems.filter((problem) => problem.severity === "error").length;
  return (
    <li id={`step-${INPUTS_KEY}`} className="scroll-mt-4">
      <FlowCard
        label="Inputs"
        open={open}
        onToggle={onToggle}
        header={
          <div className="p-2">
            <CardToggle open={open}>
              <span
                aria-hidden
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-accent"
              >
                <TextCursorInputIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Starts with</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {draft.parameters.length
                    ? draft.parameters.map((parameter) => parameter.name || "unnamed").join(", ")
                    : "No inputs, so every run starts the same way"}
                </span>
              </span>
              {problems.length ? (
                <LibraryStateBadge tone={errors ? "danger" : "warning"}>
                  {errors ? plural(errors, "problem") : plural(problems.length, "warning")}
                </LibraryStateBadge>
              ) : null}
            </CardToggle>
          </div>
        }
      >
        <div className="flex flex-col gap-3 border-t border-border px-3 pt-3 pb-4 sm:px-4">
          <p className="text-xs text-muted-foreground">
            What a person or a trigger fills in for each run. A step reads one as{" "}
            <code className="font-mono">{"{{input.name}}"}</code>.
          </p>
          <FieldProblems problems={problems.filter((problem) => problem.field === "parameters")} />
          {draft.parameters.map((parameter, index) => {
            const readers = usage.get(parameter.name.trim()) ?? [];
            return (
              <div key={parameter.key} className="grid gap-1.5">
                <ParameterRow
                  parameter={parameter}
                  onChange={onChange}
                  onRemove={() => onRemove(parameter)}
                  onMove={(by) => onMove(parameter.key, by)}
                  canMoveUp={index > 0}
                  canMoveDown={index < draft.parameters.length - 1}
                />
                <FieldProblems
                  problems={problems.filter(
                    (problem) =>
                      problem.field === `parameters.${parameter.key}` ||
                      problem.field.startsWith(`parameters.${parameter.key}.`),
                  )}
                />
                <p className="ps-1 text-xs text-muted-foreground">
                  {readers.length ? `Read by ${readers.join(", ")}.` : "No step reads it yet."}
                </p>
              </div>
            );
          })}
          <WithReason
            reason={full ? `A pipeline takes up to ${BOTS_MAX_PARAMETERS} inputs.` : null}
          >
            <Button shape="pill" size="xs" variant="outline" disabled={full} onClick={onAdd}>
              <PlusIcon />
              Add input
            </Button>
          </WithReason>
        </div>
      </FlowCard>
    </li>
  );
}

function StepItem({
  environmentId,
  draft,
  step,
  index,
  botOf,
  botsLoaded,
  allBots,
  insertChoices,
  open,
  problems,
  onInsertBefore,
  onToggle,
  onChange,
  onChangeId,
  onChangeBot,
  onMove,
  onRemove,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: PipelineDraft;
  readonly step: PipelineStepDraft;
  readonly index: number;
  readonly botOf: (botId: string) => BotDefinition | undefined;
  /** Whether the bot list loaded, so a bot it lacks is really gone. */
  readonly botsLoaded: boolean;
  readonly allBots: ReadonlyArray<BotDefinition>;
  /** Bots to insert before this step; empty when no step can be added. */
  readonly insertChoices: ReadonlyArray<BotDefinition>;
  readonly open: boolean;
  readonly problems: ReadonlyArray<BuilderProblem>;
  readonly onInsertBefore: (bot: BotDefinition) => void;
  readonly onToggle: () => void;
  readonly onChange: (step: PipelineStepDraft) => void;
  readonly onChangeId: (id: string) => void;
  readonly onChangeBot: (bot: BotDefinition) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const bot = botOf(step.botId);
  const id = step.id.trim() || "unnamed";
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const mapping = mappingSummary(step);
  const gates = gateSummary(step, bot?.output === "verdict");
  return (
    <>
      <Connector>
        {insertChoices.length ? (
          <AddStepMenu
            compact
            bots={insertChoices}
            reason={null}
            label={index === 0 ? "Add a step at the start" : `Add a step before ${id}`}
            onPick={onInsertBefore}
          />
        ) : null}
      </Connector>
      <li id={`step-${step.key}`} className="scroll-mt-4">
        <FlowCard
          label={`Step ${index + 1}, ${id}`}
          open={open}
          onToggle={onToggle}
          header={
            <div className="flex items-start gap-1 p-2">
              <CardToggle open={open}>
                <BotTile
                  bot={bot ?? { id: step.botId }}
                  size="md"
                  status={errors ? <LibraryStateDot tone="danger" /> : null}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                    <span className="truncate font-mono text-sm font-medium">{id}</span>
                    {bot === undefined && step.botId !== "" && !botsLoaded ? (
                      <Skeleton className="h-3.5 w-20" />
                    ) : (
                      <span className="truncate text-sm text-muted-foreground">
                        {bot?.name ?? (step.botId ? `Missing bot ${step.botId}` : "No bot")}
                      </span>
                    )}
                    {step.forEach ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <LayersIcon aria-hidden className="size-3.5" />
                        Per item
                      </span>
                    ) : null}
                    {bot !== undefined && bot.archivedAt !== null ? (
                      <LibraryStateBadge tone="warning">Archived bot</LibraryStateBadge>
                    ) : null}
                  </span>
                  {open ? null : (
                    <>
                      <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                        {mapping.length
                          ? mapping.map((entry) => `${entry.name} ← ${entry.from}`).join(" · ")
                          : "Gets nothing"}
                      </span>
                      {gates.length ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {gates.join(". ")}.
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
                {problems.length ? (
                  <LibraryStateBadge tone={errors ? "danger" : "warning"}>
                    {errors ? plural(errors, "problem") : plural(problems.length, "warning")}
                  </LibraryStateBadge>
                ) : null}
              </CardToggle>
              <div className="flex shrink-0 items-center pt-1">
                <Button
                  id={`move-up-${step.key}`}
                  shape="pill"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Move ${id} up`}
                  disabled={index === 0}
                  onClick={() => onMove(-1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  id={`move-down-${step.key}`}
                  shape="pill"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Move ${id} down`}
                  disabled={index === draft.steps.length - 1}
                  onClick={() => onMove(1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        shape="pill"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`More for ${id}`}
                      />
                    }
                  >
                    <EllipsisIcon />
                  </MenuTrigger>
                  <MenuPopup side="bottom" align="end">
                    <MenuItem variant="destructive" onClick={onRemove}>
                      <Trash2Icon />
                      Remove step
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
            </div>
          }
        >
          <div className="border-t border-border px-3 pt-4 pb-4 sm:px-4">
            <StepEditor
              environmentId={environmentId}
              draft={draft}
              step={step}
              index={index}
              bot={bot}
              botOf={botOf}
              botsLoaded={botsLoaded}
              allBots={allBots}
              problems={problems}
              onChange={onChange}
              onChangeId={onChangeId}
              onChangeBot={onChangeBot}
            />
          </div>
        </FlowCard>
      </li>
    </>
  );
}

function StepSection({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-2.5">
      <div className="grid gap-0.5">
        <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Fields the editor marks in place; any other step problem shows at the top of the step. */
const PLACED_FIELDS = new Set([
  "id",
  "botId",
  "version",
  "onFail",
  "onNeedsAttention",
  "onError",
  "forEach",
  "forEach.from",
  "forEach.itemLabel",
]);

function StepEditor({
  environmentId,
  draft,
  step,
  index,
  bot,
  botOf,
  botsLoaded,
  allBots,
  problems,
  onChange,
  onChangeId,
  onChangeBot,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: PipelineDraft;
  readonly step: PipelineStepDraft;
  readonly index: number;
  readonly bot: BotDefinition | undefined;
  readonly botOf: (botId: string) => BotDefinition | undefined;
  readonly botsLoaded: boolean;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly problems: ReadonlyArray<BuilderProblem>;
  readonly onChange: (step: PipelineStepDraft) => void;
  readonly onChangeId: (id: string) => void;
  readonly onChangeBot: (bot: BotDefinition) => void;
}) {
  const host = useBotsHost();
  const [custom, setCustom] = useState<ReadonlySet<string>>(() => new Set());
  const at = (field: string) => problems.filter((problem) => problem.field === field);
  const sources = stepSources(draft, index, botOf);
  const verdict = bot?.output === "verdict";
  const showVerdictGates = verdict || step.onFail !== "stop" || step.onNeedsAttention !== "stop";
  // A missing bot's inputs are unknown, so the ones the step already fills stay editable.
  const parameters: ReadonlyArray<BotParameter> =
    bot?.parameters ??
    Object.keys(step.inputs).map((name) => ({ name, label: name, type: "text", required: false }));
  const parameterNames = new Set(parameters.map((parameter) => parameter.name));
  const unplaced = problems.filter(
    (problem) =>
      !PLACED_FIELDS.has(problem.field) &&
      !(
        problem.field.startsWith("inputs.") &&
        parameterNames.has(problem.field.slice("inputs.".length))
      ),
  );
  const items = itemSources(draft, index, botOf);
  const targets = loopTargets(draft, index);
  const goToChoices = targets.includes(step.goTo) ? targets : [...targets, step.goTo];
  const roundChoices = ROUND_CHOICES.includes(step.maxRounds)
    ? ROUND_CHOICES
    : [...ROUND_CHOICES, step.maxRounds];
  const botChoices = allBots.filter(
    (candidate) => candidate.archivedAt === null || candidate.id === step.botId,
  );

  return (
    <div className="grid gap-6">
      <FieldProblems problems={unplaced} />
      <StepSection title="Bot">
        <div className="grid gap-3 sm:grid-cols-2">
          <LibraryField label="Runs">
            <Select
              value={step.botId}
              onValueChange={(next) => {
                const chosen = next === null ? undefined : botOf(next);
                if (chosen !== undefined) onChangeBot(chosen);
              }}
            >
              <SelectTrigger size="sm" aria-invalid={at("botId").length ? true : undefined}>
                <SelectValue>
                  {bot ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <BotTile bot={bot} size="sm" />
                      <span className="truncate">{bot.name}</span>
                    </span>
                  ) : (
                    step.botId || "Choose a bot…"
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {botChoices.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id} label={candidate.name}>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <BotTile bot={candidate} size="sm" />
                      <span className="truncate">{candidate.name}</span>
                      <span className="ms-auto shrink-0 ps-3 text-xs text-muted-foreground">
                        {[
                          candidate.archivedAt !== null
                            ? "Archived"
                            : candidate.output === "verdict"
                              ? "Verdict"
                              : "Text",
                          needsProject(candidate) ? "needs a project" : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <FieldProblems problems={at("botId")} />
            {bot === undefined && step.botId !== "" && botsLoaded ? (
              <span className="text-xs font-normal text-warning-foreground">
                There is no bot {step.botId} on this computer. Choose another to keep this step.
              </span>
            ) : null}
          </LibraryField>
          <LibraryField label="Step id">
            <Input
              size="sm"
              value={step.id}
              maxLength={64}
              aria-invalid={at("id").length ? true : undefined}
              onChange={(event) => onChangeId(event.target.value)}
            />
            <FieldProblems problems={at("id")} />
            <span className="text-xs font-normal text-muted-foreground">
              Later steps read it by this id. Renaming it updates them.
            </span>
          </LibraryField>
        </div>
      </StepSection>

      <StepSection
        title="Gets"
        hint="Fill each of the bot's inputs from the pipeline's inputs, an earlier step, or your own text."
      >
        {parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">This bot takes no inputs.</p>
        ) : (
          <div className="grid gap-4">
            {parameters.map((parameter) => (
              <InputMapping
                key={parameter.name}
                id={`${step.key}-input-${parameter.name}`}
                parameter={parameter}
                template={step.inputs[parameter.name] ?? ""}
                sources={sources}
                custom={custom.has(parameter.name)}
                problems={at(`inputs.${parameter.name}`)}
                onCustom={(on) => {
                  const next = new Set(custom);
                  if (on) next.add(parameter.name);
                  else next.delete(parameter.name);
                  setCustom(next);
                }}
                onChange={(template) =>
                  onChange({ ...step, inputs: { ...step.inputs, [parameter.name]: template } })
                }
              />
            ))}
          </div>
        )}
      </StepSection>

      <StepSection
        title="Runs"
        hint={
          step.forEach
            ? "As a batch, one run per item. Its inputs read the item from This item."
            : undefined
        }
      >
        <ToggleGroup
          shape="pill"
          variant="segmented"
          aria-label="How often it runs"
          value={[step.forEach ? "each" : "once"]}
          onValueChange={(next) => {
            const value = next[0];
            if (value !== "once" && value !== "each") return;
            const forEach = value === "each";
            const only = items.length === 1 ? (items[0]?.template ?? "") : "";
            onChange({
              ...step,
              forEach,
              forEachFrom: forEach && step.forEachFrom === "" ? only : step.forEachFrom,
            });
          }}
        >
          <ToggleGroupItem value="once">Once</ToggleGroupItem>
          <ToggleGroupItem value="each">Once per item</ToggleGroupItem>
        </ToggleGroup>
        {step.forEach ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <LibraryField label="Items">
              <ItemSourceSelect
                value={step.forEachFrom}
                sources={items}
                invalid={at("forEach.from").length > 0}
                onChange={(forEachFrom) => onChange({ ...step, forEachFrom })}
              />
              <FieldProblems problems={[...at("forEach.from"), ...at("forEach")]} />
              {items.length === 0 ? (
                <span className="text-xs font-normal text-muted-foreground">
                  A step runs over an earlier verdict step's findings, or a long text input with one
                  item per line. Add one of those first.
                </span>
              ) : null}
            </LibraryField>
            <LibraryField label="Item label (optional)">
              <Input
                size="sm"
                value={step.forEachItemLabel}
                placeholder="{{item.title}}"
                maxLength={200}
                onChange={(event) => onChange({ ...step, forEachItemLabel: event.target.value })}
              />
              <FieldProblems problems={at("forEach.itemLabel")} />
            </LibraryField>
          </div>
        ) : null}
      </StepSection>

      <StepSection
        title="When it ends"
        hint={
          verdict
            ? "Its verdict decides what comes next."
            : "This bot replies in text, so the pipeline carries on unless its run errors."
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {showVerdictGates ? (
            <LibraryField label="If it fails">
              <Choice
                id={`${step.key}-on-fail`}
                value={step.onFail}
                labels={FAIL_LABELS}
                onChange={(onFail) =>
                  onChange({
                    ...step,
                    onFail,
                    goTo:
                      onFail === "loop"
                        ? step.goTo || draft.steps[index - 1]?.id.trim() || step.id.trim()
                        : "",
                  })
                }
              />
              <FieldProblems problems={at("onFail")} />
            </LibraryField>
          ) : null}
          {step.onFail === "loop" ? (
            <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
              <LibraryField label="Go back to">
                <Choice
                  id={`${step.key}-go-to`}
                  value={step.goTo}
                  labels={Object.fromEntries(
                    goToChoices.map((target) => [
                      target,
                      target === ""
                        ? "Choose a step…"
                        : target === step.id.trim()
                          ? `${target}, this step`
                          : target,
                    ]),
                  )}
                  options={goToChoices}
                  onChange={(goTo) => onChange({ ...step, goTo })}
                />
              </LibraryField>
              <LibraryField label="At most">
                <Choice
                  id={`${step.key}-rounds`}
                  value={step.maxRounds}
                  labels={Object.fromEntries(
                    roundChoices.map((rounds) => [rounds, plural(Number(rounds), "round")]),
                  )}
                  options={roundChoices}
                  onChange={(maxRounds) => onChange({ ...step, maxRounds })}
                />
              </LibraryField>
            </div>
          ) : null}
          {showVerdictGates ? (
            <LibraryField label="If it needs attention">
              <Choice
                id={`${step.key}-on-attention`}
                value={step.onNeedsAttention}
                labels={GATE_LABELS}
                onChange={(onNeedsAttention) => onChange({ ...step, onNeedsAttention })}
              />
              <FieldProblems problems={at("onNeedsAttention")} />
            </LibraryField>
          ) : null}
          <LibraryField label="If its run errors">
            <Choice
              id={`${step.key}-on-error`}
              value={step.onError}
              labels={GATE_LABELS}
              onChange={(onError) => onChange({ ...step, onError })}
            />
            <span className="text-xs font-normal text-muted-foreground">
              A failed, timed out or cancelled run, or a failed item.
            </span>
            <FieldProblems problems={at("onError")} />
          </LibraryField>
        </div>
        {!verdict && showVerdictGates ? (
          <ProblemLink
            tone="warning"
            onClick={() =>
              onChange({ ...step, onFail: "stop", goTo: "", onNeedsAttention: "stop" })
            }
          >
            This bot never fails or needs attention, so those choices do nothing. Reset them.
          </ProblemLink>
        ) : null}
      </StepSection>

      <StepAdvanced
        environmentId={environmentId}
        step={step}
        bot={bot}
        versionsSupported={host.versionsSupported}
        anywhereSupported={host.anywhereSupported}
        versionProblems={at("version")}
        onChange={onChange}
      />
    </div>
  );
}

const fixedValues = (parameter: BotParameter): ReadonlyArray<string> =>
  parameter.type === "choice"
    ? (parameter.choices ?? [])
    : parameter.type === "boolean"
      ? ["true", "false"]
      : [];

const fixedLabel = (parameter: BotParameter, value: string) =>
  parameter.type === "boolean" ? (value === "true" ? "Yes" : "No") : value;

const groupSources = (sources: ReadonlyArray<StepSource>) => {
  const groups = new Map<string, Array<StepSource>>();
  for (const source of sources) {
    const list = groups.get(source.group) ?? [];
    list.push(source);
    groups.set(source.group, list);
  }
  return [...groups.entries()];
};

/** One bot input and where its value comes from: a reference, a fixed choice, or own text. */
function InputMapping({
  id,
  parameter,
  template,
  sources,
  custom,
  problems,
  onCustom,
  onChange,
}: {
  readonly id: string;
  readonly parameter: BotParameter;
  readonly template: string;
  readonly sources: ReadonlyArray<StepSource>;
  readonly custom: boolean;
  readonly problems: ReadonlyArray<BuilderProblem>;
  readonly onCustom: (on: boolean) => void;
  readonly onChange: (template: string) => void;
}) {
  const trimmed = template.trim();
  const matched = sources.find((source) => source.template === trimmed);
  const fixed = fixedValues(parameter);
  const mode = custom
    ? CUSTOM
    : trimmed === ""
      ? EMPTY
      : matched
        ? matched.template
        : fixed.includes(template)
          ? `${FIXED_PREFIX}${template}`
          : CUSTOM;
  const modeLabel =
    mode === CUSTOM
      ? "Your own text"
      : mode === EMPTY
        ? parameter.required
          ? "Choose a source…"
          : "Left empty"
        : matched
          ? matched.label
          : `Always ${fixedLabel(parameter, template)}`;
  const invalid = problems.some((problem) => problem.severity === "error");
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <label htmlFor={`${id}-source`} className="min-w-0 text-sm">
          <span className="font-medium">{parameter.label}</span>{" "}
          <span className="font-mono text-xs text-muted-foreground">{parameter.name}</span>
          {parameter.required ? null : (
            <span className="text-xs text-muted-foreground"> · optional</span>
          )}
        </label>
        <div className="w-full sm:w-72">
          <Select
            value={mode}
            onValueChange={(next) => {
              if (next === null) return;
              onCustom(next === CUSTOM);
              if (next === CUSTOM) return;
              if (next === EMPTY) onChange("");
              else if (next.startsWith(FIXED_PREFIX)) onChange(next.slice(FIXED_PREFIX.length));
              else onChange(next);
            }}
          >
            <SelectTrigger id={`${id}-source`} size="sm" aria-invalid={invalid || undefined}>
              <SelectValue>{modeLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {groupSources(sources).map(([group, list]) => (
                <SelectGroup key={group}>
                  <SelectGroupLabel>{group}</SelectGroupLabel>
                  {list.map((source) => (
                    <SelectItem key={source.template} value={source.template} label={source.label}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
              {fixed.length ? (
                <SelectGroup>
                  <SelectGroupLabel>Always the same</SelectGroupLabel>
                  {fixed.map((value) => (
                    <SelectItem
                      key={value}
                      value={`${FIXED_PREFIX}${value}`}
                      label={fixedLabel(parameter, value)}
                    >
                      {fixedLabel(parameter, value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              <SelectGroup>
                <SelectGroupLabel>Other</SelectGroupLabel>
                <SelectItem value={CUSTOM} label="Your own text">
                  Your own text
                </SelectItem>
                <SelectItem value={EMPTY} label="Leave empty">
                  Leave empty
                </SelectItem>
              </SelectGroup>
            </SelectPopup>
          </Select>
        </div>
      </div>
      {mode === CUSTOM ? (
        <TemplateEditor
          id={id}
          label={parameter.label}
          value={template}
          sources={sources}
          invalid={invalid}
          onChange={onChange}
        />
      ) : null}
      {parameter.description ? (
        <p className="text-xs text-muted-foreground">{parameter.description}</p>
      ) : null}
      <FieldProblems problems={problems} />
    </div>
  );
}

/** Own text for an input, with references inserted where the caret is. */
function TemplateEditor({
  id,
  label,
  value,
  sources,
  invalid,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly sources: ReadonlyArray<StepSource>;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const insert = (template: string) => {
    const element = field.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${template}${value.slice(end)}`);
    const caret = start + template.length;
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  };
  return (
    <div className="grid gap-1.5">
      <Textarea
        ref={field}
        id={id}
        size="sm"
        aria-label={`${label}, own text`}
        aria-invalid={invalid || undefined}
        value={value}
        maxLength={BOTS_PIPELINE_TEMPLATE_MAX}
        placeholder="Text, with references such as {{input.target}}"
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Menu>
          <MenuTrigger render={<Button shape="pill" size="xs" variant="ghost" />}>
            <PlusIcon />
            Insert a reference
          </MenuTrigger>
          <MenuPopup side="bottom" align="start">
            {groupSources(sources).map(([group, list]) => (
              <MenuGroup key={group}>
                <MenuGroupLabel>{group}</MenuGroupLabel>
                {list.map((source) => (
                  <MenuItem key={source.template} onClick={() => insert(source.template)}>
                    <span className="min-w-0 flex-1 truncate">{source.label}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {source.template}
                    </span>
                  </MenuItem>
                ))}
              </MenuGroup>
            ))}
          </MenuPopup>
        </Menu>
        <span className="text-xs text-muted-foreground">References fill in as the step runs.</span>
      </div>
    </div>
  );
}

function ItemSourceSelect({
  value,
  sources,
  invalid,
  onChange,
}: {
  readonly value: string;
  readonly sources: ReadonlyArray<StepSource>;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
}) {
  const known = sources.find((source) => source.template === value.trim());
  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? "")}>
      <SelectTrigger size="sm" aria-invalid={invalid || undefined}>
        <SelectValue>{known?.label ?? (value.trim() || "Choose what to run over…")}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {groupSources(sources).map(([group, list]) => (
          <SelectGroup key={group}>
            <SelectGroupLabel>{group}</SelectGroupLabel>
            {list.map((source) => (
              <SelectItem key={source.template} value={source.template} label={source.label}>
                {source.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {known === undefined && value.trim() !== "" ? (
          <SelectItem value={value} label={value}>
            {value}
          </SelectItem>
        ) : null}
      </SelectPopup>
    </Select>
  );
}

/** Choices most steps leave alone, mounted only while open so a closed step costs no requests. */
function StepAdvanced({
  environmentId,
  step,
  bot,
  versionsSupported,
  anywhereSupported,
  versionProblems,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly step: PipelineStepDraft;
  readonly bot: BotDefinition | undefined;
  readonly versionsSupported: boolean;
  readonly anywhereSupported: boolean;
  readonly versionProblems: ReadonlyArray<BuilderProblem>;
  readonly onChange: (step: PipelineStepDraft) => void;
}) {
  const [wanted, setWanted] = useState(false);
  const open = wanted || versionProblems.length > 0;
  const [modelOn, setModelOn] = useState(step.modelSelection !== null);
  const summary = [
    step.version === "stable"
      ? "stable version"
      : step.version === "number"
        ? `v${step.versionNumber}`
        : null,
    step.modelSelection ? step.modelSelection.model : null,
    step.target.type === "best"
      ? "best computer"
      : step.target.type === "environment"
        ? "another computer"
        : null,
  ].filter(Boolean);
  return (
    <Collapsible open={open} onOpenChange={setWanted}>
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-sm text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
        />
        Version, model and computer
        <span className="font-normal">· {summary.length ? summary.join(", ") : "as the bot"}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        {open ? (
          <div className="grid gap-4 pt-3 sm:grid-cols-2">
            <LibraryField label="Version">
              {bot !== undefined && versionsSupported ? (
                <VersionSelect
                  environmentId={environmentId}
                  bot={bot}
                  step={step}
                  invalid={versionProblems.length > 0}
                  onChange={onChange}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Choice
                    id={`${step.key}-version`}
                    value={step.version}
                    labels={VERSION_LABELS}
                    onChange={(version) => onChange({ ...step, version })}
                  />
                  {step.version === "number" ? (
                    <Input
                      size="sm"
                      inputMode="numeric"
                      aria-label="Version number"
                      value={step.versionNumber}
                      onChange={(event) => onChange({ ...step, versionNumber: event.target.value })}
                    />
                  ) : null}
                </div>
              )}
              <FieldProblems problems={versionProblems} />
            </LibraryField>
            <div className="grid content-start gap-2">
              <label className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                Another model for this step
                <Switch
                  checked={modelOn || step.modelSelection !== null}
                  onCheckedChange={(on) => {
                    setModelOn(on);
                    onChange({
                      ...step,
                      modelSelection: on ? (bot?.modelSelection ?? null) : null,
                    });
                  }}
                />
              </label>
              {modelOn || step.modelSelection !== null ? (
                <BotModelPicker
                  environmentId={environmentId}
                  value={step.modelSelection}
                  onChange={(modelSelection) => onChange({ ...step, modelSelection })}
                />
              ) : (
                <span className="text-xs text-muted-foreground">Runs on its bot's model.</span>
              )}
            </div>
            {anywhereSupported && step.botId !== "" ? (
              <div className="sm:col-span-2">
                <BotTargetField
                  environmentId={environmentId}
                  botId={step.botId}
                  projectId={null}
                  value={step.target}
                  onChange={(target) => onChange({ ...step, target })}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </CollapsiblePanel>
    </Collapsible>
  );
}

function VersionSelect({
  environmentId,
  bot,
  step,
  invalid,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly step: PipelineStepDraft;
  readonly invalid: boolean;
  readonly onChange: (step: PipelineStepDraft) => void;
}) {
  const query = useEnvironmentQuery(
    bots.versions({ environmentId, input: { botId: bot.id, limit: BOTS_VERSIONS_MAX_LIMIT } }),
  );
  const saved = query.data?.versions ?? [];
  const stable = bot.stableVersion ?? null;
  const stableLabel = stable === null ? "Stable, none marked so latest" : `Stable, v${stable}`;
  const value = step.version === "number" ? `${VERSION_PREFIX}${step.versionNumber}` : step.version;
  const label =
    step.version === "latest"
      ? `Latest, v${bot.version}`
      : step.version === "stable"
        ? stableLabel
        : `v${step.versionNumber}`;
  const pinned = step.version === "number" ? step.versionNumber : "";
  const pinnedListed = saved.some((version) => String(version.version) === pinned);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === null) return;
        if (next === "latest" || next === "stable")
          onChange({ ...step, version: next, versionNumber: "" });
        else if (next.startsWith(VERSION_PREFIX))
          onChange({
            ...step,
            version: "number",
            versionNumber: next.slice(VERSION_PREFIX.length),
          });
      }}
    >
      <SelectTrigger size="sm" aria-invalid={invalid || undefined}>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value="latest" label="Latest">
          Latest, v{bot.version}
        </SelectItem>
        <SelectItem value="stable" label="Stable">
          {stableLabel}
        </SelectItem>
        <SelectGroup>
          <SelectGroupLabel>
            {query.isPending && !query.data
              ? "Loading versions…"
              : query.error
                ? "Could not load versions"
                : "Always this version"}
          </SelectGroupLabel>
          {pinned !== "" && !pinnedListed ? (
            <SelectItem value={value} label={`v${pinned}`}>
              v{pinned}
            </SelectItem>
          ) : null}
          {saved.map((version) => (
            <SelectItem
              key={version.version}
              value={`${VERSION_PREFIX}${version.version}`}
              label={`v${version.version}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                v{version.version}
                <span className="truncate text-xs text-muted-foreground">
                  saved {runTime(version.savedAt)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
}
