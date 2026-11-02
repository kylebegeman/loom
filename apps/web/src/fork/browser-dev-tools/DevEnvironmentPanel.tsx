import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import HttpRequestLab from "./HttpRequestLab";
import { useNavigate } from "@tanstack/react-router";
import { randomUUID } from "~/lib/utils";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  DevServerRun,
  DevSnapshot,
  DevContainers,
  DevDatabaseKind,
} from "@t3tools/contracts/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "~/components/ui/alert-dialog";
import { useEnvironmentQuery } from "~/state/query";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { useTerminalUiStateStore } from "~/terminalUiStateStore";
import { openUrlInPreview } from "~/browser/openFileInPreview";
import { PreviewLinkCardActions } from "../preview-links/PortCardActions";
import type { ForkPanelProps } from "../panels/types";
import { devEnvironment as dev, runDevCommand, attachDevEvidence } from "./state";

type Confirmation = { title: string; description: string; run: () => Promise<void> };
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The development operation failed.";
const isActive = (run: DevServerRun) => ["starting", "ready", "running"].includes(run.state);
function Output({ text }: { text: string }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-code p-3 font-mono text-2xs leading-relaxed">
      {text || "No output yet."}
    </pre>
  );
}
export default function DevEnvironmentPanel(props: ForkPanelProps) {
  if (!props.visible) return null;
  return (
    <Development
      key={`${props.threadRef.environmentId}:${props.threadRef.threadId}`}
      threadRef={props.threadRef}
    />
  );
}
function Development({ threadRef }: { threadRef: ScopedThreadRef }) {
  const supportsHttp = supportsLoomFeature(
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities,
    "browser-dev-tools-http",
  );
  const supportsApi = supportsLoomFeature(
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities,
    "browser-dev-tools-api",
  );
  const supportsApiEditing = supportsLoomFeature(
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities,
    "browser-dev-tools-api-editor",
  );
  const servers = useEnvironmentQuery(
    dev.servers({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const [tab, setTab] = useState<"servers" | "services" | "diagnostics" | "requests">("servers");
  const activeTab = tab === "requests" && !supportsHttp ? "servers" : tab;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Development</h2>
          <Button variant="ghost" size="sm" onClick={servers.refresh}>
            Refresh
          </Button>
        </div>
        {servers.data ? (
          <p className="break-all text-2xs text-muted-foreground">{servers.data.root}</p>
        ) : null}
        <div className="flex flex-wrap gap-1" role="group" aria-label="Development views">
          {(
            [
              ["servers", "Servers"],
              ["services", "Services"],
              ["diagnostics", "Browser diagnostics"],
              ...(supportsHttp ? [["requests", "HTTP requests"] as const] : []),
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={activeTab === value ? "secondary" : "ghost"}
              aria-pressed={activeTab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {servers.error ? (
          <p role="alert" className="p-4 text-sm">
            {servers.error}
          </p>
        ) : null}
        {!servers.data && servers.isPending ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Reading this checkout...
          </p>
        ) : null}
        {activeTab === "servers" && servers.data ? (
          <Servers threadRef={threadRef} snapshot={servers.data} />
        ) : null}
        {activeTab === "requests" ? (
          <HttpRequestLab
            threadRef={threadRef}
            supportsApi={supportsApi}
            supportsEditing={supportsApiEditing}
            serverUrl={servers.data?.runs.find((run) => run.state === "ready")?.urls[0]}
          />
        ) : null}
        {activeTab === "services" ? <Services threadRef={threadRef} /> : null}
        {activeTab === "diagnostics" ? <Diagnostics threadRef={threadRef} /> : null}
      </div>
    </div>
  );
}
function Servers({ threadRef, snapshot }: { threadRef: ScopedThreadRef; snapshot: DevSnapshot }) {
  const navigate = useNavigate();
  const canStart = useAtomValue(dev.start.permissionAtom(threadRef.environmentId));
  const canControl = useAtomValue(dev.control.permissionAtom(threadRef.environmentId));
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const attempted = useRef(new Set<string>());
  const open = async (run: DevServerRun) => {
    const url = run.urls[0];
    if (!url) return;
    const result = await openUrlInPreview({
      threadRef: { ...threadRef, threadId: run.threadId },
      url,
      openPreview,
    });
    if (result._tag === "Failure")
      setError("Browser could not open this run. Check Browser availability and try again.");
  };
  const autoOpen = useEffectEvent((run: DevServerRun) => {
    void open(run).catch((error: unknown) => setError(errorText(error)));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens a requested preview when the execution computer first reports the new run ready
  useEffect(() => {
    for (const run of snapshot.runs) {
      if (
        run.state !== "ready" ||
        run.threadId !== threadRef.threadId ||
        attempted.current.has(run.id) ||
        !snapshot.candidates.find((entry) => entry.key === run.key)?.autoOpenPreview
      )
        continue;
      attempted.current.add(run.id);
      autoOpen(run);
    }
  }, [snapshot, threadRef.threadId]);
  const perform = async (key: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setConfirmation(null);
    try {
      await action();
    } catch (error) {
      setError(errorText(error));
    }
    setBusy(null);
  };
  const control = (run: DevServerRun, action: "stop" | "restart") => {
    const operate = () =>
      perform(run.id, () =>
        runDevCommand(dev.control, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            runId: run.id,
            action,
            requestId: randomUUID(),
            confirmOtherThread: run.threadId !== threadRef.threadId,
          },
        }),
      );
    if (run.threadId !== threadRef.threadId)
      setConfirmation({
        title: `${action === "stop" ? "Stop" : "Restart"} this shared run?`,
        description:
          "Another conversation started this run in the same checkout. Its terminal and server will be interrupted.",
        run: operate,
      });
    else void operate();
  };
  return (
    <div className="space-y-4 p-4">
      <p className="text-xs text-muted-foreground">
        Runs stay with this checkout. Other worktrees have their own servers and ports.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!snapshot.candidates.length ? (
        <p className="text-sm text-muted-foreground">
          No run commands found. Add a project action or a dev, start, serve, preview or Storybook
          script to package.json.
        </p>
      ) : null}
      {snapshot.candidates.map((candidate) => {
        const run =
          snapshot.runs.find((entry) => entry.key === candidate.key && isActive(entry)) ??
          snapshot.runs.find((entry) => entry.key === candidate.key);
        return (
          <section
            key={candidate.key}
            className="space-y-3 rounded-lg border border-border p-3"
            aria-label={candidate.name}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{candidate.name}</h3>
              <span className="text-xs text-muted-foreground" role="status">
                {run
                  ? `${run.state}${run.exitCode === null ? "" : ` · exit ${run.exitCode}`}`
                  : "Stopped"}
              </span>
            </div>
            <code className="block break-all text-xs text-muted-foreground">
              {candidate.command}
            </code>
            <div className="flex flex-wrap gap-2">
              {!run || !isActive(run) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canStart || busy !== null}
                  onClick={() =>
                    void perform(candidate.key, () =>
                      runDevCommand(dev.start, {
                        environmentId: threadRef.environmentId,
                        input: {
                          threadId: threadRef.threadId,
                          key: candidate.key,
                          requestId: randomUUID(),
                        },
                      }),
                    )
                  }
                >
                  {busy === candidate.key ? "Starting..." : "Start"}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canControl || busy !== null}
                    onClick={() => control(run, "restart")}
                  >
                    Restart
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canControl || busy !== null}
                    onClick={() => control(run, "stop")}
                  >
                    Stop
                  </Button>
                </>
              )}
              {run ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    useTerminalUiStateStore
                      .getState()
                      .ensureTerminal({ ...threadRef, threadId: run.threadId }, run.terminalId, {
                        open: true,
                        active: true,
                      });
                    if (run.threadId !== threadRef.threadId)
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: { environmentId: threadRef.environmentId, threadId: run.threadId },
                      });
                  }}
                >
                  Show terminal
                </Button>
              ) : null}
              {run?.output ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    attachDevEvidence(
                      threadRef,
                      `Dev server ${run.name} (${run.state}${run.exitCode === null ? "" : `, exit ${run.exitCode}`}):\n\n\`\`\`text\n${run.output}\n\`\`\``,
                    )
                  }
                >
                  Add logs to message
                </Button>
              ) : null}
            </div>
            {run?.urls.map((url) => (
              <PreviewLinkCardActions
                key={url}
                threadRef={{ ...threadRef, threadId: run.threadId }}
                port={Number(new URL(url).port)}
                row={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void open(run).catch((error: unknown) => setError(errorText(error)))
                    }
                  >
                    Open {url}
                  </Button>
                }
              />
            ))}
            {run?.state === "running" && !run.urls.length ? (
              <p className="text-xs text-muted-foreground">
                Running. No listening address detected yet.
              </p>
            ) : null}
            {run?.state === "starting" && !run.urls.length ? (
              <p className="text-xs text-muted-foreground">
                Waiting for a listening server. Its output is available below.
              </p>
            ) : null}
            {run?.output ? <Output text={run.output} /> : null}
          </section>
        );
      })}
      <Confirm confirmation={confirmation} close={() => setConfirmation(null)} />
    </div>
  );
}
function Confirm({
  confirmation,
  close,
}: {
  confirmation: Confirmation | null;
  close: () => void;
}) {
  return (
    <AlertDialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void confirmation?.run()}>Continue</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
function Services({ threadRef }: { threadRef: ScopedThreadRef }) {
  const query = useEnvironmentQuery(
    dev.containers({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canCompose = useAtomValue(dev.compose.permissionAtom(threadRef.environmentId));
  const canDatabase = useAtomValue(dev.database.permissionAtom(threadRef.environmentId));
  const canCopy = useAtomValue(dev.databaseUrl.permissionAtom(threadRef.environmentId));
  const [result, setResult] = useState<DevContainers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const data = result ?? query.data;
  const perform = async (label: string, action: () => Promise<DevContainers>) => {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    setConfirmation(null);
    try {
      setResult(await action());
    } catch (error) {
      setMessage(errorText(error));
      setResult(null);
      query.refresh();
    }
    setBusy(null);
  };
  const compose = (file: string, action: "up" | "down" | "restart" | "logs") => {
    const run = () =>
      perform(`compose:${action}`, () =>
        runDevCommand(dev.compose, {
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, file, action },
        }),
      );
    if (action === "down")
      setConfirmation({
        title: "Stop this checkout's stack?",
        description: "Its containers and network will be removed. Data volumes are preserved.",
        run,
      });
    else void run();
  };
  const database = (
    kind: DevDatabaseKind,
    action: "create" | "start" | "stop" | "remove" | "logs",
    deleteData = false,
  ) => {
    const run = () =>
      perform(`${kind}:${action}`, () =>
        runDevCommand(dev.database, {
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, kind, action, deleteData },
        }),
      );
    if (deleteData)
      setConfirmation({
        title: "Remove this database and its data?",
        description:
          "This permanently deletes this checkout's database volume. Other checkouts are unaffected.",
        run,
      });
    else void run();
  };
  const copyUrl = async (kind: DevDatabaseKind) => {
    try {
      const result = await runDevCommand(dev.databaseUrl, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, kind },
      });
      await navigator.clipboard.writeText(result.url);
      setMessage(
        "Connection URL copied. It works on the execution computer and includes a password.",
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Development services on this checkout's computer.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setResult(null);
            query.refresh();
          }}
        >
          Refresh services
        </Button>
      </div>
      {query.error || message ? (
        <p role="status" className="text-sm">
          {message ?? query.error}
        </p>
      ) : null}
      {!data && query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking Docker...
        </p>
      ) : null}
      {data?.docker === false ? (
        <p role="status" className="text-sm text-muted-foreground">
          Docker is unavailable on this computer. Start Docker Desktop, OrbStack or the Docker
          daemon, then refresh. Dev servers remain available.
        </p>
      ) : null}
      {data?.docker ? (
        <>
          <section className="space-y-3" aria-label="Compose">
            <h3 className="text-sm font-medium">Compose</h3>
            {!data.composeFiles.length ? (
              <p className="text-xs text-muted-foreground">No Compose file in this checkout.</p>
            ) : null}
            {data.composeFiles.map((file) => (
              <div className="space-y-2 rounded-lg border border-border p-3" key={file.path}>
                <p className="text-xs font-medium">{file.path}</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["up", "Start stack"],
                      ["down", "Stop stack"],
                      ["restart", "Restart"],
                      ["logs", "Logs"],
                    ] as const
                  ).map(([action, label]) => (
                    <Button
                      size="sm"
                      variant="outline"
                      key={action}
                      disabled={!canCompose || busy !== null}
                      onClick={() => compose(file.path, action)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
            {data.services.map((service) => (
              <p key={service.id} className="break-all text-xs">
                {service.service}: {service.state}
                {service.health ? ` · ${service.health}` : ""}
                {service.ports ? ` · ${service.ports}` : ""}
              </p>
            ))}
          </section>
          <section className="space-y-3" aria-label="Databases">
            <h3 className="text-sm font-medium">Local databases</h3>
            <p className="text-xs text-muted-foreground">
              Isolated data and ports for this checkout. Connection URLs work on the execution
              computer.
            </p>
            {data.databases.map((db) => (
              <article
                key={db.kind}
                className="space-y-2 rounded-lg border border-border p-3"
                aria-label={db.kind === "postgres" ? "Postgres" : "Redis (Valkey)"}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-medium">
                    {db.kind === "postgres" ? "Postgres" : "Redis (Valkey)"}
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    {db.state}
                    {db.port ? ` · port ${db.port}` : ""}
                  </span>
                </div>
                {db.hasData && db.state === "absent" ? (
                  <p className="text-xs text-muted-foreground">
                    Saved data is available for reuse.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canDatabase || busy !== null}
                    onClick={() =>
                      database(
                        db.kind,
                        db.state === "absent"
                          ? "create"
                          : db.state === "running"
                            ? "stop"
                            : "start",
                      )
                    }
                  >
                    {db.state === "absent"
                      ? db.hasData
                        ? "Restore database"
                        : "Create"
                      : db.state === "running"
                        ? "Stop"
                        : "Start"}
                  </Button>
                  {db.state === "running" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canCopy || busy !== null}
                      onClick={() => void copyUrl(db.kind)}
                    >
                      Copy connection URL
                    </Button>
                  ) : null}
                  {db.state !== "absent" ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canDatabase || busy !== null}
                        onClick={() => database(db.kind, "logs")}
                      >
                        Logs
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canDatabase || busy !== null}
                        onClick={() => database(db.kind, "remove")}
                      >
                        Remove, keep data
                      </Button>
                    </>
                  ) : null}
                  {db.hasData ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canDatabase || busy !== null}
                      onClick={() => database(db.kind, "remove", true)}
                    >
                      Delete data
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        </>
      ) : null}
      {busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          Running {busy}. Docker may need to download an image first.
        </p>
      ) : null}
      {data?.output ? <Output text={data.output} /> : null}
      <Confirm confirmation={confirmation} close={() => setConfirmation(null)} />
    </div>
  );
}
function Diagnostics({ threadRef }: { threadRef: ScopedThreadRef }) {
  const tabs = useEnvironmentQuery(
    previewEnvironment.list({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const tabId = selected ?? tabs.data?.sessions[0]?.tabId;
  const diagnostics = useEnvironmentQuery(
    tabId
      ? dev.diagnostics({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, tabId },
        })
      : null,
  );
  const [kind, setKind] = useState<"console" | "network">("console");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);
  const data = diagnostics.data;
  const consoleEntries =
    data?.consoleEntries.filter(
      (entry) =>
        (!cleared || entry.timestamp > cleared) &&
        (!errorsOnly || ["error", "warning", "warn"].includes(entry.level)),
    ) ?? [];
  const networkEntries =
    data?.networkEntries.filter(
      (entry) =>
        (!cleared || entry.timestamp > cleared) &&
        (!errorsOnly || entry.failed || (entry.status ?? 0) >= 400),
    ) ?? [];
  const evidence =
    kind === "console"
      ? consoleEntries.map((entry) => `${entry.level}: ${entry.text}`).join("\n")
      : networkEntries
          .map(
            (entry) =>
              `${entry.method} ${entry.status ?? (entry.failed ? "failed" : "pending")} ${entry.url}${entry.errorText ? `: ${entry.errorText}` : ""}`,
          )
          .join("\n");
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Browser diagnostics</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            tabs.refresh();
            diagnostics.refresh();
          }}
        >
          Refresh diagnostics
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Uses Browser's existing capture. Reading diagnostics keeps the page and agent controls in
        place.
      </p>
      {!tabs.data?.sessions.length ? (
        <p className="text-sm text-muted-foreground">
          Open your app in this conversation's Browser, then refresh.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {tabs.data?.sessions.map((tab) => (
          <Button
            key={tab.tabId}
            size="sm"
            variant={tabId === tab.tabId ? "secondary" : "ghost"}
            onClick={() => {
              setSelected(tab.tabId);
              setCleared(null);
            }}
          >
            {("title" in tab.navStatus ? tab.navStatus.title : "") || "Browser tab"}
          </Button>
        ))}
      </div>
      {tabs.error || diagnostics.error ? (
        <p role="alert" className="text-sm">
          {diagnostics.error ?? tabs.error}
        </p>
      ) : null}
      {data ? (
        <>
          <p className="break-all text-xs text-muted-foreground">{data.url}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={kind === "console" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setKind("console")}
            >
              Console ({consoleEntries.length})
            </Button>
            <Button
              variant={kind === "network" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setKind("network")}
            >
              Network ({networkEntries.length})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={errorsOnly}
              onClick={() => setErrorsOnly(!errorsOnly)}
            >
              {errorsOnly ? "Show all" : "Errors only"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!evidence}
              onClick={() =>
                attachDevEvidence(
                  threadRef,
                  `Browser ${kind} for ${data.url}:\n\n\`\`\`text\n${evidence.slice(-16000)}\n\`\`\``,
                )
              }
            >
              Add to message
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCleared(new Date().toISOString())}>
              Clear view
            </Button>
          </div>
          <Output text={evidence || "No matching entries captured."} />
        </>
      ) : null}
    </div>
  );
}
