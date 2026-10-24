import { OperationStatus } from "./OperationStatus";
import styles from "./workspace.module.css";
import { useEffect, useState } from "react";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { BoxIcon, FileCode2Icon, FileBoxIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { TurnModels } from "@t3tools/contracts/fork";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useServerConfigs } from "~/state/entities";
import { modelSurface } from "./agentModels";
import { useAgentModelMarks } from "./agentModelMarks";
import { models, runModelCommand } from "./state";
import { ModelTool } from "./WorkspaceTools";
function usePickerAgentModels(threadRef: ScopedThreadRef) {
  const key = scopedThreadKey(threadRef);
  const configs = useServerConfigs();
  const features = loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities);
  const available =
    features.includes("model-preview-3d") && features.includes("model-follow-agent");
  const latest = useAgentModelMarks((state) => state.latest[key]);
  const runId = useAgentModelMarks((state) => state.pickerTurn[key] ?? null);
  const [lookup, setLookup] = useState<{ key: string; result?: TurnModels; error?: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  const lookupKey = `${key}:${runId ?? "latest"}:${retry}`;
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void runModelCommand(models.loadTurnModels, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, runId },
    })
      .then((result) => {
        if (cancelled || result.threadId !== threadRef.threadId) return;
        setLookup({ key: lookupKey, result });
        if (runId === null && result.models.length)
          useAgentModelMarks.getState().remember(key, result);
      })
      .catch((error) => {
        if (!cancelled)
          setLookup({
            key: lookupKey,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [available, key, lookupKey, runId, threadRef]);
  useEffect(
    () => () => {
      useAgentModelMarks.getState().setPickerTurn(key, null);
    },
    [key],
  );
  const fetched = lookup?.key === lookupKey ? lookup : null;
  return {
    available,
    filtered: runId !== null,
    result: runId === null ? (latest ?? fetched?.result) : fetched?.result,
    error: fetched?.error,
    retry: () => setRetry((value) => value + 1),
    clearFilter: () => useAgentModelMarks.getState().setPickerTurn(key, null),
  };
}
export function ModelPicker({ threadRef }: { threadRef: ScopedThreadRef }) {
  const agentModels = usePickerAgentModels(threadRef);
  const configs = useServerConfigs();
  const features = loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities);
  const canCreate = useAtomValue(models.updateAssembly.permissionAtom(threadRef.environmentId));
  const [creating, setCreating] = useState(false),
    [assemblyName, setAssemblyName] = useState("New assembly"),
    [assemblyPath, setAssemblyPath] = useState("assembly.loom-assembly.json"),
    [createError, setCreateError] = useState<string | null>(null),
    [createBusy, setCreateBusy] = useState(false);
  const create = async () => {
    setCreateBusy(true);
    setCreateError(null);
    // The async wrapper turns the path check's throw into a rejection for the catch.
    await (async () => {
      if (!assemblyPath.toLowerCase().endsWith(".loom-assembly.json"))
        throw new Error("Use a .loom-assembly.json path.");
      await runModelCommand(models.updateAssembly, {
        environmentId: threadRef.environmentId,
        input: {
          file: { threadId: threadRef.threadId, path: assemblyPath.trim() },
          createOnly: true,
          operations: [{ op: "set-name", name: assemblyName.trim() }],
        },
      });
      appAtomRegistry.refresh(atom);
      useRightPanelStore.getState().openSurface(threadRef, modelSurface(assemblyPath.trim()));
    })()
      .catch((cause: unknown) => {
        setCreateError(
          cause instanceof Error ? cause.message : "The assembly could not be created.",
        );
      })
      .finally(() => {
        setCreateBusy(false);
      });
  };
  const atom = models.models({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });
  const result = useAtomValue(atom);
  const listing = Option.getOrNull(AsyncResult.value(result));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "mesh" | "scad" | "python" | "assembly">("all");
  const combined = [
    ...(listing?.models ?? []),
    ...(listing?.assemblies ?? []).map((entry) => ({ ...entry, format: "assembly" as const })),
  ];
  const files = combined.filter(
    (model) =>
      (!agentModels.filtered ||
        agentModels.result?.models.some((changed) => changed.path === model.path)) &&
      model.path.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "scad"
          ? model.format === "scad"
          : filter === "python"
            ? model.format === "build123d" || model.format === "step"
            : filter === "assembly"
              ? model.format === "assembly"
              : !["scad", "step", "build123d", "assembly"].includes(model.format))),
  );
  return (
    <div className={styles["model-library"]}>
      <div className={styles["model-library-header"]}>
        <div className={styles["model-library-heading"]}>
          <h1>Model files</h1>
          <ModelTool
            label="Refresh model files"
            onClick={() => {
              appAtomRegistry.refresh(atom);
              agentModels.retry();
            }}
          >
            <RefreshCwIcon />
          </ModelTool>
        </div>
        {features.includes("model-assemblies") && (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={!canCreate}
              onClick={() => setCreating((value) => !value)}
            >
              New assembly
            </Button>
          </div>
        )}
        {creating && (
          <fieldset disabled={createBusy} className="mt-2 flex flex-col gap-2">
            <label className="text-xs">
              Name
              <Input
                aria-label="Assembly name"
                value={assemblyName}
                onChange={(e) => setAssemblyName(e.target.value)}
              />
            </label>
            <label className="text-xs">
              Workspace path
              <Input
                aria-label="Assembly path"
                value={assemblyPath}
                onChange={(e) => setAssemblyPath(e.target.value)}
              />
            </label>
            {createError && <p role="alert">{createError}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!canCreate || !assemblyName.trim()}
                onClick={() => void create()}
              >
                Create assembly
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </fieldset>
        )}
        <p>Open a part from this workspace. Each file gets its own preview.</p>
      </div>
      <div className={styles["model-library-search"]}>
        <Input
          type="search"
          aria-label="Search model files"
          placeholder="Search files or folders..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className={styles["model-library-filters"]} role="group" aria-label="File type">
        {(
          [
            "all",
            "mesh",
            "scad",
            ...(features.includes("model-python-cad") ? ["python" as const] : []),
            ...(features.includes("model-assemblies") ? ["assembly" as const] : []),
          ] as const
        ).map((value) => (
          <button
            key={value}
            className={styles["model-tool"]}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {
              {
                all: "All files",
                mesh: "Meshes",
                scad: "OpenSCAD",
                python: "Python CAD / STEP",
                assembly: "Assemblies",
              }[value]
            }
          </button>
        ))}
      </div>
      {agentModels.available &&
      (agentModels.result?.models.length || agentModels.filtered || agentModels.error) ? (
        <section className="px-5 pb-3" aria-label="Changed by the agent">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Changed by the agent</h2>
            <span className="text-xs text-muted-foreground">
              {agentModels.result?.turn !== null && agentModels.result?.turn !== undefined
                ? `Turn ${agentModels.result.turn}`
                : ""}
            </span>
          </div>
          {agentModels.error ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
              <span>{agentModels.error}</span>
              <Button size="xs" variant="outline" onClick={agentModels.retry}>
                Try again
              </Button>
            </div>
          ) : !agentModels.result ? (
            <OperationStatus label="Finding this turn's models" />
          ) : !agentModels.result.models.length ? (
            <p className="text-sm text-muted-foreground">
              These model files were deleted or moved.
            </p>
          ) : (
            <div className={styles["model-file-grid"]}>
              {agentModels.result.models.map((model) => (
                <button
                  key={model.path}
                  className={styles["model-file-row"]}
                  onClick={() =>
                    useRightPanelStore.getState().openSurface(threadRef, modelSurface(model.path))
                  }
                >
                  <span className={styles["model-file-symbol"]} data-scad={model.format === "scad"}>
                    {model.format === "scad" ? <FileCode2Icon /> : <BoxIcon />}
                  </span>
                  <span className={styles["model-file-name"]}>
                    <strong>{model.path.split("/").at(-1)}</strong>
                    <small>
                      {model.reason === "dependency" ? `Reads ${model.via}` : model.path}
                    </small>
                  </span>
                  <span className={styles["model-file-format"]}>{model.format.toUpperCase()}</span>
                </button>
              ))}
            </div>
          )}
          {agentModels.result?.truncated && (
            <p className="mt-2 text-xs text-muted-foreground">
              Some models may be omitted from this turn.
            </p>
          )}
          {agentModels.filtered && (
            <div className="mt-2">
              <Button size="xs" variant="outline" onClick={agentModels.clearFilter}>
                Show all model files
              </Button>
            </div>
          )}
        </section>
      ) : null}
      <div className={styles["model-file-list"]}>
        {result.waiting && listing && <OperationStatus label="Refreshing model files" />}

        {result._tag === "Failure" ? (
          <div className={styles["model-notice"]} role="alert">
            <p>{String(Cause.squash(result.cause))}</p>
            <Button size="sm" variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
              Try again
            </Button>
          </div>
        ) : !listing ? (
          <div className={styles["model-empty"]}>
            <OperationStatus
              label="Finding model files"
              detail="Searching this workspace on the selected environment."
            />
          </div>
        ) : !combined.length ? (
          <div className={styles["model-empty"]}>
            <BoxIcon />
            <strong>Your parts will appear here</strong>
            <p>Add an STL, 3MF, OBJ, glTF, GLB, SCAD, .b3d.py or STEP file to this workspace.</p>
          </div>
        ) : !files?.length ? (
          <div className={styles["model-empty"]}>
            <SearchIcon />
            <strong>No matching files</strong>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className={styles["model-file-grid"]}>
            {files.map((model) => {
              const name = model.path.split("/").at(-1) ?? model.path;
              const folder = model.path.includes("/")
                ? model.path.slice(0, -(name.length + 1))
                : "Workspace";
              const Icon =
                model.format === "scad" || model.format === "build123d"
                  ? FileCode2Icon
                  : model.format === "step"
                    ? FileBoxIcon
                    : BoxIcon;
              return (
                <button
                  key={model.path}
                  className={styles["model-file-row"]}
                  onClick={() =>
                    useRightPanelStore.getState().openSurface(threadRef, modelSurface(model.path))
                  }
                >
                  <span className={styles["model-file-symbol"]} data-scad={model.format === "scad"}>
                    <Icon />
                  </span>
                  <span className={styles["model-file-name"]}>
                    <strong>{name}</strong>
                    <small>
                      {folder} · {formatAttachmentSize(model.sizeBytes)}
                    </small>
                  </span>
                  <span className={styles["model-file-format"]}>{model.format.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {listing && (
        <div className={styles["model-status-bar"]}>
          <span>
            {files?.length ?? 0} of {combined.length} files
            {listing.truncated ? " · First 2,000 indexed" : ""}
          </span>
          <span>Environment workspace</span>
        </div>
      )}
    </div>
  );
}
