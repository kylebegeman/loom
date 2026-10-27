import { loomFeaturesOf, MINI_WORKER_EDIT_FEATURE } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import { randomUUID } from "~/lib/utils";
import type { MiniWorkerReadiness } from "@t3tools/contracts/fork";
import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useAction, valueOf, failureOf } from "../apple-build-tooling/parts";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import { PathField } from "~/fork/settings/PathField";
import { workerCheckStatus } from "./presentation";
import { mini, runMini } from "./state";

export function MiniWorkers({ environmentId }: { environmentId: EnvironmentId }) {
  const formId = useId();
  const atom = mini.workers({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const workers = valueOf(result);
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
  const [editing, setEditing] = useState<{
    workerId: string;
    kind: "connection" | "remove";
  } | null>(null);
  const [newTarget, setNewTarget] = useState("");
  const [newSshConfig, setNewSshConfig] = useState("");
  const startEditing = (workerId: string, kind: "connection" | "remove") => {
    setEditing({ workerId, kind });
    setNewTarget("");
    setNewSshConfig("");
  };
  const [adding, setAdding] = useState(false);
  const [id, setId] = useState(() => "worker-" + randomUUID().replaceAll("-", ""));
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [sshConfig, setSshConfig] = useState("");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <LoomSettingsNotice>
        These connections run command jobs. For agents, connect the computer as a normal Loom
        environment. Existing tasks remain accessible when a worker is disabled.
      </LoomSettingsNotice>
      {failureOf(result) && (
        <>
          <LoomSettingsNotice role="alert">{failureOf(result)}</LoomSettingsNotice>
          <LoomSettingsActions>
            <Button variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
              Try again
            </Button>
          </LoomSettingsActions>
        </>
      )}
      {!workers && !failureOf(result) ? (
        <LoomSettingsNotice role="status">Loading workers...</LoomSettingsNotice>
      ) : workers?.length === 0 ? (
        <LoomSettingsNotice>
          No command workers yet. Add a computer reachable by SSH to run command jobs there.
        </LoomSettingsNotice>
      ) : (
        workers?.map((worker) => (
          <LoomSettingsPanel
            key={worker.id}
            title={<span className="wrap-anywhere">{worker.name}</span>}
            description={worker.enabled ? "Enabled for commands" : "Disabled"}
          >
            <p className="text-sm text-muted-foreground wrap-anywhere">Worker ID: {worker.id}</p>
            <LoomSettingsActions>
              {supportsCheck && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canCheck || action.busy}
                  onClick={() => void action.act(() => check(worker.id))}
                >
                  Check connection
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!canEnable || action.busy}
                onClick={() =>
                  void action.act(async () => {
                    await runMini(mini.setEnabled, {
                      environmentId,
                      input: { workerId: worker.id, enabled: !worker.enabled },
                    });
                    appAtomRegistry.refresh(atom);
                  })
                }
              >
                {worker.enabled ? "Disable" : "Enable"}
              </Button>
              {supportsEdit && canUpdate && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.busy}
                  onClick={() => startEditing(worker.id, "connection")}
                >
                  Change connection
                </Button>
              )}
              {supportsEdit && canRemove && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.busy}
                  onClick={() => startEditing(worker.id, "remove")}
                >
                  Remove
                </Button>
              )}
            </LoomSettingsActions>
            {editing?.workerId === worker.id && editing.kind === "connection" && (
              <form
                className="flex min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action.act(async () => {
                    await runMini(mini.updateWorker, {
                      environmentId,
                      input: {
                        workerId: worker.id,
                        target: newTarget.trim(),
                        sshConfig: newSshConfig.trim() || null,
                      },
                    });
                    setEditing(null);
                    forgetCheck(worker.id);
                    appAtomRegistry.refresh(atom);
                    if (supportsCheck && canCheck) await check(worker.id);
                  });
                }}
              >
                <LoomSettingsNotice>
                  Use this when the same worker moved or its SSH setup changed. Its earlier jobs use
                  the new connection. Add a different computer as a new worker. This replaces the
                  saved connection: choose the SSH config file again if the worker uses one, or
                  leave it unset for the server's default SSH config.
                </LoomSettingsNotice>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <LoomSettingsField label="SSH host alias">
                    <Input
                      id={`${formId}-edit-target`}
                      aria-label="SSH host alias"
                      value={newTarget}
                      onChange={(event) => setNewTarget(event.target.value)}
                      placeholder="loom-mini"
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
                    variant="outline"
                    type="submit"
                    disabled={action.busy || !newTarget.trim()}
                  >
                    Save connection
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.busy}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </LoomSettingsActions>
              </form>
            )}
            {editing?.workerId === worker.id && editing.kind === "remove" && (
              <div className="flex min-w-0 flex-col gap-3">
                <LoomSettingsNotice>
                  Remove {worker.name}? It gets no new commands. Its earlier jobs stay listed, and
                  its ID can only be added again at this connection.
                </LoomSettingsNotice>
                <LoomSettingsActions>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={action.busy}
                    onClick={() =>
                      void action.act(async () => {
                        await runMini(mini.removeWorker, {
                          environmentId,
                          input: { workerId: worker.id },
                        });
                        setEditing(null);
                        forgetCheck(worker.id);
                        appAtomRegistry.refresh(atom);
                      })
                    }
                  >
                    Remove worker
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={action.busy}
                    onClick={() => setEditing(null)}
                  >
                    Keep worker
                  </Button>
                </LoomSettingsActions>
              </div>
            )}
            {checks[worker.id] && (
              <div className="flex min-w-0 flex-col gap-3 text-xs text-muted-foreground">
                <LoomSettingsNotice role="status">
                  {workerCheckStatus(checks[worker.id]!)}
                </LoomSettingsNotice>
                {checks[worker.id]!.architecture && (
                  <p>
                    {checks[worker.id]!.architecture} · {checks[worker.id]!.active} of{" "}
                    {checks[worker.id]!.slots} slots reserved
                  </p>
                )}
                <p>
                  {checks[worker.id]!.nativeServerRunning
                    ? "Loom server is running. Check providers in Computers."
                    : "Connect a running Loom server in Computers to use agents here."}
                </p>
                {checks[worker.id]!.missingTools.length > 0 && (
                  <LoomSettingsDetails title="Project tools to prepare">
                    <LoomSettingsNotice>
                      {checks[worker.id]!.missingTools.join(", ")}. Choose the required toolsets on
                      this computer.
                    </LoomSettingsNotice>
                  </LoomSettingsDetails>
                )}
                {checks[worker.id]!.reasons.length > 0 && (
                  <p className="break-words">
                    {checks[worker.id]!.reasons.join(", ").replaceAll("_", " ")}
                  </p>
                )}
                {canPrepare &&
                  worker.enabled &&
                  checks[worker.id]!.reasons.includes("worker_stopped") && (
                    <LoomSettingsActions>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={action.busy}
                        onClick={() => void action.act(() => check(worker.id, true))}
                      >
                        Start worker
                      </Button>
                    </LoomSettingsActions>
                  )}
              </div>
            )}
          </LoomSettingsPanel>
        ))
      )}
      {action.busy && (
        <LoomSettingsNotice role="status">Updating command workers...</LoomSettingsNotice>
      )}
      {canRegister && !adding && (
        <LoomSettingsActions>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add command worker
          </Button>
        </LoomSettingsActions>
      )}
      {canRegister && adding ? (
        <LoomSettingsPanel
          title="Add command worker"
          description="Name the computer and choose an SSH host alias configured on this environment."
        >
          <form
            className="flex min-w-0 flex-col gap-4"
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
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <LoomSettingsField label="Name">
                <Input
                  id={`${formId}-add-name`}
                  aria-label="Name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Orange Pi 5 Pro"
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
                  placeholder="loom-mini"
                  required
                  disabled={action.busy}
                />
              </LoomSettingsField>
            </div>
            <LoomSettingsDetails title="Advanced connection settings">
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
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
            </LoomSettingsDetails>
            <LoomSettingsActions>
              <Button
                size="sm"
                variant="outline"
                type="submit"
                disabled={action.busy || !id.trim() || !name.trim() || !target.trim()}
              >
                Add worker
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={action.busy}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </LoomSettingsActions>
          </form>
        </LoomSettingsPanel>
      ) : !canRegister ? (
        <LoomSettingsNotice>
          Adding workers requires environment maintenance access.
        </LoomSettingsNotice>
      ) : null}
      {action.error && <LoomSettingsNotice role="alert">{action.error}</LoomSettingsNotice>}
    </div>
  );
}
