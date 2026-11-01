import { loomFeaturesOf, MINI_WORKER_EDIT_FEATURE } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import { randomUUID } from "~/lib/utils";
import type { MiniWorkerReadiness } from "@t3tools/contracts/fork";
import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowLeftIcon, ChevronRightIcon, NetworkIcon, TerminalIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useAction, valueOf, failureOf } from "../apple-build-tooling/parts";
import { LoomSettingsActions, LoomSettingsField, LoomSettingsNotice } from "~/fork/settings/parts";
import { PathField } from "~/fork/settings/PathField";
import { LibraryEmpty, LibraryStateDot } from "../project-library/LibraryControls";
import { workerCheckStatus } from "./presentation";
import { mini, runMini } from "./state";

export function MiniWorkers({ environmentId }: { environmentId: EnvironmentId }) {
  const formId = useId();
  const atom = mini.workers({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const workers = valueOf(result);
  const error = failureOf(result);
  const canRegister = useAtomValue(mini.register.permissionAtom(environmentId));
  const canEnable = useAtomValue(mini.setEnabled.permissionAtom(environmentId));
  const action = useAction();
  const configs = useServerConfigs();
  const features = loomFeaturesOf(configs.get(environmentId)?.environment.capabilities);
  const supportsCheck = features.includes("mini-worker-readiness");
  const supportsEdit = features.includes(MINI_WORKER_EDIT_FEATURE);
  const canUpdate = useAtomValue(mini.updateWorker.permissionAtom(environmentId));
  const canRemove = useAtomValue(mini.removeWorker.permissionAtom(environmentId));
  const canCheck = useAtomValue(mini.check.permissionAtom(environmentId));
  const canPrepare = useAtomValue(mini.prepare.permissionAtom(environmentId));
  const [checks, setChecks] = useState<Record<string, MiniWorkerReadiness>>({});
  const check = async (workerId: string, prepare = false) => {
    const report = await runMini(prepare ? mini.prepare : mini.check, {
      environmentId,
      input: { workerId },
    });
    setChecks((previous) => ({ ...previous, [workerId]: report }));
  };
  const forgetCheck = (workerId: string) =>
    setChecks((previous) => {
      const next = { ...previous };
      delete next[workerId];
      return next;
    });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  const selected = workers?.find((worker) => worker.id === selectedId);
  const [editing, setEditing] = useState<"connection" | "remove" | null>(null);
  const [newTarget, setNewTarget] = useState("");
  const [newSshConfig, setNewSshConfig] = useState("");
  const [adding, setAdding] = useState(false);
  const [id, setId] = useState(() => "worker-" + randomUUID().replaceAll("-", ""));
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [sshConfig, setSshConfig] = useState("");
  const enabled = workers?.filter((worker) => worker.enabled).length ?? 0;
  const report = selected ? checks[selected.id] : undefined;

  return (
    <div className="@container/workers space-y-6">
      {selected || adding ? (
        <Button
          shape="pill"
          size="sm"
          variant="ghost"
          autoFocus
          disabled={action.busy}
          onClick={() => {
            setReturnFocusId(selected?.id ?? null);
            setSelectedId(null);
            setAdding(false);
            setEditing(null);
          }}
        >
          <ArrowLeftIcon aria-hidden />
          All command workers
        </Button>
      ) : null}
      {error ? (
        <div className="space-y-3">
          <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>
          <Button
            size="sm"
            shape="pill"
            variant="outline"
            onClick={() => appAtomRegistry.refresh(atom)}
          >
            Try again
          </Button>
        </div>
      ) : null}
      <div className="grid min-w-0 gap-8 @min-[52rem]/workers:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 space-y-6">
          {canRegister && adding ? (
            <section className="space-y-5" aria-label="Add command worker">
              <header className="space-y-1.5">
                <h2 className="text-xl font-semibold tracking-tight">Add command worker</h2>
                <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                  Use an SSH host alias configured on this environment.
                </p>
              </header>
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action.act(async () => {
                    await runMini(mini.register, {
                      environmentId,
                      input: {
                        id: id.trim(),
                        name: name.trim(),
                        target: target.trim(),
                        sshConfig: sshConfig.trim() || null,
                        enabled: true,
                      },
                    });
                    appAtomRegistry.refresh(atom);
                    setAdding(false);
                    setId("worker-" + randomUUID().replaceAll("-", ""));
                    setName("");
                    setTarget("");
                    setSshConfig("");
                    if (supportsCheck && canCheck) await check(id.trim());
                  });
                }}
              >
                <div className="grid min-w-0 gap-4 @min-[32rem]/workers:grid-cols-2">
                  <LoomSettingsField label="Name">
                    <Input
                      id={`${formId}-add-name`}
                      aria-label="Name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Build Mini"
                      required
                      disabled={action.busy}
                    />
                  </LoomSettingsField>
                  <LoomSettingsField label="SSH host alias">
                    <Input
                      id={`${formId}-add-target`}
                      aria-label="SSH host alias"
                      value={target}
                      onChange={(event) => setTarget(event.target.value)}
                      placeholder="build-mini"
                      required
                      disabled={action.busy}
                    />
                  </LoomSettingsField>
                </div>
                <div className="border-y border-border/60">
                  <Collapsible>
                    <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <ChevronRightIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground group-data-panel-open:rotate-90"
                      />
                      Advanced connection settings
                    </CollapsibleTrigger>
                    <CollapsiblePanel hiddenUntilFound>
                      <div className="grid min-w-0 gap-4 pt-1 pb-5 @min-[32rem]/workers:grid-cols-2">
                        <LoomSettingsField label="SSH config file on the server (optional)">
                          <PathField
                            environmentId={environmentId}
                            kind="file"
                            label="SSH config file"
                            defaultLabel="Default SSH config"
                            value={sshConfig}
                            onChange={setSshConfig}
                            disabled={action.busy}
                          />
                        </LoomSettingsField>
                        <LoomSettingsField label="Worker ID">
                          <Input
                            id={`${formId}-add-id`}
                            aria-label="Worker ID"
                            value={id}
                            onChange={(event) => setId(event.target.value)}
                            required
                            disabled={action.busy}
                          />
                        </LoomSettingsField>
                      </div>
                    </CollapsiblePanel>
                  </Collapsible>
                </div>
                <LoomSettingsActions>
                  <Button
                    size="sm"
                    shape="pill"
                    type="submit"
                    disabled={action.busy || !id.trim() || !name.trim() || !target.trim()}
                  >
                    Add worker
                  </Button>
                  <Button
                    size="sm"
                    shape="pill"
                    variant="ghost"
                    disabled={action.busy}
                    onClick={() => setAdding(false)}
                  >
                    Cancel
                  </Button>
                </LoomSettingsActions>
              </form>
            </section>
          ) : selected ? (
            <section className="space-y-6" aria-label={selected.name}>
              <header className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                >
                  <NetworkIcon className="size-6" />
                </span>
                <div className="min-w-0 space-y-2">
                  <h2 className="wrap-anywhere text-xl font-semibold tracking-tight">
                    {selected.name}
                  </h2>
                  <WorkerState enabled={selected.enabled} report={report} />
                </div>
              </header>
              <LoomSettingsActions>
                {supportsCheck ? (
                  <Button
                    size="sm"
                    shape="pill"
                    variant="outline"
                    disabled={!canCheck || action.busy}
                    onClick={() => void action.act(() => check(selected.id))}
                  >
                    Check connection
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  shape="pill"
                  variant="outline"
                  disabled={!canEnable || action.busy}
                  onClick={() =>
                    void action.act(async () => {
                      await runMini(mini.setEnabled, {
                        environmentId,
                        input: { workerId: selected.id, enabled: !selected.enabled },
                      });
                      appAtomRegistry.refresh(atom);
                    })
                  }
                >
                  {selected.enabled ? "Disable" : "Enable"}
                </Button>
              </LoomSettingsActions>
              <section
                className="space-y-3 border-t border-border/60 pt-5"
                aria-label="Worker readiness"
              >
                <h3 className="text-sm font-medium">Connection and capacity</h3>
                {report ? (
                  <>
                    <p role="status" className="text-sm leading-relaxed text-muted-foreground">
                      {workerCheckStatus(report)}
                    </p>
                    {report.architecture ? (
                      <dl className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1">
                          <dt className="text-xs text-muted-foreground">Architecture</dt>
                          <dd>{report.architecture}</dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs text-muted-foreground">Reserved slots</dt>
                          <dd>
                            {report.active} of {report.slots}
                          </dd>
                        </div>
                      </dl>
                    ) : null}
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {report.nativeServerRunning
                        ? "Loom server is running. Check providers in Computers."
                        : "Connect a running Loom server in Computers to use agents here."}
                    </p>
                    {report.missingTools.length > 0 ? (
                      <div className="space-y-1.5">
                        <h4 className="text-xs font-medium">Project tools to prepare</h4>
                        <p className="text-xs leading-relaxed text-muted-foreground wrap-anywhere">
                          {report.missingTools.join(", ")}. Choose the required toolsets on this
                          computer.
                        </p>
                      </div>
                    ) : null}
                    {report.reasons.length > 0 ? (
                      <p className="text-xs text-muted-foreground wrap-anywhere">
                        {report.reasons.join(", ").replaceAll("_", " ")}
                      </p>
                    ) : null}
                    {canPrepare && selected.enabled && report.reasons.includes("worker_stopped") ? (
                      <Button
                        size="sm"
                        shape="pill"
                        variant="outline"
                        disabled={action.busy}
                        onClick={() => void action.act(() => check(selected.id, true))}
                      >
                        Start worker
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {supportsCheck
                      ? "Check the connection to see readiness and available capacity."
                      : "This server does not support worker readiness checks."}
                  </p>
                )}
              </section>
              <section
                className="space-y-4 border-t border-border/60 pt-5"
                aria-label="Worker settings"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">Connection settings</h3>
                  <LoomSettingsActions>
                    {supportsEdit && canUpdate ? (
                      <Button
                        size="xs"
                        shape="pill"
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() => {
                          setEditing("connection");
                          setNewTarget("");
                          setNewSshConfig("");
                        }}
                      >
                        Change connection
                      </Button>
                    ) : null}
                    {supportsEdit && canRemove ? (
                      <Button
                        size="xs"
                        shape="pill"
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() => setEditing("remove")}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </LoomSettingsActions>
                </div>
                <p className="text-xs text-muted-foreground wrap-anywhere">
                  Worker ID: {selected.id}
                </p>
                {editing === "connection" ? (
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action.act(async () => {
                        await runMini(mini.updateWorker, {
                          environmentId,
                          input: {
                            workerId: selected.id,
                            target: newTarget.trim(),
                            sshConfig: newSshConfig.trim() || null,
                          },
                        });
                        setEditing(null);
                        forgetCheck(selected.id);
                        appAtomRegistry.refresh(atom);
                        if (supportsCheck && canCheck) await check(selected.id);
                      });
                    }}
                  >
                    <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                      Earlier jobs will use this new connection. Add a different computer as a new
                      worker. Choose the SSH config again if needed, or leave it unset to use the
                      server's default.
                    </p>
                    <div className="grid min-w-0 gap-4 @min-[32rem]/workers:grid-cols-2">
                      <LoomSettingsField label="SSH host alias">
                        <Input
                          id={`${formId}-edit-target`}
                          aria-label="SSH host alias"
                          value={newTarget}
                          onChange={(event) => setNewTarget(event.target.value)}
                          placeholder="build-mini"
                          required
                          disabled={action.busy}
                        />
                      </LoomSettingsField>
                      <LoomSettingsField label="SSH config file on the server (optional)">
                        <PathField
                          environmentId={environmentId}
                          kind="file"
                          label="SSH config file"
                          defaultLabel="Default SSH config"
                          value={newSshConfig}
                          onChange={setNewSshConfig}
                          disabled={action.busy}
                        />
                      </LoomSettingsField>
                    </div>
                    <LoomSettingsActions>
                      <Button
                        size="sm"
                        shape="pill"
                        type="submit"
                        disabled={action.busy || !newTarget.trim()}
                      >
                        Save connection
                      </Button>
                      <Button
                        size="sm"
                        shape="pill"
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </LoomSettingsActions>
                  </form>
                ) : null}
                {editing === "remove" ? (
                  <div className="space-y-3 rounded-xl border border-border/60 p-4">
                    <h4 className="text-sm font-medium">Remove {selected.name}?</h4>
                    <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                      It will receive no new commands. Earlier jobs stay listed, and its ID can only
                      be added again at this connection.
                    </p>
                    <LoomSettingsActions>
                      <Button
                        size="sm"
                        shape="pill"
                        variant="destructive"
                        disabled={action.busy}
                        onClick={() =>
                          void action.act(async () => {
                            await runMini(mini.removeWorker, {
                              environmentId,
                              input: { workerId: selected.id },
                            });
                            setEditing(null);
                            setSelectedId(null);
                            forgetCheck(selected.id);
                            appAtomRegistry.refresh(atom);
                          })
                        }
                      >
                        Remove worker
                      </Button>
                      <Button
                        size="sm"
                        shape="pill"
                        variant="outline"
                        disabled={action.busy}
                        onClick={() => setEditing(null)}
                      >
                        Keep worker
                      </Button>
                    </LoomSettingsActions>
                  </div>
                ) : null}
              </section>
            </section>
          ) : (
            <section className="space-y-4" aria-label="Command workers">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {workers?.length ?? 0} {workers?.length === 1 ? "worker" : "workers"}
                  <span aria-hidden className="mx-2 text-muted-foreground/50">
                    /
                  </span>
                  {enabled} enabled
                </p>
                {canRegister ? (
                  <Button
                    size="sm"
                    shape="pill"
                    variant="outline"
                    disabled={action.busy}
                    onClick={() => setAdding(true)}
                  >
                    Add command worker
                  </Button>
                ) : null}
              </div>
              {!workers && !error ? (
                <div
                  role="status"
                  aria-label="Loading workers"
                  className="space-y-5 border-y border-border/60 py-5"
                >
                  {[0, 1].map((key) => (
                    <div key={key} className="flex items-center gap-3">
                      <Skeleton className="size-10" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : workers?.length === 0 ? (
                <LibraryEmpty icon={NetworkIcon} title="No command workers yet">
                  Add a computer reachable by SSH to run builds, scripts, and other command jobs
                  there.
                </LibraryEmpty>
              ) : (
                <ul className="divide-y divide-border/60 border-y border-border/60">
                  {workers?.map((worker) => (
                    <li key={worker.id}>
                      <button
                        type="button"
                        aria-label={`Manage ${worker.name}`}
                        autoFocus={returnFocusId === worker.id}
                        onClick={() => {
                          setSelectedId(worker.id);
                          setEditing(null);
                        }}
                        className="group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg py-4 text-left outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span
                          aria-hidden
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                        >
                          <NetworkIcon className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1 space-y-1.5">
                          <span className="block wrap-anywhere text-sm font-medium">
                            {worker.name}
                          </span>
                          <WorkerState enabled={worker.enabled} report={checks[worker.id]} />
                        </span>
                        <ChevronRightIcon
                          aria-hidden
                          className="me-2 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!canRegister ? (
                <p className="text-xs text-muted-foreground">
                  Adding workers requires environment maintenance access.
                </p>
              ) : null}
            </section>
          )}
          {action.busy ? (
            <p role="status" className="text-xs text-muted-foreground">
              Updating command workers...
            </p>
          ) : null}
          {action.error ? (
            <LoomSettingsNotice role="alert">{action.error}</LoomSettingsNotice>
          ) : null}
        </div>
        <aside className="space-y-5 border-t border-border/60 pt-5 @min-[52rem]/workers:border-t-0 @min-[52rem]/workers:pt-0">
          <section className="space-y-2" aria-label="About command workers">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <TerminalIcon aria-hidden className="size-4 text-muted-foreground" />
              Commands over SSH
            </h2>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Workers run command jobs on another computer. To run agents there, connect its Loom
              server in Computers.
            </p>
          </section>
          <section className="space-y-2" aria-label="Disabling a worker">
            <h2 className="text-sm font-medium">Pause new work</h2>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Disable a worker to stop new commands. Its existing jobs remain accessible. Enable it
              again when it is ready.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function WorkerState({
  enabled,
  report,
}: {
  readonly enabled: boolean;
  readonly report?: MiniWorkerReadiness | undefined;
}) {
  const tone = !enabled
    ? "neutral"
    : report?.status === "unreachable"
      ? "danger"
      : report?.status === "needs_setup" || report?.status === "busy"
        ? "warning"
        : report?.status === "ready"
          ? "success"
          : "neutral";
  const label = !enabled
    ? "Disabled"
    : report?.status === "ready"
      ? "Ready for commands"
      : report?.status === "unreachable"
        ? "Connection failed"
        : report?.status === "needs_setup"
          ? "Setup needed"
          : report?.status === "busy"
            ? "Waiting for capacity"
            : "Enabled for commands";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <LibraryStateDot tone={tone} />
      {label}
    </span>
  );
}
