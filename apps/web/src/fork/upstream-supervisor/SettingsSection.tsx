import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  type AuthClientSession,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import type { UpstreamSupervisorConfig, VaultGitHubTarget } from "@t3tools/contracts/fork";
import {
  createUpstreamSupervisorAtoms,
  createVaultGitHubAtoms,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import * as DateTime from "effect/DateTime";
import { useId, useState } from "react";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { Badge } from "~/components/ui/badge";
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
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "../settings/parts";
import { runVault } from "../vault/state";

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
      canWrite={canWrite}
    />
  );
}

function SupervisorSettings({
  environmentId,
  canWrite,
}: {
  environmentId: EnvironmentId;
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
  return (
    <LoomSettingsPanel>
      <p className="max-w-prose text-sm text-muted-foreground">
        Let your Grok chief request upstream integrations for one project and repository. Save its
        access paused, then enable it when you are ready.
      </p>
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
      {status.isPending && !status.data ? <p role="status">Loading upstream supervisor…</p> : null}
      {status.error ? <LoomSettingsNotice role="alert">{status.error}</LoomSettingsNotice> : null}
      {status.data?.unavailable ? (
        <LoomSettingsNotice role="alert">
          The upstream service is unavailable. Saved access and receipts are shown below. You can
          still pause the supervisor.
        </LoomSettingsNotice>
      ) : null}
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">Saved status</h4>
          <Badge variant={config?.enabled ? "success" : "secondary"}>
            {config
              ? config.enabled
                ? "Enabled"
                : "Paused"
              : status.data
                ? "Not configured"
                : status.isPending
                  ? "Loading"
                  : "Unavailable"}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || status.isPending}
          onClick={() => {
            status.refresh();
            access.refresh();
          }}
        >
          Refresh status and logins
        </Button>
      </div>
      {config ? (
        <div className="space-y-4">
          <dl className="grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Project</dt>
              <dd className="mt-1 wrap-anywhere">
                {projects.find((project) => project.id === config.projectId)?.title ??
                  "Project no longer registered"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Chief login</dt>
              <dd className="mt-1 wrap-anywhere">
                {sessionName(
                  sessions.find((session) => session.sessionId === config.clientSessionId),
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Repository</dt>
              <dd className="mt-1 wrap-anywhere">{config.connection.repository}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vault connection</dt>
              <dd className="mt-1">Version {config.connection.expectedVersion}</dd>
            </div>
          </dl>
          <LoomSettingsActions>
            <Button
              variant="outline"
              size="sm-multiline"
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
              {pending ? "Saving…" : config.enabled ? "Pause supervisor" : "Enable supervisor"}
            </Button>
            <p className="max-w-prose text-xs text-muted-foreground">
              {config.enabled
                ? "The saved chief can request integrations. Pause to stop new requests."
                : "New integration requests are blocked while paused."}
            </p>
          </LoomSettingsActions>
        </div>
      ) : status.data ? (
        <p className="text-sm text-muted-foreground">
          Choose the access below to set up this computer.
        </p>
      ) : null}
      {initialProject && status.data ? (
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
          onSave={(input) => void save(input)}
        />
      ) : null}
      {status.data && (status.data.runs.length > 0 || status.data.receipts.length > 0) ? (
        <LoomSettingsDetails title="Recent upstream activity">
          {status.data.mainSha ? (
            <p className="text-xs text-muted-foreground">
              Main: {status.data.mainSha.slice(0, 12)}
            </p>
          ) : null}
          {status.data.runs.map((run) => (
            <p key={`${run.id}:${run.attempt}`} className="text-sm">
              <a href={run.url} target="_blank" rel="noreferrer" className="underline">
                {run.title}
              </a>{" "}
              · {run.conclusion ?? run.status}
            </p>
          ))}
          {status.data.receipts.map((receipt) => (
            <p key={receipt.id} className="text-xs text-muted-foreground">
              {receipt.targetTag} · {receipt.status}
              {receipt.run ? ` · ${receipt.run.conclusion ?? receipt.run.status}` : ""}
            </p>
          ))}
        </LoomSettingsDetails>
      ) : null}
    </LoomSettingsPanel>
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
  onSave,
}: {
  environmentId: EnvironmentId;
  projects: ReturnType<typeof useProjects>;
  initialProjectId: ProjectId;
  config: UpstreamSupervisorConfig | null;
  sessions: ReadonlyArray<AuthClientSession>;
  accessPending: boolean;
  accessError: string | null;
  disabled: boolean;
  onSave: (input: Omit<UpstreamSupervisorConfig, "updatedAt">) => void;
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
    <div className="space-y-5 border-t border-border/60 pt-5">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">
          {config ? "Edit configuration" : "Configure access"}
        </h4>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          Use an existing chief login and Vault connection. Saving keeps the supervisor paused and
          does not start an integration or create a schedule.
        </p>
      </div>
      <div className="grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2">
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
        <LoomSettingsField
          label="Chief login"
          description="The existing Grok chief login on this computer. Revoking it removes its access."
        >
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
          Could not load chief logins. {accessError} Use Refresh status and logins to try again.
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
      <div className="grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2">
        <LoomSettingsField
          label="Vault GitHub connection"
          description="An existing connection with access to the repository’s upstream workflow."
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
              ? `Connection version ${connection.expectedVersion}. Runs loom-upstream.yml on main.`
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
      {page.isPending && !page.data ? <p role="status">Loading GitHub connections…</p> : null}
      {page.error ? (
        <LoomSettingsNotice role="alert">
          Could not load GitHub connections. {page.error}
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
              size="sm-multiline"
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
          size="sm"
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
      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
        <Button
          size="sm-multiline"
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
          Save paused configuration
        </Button>
        <p id={saveHintId} className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {missing.length > 0
            ? `To save, ${missing.join(", ")}.`
            : "Ready to save. The supervisor will stay paused."}
        </p>
      </div>
    </div>
  );
}
