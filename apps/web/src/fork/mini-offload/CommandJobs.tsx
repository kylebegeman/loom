import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import { Link } from "@tanstack/react-router";
import { randomUUID } from "~/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MiniArtifacts, MiniReceipt } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { TerminalIcon, PlusIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { Textarea } from "~/components/ui/textarea";
import { jobStateLabel, jobStateTone, parseOutputFiles } from "./presentation";
import { Checkbox } from "~/components/ui/checkbox";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import type { ForkPanelProps } from "../panels/types";
import { Alert, Muted, useAction, valueOf, failureOf } from "../apple-build-tooling/parts";
import { MiniWorkers } from "./Workers";
import { mini, runMini } from "./state";
const newRequestId = () => randomUUID().replaceAll("-", "");
const active = (receipt: MiniReceipt) =>
  receipt.job !== null &&
  ["queued", "starting", "running", "cancelling"].includes(receipt.job.state);

function Job({
  threadRef,
  receipt,
  onChange,
}: {
  threadRef: ScopedThreadRef;
  receipt: MiniReceipt;
  onChange: () => void;
}) {
  const environmentId = threadRef.environmentId;
  const configs = useServerConfigs();
  const supportsOutputs = loomFeaturesOf(
    configs.get(environmentId)?.environment.capabilities,
  ).includes("mini-offload-outputs");
  const input = { threadId: threadRef.threadId, requestId: receipt.request.requestId };
  const atom = mini.inspect({ environmentId, input });
  const result = useAtomValue(atom);
  const detail = valueOf(result);
  const action = useAction();
  const canCancel = useAtomValue(mini.cancel.permissionAtom(environmentId));
  const canCollect = useAtomValue(mini.artifacts.permissionAtom(environmentId));
  const [outputs, setOutputs] = useState<Omit<MiniArtifacts, "artifactsBase64"> | null>(null);
  const [collecting, setCollecting] = useState(false);
  useEffect(() => {
    if (!active(detail?.receipt ?? receipt)) return;
    const interval = window.setInterval(() => appAtomRegistry.refresh(atom), 5000);
    return () => window.clearInterval(interval);
  }, [atom, detail?.receipt, receipt]);
  const currentState = detail?.receipt.job?.state;
  useEffect(() => {
    if (currentState) onChange();
  }, [currentState, onChange]);
  const downloadOutputs = () =>
    action.act(async () => {
      setCollecting(true);
      try {
        const bundle = await runMini(mini.artifacts, { environmentId, input });
        setOutputs({
          bytes: bundle.bytes,
          sha256: bundle.sha256,
          files: bundle.files,
          missing: bundle.missing,
        });
        const bytes = Uint8Array.from(atob(bundle.artifactsBase64), (char) => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/x-tar" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${input.requestId}-outputs.tar`;
        link.click();
        URL.revokeObjectURL(url);
      } finally {
        setCollecting(false);
      }
    });
  const download = () =>
    action.act(async () => {
      const patchAtom = mini.patch({ environmentId, input });
      appAtomRegistry.refresh(patchAtom);
      const patch = await Effect.runPromise(AtomRegistry.getResult(appAtomRegistry, patchAtom));
      const bytes = Uint8Array.from(atob(patch.patchBase64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${input.requestId}.patch`;
      link.click();
      URL.revokeObjectURL(url);
    });
  const current = detail?.receipt ?? receipt;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">
        {jobStateLabel(current)}{" "}
        {current.job?.exit_code !== null && current.job?.exit_code !== undefined
          ? `· exit ${current.job.exit_code}`
          : ""}
      </p>
      {current.job?.state === "failed" && (
        <p className="text-sm text-muted-foreground">
          The command did not complete successfully. Review its output before trying again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={action.busy}
          onClick={() => {
            appAtomRegistry.refresh(atom);
            onChange();
          }}
        >
          Refresh result
        </Button>
        {active(current) && (
          <Button
            size="xs"
            variant="outline"
            disabled={!canCancel || action.busy}
            onClick={() =>
              void action.act(async () => {
                await runMini(mini.cancel, { environmentId, input });
                appAtomRegistry.refresh(atom);
                onChange();
              })
            }
          >
            Cancel job
          </Button>
        )}
        {!active(current) && current.job !== null && (
          <Button
            size="xs"
            variant="default"
            disabled={action.busy}
            onClick={() => void download()}
          >
            <DownloadIcon aria-hidden /> Download patch
          </Button>
        )}
      </div>
      {(current.request.outputs?.length ?? 0) > 0 && (
        <section aria-label="Collected outputs" className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium">Output files</h4>
            {supportsOutputs && !active(current) && current.job !== null && (
              <Button
                size="xs"
                variant="outline"
                disabled={!canCollect || action.busy}
                onClick={() => void downloadOutputs()}
              >
                <DownloadIcon aria-hidden /> {collecting ? "Collecting..." : "Download outputs"}
              </Button>
            )}
          </div>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {current.request.outputs?.map((path) => (
              <li key={path} className="break-all">
                {path}
              </li>
            ))}
          </ul>
          {active(current) ? (
            <Muted>Files can be collected when this job finishes, including if it fails.</Muted>
          ) : !outputs ? (
            <Muted>Download a saved bundle with checksums and a list of any missing files.</Muted>
          ) : (
            <p role="status" className="text-xs text-muted-foreground">
              {outputs.files.length} {outputs.files.length === 1 ? "file" : "files"} collected,{" "}
              {(outputs.bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB
              bundle.
            </p>
          )}
          {outputs && outputs.missing.length > 0 && (
            <Alert>
              Missing files: {outputs.missing.join(", ")}. Review the command output; the bundle
              includes its manifest.
            </Alert>
          )}
        </section>
      )}
      {failureOf(result) && <Alert>{failureOf(result)}</Alert>}
      {!detail && !failureOf(result) && <Muted>Reading worker state...</Muted>}
      {detail?.logs.truncated && <Muted>Showing the last 1 MiB of logs.</Muted>}
      {detail && (
        <details
          open={current.job?.state === "failed" || active(current)}
          className="rounded-lg bg-muted/50 p-3"
        >
          <summary className="cursor-pointer text-xs font-medium">Command output</summary>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
            {detail.logs.text || "No output yet."}
          </pre>
        </details>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Task details</summary>
        <dl className="mt-2 grid gap-2 break-all">
          <div>
            <dt>Request</dt>
            <dd>{current.request.requestId}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{current.sourceRevision}</dd>
          </div>
          <div>
            <dt>Resources</dt>
            <dd>
              {current.request.memoryMiB / 1024} GiB RAM, {current.request.cpuPercent / 100} CPU
              cores, {Math.ceil(current.request.timeoutSeconds / 60)} minute limit
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {current.localEditsExcluded
                ? "Committed revision; local edits excluded"
                : "Committed revision"}
            </dd>
          </div>
        </dl>
      </details>
      {action.error && <Alert>{action.error}</Alert>}
    </div>
  );
}
function Body({ threadRef }: { threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const configs = useServerConfigs();
  const supportsOutputs = loomFeaturesOf(
    configs.get(environmentId)?.environment.capabilities,
  ).includes("mini-offload-outputs");
  const workerAtom = mini.workers({ environmentId, input: {} });
  const listAtom = mini.list({ environmentId, input: { threadId } });
  const workersResult = useAtomValue(workerAtom);
  const listResult = useAtomValue(listAtom);
  const workers = valueOf(workersResult) ?? [];
  const receipts = valueOf(listResult) ?? [];
  const pendingTransfer = receipts.some((receipt) => receipt.state === "transfer_pending");
  const canSubmit = useAtomValue(mini.submit.permissionAtom(environmentId));
  const canRecover = useAtomValue(mini.recover.permissionAtom(environmentId));
  const action = useAction();
  const [composing, setComposing] = useState(false);
  const [workerId, setWorkerId] = useState("");
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [memory, setMemory] = useState("6");
  const [cpu, setCpu] = useState("4");
  const [timeout, setTimeout] = useState("60");
  const [committedOnly, setCommittedOnly] = useState(false);
  const [outputText, setOutputText] = useState("");
  const outputDeclaration = parseOutputFiles(outputText);
  const [selected, setSelected] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const enabledWorkers = workers.filter((worker) => worker.enabled);
  const selectedReceipt =
    receipts.find((receipt) => receipt.request.requestId === selected) ?? receipts[0];
  const refresh = useCallback(() => {
    appAtomRegistry.refresh(listAtom);
    appAtomRegistry.refresh(workerAtom);
  }, [listAtom, workerAtom]);
  const failure = failureOf(workersResult) ?? failureOf(listResult);
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto scrollbar-gutter-both p-5 @container">
      <header className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <TerminalIcon aria-hidden className="size-6" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Command jobs</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Run a repository command on a worker and collect its results.
          </p>
        </div>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setComposing(!composing)}
          aria-expanded={composing}
          disabled={!canSubmit}
        >
          <PlusIcon aria-hidden />
          Run command
        </Button>
        <Button variant="ghost" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        For a full agent session, open{" "}
        <Link to="/settings/connections" className="text-primary underline underline-offset-2">
          Computers
        </Link>
        . Command jobs send a committed snapshot, up to 1 GiB.
      </p>
      {failure && <Alert>{failure}</Alert>}
      {pendingTransfer && (
        <Alert>
          A transfer needs checking. Recover it on its original worker before sending another
          command.
        </Alert>
      )}
      {composing && (
        <form
          className="flex flex-col gap-4 rounded-xl border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              listResult._tag !== "Success" ||
              pendingTransfer ||
              outputDeclaration.error ||
              (!supportsOutputs && outputDeclaration.outputs.length)
            )
              return;
            void action.act(async () => {
              try {
                const receipt = await runMini(mini.submit, {
                  environmentId,
                  input: {
                    threadId,
                    requestId,
                    workerId: workerId || enabledWorkers[0]?.id || "",
                    label:
                      label.trim() ||
                      command.trim().split("\n")[0]!.replace(/\s+/g, " ").slice(0, 80),
                    argv: ["sh", "-lc", command],
                    memoryMiB: Math.round(Number(memory) * 1024),
                    cpuPercent: Math.round(Number(cpu) * 100),
                    timeoutSeconds: Math.round(Number(timeout) * 60),
                    committedOnly,
                    ...(outputDeclaration.outputs.length
                      ? { outputs: outputDeclaration.outputs }
                      : {}),
                  },
                });
                setSelected(receipt.request.requestId);
                setRequestId(newRequestId());
                setComposing(false);
                setCommand("");
                setLabel("");
                setOutputText("");
              } finally {
                refresh();
              }
            });
          }}
        >
          <div>
            <h3 className="text-sm font-medium">New command</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Runs in a fresh checkout on the worker.
            </p>
          </div>
          <div role="group" aria-label="Command destination" className="flex flex-wrap gap-2">
            {enabledWorkers.map((worker) => (
              <Button
                key={worker.id}
                type="button"
                size="sm"
                variant={
                  (workerId || enabledWorkers[0]?.id) === worker.id ? "secondary" : "outline"
                }
                aria-pressed={(workerId || enabledWorkers[0]?.id) === worker.id}
                disabled={action.busy}
                onClick={() => setWorkerId(worker.id)}
              >
                {worker.name}
              </Button>
            ))}
            {enabledWorkers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Add or enable a command worker in Worker connections below.
              </p>
            )}
          </div>
          <label className="flex flex-col gap-1.5 text-sm">
            Command
            <Textarea
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              rows={3}
              placeholder="Enter the command to run"
              required
              disabled={action.busy}
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-relaxed">
            <Checkbox
              checked={committedOnly}
              disabled={action.busy}
              onCheckedChange={(checked) => setCommittedOnly(checked === true)}
            />
            <span>
              Use the committed revision even if this workspace has local edits. Those edits stay
              here.
            </span>
          </label>
          {supportsOutputs && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Files to collect (optional)</summary>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex flex-col gap-1.5 text-xs">
                  Output file paths
                  <Textarea
                    value={outputText}
                    onChange={(event) => setOutputText(event.target.value)}
                    rows={3}
                    placeholder={"dist/firmware.bin\nbuild/report.txt"}
                    disabled={action.busy}
                    aria-invalid={Boolean(outputDeclaration.error)}
                    aria-describedby="mini-output-help"
                  />
                </label>
                <p id="mini-output-help" className="text-xs text-muted-foreground">
                  One exact repository-relative file per line, up to 32 files and 60 MiB total.
                  Ignored build files are included. Saved outputs remain available after workspace
                  cleanup until result retention expires.
                </p>
                {outputDeclaration.error && <Alert>{outputDeclaration.error}</Alert>}
              </div>
            </details>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Resource limits and task name</summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Default: 6 GiB RAM, 4 CPU cores and a 60 minute limit.
              </p>
              <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs">
                  RAM (GiB)
                  <Input
                    type="number"
                    min={0.125}
                    max={12}
                    step={0.125}
                    value={memory}
                    onChange={(event) => setMemory(event.target.value)}
                    required
                    disabled={action.busy}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  CPU cores
                  <Input
                    type="number"
                    min={0.25}
                    max={8}
                    step={0.25}
                    value={cpu}
                    onChange={(event) => setCpu(event.target.value)}
                    required
                    disabled={action.busy}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Time limit (min)
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={timeout}
                    onChange={(event) => setTimeout(event.target.value)}
                    required
                    disabled={action.busy}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs">
                Task name (optional)
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  maxLength={80}
                  placeholder="Uses the command by default"
                  disabled={action.busy}
                />
              </label>
            </div>
          </details>
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                !canSubmit ||
                action.busy ||
                listResult._tag !== "Success" ||
                pendingTransfer ||
                enabledWorkers.length === 0 ||
                Boolean(outputDeclaration.error) ||
                (!supportsOutputs && outputDeclaration.outputs.length > 0)
              }
            >
              {action.busy ? "Sending..." : "Run on worker"}
            </Button>
            <Button variant="ghost" disabled={action.busy} onClick={() => setComposing(false)}>
              Close
            </Button>
          </div>
        </form>
      )}
      {action.error && <Alert>{action.error}</Alert>}
      {listResult._tag === "Initial" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading tasks...
        </p>
      ) : receipts.length === 0 && !failure ? (
        <div className="py-8 text-center">
          <TerminalIcon aria-hidden className="mx-auto size-8 text-muted-foreground" />
          <h3 className="mt-3 font-medium">No commands sent yet</h3>
          <p className="mx-auto mt-1 max-w-64 text-sm leading-relaxed text-muted-foreground">
            Builds, tests and scripts can run here while you keep working.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-2" aria-label="Command tasks">
          {receipts.map((receipt) => (
            <div
              key={receipt.request.requestId}
              className={`rounded-xl border p-3 ${selectedReceipt === receipt ? "border-border bg-muted/50" : "border-transparent"}`}
            >
              <button
                className="flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setSelected(receipt.request.requestId)}
                aria-pressed={selectedReceipt === receipt}
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{receipt.request.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{receipt.workerName}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs ${jobStateTone(receipt)}`}
                >
                  {jobStateLabel(receipt)}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className="mt-1 size-4 shrink-0 text-muted-foreground"
                />
              </button>
              {receipt.state === "transfer_pending" && (
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canRecover || action.busy}
                    onClick={() =>
                      void action.act(async () => {
                        await runMini(mini.recover, {
                          environmentId,
                          input: { threadId, requestId: receipt.request.requestId },
                        });
                        setRequestId(newRequestId());
                        setSelected(receipt.request.requestId);
                        refresh();
                      })
                    }
                  >
                    Recover transfer
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {selectedReceipt?.job && (
        <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <h3 className="break-words font-medium text-sm">{selectedReceipt.request.label}</h3>
          <Job
            key={selectedReceipt.request.requestId}
            threadRef={threadRef}
            receipt={selectedReceipt}
            onChange={refresh}
          />
        </section>
      )}
      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">Worker connections</summary>
        <div className="pt-4">
          <MiniWorkers environmentId={environmentId} />
        </div>
      </details>
    </div>
  );
}
export default function CommandJobs({ threadRef, visible }: ForkPanelProps) {
  return visible ? (
    <Body key={`${threadRef.environmentId}:${threadRef.threadId}`} threadRef={threadRef} />
  ) : null;
}
