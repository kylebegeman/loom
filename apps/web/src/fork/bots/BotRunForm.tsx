import { useState } from "react";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotParameter, BotRun, BotTarget } from "@t3tools/contracts/fork";
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
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { useProjects, useThreadShells } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { BotTargetField } from "./BotAnywhere";
import {
  checkoutChoices,
  initialRunValues,
  needsProject,
  runInputs,
  runsInCheckout,
} from "@t3tools/client-runtime/fork";
import { bots, useBotsHost } from "./state";

export function ParameterField({
  parameter,
  value,
  onChange,
}: {
  readonly parameter: BotParameter;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const label = parameter.required ? parameter.label : `${parameter.label} (optional)`;
  const hint = parameter.description ? (
    <span className="text-xs font-normal text-muted-foreground">{parameter.description}</span>
  ) : null;
  switch (parameter.type) {
    case "boolean":
      return (
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={value === "true"}
              onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
            />
            {parameter.label}
          </label>
          {hint}
        </div>
      );
    case "choice":
      return (
        <LibraryField label={label}>
          <Select value={value} onValueChange={(next) => onChange(next ?? "")}>
            <SelectTrigger size="sm">
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
          {hint}
        </LibraryField>
      );
    case "text":
      return (
        <LibraryField label={label}>
          <Textarea rows={5} value={value} onChange={(event) => onChange(event.target.value)} />
          {hint}
        </LibraryField>
      );
    case "number":
      return (
        <LibraryField label={label}>
          <Input
            inputMode="decimal"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          {hint}
        </LibraryField>
      );
    case "string":
      return (
        <LibraryField label={label}>
          <Input value={value} onChange={(event) => onChange(event.target.value)} />
          {hint}
        </LibraryField>
      );
  }
}

export function BotRunForm({
  environmentId,
  bot,
  canRun,
  onStarted,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly canRun: boolean;
  readonly onStarted: (run: BotRun) => void;
  readonly onClose: () => void;
}) {
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [values, setValues] = useState(() => initialRunValues(bot));
  const pickProject = needsProject(bot);
  const [projectId, setProjectId] = useState<string>(
    bot.scopeProjectId ?? (pickProject ? (projects[0]?.id ?? "") : ""),
  );
  const inCheckout = runsInCheckout(bot);
  const effectiveProjectId =
    (bot.workspace.type === "project" ? bot.workspace.projectId : null) ?? projectId;
  const shells = useThreadShells(inCheckout);
  const checkouts = inCheckout
    ? checkoutChoices(
        shells.filter((shell) => shell.environmentId === environmentId),
        effectiveProjectId,
      )
    : [];
  // "" is the project root.
  const [checkoutThreadId, setCheckoutThreadId] = useState("");
  const checkout = checkouts.find((choice) => choice.threadId === checkoutThreadId);
  const sentProjectId = inCheckout ? effectiveProjectId : projectId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useAtomCommand(bots.run, { reportFailure: false });
  const anywhereSupported = useBotsHost().anywhereSupported;
  const [target, setTarget] = useState<BotTarget>({ type: "here" });
  // Checkouts are this computer's; another computer runs in its own copy of the project.
  const localRun = target.type === "here";

  const submit = async () => {
    if (busy || !canRun) return;
    if (pickProject && projectId === "") {
      setError(`Choose a project to run ${bot.name} in.`);
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
          ...(localRun ? {} : { target }),
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

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Run ${bot.name}`}
      description={bot.description || "Fill in the inputs, then run."}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !canRun} onClick={() => void submit()}>
            {busy ? "Starting…" : "Run"}
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
          <p className="text-sm text-muted-foreground">This bot takes no inputs.</p>
        ) : null}
        {bot.parameters.map((parameter) => (
          <ParameterField
            key={parameter.name}
            parameter={parameter}
            value={values[parameter.name] ?? ""}
            onChange={(value) => setValues((current) => ({ ...current, [parameter.name]: value }))}
          />
        ))}
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
        {anywhereSupported ? (
          <BotTargetField
            environmentId={environmentId}
            botId={bot.id}
            projectId={sentProjectId === "" ? null : (sentProjectId as ProjectId)}
            value={target}
            onChange={setTarget}
          />
        ) : null}
        {inCheckout && localRun && effectiveProjectId !== "" ? (
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
                  <SelectItem key={choice.threadId} value={choice.threadId} label={choice.label}>
                    <span className="block truncate">{choice.label}</span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LibraryField>
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
