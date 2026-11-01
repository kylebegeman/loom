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
import { useState } from "react";
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
        Let one existing chief login request nightly integrations through loom-upstream.yml on main.
        Save the selected access paused, then enable it. This does not change general Vault
        permissions.
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
      <LoomSettingsActions>
        <Button
          variant="outline"
          size="sm-multiline"
          disabled={pending || status.isPending}
          onClick={() => {
            status.refresh();
            access.refresh();
          }}
        >
          Refresh status and logins
        </Button>
      </LoomSettingsActions>
      {config ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{config.enabled ? "Enabled" : "Paused"}</Badge>
            <span className="text-sm font-medium">{config.connection.repository}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Project:{" "}
            {projects.find((project) => project.id === config.projectId)?.title ??
              "Project no longer registered"}
            . Chief:{" "}
            {sessionName(sessions.find((session) => session.sessionId === config.clientSessionId))}.
            Connection version {config.connection.expectedVersion}.
          </p>
          <LoomSettingsActions>
            <Button
              variant={config.enabled ? "outline" : "default"}
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
          </LoomSettingsActions>
        </div>
      ) : status.data ? (
        <LoomSettingsNotice>
          No upstream supervisor is configured on this computer.
        </LoomSettingsNotice>
      ) : null}
      {initialProject && status.data ? (
        <SupervisorEditor
          key={config?.updatedAt ?? "new"}
          environmentId={environmentId}
          projects={projects}
          initialProjectId={initialProject.id}
          config={config}
          sessions={sessions}
          accessPending={access.isPending}
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
  const [projectId, setProjectId] = useState(config?.projectId ?? initialProjectId);
  const [clientSessionId, setClientSessionId] = useState(config?.clientSessionId ?? "");
  const [connection, setConnection] = useState<VaultGitHubTarget | null>(
    config?.connection ?? null,
  );
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedSession = sessions.find((session) => session.sessionId === clientSessionId);
  return (
    <div className="space-y-4">
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
        description="Choose the existing login used by your Grok chief. Signing out or revoking it removes its access."
      >
        <Select
          value={clientSessionId}
          disabled={disabled || accessPending || accessError !== null}
          onValueChange={(value) => {
            if (value !== null) setClientSessionId(value);
          }}
        >
          <SelectTrigger aria-label="Upstream supervisor chief login">
            <SelectValue>
              {selectedSession ? sessionLabel(selectedSession) : "Choose an existing chief login"}
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
      {accessError ? (
        <LoomSettingsNotice role="alert">
          Could not load chief logins. {accessError}
        </LoomSettingsNotice>
      ) : accessPending && sessions.length === 0 ? (
        <p role="status">Loading chief logins…</p>
      ) : sessions.length === 0 ? (
        <LoomSettingsNotice>
          Connect your chief to this computer with permission to operate work, then refresh logins.
        </LoomSettingsNotice>
      ) : null}
      <GitHubPicker
        environmentId={environmentId}
        value={connection}
        disabled={disabled}
        onChange={setConnection}
      />
      <LoomSettingsActions>
        <Button
          variant="outline"
          size="sm-multiline"
          disabled={
            disabled ||
            !selectedProject ||
            !selectedSession ||
            !connection ||
            accessPending ||
            accessError !== null
          }
          onClick={() => {
            if (selectedProject && selectedSession && connection)
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
      </LoomSettingsActions>
      <p className="text-xs text-muted-foreground">
        Saving pauses the supervisor, including when you change its project, chief or GitHub
        connection. It does not start an integration or create a schedule.
      </p>
    </div>
  );
}

function GitHubPicker({
  environmentId,
  value,
  disabled,
  onChange,
}: {
  environmentId: EnvironmentId;
  value: VaultGitHubTarget | null;
  disabled: boolean;
  onChange: (value: VaultGitHubTarget) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useEnvironmentQuery(github.list({ environmentId, input: { cursor } }));
  const selected = useEnvironmentQuery(
    value ? github.info({ environmentId, input: { id: value.id } }) : null,
  );
  const choices = page.data?.items ?? [];
  const selectedInfo = choices.find((info) => info.item.id === value?.id) ?? selected.data;
  const options =
    selectedInfo && !choices.some((info) => info.item.id === selectedInfo.item.id)
      ? [selectedInfo, ...choices]
      : choices;
  const locked = disabled || page.isPending || page.error !== null;
  return (
    <div className="space-y-4">
      <LoomSettingsField
        label="Vault GitHub connection"
        description="Use an existing connection that can run the repository’s upstream workflow. Credentials stay in Vault."
      >
        <Select
          value={value?.id ?? ""}
          disabled={locked}
          onValueChange={(id) => {
            const info = options.find((entry) => entry.item.id === id);
            const repository = info?.repositories[0];
            if (info?.item.state === "active" && repository)
              onChange({ id: info.item.id, expectedVersion: info.item.version, repository });
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
                disabled={info.item.state !== "active"}
              >
                {info.item.label} · {info.account} · version {info.item.version}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LoomSettingsField>
      {page.isPending && !page.data ? <p role="status">Loading GitHub connections…</p> : null}
      {page.error ? <LoomSettingsNotice role="alert">{page.error}</LoomSettingsNotice> : null}
      {selected.error ? (
        <LoomSettingsNotice role="alert">
          Could not inspect the saved GitHub connection. {selected.error}
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
      {selectedInfo && value ? (
        <LoomSettingsField
          label="Repository"
          description={`Selected connection version ${value.expectedVersion}. Workflow: loom-upstream.yml on main.`}
        >
          <Select
            value={value.repository}
            disabled={locked || selectedInfo.item.state !== "active"}
            onValueChange={(repository) => {
              if (repository !== null && selectedInfo.repositories.includes(repository))
                onChange({
                  id: selectedInfo.item.id,
                  expectedVersion: selectedInfo.item.version,
                  repository,
                });
            }}
          >
            <SelectTrigger aria-label="Upstream supervisor repository">
              <SelectValue>{value.repository}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {selectedInfo.repositories.map((repository) => (
                <SelectItem key={repository} value={repository}>
                  {repository}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </LoomSettingsField>
      ) : null}
      {selectedInfo && value && selectedInfo.item.version !== value.expectedVersion ? (
        <LoomSettingsNotice>
          The saved connection version has changed. Review its repository and use the current
          version before saving.
          <div className="mt-2">
            <Button
              variant="outline"
              size="sm-multiline"
              disabled={locked || selectedInfo.item.state !== "active"}
              onClick={() => {
                const repository = selectedInfo.repositories.includes(value.repository)
                  ? value.repository
                  : selectedInfo.repositories[0];
                if (repository)
                  onChange({
                    id: selectedInfo.item.id,
                    expectedVersion: selectedInfo.item.version,
                    repository,
                  });
              }}
            >
              Use connection version {selectedInfo.item.version}
            </Button>
          </div>
        </LoomSettingsNotice>
      ) : null}
      <LoomSettingsActions>
        <Button
          variant="outline"
          size="sm-multiline"
          disabled={disabled || page.isPending}
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
            size="sm-multiline"
            disabled={locked}
            onClick={() => setCursor(null)}
          >
            First connections
          </Button>
        ) : null}
        {page.data?.nextCursor ? (
          <Button
            variant="outline"
            size="sm-multiline"
            disabled={locked}
            onClick={() => setCursor(page.data?.nextCursor ?? null)}
          >
            More connections
          </Button>
        ) : null}
      </LoomSettingsActions>
    </div>
  );
}
