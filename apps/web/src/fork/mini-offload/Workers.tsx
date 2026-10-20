import { loomFeaturesOf, MINI_WORKER_EDIT_FEATURE } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import { randomUUID } from "~/lib/utils";
import type { MiniWorkerReadiness } from "@t3tools/contracts/fork";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Alert, Muted, useAction, valueOf, failureOf } from "../apple-build-tooling/parts";
import { workerCheckStatus } from "./presentation";
import { mini, runMini } from "./state";

export function MiniWorkers({ environmentId }: { environmentId: EnvironmentId }) {
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
  const forgetCheck = (workerId: string) => setChecks(({ [workerId]: _old, ...rest }) => rest);
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
    <div className="flex flex-col gap-3">
      <Muted>
        These connections run command jobs. For agents, connect the computer as a normal Loom
        environment. Existing tasks remain accessible when a worker is disabled.
      </Muted>
      {failureOf(result) && <Alert>{failureOf(result)}</Alert>}
      {!workers ? (
        <p>Loading workers...</p>
      ) : workers.length === 0 ? (
        <Muted>No workers registered.</Muted>
      ) : (
        workers.map((worker) => (
          <div key={worker.id} className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words text-sm">
                {worker.name}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {worker.enabled ? "Enabled for commands" : "Disabled"}
                </span>
              </span>
              <div className="flex gap-2">
                {supportsCheck && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canCheck || action.busy}
                    onClick={() => void action.act(() => check(worker.id))}
                  >
                    Check connection
                  </Button>
                )}
                <Button
                  size="xs"
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
                    size="xs"
                    variant="outline"
                    disabled={action.busy}
                    onClick={() => startEditing(worker.id, "connection")}
                  >
                    Change connection
                  </Button>
                )}
                {supportsEdit && canRemove && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={action.busy}
                    onClick={() => startEditing(worker.id, "remove")}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            {editing?.workerId === worker.id && editing.kind === "connection" && (
              <form
                className="flex flex-col gap-2"
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
                <Muted>
                  Use this when the same worker moved or its SSH setup changed. Its earlier jobs use
                  the new connection. Add a different computer as a new worker.
                </Muted>
                <label className="text-sm">
                  SSH host alias
                  <Input
                    value={newTarget}
                    onChange={(event) => setNewTarget(event.target.value)}
                    placeholder="loom-mini"
                    required
                    disabled={action.busy}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  SSH config path on server (optional)
                  <Input
                    value={newSshConfig}
                    onChange={(event) => setNewSshConfig(event.target.value)}
                    placeholder="/absolute/path/to/ssh-config"
                    disabled={action.busy}
                  />
                </label>
                <div className="flex gap-2">
                  <Button size="xs" variant="outline" type="submit" disabled={action.busy}>
                    Save connection
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={action.busy}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {editing?.workerId === worker.id && editing.kind === "remove" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <p>Remove {worker.name}? It gets no new commands. Its earlier jobs stay listed.</p>
                <Button
                  size="xs"
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
                  size="xs"
                  variant="outline"
                  disabled={action.busy}
                  onClick={() => setEditing(null)}
                >
                  Keep worker
                </Button>
              </div>
            )}
            {checks[worker.id] && (
              <div className="flex flex-col gap-2 text-xs text-muted-foreground">
                <p role="status">{workerCheckStatus(checks[worker.id]!)}</p>
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
                  <details>
                    <summary className="cursor-pointer">Project tools to prepare</summary>
                    <p className="mt-1 break-words">
                      {checks[worker.id]!.missingTools.join(", ")}. Choose the required toolsets on
                      this computer.
                    </p>
                  </details>
                )}
                {checks[worker.id]!.reasons.length > 0 && (
                  <p className="break-words">
                    {checks[worker.id]!.reasons.join(", ").replaceAll("_", " ")}
                  </p>
                )}
                {canPrepare &&
                  worker.enabled &&
                  checks[worker.id]!.reasons.includes("worker_stopped") && (
                    <div>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={action.busy}
                        onClick={() => void action.act(() => check(worker.id, true))}
                      >
                        Start worker
                      </Button>
                    </div>
                  )}
              </div>
            )}
          </div>
        ))
      )}
      {canRegister && !adding && (
        <div>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add command worker
          </Button>
        </div>
      )}
      {canRegister && adding ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void action.act(async () => {
              await runMini(mini.register, {
                environmentId,
                input: { id, name, target, sshConfig: sshConfig.trim() || null, enabled: true },
              });
              appAtomRegistry.refresh(atom);
              if (supportsCheck && canCheck) await check(id);
              setAdding(false);
              setId("worker-" + randomUUID().replaceAll("-", ""));
              setName("");
              setTarget("");
              setSshConfig("");
            });
          }}
        >
          <label className="text-sm">
            Name
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Orange Pi 5 Pro"
              required
            />
          </label>
          <label className="text-sm">
            SSH host alias
            <Input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="loom-mini"
              required
            />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer">Advanced connection settings</summary>
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs">
                SSH config path on server (optional)
                <Input
                  value={sshConfig}
                  onChange={(event) => setSshConfig(event.target.value)}
                  placeholder="/absolute/path/to/ssh-config"
                  disabled={action.busy}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Worker ID
                <Input
                  value={id}
                  onChange={(event) => setId(event.target.value)}
                  required
                  disabled={action.busy}
                />
              </label>
            </div>
          </details>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" type="submit" disabled={action.busy}>
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
          </div>
        </form>
      ) : !canRegister ? (
        <Muted>Adding workers requires environment maintenance access.</Muted>
      ) : null}
      {action.error && <Alert>{action.error}</Alert>}
    </div>
  );
}
