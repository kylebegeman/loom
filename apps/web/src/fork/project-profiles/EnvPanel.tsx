import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  COMMAND_INTENTS,
  type EnvItem,
  type EnvItemStatus,
  type VarlockValidation,
} from "@t3tools/contracts/fork";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "~/components/ui/alert-dialog";
import { useProject, useQuietThreadShell, useServerConfigs } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentProviders } from "~/state/environments";
import { useStableCallback } from "~/hooks/useStableCallback";
import type { ForkPanelProps } from "../panels/types";
import {
  profiles,
  profileError,
  requestProfileAction,
  runProfileCommand,
  useProfilesSupported,
} from "./state";
import { useRunProfileCommand } from "./runInTerminal";

const CONFIRM_KEY = "loom:project-profiles:varlock-confirmed:v1";
export function varlockConfirmed(environmentId: string): boolean {
  try {
    return localStorage.getItem(`${CONFIRM_KEY}:${environmentId}`) === "yes";
  } catch {
    return false;
  }
}
function rememberVarlockConfirmation(environmentId: string) {
  try {
    localStorage.setItem(`${CONFIRM_KEY}:${environmentId}`, "yes");
  } catch {
    /* Storage can be unavailable in private browser sessions. */
  }
}
function envStatusText(status: EnvItemStatus): string {
  switch (status._tag) {
    case "set":
      return `Set in ${status.source}`;
    case "empty":
      return `Empty in ${status.source}`;
    case "invalid":
      return `Invalid: ${status.reason}`;
    case "missing":
      return "Missing";
    case "resolvedByVarlock":
      return `Resolved by varlock (${status.functionName})`;
    case "unchecked":
      return `Unchecked type in ${status.source}`;
  }
}
export function filterEnvItems(
  items: readonly EnvItem[],
  search: string,
  filter: string,
  validation: VarlockValidation | null = null,
) {
  const query = search.trim().toLowerCase();
  return items.filter((item) => {
    const status = validation?.itemErrors[item.key]
      ? "invalid"
      : validation && validation.rootErrors.length === 0
        ? "set"
        : item.status._tag;
    return (
      (filter === "all" ||
        (filter === "attention"
          ? ["missing", "empty", "invalid"].includes(status)
          : status === filter)) &&
      `${item.key} ${item.description ?? ""} ${item.tags.join(" ")}`.toLowerCase().includes(query)
    );
  });
}
function EnvRow({
  item,
  error,
  validated,
}: {
  item: EnvItem;
  error?: string | undefined;
  validated: boolean;
}) {
  const attention =
    error || (!validated && ["missing", "invalid", "empty"].includes(item.status._tag));
  return (
    <article className="space-y-2 border-b border-border/60 px-4 py-3" aria-label={item.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <code className="break-all text-xs font-semibold">{item.key}</code>
        <span className={attention ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
          {error
            ? `Invalid: ${error}`
            : validated
              ? "Validated by varlock"
              : envStatusText(item.status)}
        </span>
      </div>
      {item.description ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
      ) : null}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span>{item.type ?? "string"}</span>
        <span>{item.required ? "Required" : "Optional"}</span>
        <span>{item.sensitive ? "Sensitive" : "Public"}</span>
        <span>Line {item.line}</span>
        {item.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </p>
      {item.example !== null ? (
        <p className="text-xs text-muted-foreground">
          Example: <code>{item.example}</code>
        </p>
      ) : null}
      {item.docs.map((doc) => (
        <a
          key={doc.url}
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline underline-offset-2"
        >
          {doc.label ?? "Documentation"}
        </a>
      ))}
    </article>
  );
}
export default function EnvPanel(props: ForkPanelProps) {
  const supported = useProfilesSupported(props.threadRef.environmentId);
  if (!props.visible) return null;
  if (!supported)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        This environment does not run Loom's project profiles.
      </p>
    );
  return (
    <ProjectEnv key={`${props.threadRef.environmentId}:${props.threadRef.threadId}`} {...props} />
  );
}
function ProjectEnv({ threadRef }: ForkPanelProps) {
  const thread = useQuietThreadShell(threadRef);
  const project = useProject(
    thread ? scopeProjectRef(threadRef.environmentId, thread.projectId) : null,
  );
  const config = useServerConfigs().get(threadRef.environmentId);
  const providers = useEnvironmentProviders().get(threadRef.environmentId);
  const input = thread ? { projectId: thread.projectId, threadId: threadRef.threadId } : null;
  const report = useEnvironmentQuery(
    input ? profiles.envReport({ environmentId: threadRef.environmentId, input }) : null,
  );
  const profile = useEnvironmentQuery(
    input
      ? profiles.profile({
          environmentId: threadRef.environmentId,
          input: { projectId: input.projectId },
        })
      : null,
  );
  const budget = useEnvironmentQuery(
    input ? profiles.budgetStatus({ environmentId: threadRef.environmentId, input }) : null,
  );
  const canValidate = useAtomValue(profiles.validate.permissionAtom(threadRef.environmentId));
  const canRun = useAtomValue(profiles.command.permissionAtom(threadRef.environmentId));
  const run = useRunProfileCommand(threadRef);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<VarlockValidation | null>(null);
  const [confirm, setConfirm] = useState(false);
  const refresh = useStableCallback(() => {
    report.refresh();
    profile.refresh();
    budget.refresh();
    setValidation(null);
  });
  const completedAt = thread?.latestRun?.completedAt;
  const refreshBudget = budget.refresh;
  useEffect(() => {
    if (completedAt) refreshBudget();
  }, [completedAt, refreshBudget]);
  const data = report.data;
  const available = data?.varlock._tag === "available";
  const automatic = profile.data?.env.varlock === "auto";
  const wrapped = automatic && data?.schema._tag === "ok" && available;
  const commandTitle = !canRun
    ? "Terminal operate access is required"
    : automatic && !available
      ? "Install varlock to use this"
      : undefined;
  const validate = async () => {
    if (!input || !canValidate || !available || busy) return;
    setConfirm(false);
    setBusy("validate");
    setMessage(null);
    try {
      setValidation(
        await runProfileCommand(profiles.validate, {
          environmentId: threadRef.environmentId,
          input,
        }),
      );
      rememberVarlockConfirmation(threadRef.environmentId);
    } catch (error) {
      setMessage(profileError(error));
    }
    setBusy(null);
  };
  const runTarget = async (target: Parameters<typeof run>[0], label: string) => {
    if (!canRun || busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await run(target);
      setMessage(`${label} started in the terminal.`);
    } catch (error) {
      setMessage(profileError(error));
    }
    setBusy(null);
  };
  const commands = project && config ? resolveProjectScripts(config.settings, project) : [];
  const filtered = filterEnvItems(data?.items ?? [], search, filter, validation);
  const provider = providers?.find(
    (provider) => provider.instanceId === thread?.providerInstanceId,
  );
  const providerLabel = provider ? resolveProviderInstanceDisplayName(provider) : "this provider";
  if (!thread)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Open a saved project thread to inspect its checkout.
      </p>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Env</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Schema and presence. Values stay on the environment's computer.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              requestProfileAction({
                kind: "edit",
                environmentId: threadRef.environmentId,
                projectId: thread.projectId,
              })
            }
          >
            Edit profile
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={report.isPending}>
            Refresh
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {report.error ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>{report.error}</p>
              <Button variant="outline" size="sm" onClick={refresh}>
                Try again
              </Button>
            </div>
          ) : null}
          {report.isPending && !data ? (
            <p role="status" className="text-sm text-muted-foreground">
              Reading env metadata...
            </p>
          ) : null}
          {data ? (
            <>
              <p className="break-all font-mono text-2xs text-muted-foreground">{data.root}</p>
              {data.schema._tag === "absent" ? (
                <div className="space-y-2 text-sm">
                  <p>No {data.schema.path} in this checkout.</p>
                  <p className="text-xs text-muted-foreground">
                    An env-spec schema describes the variables this project needs. Add types and
                    required or sensitive annotations beside each key.{" "}
                    <a
                      href="https://varlock.dev"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Learn about env-spec
                    </a>
                    .
                  </p>
                </div>
              ) : data.schema._tag === "invalid" ? (
                <p role="alert" className="text-sm">
                  {data.schema.path}:{data.schema.line}:{data.schema.column}: {data.schema.message}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {data.schema.path}
                  {data.schema.currentEnv ? ` · ${data.schema.currentEnv}` : ""}
                  {data.schema.imports.length ? ` · ${data.schema.imports.length} imports` : ""}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    !canValidate || !available || busy !== null || data.schema._tag !== "ok"
                  }
                  title={
                    !canValidate
                      ? "Terminal operate access is required"
                      : !available
                        ? "Install varlock to use this"
                        : undefined
                  }
                  onClick={() =>
                    varlockConfirmed(threadRef.environmentId) ? void validate() : setConfirm(true)
                  }
                >
                  {busy === "validate" ? "Validating..." : "Validate with varlock"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {data.varlock._tag === "available"
                    ? `varlock ${data.varlock.version}`
                    : data.varlock.installHint}
                </span>
              </div>
              {validation ? (
                <div role={validation.ok ? "status" : "alert"} className="space-y-1 text-xs">
                  <p>
                    {validation.ok
                      ? "Varlock validation passed."
                      : "Varlock found configuration errors."}{" "}
                    {Math.round(validation.durationMs)} ms
                  </p>
                  {[...new Set(validation.rootErrors)].map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                </div>
              ) : null}
              <section className="space-y-2" aria-label="Project commands">
                <h3 className="text-xs font-semibold">Commands</h3>
                <div className="flex flex-wrap gap-2">
                  {COMMAND_INTENTS.filter((intent) => profile.data?.commands[intent]).map(
                    (intent) => (
                      <Button
                        key={intent}
                        variant="outline"
                        size="sm"
                        disabled={
                          !canRun ||
                          busy !== null ||
                          (!wrapped && profile.data?.env.varlock !== "never")
                        }
                        title={commandTitle}
                        onClick={() => void runTarget({ intent }, intent)}
                      >
                        Run {intent}
                        {automatic ? " with varlock" : ""}
                      </Button>
                    ),
                  )}
                  {commands.map((script) => (
                    <Button
                      key={script.id}
                      variant="ghost"
                      size="sm"
                      disabled={
                        !canRun ||
                        busy !== null ||
                        (!wrapped && profile.data?.env.varlock !== "never")
                      }
                      title={commandTitle}
                      onClick={() => void runTarget({ scriptId: script.id }, script.name)}
                    >
                      {script.name}
                      {automatic ? " with varlock" : ""}
                    </Button>
                  ))}
                </div>
                {!commands.length &&
                !COMMAND_INTENTS.some((intent) => profile.data?.commands[intent]) ? (
                  <p className="text-xs text-muted-foreground">
                    Map commands in the project profile or add actions in Project settings.
                  </p>
                ) : null}
              </section>
            </>
          ) : null}
          <section
            aria-label="Token budgets"
            className="space-y-1 rounded-lg border border-border p-3 text-xs"
          >
            <h3 className="font-semibold">Token budgets</h3>
            {budget.error ? (
              <p role="alert">{budget.error}</p>
            ) : budget.data ? (
              <>
                <p>
                  Project today: {budget.data.projectTokensToday.toLocaleString()}
                  {budget.data.dailyTokens
                    ? ` / ${budget.data.dailyTokens.toLocaleString()}`
                    : " tokens"}
                </p>
                <p>
                  {budget.data.thread?.reported
                    ? `Thread: ${budget.data.thread.tokens.toLocaleString()}${budget.data.thread.threadTokens ? ` / ${budget.data.thread.threadTokens.toLocaleString()}` : " tokens"}`
                    : `Token usage is not reported by ${providerLabel} for this thread yet.`}
                </p>
                <p className="text-muted-foreground">
                  Advisory. The day ends at the environment's local midnight ({budget.data.day}).
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Loading usage...</p>
            )}
          </section>
          {message ? (
            <p role="status" className="text-xs">
              {message}
            </p>
          ) : null}
          {data ? (
            <div className="flex gap-2">
              <Input
                size="sm"
                aria-label="Search env variables"
                placeholder="Search variables"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select value={filter} onValueChange={(value) => value && setFilter(value)}>
                <SelectTrigger size="sm" aria-label="Filter env status">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {[
                    { value: "all", label: "All" },
                    { value: "attention", label: "Needs attention" },
                    { value: "set", label: "Set" },
                    { value: "resolvedByVarlock", label: "Varlock" },
                  ].map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </div>
        {data ? (
          <section aria-label="Environment variables">
            {filtered.length > 200 ? (
              <div className="h-96">
                <LegendList
                  data={filtered}
                  keyExtractor={(item) => item.key}
                  renderItem={({ item }) => (
                    <EnvRow
                      item={item}
                      error={validation?.itemErrors[item.key]}
                      validated={validation !== null && validation.rootErrors.length === 0}
                    />
                  )}
                  estimatedItemSize={110}
                />
              </div>
            ) : (
              filtered.map((item) => (
                <EnvRow
                  key={item.key}
                  item={item}
                  error={validation?.itemErrors[item.key]}
                  validated={validation !== null && validation.rootErrors.length === 0}
                />
              ))
            )}
            {!filtered.length ? (
              <p className="px-4 pb-4 text-xs text-muted-foreground">
                {data.items.length ? "No matching variables." : "No schema variables found."}
              </p>
            ) : null}
            {data.unschematizedKeys.length ? (
              <div className="space-y-2 p-4">
                <h3 className="text-xs font-semibold">Variables without a schema</h3>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {data.unschematizedKeys.join(", ")}
                </p>
              </div>
            ) : null}
            {data.envFiles.length ? (
              <p className="px-4 pb-4 text-2xs text-muted-foreground">
                Files: {data.envFiles.join(", ")}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Validate with varlock?</AlertDialogTitle>
            <AlertDialogDescription>
              varlock loads this project's configuration on{" "}
              {config?.environment.label ?? "this computer"}. That can contact the secret managers
              and run the code generators the project configured. Values stay on the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button disabled={!canValidate || busy !== null} onClick={() => void validate()}>
              Validate
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
