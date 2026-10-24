import { useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotParameter, BotRun, BotTarget } from "@t3tools/contracts/fork";
import {
  checkoutChoices,
  initialRunValues,
  needsProject,
  runInputs,
  runsInCheckout,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CloudOffIcon, LayersIcon, LockIcon, PlayIcon, UndoIcon } from "lucide-react";
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
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LibraryDialog,
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
} from "../project-library/LibraryControls";
import { BotTargetField } from "./BotAnywhere";
import { RUNTIME_MODE_LABELS } from "./editorLogic";
import { focusFirstInputError, runInputErrors, runValuesFrom, shortDescription } from "./runForm";
import { bots, useBotsAccess, useBotsHost } from "./state";

function FieldError({ error }: { readonly error: string | null | undefined }) {
  return error ? (
    <span className="text-xs font-normal text-destructive-foreground">{error}</span>
  ) : null;
}

/**
 * One bot input as a form control. Shared by every form that starts a bot, so a boolean is a
 * plain switch row and a long text grows with what is typed instead of opening tall.
 */
export function ParameterField({
  id,
  parameter,
  value,
  onChange,
  error,
}: {
  /** The control's id, so a form can take the person to the first input to fix. */
  readonly id?: string;
  readonly parameter: BotParameter;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Why the value cannot be sent, shown under the control. */
  readonly error?: string | null | undefined;
}) {
  const label = parameter.required ? parameter.label : `${parameter.label} (optional)`;
  const invalid = error ? true : undefined;
  const hint = parameter.description ? (
    <span className="text-xs font-normal text-muted-foreground">{parameter.description}</span>
  ) : null;
  switch (parameter.type) {
    case "boolean":
      return (
        <label className="flex cursor-pointer items-center justify-between gap-4 py-0.5">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{parameter.label}</span>
            {hint}
          </span>
          <Switch
            id={id}
            checked={value === "true"}
            onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
          />
        </label>
      );
    case "choice":
      return (
        <LibraryField label={label}>
          <Select value={value} onValueChange={(next) => onChange(next ?? "")}>
            <SelectTrigger id={id} size="sm" aria-invalid={invalid}>
              <SelectValue>{value === "" ? "Choose…" : value}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {(parameter.choices ?? []).map((choice) => (
                <SelectItem key={choice} value={choice} label={choice}>
                  {choice}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <FieldError error={error} />
          {hint}
        </LibraryField>
      );
    case "text":
      return (
        <LibraryField label={label}>
          <Textarea
            id={id}
            size="sm"
            value={value}
            aria-invalid={invalid}
            onChange={(event) => onChange(event.target.value)}
          />
          <FieldError error={error} />
          {hint}
        </LibraryField>
      );
    case "number":
      return (
        <LibraryField label={label}>
          <Input
            id={id}
            size="sm"
            inputMode="decimal"
            value={value}
            aria-invalid={invalid}
            onChange={(event) => onChange(event.target.value)}
          />
          <FieldError error={error} />
          {hint}
        </LibraryField>
      );
    case "string":
      return (
        <LibraryField label={label}>
          <Input
            id={id}
            size="sm"
            value={value}
            aria-invalid={invalid}
            onChange={(event) => onChange(event.target.value)}
          />
          <FieldError error={error} />
          {hint}
        </LibraryField>
      );
  }
}

/** Long text and switches read best across the dialog; short fields pair up. */
const spansRow = (parameter: BotParameter) =>
  parameter.type === "text" || parameter.type === "boolean";

function RunFact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <dt className="w-18 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">{children}</dd>
    </div>
  );
}

/**
 * Starts one run: the bot's inputs, where it runs, and what it runs with. `from` prefills an
 * earlier run's inputs and place, for running it again.
 */
export function BotRunForm({
  environmentId,
  bot,
  from,
  onClose,
  onStarted,
  onRunOnMany,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly from: BotRun | null;
  readonly onClose: () => void;
  readonly onStarted: (run: BotRun) => void;
  /** Switches to starting the bot over many inputs, where the server supports it. */
  readonly onRunOnMany?: (() => void) | undefined;
}) {
  const host = useBotsHost();
  const { canRun, canSave } = useBotsAccess();
  const formId = useId();
  const inputId = (name: string) => `${formId}-${name}`;
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [prefill] = useState(() =>
    from ? runValuesFrom(bot, from.inputs) : { values: initialRunValues(bot), dropped: [] },
  );
  const [values, setValues] = useState(prefill.values);
  const [attempted, setAttempted] = useState(false);
  const pickProject = needsProject(bot);
  const [projectId, setProjectId] = useState<string>(() => {
    if (bot.scopeProjectId) return bot.scopeProjectId;
    if (!pickProject) return "";
    const earlier = projects.find((project) => project.id === from?.projectId);
    return earlier?.id ?? projects[0]?.id ?? "";
  });
  const inCheckout = runsInCheckout(bot);
  const fixedProjectId =
    (bot.workspace.type === "project" ? bot.workspace.projectId : null) ?? bot.scopeProjectId;
  const effectiveProjectId = fixedProjectId ?? projectId;
  const shells = useThreadShells(inCheckout);
  const checkouts = inCheckout
    ? checkoutChoices(
        shells.filter((shell) => shell.environmentId === environmentId),
        effectiveProjectId,
      )
    : [];
  // "" is the project root.
  const [checkoutThreadId, setCheckoutThreadId] = useState<string>(from?.checkoutThreadId ?? "");
  const checkout = checkouts.find((choice) => choice.threadId === checkoutThreadId);
  const sentProjectId = inCheckout ? effectiveProjectId : projectId;
  const [target, setTarget] = useState<BotTarget>(() =>
    from?.ranOn
      ? { type: "environment", environmentId: from.ranOn.environmentId }
      : { type: "here" },
  );
  const targetProjectId = sentProjectId === "" ? null : (sentProjectId as ProjectId);
  // The same request BotTargetField makes, read here only to hold its place while it loads.
  const targets = useEnvironmentQuery(
    host.anywhereSupported
      ? bots.targets({
          environmentId,
          input: {
            botId: bot.id,
            ...(targetProjectId === null ? {} : { projectId: targetProjectId }),
          },
        })
      : null,
  );
  const targetList = targets.data?.library === "available" ? targets.data.targets : [];
  // The picker shows only with a choice to make, and a computer remembered from an earlier run
  // may be gone; either way the run stays here rather than going somewhere unseen.
  const sentTarget: BotTarget =
    targetList.length < 2 ||
    (target.type === "environment" &&
      !targetList.some((option) => option.environmentId === target.environmentId))
      ? { type: "here" }
      : target;
  // Checkouts are this computer's; another computer runs in its own copy of the project.
  const localRun = sentTarget.type === "here";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useAtomCommand(bots.run, { reportFailure: false });
  const archived = bot.archivedAt !== null;
  const errors = runInputErrors(bot.parameters, values);
  const invalid = Object.keys(errors).length;
  const showCheckout = inCheckout && localRun && effectiveProjectId !== "";
  const fixedProject = projects.find((project) => project.id === fixedProjectId);
  const place =
    bot.workspace.type === "scratch"
      ? "A fresh scratch folder"
      : pickProject
        ? null
        : `${fixedProject?.title ?? "Its project"}${
            showCheckout ? "" : bot.workspace.worktree ? ", in a new worktree" : ", project root"
          }`;

  const submit = async () => {
    if (busy || !canRun || archived) return;
    setAttempted(true);
    if (invalid) {
      setError(null);
      focusFirstInputError(bot.parameters, errors, inputId);
      return;
    }
    if (pickProject && projectId === "") {
      setError(
        projects.length === 0
          ? `${bot.name} runs in a project you choose, and this computer has none yet. Add a project first.`
          : `Choose a project to run ${bot.name} in.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await run({
        environmentId,
        input: {
          botId: bot.id,
          inputs: runInputs(bot, values),
          // A checkout run without a thread runs in the root of the project it names.
          ...(sentProjectId === "" ? {} : { projectId: sentProjectId as ProjectId }),
          ...(checkout === undefined || !localRun
            ? {}
            : { checkoutThreadId: checkout.threadId as ThreadId }),
          ...(localRun ? {} : { target: sentTarget }),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onStarted(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not run ${bot.name}.`);
    } finally {
      setBusy(false);
    }
  };

  const blocked = !host.connected
    ? { icon: CloudOffIcon, text: "Offline. Reconnect to run bots." }
    : archived
      ? { icon: UndoIcon, text: `${bot.name} is archived. Restore it to run it.` }
      : !canRun
        ? { icon: LockIcon, text: "This connection cannot run bots." }
        : null;

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={from ? `Run ${bot.name} again` : `Run ${bot.name}`}
      description={
        shortDescription(bot.description) ||
        (bot.parameters.length ? "Fill in the inputs, then run." : "Check where it runs, then run.")
      }
      actions={
        <>
          {onRunOnMany ? (
            <div className="sm:me-auto">
              <Button
                shape="pill"
                variant="ghost"
                disabled={!canRun || archived}
                onClick={onRunOnMany}
              >
                <LayersIcon />
                Run on many…
              </Button>
            </div>
          ) : null}
          <Button shape="pill" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {/* Tied to the form, so Enter in any short field runs it as well. */}
          <Button shape="pill" type="submit" form={formId} disabled={busy || blocked !== null}>
            <PlayIcon />
            {busy ? "Starting…" : "Run"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          // Enter in a long text adds a line, so the shortcut that sends from anywhere is Mod+Enter.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        {bot.parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{bot.name} takes no inputs.</p>
        ) : (
          <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
            {bot.parameters.map((parameter) => (
              <div
                key={parameter.name}
                className={cn("min-w-0", spansRow(parameter) && "sm:col-span-2")}
              >
                <ParameterField
                  id={inputId(parameter.name)}
                  parameter={parameter}
                  value={values[parameter.name] ?? ""}
                  error={attempted ? errors[parameter.name] : null}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [parameter.name]: value }))
                  }
                />
              </div>
            ))}
          </div>
        )}
        {prefill.dropped.length ? (
          <p className="text-xs text-muted-foreground">
            {bot.name} no longer takes {prefill.dropped.join(", ")}, so{" "}
            {prefill.dropped.length === 1 ? "that input was" : "those inputs were"} left out.
          </p>
        ) : null}
        {pickProject || showCheckout || host.anywhereSupported ? (
          <div className="grid gap-x-4 gap-y-3.5 border-t border-border pt-3.5 sm:grid-cols-2 empty:hidden">
            {pickProject ? (
              <LibraryField label="Project">
                <Select
                  value={projectId}
                  onValueChange={(next) => {
                    setProjectId(next ?? "");
                    setCheckoutThreadId("");
                  }}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {projects.find((project) => project.id === projectId)?.title ?? "Choose…"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id} label={project.title}>
                        <span className="block truncate">{project.title}</span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </LibraryField>
            ) : null}
            {showCheckout ? (
              <LibraryField label="Checkout">
                <Select
                  value={checkoutThreadId}
                  onValueChange={(next) => setCheckoutThreadId(next ?? "")}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>{checkout?.label ?? "Project root"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="" label="Project root">
                      Project root
                    </SelectItem>
                    {checkouts.map((choice) => (
                      <SelectItem
                        key={choice.threadId}
                        value={choice.threadId}
                        label={choice.label}
                      >
                        <span className="block truncate">{choice.label}</span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </LibraryField>
            ) : null}
            {host.anywhereSupported && targets.isPending && !targets.data ? (
              <div className="grid gap-2" role="status" aria-label="Loading computers">
                <Skeleton className="h-3.5 w-14" />
                <Skeleton shape="pill" className="h-7" />
              </div>
            ) : host.anywhereSupported ? (
              <BotTargetField
                environmentId={environmentId}
                botId={bot.id}
                projectId={targetProjectId}
                value={target}
                onChange={setTarget}
              />
            ) : null}
          </div>
        ) : null}
        <dl className="flex flex-col gap-1.5 text-xs">
          {place ? <RunFact label="Where">{place}</RunFact> : null}
          <RunFact label="Runs with">
            <span className="min-w-0">
              {[
                bot.modelSelection.model,
                RUNTIME_MODE_LABELS[bot.runtimeMode],
                bot.interactionMode === "plan" ? "Plan only" : null,
                `${bot.timeoutMinutes} min limit`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {canSave ? (
              <Link
                to="/loom/bots"
                search={{ bot: bot.id, edit: true }}
                className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                Edit bot
              </Link>
            ) : null}
          </RunFact>
        </dl>
        {attempted && invalid ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {invalid === 1 ? "One input needs a fix" : `${invalid} inputs need a fix`} before{" "}
            {bot.name} can run.
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
        {blocked ? <LibraryNotice icon={blocked.icon}>{blocked.text}</LibraryNotice> : null}
      </form>
    </LibraryDialog>
  );
}
