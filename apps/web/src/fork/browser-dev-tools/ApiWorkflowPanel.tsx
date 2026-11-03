import { useRef, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  DevApiDetails,
  DevApiSource,
  DevApiWorkflow,
  DevApiWorkflowRun,
  DevApiWorkflowSummary,
  DevApiWorkflowCommand,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LabSelect, LabCodeEditor } from "./HttpLabParts";
import { useEnvironmentQuery } from "~/state/query";
import { devEnvironment as dev, runDevCommand } from "./state";
import { randomUUID } from "~/lib/utils";
function RunProgress({
  threadRef,
  workspaceId,
  run,
  onRefresh,
  onStop,
}: {
  threadRef: ScopedThreadRef;
  workspaceId: string;
  run: DevApiWorkflowRun;
  onRefresh: () => void;
  onStop: () => void;
}) {
  const progress = useEnvironmentQuery(
    dev.apiWorkflowWatch({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, workspaceId, runId: run.id },
    }),
  );
  const state = progress.data?.state ?? run.state;
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <p role="status">
        {state} · {progress.data?.completed ?? run.results.length} requests completed
        {progress.data?.latest ? ` · ${progress.data.latest}` : ""}
      </p>
      <div className="flex gap-2">
        <Button size="xs" variant="outline" onClick={onRefresh}>
          Inspect run results
        </Button>
        {state === "running" ? (
          <Button size="xs" variant="outline" onClick={onStop}>
            Stop after current request
          </Button>
        ) : null}
      </div>
      {progress.error ? (
        <p role="alert" className="text-destructive">
          {progress.error}
        </p>
      ) : null}
    </div>
  );
}
export default function ApiWorkflowPanel({
  threadRef,
  details,
  source,
  disabled,
  canRun,
  onRevision,
  onInspect,
}: {
  threadRef: ScopedThreadRef;
  details: DevApiDetails;
  source: DevApiSource;
  disabled: boolean;
  canRun: boolean;
  onRevision: (revision: string) => void;
  onInspect: (run: NonNullable<DevApiWorkflowRun["results"][number]["result"]>) => void;
}) {
  const [definitions, setDefinitions] = useState<readonly DevApiWorkflow[]>([]);
  const [definition, setDefinition] = useState<DevApiWorkflow | null>(null);
  const [definitionRevision, setDefinitionRevision] = useState(details.revision);
  const [runs, setRuns] = useState<readonly DevApiWorkflowSummary[]>([]);
  const [run, setRun] = useState<DevApiWorkflowRun | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [datasetText, setDatasetText] = useState("[]");
  const pendingRun = useRef<{ key: string; runId: string } | null>(null);
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, workspaceId: details.workspace.id },
  };
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await runDevCommand(dev.apiWorkflow, {
        ...target,
        input: { ...target.input, action: "list" },
      });
      setDefinitions(value.workflows);
      setDefinitionRevision(value.revision);
      setRuns(value.runs ?? []);
      onRevision(value.revision);
      if (definition) {
        const selected = value.workflows.find((w) => w.id === definition.id) ?? null;
        setDefinition(selected);
        setDatasetText(JSON.stringify(selected?.datasets ?? [], null, 2));
      }
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Workflows are unavailable on this computer.");
    }
    setBusy(false);
  };
  const choose = (id: string) => {
    const next = definitions.find((w) => w.id === id) ?? null;
    setDefinition(next);
    setDatasetText(JSON.stringify(next?.datasets ?? [], null, 2));
    pendingRun.current = null;
  };
  const save = async (remove = false) => {
    if (!definition) return;
    setBusy(true);
    setError("");
    try {
      const value = await runDevCommand(dev.apiWorkflow, {
        ...target,
        input: {
          ...target.input,
          action: remove ? "delete" : "save",
          expectedRevision: definitionRevision,
          workflow: { ...definition, datasets: JSON.parse(datasetText) },
          workflowId: definition.id,
        },
      });
      setDefinitions(value.workflows);
      setDefinitionRevision(value.revision);
      setRuns(value.runs ?? []);
      onRevision(value.revision);
      setDefinition(remove ? null : (value.workflows.find((w) => w.id === definition.id) ?? null));
      if (!remove)
        setDatasetText(
          JSON.stringify(
            value.workflows.find((w) => w.id === definition.id)?.datasets ?? [],
            null,
            2,
          ),
        );
      pendingRun.current = null;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Check the workflow and dataset rows before saving.",
      );
    }
    setBusy(false);
  };
  const execute = async (action: "start" | "read" | "cancel") => {
    if ((action === "start" && !definition) || (action !== "start" && !run)) return;
    setBusy(true);
    setError("");
    const fields: DevApiWorkflowCommand = {
      ...target.input,
      action,
      ...(action === "start"
        ? {
            workflowId: definition!.id,
            workflow: definition!,
            expectedRevision: details.revision,
            source,
          }
        : {}),
    };
    const key = JSON.stringify(fields);
    if (action === "start" && pendingRun.current?.key !== key)
      pendingRun.current = { key, runId: randomUUID() };
    try {
      const value = await runDevCommand(dev.apiWorkflow, {
        ...target,
        input: {
          ...fields,
          runId: action === "start" ? pendingRun.current!.runId : run!.id,
        },
      });
      setRun(value.run);
      setRuns(value.runs ?? []);
      onRevision(value.revision);
      if (action === "start") pendingRun.current = null;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The run response is unavailable. Retry with the same inputs to recover it.",
      );
    }
    setBusy(false);
  };
  const inspectRun = async (runId: string) => {
    setBusy(true);
    setError("");
    try {
      const value = await runDevCommand(dev.apiWorkflow, {
        ...target,
        input: { ...target.input, action: "read", runId },
      });
      setRun(value.run);
      setRuns(value.runs ?? []);
      onRevision(value.revision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This run is unavailable.");
    }
    setBusy(false);
  };
  const updateStep = (index: number, step: DevApiWorkflow["steps"][number]) => {
    if (definition)
      setDefinition({
        ...definition,
        steps: definition.steps.map((s, i) => (i === index ? step : s)),
      });
  };
  return (
    <details
      className="border-b border-border px-4 py-3 text-xs"
      onToggle={(e) => {
        if (e.currentTarget.open && !loaded && !busy) void load();
      }}
    >
      <summary className="cursor-pointer font-medium">Workflows</summary>
      <div className="mt-3 space-y-3">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <LabSelect
              label="Saved workflow"
              value={definition?.id ?? ""}
              disabled={busy}
              onChange={choose}
              options={[
                { value: "", label: "Choose a workflow" },
                ...definitions.map((w) => ({ value: w.id, label: w.name })),
                ...(definition && !definitions.some((w) => w.id === definition.id)
                  ? [{ value: definition.id, label: definition.name || "Unsaved workflow" }]
                  : []),
              ]}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || disabled}
            onClick={() => {
              setDefinition({
                id: randomUUID(),
                name: "New workflow",
                failurePolicy: "stop",
                steps: [],
                datasets: [],
              });
              setDatasetText("[]");
            }}
          >
            New workflow
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
            Reload
          </Button>
        </div>
        {definition ? (
          <fieldset disabled={busy || disabled} className="space-y-3">
            <Input
              aria-label="Workflow name"
              value={definition.name}
              disabled={busy}
              onChange={(e) => setDefinition({ ...definition, name: e.target.value })}
            />
            <LabSelect
              label="On failed step"
              value={definition.failurePolicy}
              disabled={busy}
              onChange={(value) =>
                setDefinition({
                  ...definition,
                  failurePolicy: value === "continue" ? "continue" : "stop",
                })
              }
              options={[
                { value: "stop", label: "Stop on failure" },
                { value: "continue", label: "Continue and report failures" },
              ]}
            />
            {definition.steps.map((step, index) => (
              <details key={step.id} open className="space-y-3 rounded-md border border-border p-3">
                <summary className="cursor-pointer font-medium">
                  {index + 1}. {step.name}
                </summary>
                <div className="mt-3 space-y-3">
                  <Input
                    aria-label={`Step ${index + 1} name`}
                    value={step.name}
                    disabled={busy}
                    onChange={(e) => updateStep(index, { ...step, name: e.target.value })}
                  />
                  <LabSelect
                    label={`Step ${index + 1} request`}
                    value={step.requestKey}
                    disabled={busy}
                    onChange={(requestKey) => updateStep(index, { ...step, requestKey })}
                    options={details.requests.map((r) => ({
                      value: r.id,
                      label: `${r.method} ${r.name}`,
                    }))}
                  />
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy || !index}
                      onClick={() => {
                        const steps = [...definition.steps];
                        [steps[index - 1], steps[index]] = [steps[index]!, steps[index - 1]!];
                        setDefinition({ ...definition, steps });
                      }}
                    >
                      Move up
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy || index === definition.steps.length - 1}
                      onClick={() => {
                        const steps = [...definition.steps];
                        [steps[index], steps[index + 1]] = [steps[index + 1]!, steps[index]!];
                        setDefinition({ ...definition, steps });
                      }}
                    >
                      Move down
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        setDefinition({
                          ...definition,
                          steps: definition.steps.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remove step
                    </Button>
                  </div>
                  <p className="font-medium">Captures</p>
                  {step.captures.map((capture, c) => (
                    <div key={capture.id ?? c} className="grid gap-2 @min-[600px]:grid-cols-4">
                      <Input
                        aria-label={`Capture variable ${c + 1}`}
                        placeholder="Variable name"
                        value={capture.key}
                        onChange={(e) =>
                          updateStep(index, {
                            ...step,
                            captures: step.captures.map((v, i) =>
                              i === c ? { ...v, key: e.target.value } : v,
                            ),
                          })
                        }
                      />
                      <LabSelect
                        label={`Capture source ${c + 1}`}
                        value={capture.source}
                        onChange={(v) =>
                          updateStep(index, {
                            ...step,
                            captures: step.captures.map((item, i) =>
                              i === c ? { ...item, source: v as typeof capture.source } : item,
                            ),
                          })
                        }
                        options={[
                          { value: "body", label: "JSON body" },
                          { value: "header", label: "Header" },
                          { value: "status", label: "Status" },
                        ]}
                      />
                      <Input
                        aria-label={`Capture path ${c + 1}`}
                        placeholder="/id or header name"
                        value={capture.path}
                        onChange={(e) =>
                          updateStep(index, {
                            ...step,
                            captures: step.captures.map((v, i) =>
                              i === c ? { ...v, path: e.target.value } : v,
                            ),
                          })
                        }
                      />
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          updateStep(index, {
                            ...step,
                            captures: step.captures.filter((_, i) => i !== c),
                          })
                        }
                      >
                        Remove capture
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      updateStep(index, {
                        ...step,
                        captures: [
                          ...step.captures,
                          { id: randomUUID(), key: "id", source: "body", path: "/id" },
                        ],
                      })
                    }
                  >
                    Add capture
                  </Button>
                  <p className="font-medium">Assertions</p>
                  {step.assertions.map((assertion, a) => (
                    <div key={assertion.id ?? a} className="space-y-2 rounded-md bg-muted/30 p-2">
                      <div className="grid gap-2 @min-[600px]:grid-cols-3">
                        <Input
                          aria-label={`Assertion name ${a + 1}`}
                          value={assertion.key}
                          onChange={(e) =>
                            updateStep(index, {
                              ...step,
                              assertions: step.assertions.map((v, i) =>
                                i === a ? { ...v, key: e.target.value } : v,
                              ),
                            })
                          }
                        />
                        <LabSelect
                          label={`Assertion source ${a + 1}`}
                          value={assertion.source}
                          onChange={(v) =>
                            updateStep(index, {
                              ...step,
                              assertions: step.assertions.map((item, i) =>
                                i === a ? { ...item, source: v as typeof assertion.source } : item,
                              ),
                            })
                          }
                          options={[
                            { value: "status", label: "Status" },
                            { value: "body", label: "JSON body" },
                            { value: "header", label: "Header" },
                          ]}
                        />
                        <Input
                          aria-label={`Assertion path ${a + 1}`}
                          value={assertion.path}
                          placeholder="/ok or header name"
                          onChange={(e) =>
                            updateStep(index, {
                              ...step,
                              assertions: step.assertions.map((v, i) =>
                                i === a ? { ...v, path: e.target.value } : v,
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="flex gap-2">
                        <LabSelect
                          label={`Assertion operator ${a + 1}`}
                          value={assertion.operator}
                          onChange={(v) =>
                            updateStep(index, {
                              ...step,
                              assertions: step.assertions.map((item, i) =>
                                i === a
                                  ? { ...item, operator: v as typeof assertion.operator }
                                  : item,
                              ),
                            })
                          }
                          options={[
                            { value: "equals", label: "Equals" },
                            { value: "contains", label: "Contains" },
                            { value: "exists", label: "Exists" },
                          ]}
                        />
                        <Input
                          aria-label={`Expected value ${a + 1}`}
                          value={assertion.expected}
                          onChange={(e) =>
                            updateStep(index, {
                              ...step,
                              assertions: step.assertions.map((v, i) =>
                                i === a ? { ...v, expected: e.target.value } : v,
                              ),
                            })
                          }
                        />
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            updateStep(index, {
                              ...step,
                              assertions: step.assertions.filter((_, i) => i !== a),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      updateStep(index, {
                        ...step,
                        assertions: [
                          ...step.assertions,
                          {
                            id: randomUUID(),
                            key: "Status is 200",
                            source: "status",
                            path: "",
                            operator: "equals",
                            expected: "200",
                          },
                        ],
                      })
                    }
                  >
                    Add assertion
                  </Button>
                </div>
              </details>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !details.requests.length || definition.steps.length >= 50}
              onClick={() => {
                const request = details.requests[0]!;
                setDefinition({
                  ...definition,
                  steps: [
                    ...definition.steps,
                    {
                      id: randomUUID(),
                      name: request.name,
                      requestKey: request.id,
                      captures: [],
                      assertions: [],
                    },
                  ],
                });
              }}
            >
              Add step
            </Button>
            <LabCodeEditor
              label="Dataset rows (JSON array, optional)"
              value={datasetText}
              onChange={setDatasetText}
              disabled={busy}
              placeholder={'[{"name":"first fixture"}, {"name":"second fixture"}]'}
            />
            <p className="text-muted-foreground">
              Each row runs the full sequence with isolated captures. Body paths use JSON Pointer,
              such as /account/id. Credentials belong in the selected environment.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || disabled || !definition.steps.length}
                onClick={() => void save()}
              >
                Save workflow
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  disabled ||
                  !canRun ||
                  !definitions.some((w) => w.id === definition.id) ||
                  JSON.stringify(definition) !==
                    JSON.stringify(definitions.find((w) => w.id === definition.id)) ||
                  datasetText !== JSON.stringify(definition.datasets, null, 2)
                }
                onClick={() => void execute("start")}
              >
                Run saved workflow
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || disabled}
                onClick={() => void save(true)}
              >
                Delete workflow
              </Button>
            </div>
          </fieldset>
        ) : null}
        {runs.length ? (
          <LabSelect
            label="Recent workflow runs"
            value={run?.id ?? ""}
            disabled={busy}
            onChange={(id) => {
              if (id) void inspectRun(id);
            }}
            options={[
              { value: "", label: "Choose a previous run" },
              ...runs.map((r) => ({
                value: r.id,
                label:
                  r.id === run?.id
                    ? `${r.name} · ${r.startedAt}`
                    : `${r.name} · ${r.state} · ${r.completed} requests · ${r.startedAt}`,
              })),
            ]}
          />
        ) : null}
        {run ? (
          <>
            <RunProgress
              threadRef={threadRef}
              workspaceId={details.workspace.id}
              run={run}
              onRefresh={() => void inspectRun(run.id)}
              onStop={() => void execute("cancel")}
            />
            <div className="space-y-2">
              {run.results.map((item) => (
                <div
                  key={`${item.dataset}:${item.stepId}`}
                  className="rounded-md border border-border p-3"
                >
                  <p>
                    Row {item.dataset + 1} · {item.name} ·{" "}
                    {item.error ?? item.result?.exchange.status}
                  </p>
                  {item.result ? (
                    <>
                      <p>
                        {item.result.checks.filter((c) => c.passed).length}/
                        {item.result.checks.length} checks passed
                      </p>
                      <Button size="xs" variant="ghost" onClick={() => onInspect(item.result!)}>
                        Inspect request and response
                      </Button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
