import { lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from "react";
import type {
  ModelWorkspace,
  ModelWorkspaceOperation,
  ModelVariant,
  ModelCamera,
} from "@t3tools/contracts/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ScadSession } from "./ScadCustomizer";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { meshStats } from "./viewer/load";
import type { ModelViewer } from "./viewer/createViewer";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogPanel,
} from "~/components/ui/dialog";
import { randomUUID } from "~/lib/utils";
import { models, modelUrl, runModelCommand } from "./state";
import { generateVariants, sweepValues } from "./variants";
import { thumbnail } from "./viewer/captureSheet";
import { OperationStatus, type OperationProgress } from "./OperationStatus";
import { validParameterLiteral, rebaseParameterValues } from "./params";
import { ItemName } from "./EditingInspector";
import styles from "./workspace.module.css";

const ViewerCanvas = lazy(() => import("./viewer/ViewerCanvas"));
type Mutation = (operation: ModelWorkspaceOperation) => Promise<unknown>;
function ComparePane({
  variant,
  dimensionKey,
  threadRef,
  path,
  volume,
  camera,
  onCamera,
  onDimensions,
}: {
  variant: ModelVariant;
  dimensionKey: string;
  threadRef: ScopedThreadRef;
  path: string;
  volume: readonly [number, number, number];
  camera: ModelCamera | null;
  onCamera: (camera: ModelCamera) => void;
  onDimensions: (id: string, dimensions: readonly [number, number, number]) => void;
}) {
  const onStats = useCallback(
    (stats: ReturnType<typeof meshStats>) => onDimensions(dimensionKey, stats.size),
    [dimensionKey, onDimensions],
  );
  const viewer = useRef<ModelViewer | null>(null),
    saved = useRef<ModelCamera | null>(null);
  const [mesh, setMesh] = useState<{ url: string; format: "stl" | "3mf" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const variantId = `compare-${variant.id}`;
    void runModelCommand(models.render, {
      environmentId: threadRef.environmentId,
      input: {
        file: { threadId: threadRef.threadId, path },
        overrides: variant.values,
        parameterSet: null,
        variantId,
      },
    })
      .then((result) => {
        if (!active) return;
        if (result.status !== "ok" || !result.mesh || !result.meshFormat)
          throw new Error(
            result.log.find((line) => line.level === "error")?.text ??
              "Comparison render cancelled.",
          );
        setMesh({
          url: modelUrl(threadRef.environmentId, result.mesh.relativeUrl),
          format: result.meshFormat,
        });
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
      void runModelCommand(models.cancelVariant, {
        environmentId: threadRef.environmentId,
        input: { file: { threadId: threadRef.threadId, path }, variantId },
      }).catch(() => undefined);
    };
  }, [threadRef.environmentId, threadRef.threadId, path, variant.id, variant.values]);
  return (
    <div className={styles["model-compare-pane"]}>
      <strong>{variant.name}</strong>
      {error ? (
        <p role="alert">{error}</p>
      ) : mesh ? (
        <Suspense fallback={<OperationStatus label="Preparing comparison viewer" />}>
          <ViewerCanvas
            {...mesh}
            volume={volume}
            visible={true}
            viewerRef={viewer}
            savedViewRef={saved}
            onStats={onStats}
            onError={setError}
            onProgress={setProgress}
            camera={camera}
            onCamera={onCamera}
          />
        </Suspense>
      ) : (
        <OperationStatus label="Rendering comparison" detail={variant.name} />
      )}
      {progress && !error && <OperationStatus label="Loading comparison model" detail={progress} />}
    </div>
  );
}
export function VariantsInspector({
  data,
  mutate,
  session,
  threadRef,
  path,
  volume,
  onActivity,
}: {
  onActivity: (activity: OperationProgress | null) => void;
  data: ModelWorkspace;
  mutate: Mutation;
  session: ScadSession | null;
  threadRef: ScopedThreadRef;
  path: string;
  volume: readonly [number, number, number];
}) {
  const [saveCandidate, setSaveCandidate] = useState<ModelVariant | null>(null);
  const [candidateSetName, setSetName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [axis, setAxis] = useState("");
  const [values, setValues] = useState("");
  const [second, setSecond] = useState("");
  const [secondValues, setSecondValues] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const parameters = session?.data.parameters;
  const chosen = useMemo(
    () =>
      data.variants
        .filter((variant) => selected.includes(variant.id))
        .map((variant) => ({
          ...variant,
          values: parameters ? rebaseParameterValues(parameters, variant.values) : variant.values,
        })),
    [data.variants, selected, parameters],
  );
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0, detail: "" });
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    onActivity(running ? { label: running, ...batchProgress } : null);
    return () => onActivity(null);
  }, [running, batchProgress, onActivity]);
  const [compare, setCompare] = useState(false);
  const [compareDimensions, setCompareDimensions] = useState<
    Record<string, readonly [number, number, number]>
  >({});
  const onDimensions = useCallback(
    (id: string, dimensions: readonly [number, number, number]) =>
      setCompareDimensions((current) => ({ ...current, [id]: dimensions })),
    [],
  );
  const comparisonKey = (variant: ModelVariant) =>
    JSON.stringify([variant.id, variant.values, session?.data.sourceRevision]);
  const [camera, setCamera] = useState<ModelCamera | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [savingValues, setSavingValues] = useState(false);
  const latestVariants = useRef(data.variants);
  useEffect(() => {
    latestVariants.current = data.variants;
  }, [data.variants]);
  const loadAbort = useRef<AbortController | null>(null);
  const activeThumbnail = useRef<(() => void) | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0),
    activeVariant = useRef<string | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    loadAbort.current?.abort();
    activeThumbnail.current?.();
    activeThumbnail.current = null;
    const id = activeVariant.current;
    activeVariant.current = null;
    setRunning(null);
    if (id)
      void runModelCommand(models.cancelVariant, {
        environmentId: threadRef.environmentId,
        input: { file: { threadId: threadRef.threadId, path }, variantId: id },
      }).catch(() => undefined);
  }, [threadRef.environmentId, threadRef.threadId, path]);
  useEffect(() => stop, [stop]);
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Source replacement cancels the external render process and its thumbnail work.
  useEffect(() => stop, [session?.data.sourceRevision, stop]);
  const add = async (
    candidates: readonly { name: string; values: Readonly<Record<string, string>> }[],
  ) => {
    if (!session || adding) return;
    setAdding(true);
    setError(null);
    try {
      if (data.variants.length + candidates.length > 24)
        throw new Error("Keep up to 24 candidates. Delete a candidate before adding more.");
      for (const candidate of candidates) {
        const saved = await mutate({
          kind: "variant",
          item: {
            id: randomUUID(),
            name: candidate.name.slice(0, 100),
            values: candidate.values,
            sourceRevision: session.data.sourceRevision,
            thumbnail: null,
            dimensions: null,
            triangles: null,
            renderedRevision: null,
            origin: "user",
          },
        });
        if (!saved) return;
      }
      setName("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setAdding(false);
    }
  };
  const render = async () => {
    if (!session || running) return;
    const token = ++generation.current;
    setError(null);
    setMessage(null);
    setRunning("Preparing variant batch");
    const candidates = data.variants.filter(
      (variant) => !chosen.length || selected.includes(variant.id),
    );
    setBatchProgress({ completed: 0, total: candidates.length, detail: "Loading render tools" });
    try {
      const [{ createViewer }, { loadModel }] = await Promise.all([
        import("./viewer/createViewer"),
        import("./viewer/load"),
      ]);
      for (const [index, candidate] of candidates.entries()) {
        if (token !== generation.current) break;
        activeVariant.current = candidate.id;
        setRunning(`Rendering ${candidate.name}`);
        setBatchProgress({
          completed: index,
          total: candidates.length,
          detail: "OpenSCAD is preparing this candidate.",
        });
        const result = await runModelCommand(models.render, {
          environmentId: threadRef.environmentId,
          input: {
            file: { threadId: threadRef.threadId, path },
            overrides: rebaseParameterValues(session.data.parameters, candidate.values),
            parameterSet: null,
            variantId: candidate.id,
          },
        });
        if (token !== generation.current) break;
        if (result.status !== "ok" || !result.mesh || !result.meshFormat)
          throw new Error(
            `${candidate.name}: ${result.log.find((line) => line.level === "error")?.text ?? "Render cancelled."}`,
          );
        setRunning(`Preparing ${candidate.name}`);
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;left:-10000px;top:0;width:640px;height:480px;";
        document.body.append(host);
        let viewer: ModelViewer | null = null;
        let disposed = false;
        const releaseThumbnail = () => {
          if (disposed) return;
          disposed = true;
          viewer?.dispose();
          host.remove();
        };
        activeThumbnail.current = releaseThumbnail;
        const abort = new AbortController();
        try {
          viewer = createViewer(host);
          viewer.setVisible(false);
          viewer.setBuildVolume(volume);
          loadAbort.current = abort;
          const model = await loadModel(
            modelUrl(threadRef.environmentId, result.mesh.relativeUrl),
            result.meshFormat,
            abort.signal,
            (bytes, total) => {
              if (token === generation.current)
                setBatchProgress((current) => ({
                  ...current,
                  detail:
                    bytes === total
                      ? "Preparing mesh"
                      : `Downloaded ${(bytes / 1024 / 1024).toFixed(1)} MB${total ? ` of ${(total / 1024 / 1024).toFixed(1)} MB` : ""}`,
                }));
            },
          );
          if (token !== generation.current) {
            const { disposeModel } = await import("./viewer/load");
            disposeModel(model);
            break;
          }
          const stats = viewer.setModel(model, false);
          setRunning(`Capturing ${candidate.name}`);
          setBatchProgress((current) => ({
            ...current,
            detail: "Encoding the thumbnail and saving this candidate.",
          }));
          const image = await thumbnail(await viewer.capture(false));
          const latest = latestVariants.current.find((item) => item.id === candidate.id);
          if (
            token === generation.current &&
            latest &&
            JSON.stringify(latest.values) === JSON.stringify(candidate.values)
          )
            if (
              !(await mutate({
                kind: "variant",
                item: {
                  ...latest,
                  sourceRevision: session.data.sourceRevision,
                  values: rebaseParameterValues(session.data.parameters, candidate.values),
                  thumbnail: image,
                  dimensions: stats.size,
                  triangles: stats.triangles,
                  renderedRevision: session.data.sourceRevision,
                },
              }))
            )
              break;
          if (token === generation.current)
            setBatchProgress((current) => ({ ...current, completed: index + 1 }));
        } finally {
          releaseThumbnail();
          if (activeThumbnail.current === releaseThumbnail) activeThumbnail.current = null;
          if (loadAbort.current === abort) loadAbort.current = null;
        }
      }
    } catch (cause) {
      if (token === generation.current) setError(String(cause));
    } finally {
      if (token === generation.current) {
        setRunning(null);
        activeVariant.current = null;
      }
    }
  };
  const eligible =
    session?.data.parameters.filter((parameter) => parameter.kind !== "vector") ?? [];
  const firstAxis = eligible.some((p) => p.name === axis) ? axis : "";
  const secondAxis = second !== firstAxis && eligible.some((p) => p.name === second) ? second : "";
  return (
    <div className={styles["model-inspector-scroll"]}>
      <div className={styles["model-inspector-page"]}>
        <h3 className={styles["model-section-title"]}>Variant workbench</h3>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Explore parameter alternatives without changing the active part. Render thumbnails,
          compare two candidates, then promote a favorite.
        </p>
        {!session ? (
          <p>Open an OpenSCAD file to explore parameters.</p>
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void add([{ name: name.trim(), values: session.values }]);
              }}
            >
              <Input
                size="sm"
                aria-label="Variant name"
                placeholder="Name this candidate"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={!name.trim() || adding}>
                Save
              </Button>
            </form>
            <Button
              variant="ghost"
              size="sm"
              disabled={adding || !session.data.sets.length}
              onClick={() =>
                void add(
                  session.data.sets.map((name) => ({
                    name,
                    values: {
                      ...Object.fromEntries(
                        session.data.parameters.map((parameter) => [
                          parameter.name,
                          parameter.defaultValue,
                        ]),
                      ),
                      ...session.data.setValues[name],
                    },
                  })),
                )
              }
            >
              Import saved sets
            </Button>
            <details className={styles["model-edit-item"]}>
              <summary>Generate a parameter sweep</summary>
              <label className="block mt-3 text-xs">
                First parameter
                <select
                  className={styles["model-native-select"]}
                  aria-label="Sweep parameter"
                  value={firstAxis}
                  onChange={(e) => setAxis(e.target.value)}
                >
                  <option value="">Choose parameter</option>
                  {eligible.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                size="sm"
                aria-label="Sweep values"
                placeholder="e.g. 80, 90, 110"
                value={values}
                onChange={(e) => setValues(e.target.value)}
              />
              <label className="block mt-3 text-xs">
                Second parameter (optional)
                <select
                  className={styles["model-native-select"]}
                  aria-label="Second sweep parameter"
                  value={secondAxis}
                  onChange={(e) => setSecond(e.target.value)}
                >
                  <option value="">None</option>
                  {eligible
                    .filter((p) => p.name !== firstAxis)
                    .map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              {secondAxis && (
                <Input
                  size="sm"
                  aria-label="Second sweep values"
                  placeholder="e.g. 2, 3"
                  value={secondValues}
                  onChange={(e) => setSecondValues(e.target.value)}
                />
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!firstAxis || !values || adding}
                onClick={() => {
                  try {
                    const axes = [
                      {
                        name: firstAxis,
                        values: sweepValues(
                          eligible.find((p) => p.name === firstAxis)!,
                          values,
                        ),
                      },
                      ...(secondAxis
                        ? [
                            {
                              name: secondAxis,
                              values: sweepValues(
                                eligible.find((p) => p.name === secondAxis)!,
                                secondValues,
                              ),
                            },
                          ]
                        : []),
                    ];
                    void add(generateVariants(session.values, axes));
                  } catch (cause) {
                    setError(String(cause));
                  }
                }}
              >
                Generate candidates
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Comma-separated values. Up to 12 combinations per batch, 24 total.
              </p>
            </details>
            <div className="my-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!data.variants.length || !!running}
                onClick={() => void render()}
              >
                Render {chosen.length ? "selected" : "all"}
              </Button>
              {running && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    stop();
                    setMessage("Variant batch cancelled.");
                  }}
                >
                  Cancel batch
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={chosen.length !== 2 || !!running}
                onClick={() => {
                  setCamera(null);
                  setCompareDimensions({});
                  setCompare(true);
                }}
              >
                Compare two
              </Button>
            </div>
            {running && (
              <OperationStatus
                label={running}
                detail={batchProgress.detail}
                completed={batchProgress.completed}
                total={batchProgress.total}
              />
            )}
            {message && (
              <p role="status" className="my-2 text-xs text-muted-foreground">
                {message}
              </p>
            )}
            {adding && <OperationStatus label="Saving variant candidates" />}
            {error && (
              <p role="alert" className={styles["model-notice"]}>
                {error}
              </p>
            )}
            {data.variants.map((variant) => (
              <div key={variant.id} className={styles["model-edit-item"]}>
                {variant.thumbnail && (
                  <img
                    className={styles["model-review-image"]}
                    alt={`${variant.name} preview`}
                    src={variant.thumbnail}
                  />
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${variant.name}`}
                    checked={selected.includes(variant.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, variant.id]
                          : current.filter((id) => id !== variant.id),
                      )
                    }
                  />
                  <ItemName
                    name={variant.name}
                    onRename={(name) =>
                      void mutate({ kind: "variant", item: { ...variant, name } })
                    }
                  />
                </div>
                <p className="my-2 text-xs text-muted-foreground">
                  {variant.origin === "agent" ? "Agent proposal · " : ""}
                  {variant.dimensions
                    ? `${variant.dimensions.map((value) => value.toFixed(2)).join(" × ")} mm`
                    : "Not rendered"}
                  {variant.renderedRevision !== session.data.sourceRevision && variant.thumbnail
                    ? " · Preview out of date. Removed or incompatible values use current source defaults."
                    : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      session.promote(
                        rebaseParameterValues(session.data.parameters, variant.values),
                        variant.name,
                      );
                      setError(null);
                    }}
                  >
                    Use candidate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (savingValues) return;
                      setDraftValues(
                        rebaseParameterValues(session.data.parameters, variant.values),
                      );
                      setEditing(editing === variant.id ? null : variant.id);
                    }}
                  >
                    Edit values
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void mutate({ kind: "remove", collection: "variants", id: variant.id })
                    }
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSaveError(null);
                      setSaveCandidate(variant);
                      setSetName(variant.name);
                    }}
                  >
                    Save as set
                  </Button>
                </div>
                {editing === variant.id && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (savingValues) return;
                      const invalid = session.data.parameters.find(
                        (parameter) =>
                          !validParameterLiteral(
                            parameter,
                            draftValues[parameter.name] ?? parameter.defaultValue,
                          ),
                      );
                      if (invalid) {
                        setError(
                          `Invalid ${invalid.kind} literal for ${invalid.name}. Use an OpenSCAD literal; quote strings.`,
                        );
                        return;
                      }
                      setSavingValues(true);
                      setError(null);
                      void mutate({
                        kind: "variant",
                        item: {
                          ...variant,
                          sourceRevision: session.data.sourceRevision,
                          values: rebaseParameterValues(session.data.parameters, draftValues),
                          renderedRevision: null,
                          thumbnail: null,
                          dimensions: null,
                          triangles: null,
                        },
                      })
                        .then((saved) => {
                          if (saved) setEditing(null);
                        })
                        .finally(() => setSavingValues(false));
                    }}
                  >
                    <p className="mt-3 text-xs text-muted-foreground">
                      Edit OpenSCAD literals, then save all values together. Quote strings.
                    </p>
                    {session.data.parameters.map((parameter) => (
                      <label className="block mt-3 text-xs" key={parameter.name}>
                        {parameter.name}
                        <Input
                          size="sm"
                          aria-label={`${variant.name} ${parameter.name}`}
                          value={draftValues[parameter.name] ?? parameter.defaultValue}
                          disabled={savingValues}
                          onChange={(event) =>
                            setDraftValues((current) => ({
                              ...current,
                              [parameter.name]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                    <div className="mt-3 flex gap-2">
                      <Button type="submit" size="sm" disabled={savingValues}>
                        Save values
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={savingValues}
                        onClick={() => setEditing(null)}
                      >
                        Cancel edits
                      </Button>
                    </div>
                    {savingValues && <OperationStatus label="Saving candidate values" />}
                  </form>
                )}
              </div>
            ))}
          </>
        )}
        <Dialog
          open={!!saveCandidate}
          onOpenChange={(open) => {
            if (!open && !saving) setSaveCandidate(null);
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Save candidate as parameter set</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <Input
                aria-label="Candidate set name"
                value={candidateSetName}
                onChange={(event) => setSetName(event.target.value)}
                maxLength={100}
              />
              {session?.data.sets.includes(candidateSetName.trim()) && (
                <p className="mt-3 text-xs text-warning-foreground">
                  This replaces “{candidateSetName.trim()}”. Other sets are preserved.
                </p>
              )}
              {saveError && (
                <p role="alert" className={styles["model-notice"]}>
                  {saveError}
                </p>
              )}
              {saving && <OperationStatus label="Saving parameter set" />}
              <Button
                disabled={saving || !candidateSetName.trim()}
                onClick={() => {
                  if (!saveCandidate || !session) return;
                  setSaving(true);
                  setSaveError(null);
                  void session
                    .saveSet(
                      candidateSetName.trim(),
                      rebaseParameterValues(session.data.parameters, saveCandidate.values),
                    )
                    .then(() => setSaveCandidate(null))
                    .catch((cause) => setSaveError(String(cause)))
                    .finally(() => setSaving(false));
                }}
              >
                {saving
                  ? "Saving..."
                  : session?.data.sets.includes(candidateSetName.trim())
                    ? "Replace set"
                    : "Save set"}
              </Button>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
        <Dialog open={compare} onOpenChange={setCompare}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Backdrop className={styles["model-comparison-backdrop"]} />
            <DialogPrimitive.Popup className={styles["model-comparison-dialog"]}>
              <DialogPrimitive.Close
                className={styles["model-comparison-close"]}
                aria-label="Close comparison"
              >
                ×
              </DialogPrimitive.Close>
              <DialogHeader>
                <DialogTitle>Compare variants</DialogTitle>
              </DialogHeader>
              <DialogPanel>
                <p className="mb-3 text-xs text-muted-foreground">
                  Cameras stay synchronized. Dimensions and values show differences between
                  candidates.
                </p>
                <div className={styles["model-compare-grid"]}>
                  {chosen.slice(0, 2).map((variant) => (
                    <ComparePane
                      key={JSON.stringify([
                        variant.id,
                        variant.values,
                        session?.data.sourceRevision,
                      ])}
                      variant={variant}
                      dimensionKey={comparisonKey(variant)}
                      threadRef={threadRef}
                      path={path}
                      volume={volume}
                      camera={camera}
                      onCamera={setCamera}
                      onDimensions={onDimensions}
                    />
                  ))}
                </div>
                {chosen.length === 2 && (
                  <dl className="mt-3 text-xs">
                    {["Width / X", "Depth / Y", "Height / Z"].map((label, index) => (
                      <div className={styles["model-property-row"]} key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {compareDimensions[comparisonKey(chosen[0]!)] &&
                          compareDimensions[comparisonKey(chosen[1]!)]
                            ? `${compareDimensions[comparisonKey(chosen[0]!)]![index]!.toFixed(2)} → ${compareDimensions[comparisonKey(chosen[1]!)]![index]!.toFixed(2)} mm (Δ ${(compareDimensions[comparisonKey(chosen[1]!)]![index]! - compareDimensions[comparisonKey(chosen[0]!)]![index]!).toFixed(2)})`
                            : "Loading comparison dimensions"}
                        </dd>
                      </div>
                    ))}
                    {session?.data.parameters
                      .filter((p) => chosen[0]!.values[p.name] !== chosen[1]!.values[p.name])
                      .map((parameter) => (
                        <div className={styles["model-property-row"]} key={parameter.name}>
                          <dt>{parameter.name}</dt>
                          <dd>
                            {chosen[0]!.values[parameter.name]} →{" "}
                            {chosen[1]!.values[parameter.name]}
                          </dd>
                        </div>
                      ))}
                  </dl>
                )}
              </DialogPanel>
            </DialogPrimitive.Popup>
          </DialogPrimitive.Portal>
        </Dialog>
      </div>
    </div>
  );
}
