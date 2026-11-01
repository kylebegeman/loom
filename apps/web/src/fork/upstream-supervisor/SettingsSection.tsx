import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  type AuthClientSession,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import type {
  UpstreamSupervisorConfig,
  UpstreamSupervisorStatus,
  VaultGitHubTarget,
} from "@t3tools/contracts/fork";
import {
  createUpstreamSupervisorAtoms,
  createVaultGitHubAtoms,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import * as DateTime from "effect/DateTime";
import { useId, useState } from "react";
import {
  ActivityIcon,
  GitForkIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  WorkflowIcon,
} from "lucide-react";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { connectionAtomRuntime } from "~/connection/runtime";
import { authEnvironment } from "~/state/auth";
import { useProjects, useServerConfigs } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { LoomSettingsActions, LoomSettingsField, LoomSettingsNotice } from "../settings/parts";
import { runVault } from "../vault/state";
import { LibraryStateBadge } from "../project-library/LibraryControls";

const supervisor = createUpstreamSupervisorAtoms(connectionAtomRuntime);
const github = createVaultGitHubAtoms(connectionAtomRuntime);
function sessionName(session: AuthClientSession | undefined) {
  if (!session) return "Saved login";
  // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- AuthClientSession.client contains display metadata, not an RPC connection.
  const { client: metadata } = session;
  return (
    metadata.label ??
    ([metadata.os, metadata.browser].filter(Boolean).join(" · ") || "Unnamed login")
  );
}
const sessionLabel = (session: AuthClientSession) =>
  `${sessionName(session)} · signed in ${new Date(DateTime.toEpochMillis(session.issuedAt)).toLocaleString()}`;

export function UpstreamSupervisorSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (!environment)
    return (
      <LoomSettingsNotice>Choose a computer to manage its upstream supervisor.</LoomSettingsNotice>
    );
  if (environment.connection.phase !== "connected")
    return (
      <LoomSettingsNotice>
        Connect this computer to manage its upstream supervisor.
      </LoomSettingsNotice>
    );
  if (
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "upstream-supervisor",
    )
  )
    return (
      <LoomSettingsNotice>
        Update this computer to a Loom version with upstream supervisor support.
      </LoomSettingsNotice>
    );
  if (!canRead)
    return (
      <LoomSettingsNotice>
        This connection needs View access permission to inspect the upstream supervisor.
      </LoomSettingsNotice>
    );
  return (
    <SupervisorSettings
      key={environment.environmentId}
      environmentId={environment.environmentId}
      computerLabel={environment.label}
      canWrite={canWrite}
    />
  );
}

function SupervisorSettings({
  environmentId,
  computerLabel,
  canWrite,
}: {
  environmentId: EnvironmentId;
  computerLabel: string;
  canWrite: boolean;
}) {
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const initialProject = projects[0];
  const status = useEnvironmentQuery(
    initialProject
      ? supervisor.status({ environmentId, input: { projectId: initialProject.id } })
      : null,
  );
  const access = useEnvironmentQuery(authEnvironment.accessChanges({ environmentId, input: null }));
  const sessions =
    access.data?.type === "snapshot"
      ? access.data.payload.clientSessions.filter((session) =>
          (session.permissions ?? session.scopes).includes(AuthOrchestrationOperateScope),
        )
      : [];
  const allowed = useAtomValue(supervisor.configure.permissionAtom(environmentId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const config = status.data?.config ?? null;
  const locked = pending || !canWrite || !allowed || status.isPending || status.error !== null;
  async function save(input: Omit<UpstreamSupervisorConfig, "updatedAt">) {
    if (locked) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await runVault(supervisor.configure, { environmentId, input });
      setNotice(
        input.enabled
          ? "Upstream supervisor enabled for the saved chief login."
          : "Configuration saved. Upstream supervisor is paused.",
      );
      setEditing(false);
      status.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the upstream supervisor. Refresh and try again.",
      );
    }
    setPending(false);
  }
  const editorOpen = !config || editing;
  const currentProject = projects.find((project) => project.id === config?.projectId);
  const chief = sessions.find((session) => session.sessionId === config?.clientSessionId);
  return (
    <div className="@container/supervisor min-w-0 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          <LibraryStateBadge tone={config?.enabled ? "success" : "neutral"}>
            {config
              ? config.enabled
                ? "Enabled"
                : "Paused"
              : status.data
                ? "Not configured"
                : status.isPending
                  ? "Loading"
                  : "Unavailable"}
          </LibraryStateBadge>
          <span>{computerLabel}</span>
        </div>
        <Button
          shape="pill"
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh status and logins"
          disabled={pending || status.isPending}
          onClick={() => {
            status.refresh();
            access.refresh();
          }}
        >
          <RefreshCwIcon aria-hidden />
        </Button>
      </header>
      {!canWrite || !allowed ? (
        <LoomSettingsNotice>
          This connection needs Manage access permission to change the supervisor.
        </LoomSettingsNotice>
      ) : null}
      {projects.length === 0 ? (
        <LoomSettingsNotice>
          Add a project on this computer before configuring the supervisor.
        </LoomSettingsNotice>
      ) : null}
      {status.error ? <LoomSettingsNotice role="alert">{status.error}</LoomSettingsNotice> : null}
      {status.data?.unavailable ? (
        <LoomSettingsNotice role="alert">
          The upstream service is unavailable. Saved setup and activity are still shown. You can
          pause new requests.
        </LoomSettingsNotice>
      ) : null}
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {status.isPending && !status.data ? (
        <div
          role="status"
          aria-label="Loading upstream supervisor"
          className="space-y-5 rounded-xl border border-border/60 p-5"
        >
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : null}
      <div className="grid min-w-0 items-start gap-7 @min-[46rem]/supervisor:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {config && !editing ? (
            <section
              aria-label="Saved supervisor setup"
              className="space-y-5 rounded-xl border border-border/60 bg-card/40 p-5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <GitForkIcon aria-hidden className="size-6" />
                </span>
                <div className="min-w-0 space-y-1">
                  <h2 className="wrap-anywhere text-lg font-semibold tracking-tight">
                    {config.connection.repository}
                  </h2>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {config.enabled
                      ? "Your chief can request integrations for this repository."
                      : "Setup is saved. Enable when you want your chief to request integrations."}
                  </p>
                </div>
              </div>
              <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-4 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Project</dt>
                  <dd className="mt-1 wrap-anywhere">
                    {currentProject?.title ?? "Project no longer registered"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Chief login</dt>
                  <dd className="mt-1 wrap-anywhere">{sessionName(chief)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">GitHub connection</dt>
                  <dd className="mt-1">Pinned to version {config.connection.expectedVersion}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Workflow</dt>
                  <dd className="mt-1 wrap-anywhere">
                    {status.data?.workflow ?? "loom-upstream.yml"}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                <Button
                  shape="pill"
                  size="sm"
                  variant={config.enabled ? "outline" : "default"}
                  disabled={locked || (!config.enabled && status.data?.unavailable === true)}
                  onClick={() =>
                    void save({
                      projectId: config.projectId,
                      clientSessionId: config.clientSessionId,
                      connection: config.connection,
                      enabled: !config.enabled,
                    })
                  }
                >
                  {config.enabled ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
                  {pending ? "Saving…" : config.enabled ? "Pause supervisor" : "Enable supervisor"}
                </Button>
                <Button
                  shape="pill"
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon aria-hidden />
                  Edit setup
                </Button>
              </div>
            </section>
          ) : null}
          {initialProject && status.data && editorOpen ? (
            <SupervisorEditor
              key={config?.updatedAt ?? "new"}
              environmentId={environmentId}
              projects={projects}
              initialProjectId={initialProject.id}
              config={config}
              sessions={sessions}
              accessPending={access.isPending && access.data === null}
              accessError={access.error}
              disabled={locked}
              saving={pending}
              onSave={(input) => void save(input)}
              onCancel={config ? () => setEditing(false) : undefined}
            />
          ) : null}
        </div>
        <aside className="min-w-0 space-y-6">
          <section className="space-y-2" aria-label="Supervisor behavior">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <WorkflowIcon aria-hidden className="size-4 text-muted-foreground" />
              {config ? "How it runs" : "Starts paused"}
            </h2>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Saving links one project, chief login and GitHub repository. Enable and pause are
              separate controls. Saving setup does not create a schedule.
            </p>
          </section>
          <SupervisorActivity status={status.data} />
        </aside>
      </div>
    </div>
  );
}

function SupervisorActivity({ status }: { readonly status: UpstreamSupervisorStatus | null }) {
  return (
    <section
      aria-label="Recent upstream activity"
      className="space-y-4 border-t border-border/60 pt-5"
    >
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <ActivityIcon aria-hidden className="size-4 text-muted-foreground" />
        Recent activity
      </h2>
      {status?.mainSha ? (
        <p className="text-xs text-muted-foreground">
          Main <code className="font-mono text-foreground">{status.mainSha.slice(0, 12)}</code>
        </p>
      ) : null}
      {!status ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Activity loads with the supervisor status.
        </p>
      ) : status.runs.length === 0 &&
        status.receipts.length === 0 &&
        (status.retryReceipts?.length ?? 0) === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          No recorded integrations. Workflow runs and requests will appear here.
        </p>
      ) : (
        <div className="space-y-5">
          {status.runs.length > 0 ? (
            <ul className="space-y-4" aria-label="Workflow runs">
              {status.runs.map((run) => (
                <li key={`${run.id}:${run.attempt}`} className="min-w-0 space-y-1.5">
                  <a
                    href={run.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block wrap-anywhere text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {run.title}
                  </a>
                  <LibraryStateBadge
                    tone={
                      run.conclusion === "success"
                        ? "success"
                        : run.conclusion === "failure"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {run.conclusion ?? run.status}
                  </LibraryStateBadge>
                </li>
              ))}
            </ul>
          ) : null}
          {status.receipts.length > 0 ? (
            <ul className="space-y-3" aria-label="Integration requests">
              {status.receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span className="wrap-anywhere font-medium">{receipt.targetTag}</span>
                  <LibraryStateBadge
                    tone={
                      receipt.status === "refused"
                        ? "danger"
                        : receipt.status === "unknown"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {receipt.run?.conclusion ?? receipt.status}
                  </LibraryStateBadge>
                </li>
              ))}
            </ul>
          ) : null}
          {(status.retryReceipts?.length ?? 0) > 0 ? (
            <ul className="space-y-3" aria-label="Failed-job retry requests">
              {status.retryReceipts?.map((receipt) => (
                <li key={receipt.id} className="min-w-0 space-y-1.5 text-xs">
                  {receipt.run ? (
                    <a
                      href={receipt.run.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block wrap-anywhere font-medium underline-offset-4 hover:underline"
                    >
                      Retry run {receipt.runId} after attempt {receipt.expectedAttempt}
                    </a>
                  ) : (
                    <p className="wrap-anywhere font-medium">
                      Retry run {receipt.runId} after attempt {receipt.expectedAttempt}
                    </p>
                  )}
                  <LibraryStateBadge
                    tone={
                      receipt.status === "refused"
                        ? "danger"
                        : receipt.status === "unknown"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {receipt.run && receipt.run.attempt > receipt.expectedAttempt
                      ? `Attempt ${receipt.run.attempt}: ${receipt.run.conclusion ?? receipt.run.status}`
                      : receipt.status}
                  </LibraryStateBadge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

function SupervisorEditor({
  environmentId,
  projects,
  initialProjectId,
  config,
  sessions,
  accessPending,
  accessError,
  disabled,
  saving,
  onSave,
  onCancel,
}: {
  environmentId: EnvironmentId;
  projects: ReturnType<typeof useProjects>;
  initialProjectId: ProjectId;
  config: UpstreamSupervisorConfig | null;
  sessions: ReadonlyArray<AuthClientSession>;
  accessPending: boolean;
  accessError: string | null;
  disabled: boolean;
  saving: boolean;
  onSave: (input: Omit<UpstreamSupervisorConfig, "updatedAt">) => void;
  onCancel?: (() => void) | undefined;
}) {
  const saveHintId = useId();
  const [projectId, setProjectId] = useState(config?.projectId ?? initialProjectId);
  const [clientSessionId, setClientSessionId] = useState(config?.clientSessionId ?? "");
  const [connection, setConnection] = useState<VaultGitHubTarget | null>(
    config?.connection ?? null,
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useEnvironmentQuery(github.list({ environmentId, input: { cursor } }));
  const selected = useEnvironmentQuery(
    connection ? github.info({ environmentId, input: { id: connection.id } }) : null,
  );
  const choices = page.data?.items ?? [];
  const selectedInfo = selected.data ?? choices.find((info) => info.item.id === connection?.id);
  const options =
    selectedInfo && !choices.some((info) => info.item.id === selectedInfo.item.id)
      ? [selectedInfo, ...choices]
      : choices;
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedSession = sessions.find((session) => session.sessionId === clientSessionId);
  const currentConnection =
    connection &&
    selected.data?.item.id === connection.id &&
    selected.data.item.state === "active" &&
    selected.data.item.version === connection.expectedVersion &&
    selected.data.repositories.includes(connection.repository) &&
    !selected.isPending &&
    selected.error === null;
  const missing = [
    !selectedProject ? "choose a project" : null,
    accessPending
      ? "wait for chief logins to load"
      : accessError
        ? "refresh chief logins"
        : !selectedSession
          ? "choose a chief login"
          : null,
    !connection
      ? "choose a GitHub connection"
      : !connection.repository
        ? "choose a repository"
        : !currentConnection
          ? "review the GitHub connection above"
          : null,
  ].filter((entry) => entry !== null);
  const connectionsLocked = disabled || page.isPending || page.error !== null;
  return (
    <div className="@container/setup space-y-6 rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          {config ? "Edit setup" : "Connect your chief"}
        </h2>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          Choose the project and existing login your Grok chief will use.
        </p>
      </div>
      <div className="grid min-w-0 gap-x-5 gap-y-5 @min-[28rem]/setup:grid-cols-2">
        <LoomSettingsField label="Project">
          <Select
            value={projectId}
            disabled={disabled}
            onValueChange={(value) => {
              const project = projects.find((entry) => entry.id === value);
              if (project) setProjectId(project.id);
            }}
          >
            <SelectTrigger aria-label="Upstream supervisor project">
              <SelectValue>{selectedProject?.title ?? "Choose a project"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title} · {project.workspaceRoot}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LoomSettingsField>
        <LoomSettingsField label="Chief login" description="Your chief’s existing Loom login.">
          <Select
            value={clientSessionId}
            disabled={disabled || accessPending || accessError !== null || sessions.length === 0}
            onValueChange={(value) => {
              if (value !== null) setClientSessionId(value);
            }}
          >
            <SelectTrigger aria-label="Upstream supervisor chief login">
              <SelectValue>
                {selectedSession ? sessionName(selectedSession) : "Choose a chief login"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {sessions.map((session) => (
                <SelectItem key={session.sessionId} value={session.sessionId}>
                  {sessionLabel(session)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LoomSettingsField>
      </div>
      {accessError ? (
        <LoomSettingsNotice role="alert">
          Could not load chief logins. {accessError} Use Refresh to try again.
        </LoomSettingsNotice>
      ) : accessPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading chief logins…
        </p>
      ) : sessions.length === 0 ? (
        <LoomSettingsNotice>
          Connect your chief to this computer with permission to operate work, then refresh logins.
        </LoomSettingsNotice>
      ) : clientSessionId && !selectedSession ? (
        <LoomSettingsNotice>
          The saved chief login is no longer available. Choose its current login before saving.
        </LoomSettingsNotice>
      ) : null}
      <div className="grid min-w-0 gap-x-5 gap-y-5 @min-[28rem]/setup:grid-cols-2">
        <LoomSettingsField
          label="Vault GitHub connection"
          description="Saved GitHub account for this repository."
        >
          <Select
            value={connection?.id ?? ""}
            disabled={connectionsLocked || options.length === 0}
            onValueChange={(id) => {
              const info = options.find((entry) => entry.item.id === id);
              if (info?.item.state === "active" && info.repositories.length > 0)
                setConnection({
                  id: info.item.id,
                  expectedVersion: info.item.version,
                  repository: info.repositories.length === 1 ? info.repositories[0]! : "",
                });
            }}
          >
            <SelectTrigger aria-label="Upstream supervisor GitHub connection">
              <SelectValue>
                {selectedInfo
                  ? `${selectedInfo.item.label} · ${selectedInfo.account}`
                  : "Choose a GitHub connection"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {options.map((info) => (
                <SelectItem
                  key={info.item.id}
                  value={info.item.id}
                  disabled={info.item.state !== "active" || info.repositories.length === 0}
                >
                  {info.item.label} · {info.account} · version {info.item.version}
                  {info.repositories.length === 0 ? " · no repositories" : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LoomSettingsField>
        <LoomSettingsField
          label="Repository"
          description={
            connection
              ? `Using connection version ${connection.expectedVersion}.`
              : "Choose a GitHub connection to see its repositories."
          }
        >
          <Select
            value={connection?.repository ?? ""}
            disabled={
              disabled ||
              !selectedInfo ||
              selected.isPending ||
              selected.error !== null ||
              selectedInfo.item.state !== "active"
            }
            onValueChange={(repository) => {
              if (
                connection &&
                repository !== null &&
                selectedInfo?.repositories.includes(repository)
              )
                setConnection({ ...connection, repository });
            }}
          >
            <SelectTrigger aria-label="Upstream supervisor repository">
              <SelectValue>{connection?.repository || "Choose a repository"}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {selectedInfo?.repositories.map((repository) => (
                <SelectItem key={repository} value={repository}>
                  {repository}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LoomSettingsField>
      </div>
      {page.isPending && !page.data && !page.error ? (
        <p role="status">Loading GitHub connections…</p>
      ) : null}
      {page.error ? (
        <LoomSettingsNotice role="alert">
          <p>Could not load GitHub connections. Refresh connections to try again.</p>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer">Connection details</summary>
            <p className="mt-2 wrap-anywhere">{page.error}</p>
          </details>
        </LoomSettingsNotice>
      ) : null}
      {selected.error ? (
        <LoomSettingsNotice role="alert">
          Could not inspect the selected GitHub connection. {selected.error} Refresh connections to
          try again.
        </LoomSettingsNotice>
      ) : null}
      {page.data?.items.length === 0 ? (
        <LoomSettingsNotice>
          No GitHub connections on this page.{" "}
          {page.data.nextCursor
            ? "Continue to the next page."
            : "Add one in Settings > Vault > GitHub for agents."}
        </LoomSettingsNotice>
      ) : null}
      {selectedInfo && selectedInfo.item.state !== "active" ? (
        <LoomSettingsNotice>
          The selected GitHub connection is inactive. Choose an active connection.
        </LoomSettingsNotice>
      ) : null}
      {selectedInfo && connection && selectedInfo.item.version !== connection.expectedVersion ? (
        <LoomSettingsNotice>
          This connection changed from version {connection.expectedVersion} to{" "}
          {selectedInfo.item.version}. Review its repository, then accept the current version before
          saving.
          <div className="mt-2">
            <Button
              variant="outline"
              shape="pill"
              size="sm"
              disabled={disabled || selected.isPending || selectedInfo.item.state !== "active"}
              onClick={() => {
                setConnection({
                  ...connection,
                  expectedVersion: selectedInfo.item.version,
                  repository: selectedInfo.repositories.includes(connection.repository)
                    ? connection.repository
                    : "",
                });
              }}
            >
              Use connection version {selectedInfo.item.version}
            </Button>
          </div>
        </LoomSettingsNotice>
      ) : null}
      {selectedInfo &&
      connection?.repository &&
      !selectedInfo.repositories.includes(connection.repository) ? (
        <LoomSettingsNotice>
          The selected repository is no longer available. Choose another repository.
        </LoomSettingsNotice>
      ) : null}
      <LoomSettingsActions>
        <Button
          variant="ghost"
          shape="pill"
          size="xs"
          disabled={disabled || page.isPending || selected.isPending}
          onClick={() => {
            page.refresh();
            selected.refresh();
          }}
        >
          Refresh connections
        </Button>
        {cursor ? (
          <Button
            variant="outline"
            size="sm"
            disabled={connectionsLocked}
            onClick={() => setCursor(null)}
          >
            First page
          </Button>
        ) : null}
        {page.data?.nextCursor ? (
          <Button
            variant="outline"
            size="sm"
            disabled={connectionsLocked}
            onClick={() => setCursor(page.data?.nextCursor ?? null)}
          >
            More connections
          </Button>
        ) : null}
      </LoomSettingsActions>
      <div className="space-y-3 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            shape="pill"
            size="sm"
            aria-describedby={saveHintId}
            disabled={disabled || missing.length > 0}
            onClick={() => {
              if (
                !disabled &&
                selectedProject &&
                selectedSession &&
                connection &&
                currentConnection &&
                !accessPending &&
                !accessError
              )
                onSave({
                  projectId: selectedProject.id,
                  clientSessionId: selectedSession.sessionId,
                  connection,
                  enabled: false,
                });
            }}
          >
            {saving ? "Saving…" : "Save paused configuration"}
          </Button>
          {onCancel ? (
            <Button shape="pill" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          ) : null}
        </div>
        <p id={saveHintId} className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {missing.length > 0
            ? `To save, ${missing.join(", ")}.`
            : "Ready to save. The supervisor will stay paused."}
        </p>
      </div>
    </div>
  );
}
