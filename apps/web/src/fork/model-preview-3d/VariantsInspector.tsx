import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookmarkIcon,
  CheckIcon,
  ChevronLeftIcon,
  Columns2Icon,
  CopyIcon,
  EllipsisIcon,
  LayersIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type {
  ModelCamera,
  ModelVariant,
  ModelWorkspace,
  ModelWorkspaceOperation,
  ScadParameter,
} from "@t3tools/contracts/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { randomUUID } from "~/lib/utils";
import type { ScadSession } from "./ScadCustomizer";
import type { meshStats } from "./viewer/load";
import type { ModelViewer } from "./viewer/createViewer";
import { models, modelUrl, runModelCommand } from "./state";
import { generateVariants, sweepValues } from "./variants";
import { thumbnail } from "./viewer/captureSheet";
import { OperationStatus, type OperationProgress } from "./OperationStatus";
import {
  changedParameters,
  describeValues,
  displayParameterValue,
  parameterLabel,
  parameterValues,
  rebaseParameterValues,
  validParameterLiteral,
} from "./params";
import { fitsBuildVolume } from "./buildPlate";
import {
  Chip,
  EmptyNote,
  ParameterRow,
  RenameInput,
  SectionHead,
  Tip,
  TitleInput,
} from "./controls";
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

const VARIANT_LIMIT = 24;
const SAVE_DELAY_MS = 500;
const same = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  Object.keys({ ...a, ...b }).every((key) => a[key] === b[key]);

type SaveCandidate = { name: string; values: Readonly<Record<string, string>> };

/** Variant detail: hero thumbnail, name and every value, saved shortly after each edit. */
function VariantDetail({
  variant,
  session,
  volume,
  mutate,
  rendering,
  onBack,
  onRender,
  onUse,
  onSaveSet,
  onDuplicate,
  onDelete,
}: {
  variant: ModelVariant;
  session: ScadSession;
  volume: readonly [number, number, number];
  mutate: Mutation;
  rendering: boolean;
  onBack: () => void;
  onRender: (variant: ModelVariant) => void;
  onUse: (values: Readonly<Record<string, string>>) => void;
  onSaveSet: (candidate: SaveCandidate) => void;
  onDuplicate: (candidate: SaveCandidate) => void;
  onDelete: () => void;
}) {
  const parameters = session.data.parameters;
  const saved = useMemo(
    () => rebaseParameterValues(parameters, variant.values),
    [parameters, variant.values],
  );
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const defaults = useMemo(() => parameterValues(parameters, {}), [parameters]);
  const dirty = !same(draft, saved);
  const persist = useEffectEvent(async () => {
    const invalid = parameters.find(
      (parameter) =>
        !validParameterLiteral(parameter, draft[parameter.name] ?? parameter.defaultValue),
    );
    if (invalid) {
      setError(`Enter a valid ${invalid.kind} for ${parameterLabel(invalid.name)}.`);
      return null;
    }
    setError(null);
    const item: ModelVariant = {
      ...variant,
      sourceRevision: session.data.sourceRevision,
      values: draft,
      renderedRevision: null,
      thumbnail: null,
      dimensions: null,
      triangles: null,
    };
    return (await mutate({ kind: "variant", item })) ? item : null;
  });
  useEffect(() => {
    if (!dirty) return;
    const timeout = setTimeout(() => void persist(), SAVE_DELAY_MS);
    return () => clearTimeout(timeout);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each edit restarts the save delay.
  }, [draft, dirty]);
  const groups = new Map<string, ScadParameter[]>();
  for (const parameter of parameters)
    groups.set(parameter.group, [...(groups.get(parameter.group) ?? []), parameter]);
  const differ = changedParameters(parameters, draft, defaults).length;
  const inUse = same(draft, session.values);
  const stale = !!variant.thumbnail && variant.renderedRevision !== session.data.sourceRevision;
  const oversized = variant.dimensions && !fitsBuildVolume(variant.dimensions, volume);
  return (
    <>
      <div className={styles["model-detail-head"]}>
        <Button variant="ghost-muted" size="xs" onClick={onBack}>
          <ChevronLeftIcon />
          Variants
        </Button>
        <div className="flex-1" />
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost-muted" size="icon-sm" aria-label="Variant actions" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => onSaveSet({ name: variant.name, values: draft })}>
              <BookmarkIcon />
              Save as parameter set
            </MenuItem>
            <MenuItem onClick={() => onDuplicate({ name: `${variant.name} copy`, values: draft })}>
              <CopyIcon />
              Duplicate
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className={styles["model-inspector-scroll"]}>
        <div className={styles["model-variant-hero"]}>
          {variant.thumbnail && !dirty ? (
            <img src={variant.thumbnail} alt={`${variant.name} preview`} />
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={rendering}
              onClick={() =>
                void persist().then((item) => {
                  if (item || !dirty) onRender(item ?? variant);
                })
              }
            >
              <PlayIcon />
              {rendering ? "Rendering" : "Render"}
            </Button>
          )}
          {stale && !dirty && <Chip tone="warning">Out of date</Chip>}
        </div>
        <TitleInput
          value={variant.name}
          label="Variant name"
          onSave={(name) => void mutate({ kind: "variant", item: { ...variant, name } })}
        />
        <div className={styles["model-detail-sub"]}>
          {differ
            ? `${differ} parameter${differ === 1 ? "" : "s"} differ from source defaults`
            : "Same as source defaults"}
          {variant.dimensions && !dirty
            ? `, ${variant.dimensions.map((value) => value.toFixed(0)).join(" × ")} mm`
            : ""}
          {oversized && !dirty ? ", too large for the plate" : ""}
        </div>
        {error && (
          <p role="alert" className={styles["model-help"]} data-tone="error">
            {error}
          </p>
        )}
        {[...groups].map(([group, items]) => (
          <section key={group} className={styles["model-param-group"]}>
            {(groups.size > 1 || group) && (
              <div className={styles["model-param-group-head"]}>{group || "General"}</div>
            )}
            {items.map((parameter) => (
              <ParameterRow
                key={parameter.name}
                parameter={parameter}
                value={draft[parameter.name] ?? parameter.defaultValue}
                baseline={defaults[parameter.name]!}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, [parameter.name]: value }))
                }
              />
            ))}
          </section>
        ))}
      </div>
      <div className={styles["model-inspector-foot"]}>
        <Button
          variant="outline"
          size="xs"
          disabled={rendering}
          onClick={() =>
            void persist().then((item) => {
              if (item || !dirty) onRender(item ?? variant);
            })
          }
        >
          <RefreshCwIcon />
          {rendering ? "Rendering" : "Render"}
        </Button>
        <div className="flex-1" />
        <Button size="xs" disabled={inUse} onClick={() => onUse(draft)}>
          {inUse ? "In use" : "Use these values"}
        </Button>
      </div>
    </>
  );
}

function SweepDialog({
  open,
  onOpenChange,
  session,
  adding,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ScadSession;
  adding: boolean;
  onGenerate: (candidates: SaveCandidate[]) => Promise<boolean>;
}) {
  const eligible = session.data.parameters.filter((parameter) => parameter.kind !== "vector");
  const [first, setFirst] = useState(""),
    [firstValues, setFirstValues] = useState(""),
    [second, setSecond] = useState(""),
    [secondValues, setSecondValues] = useState(""),
    [error, setError] = useState<string | null>(null);
  const firstAxis = eligible.some((p) => p.name === first) ? first : (eligible[0]?.name ?? "");
  const secondAxis = second !== firstAxis && eligible.some((p) => p.name === second) ? second : "";
  const items = eligible.map((parameter) => ({
    value: parameter.name,
    label: parameterLabel(parameter.name),
  }));
  const preview = (() => {
    const axes = [
      { parameter: eligible.find((p) => p.name === firstAxis), input: firstValues },
      { parameter: eligible.find((p) => p.name === secondAxis), input: secondValues },
    ].flatMap(({ parameter, input }) => (parameter ? [{ parameter, input }] : []));
    try {
      const candidates = generateVariants(
        session.values,
        axes.map(({ parameter, input }) => ({
          name: parameter.name,
          values: sweepValues(parameter, input),
        })),
      );
      return { axes, candidates, error: null };
    } catch (cause) {
      return {
        axes,
        candidates: [],
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  })();
  return (
    <Dialog open={open} onOpenChange={(next) => !adding && onOpenChange(next)}>
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (preview.error) {
              setError(preview.error);
              return;
            }
            void onGenerate(
              preview.candidates.map((candidate) => ({
                values: candidate.values,
                name: preview.axes
                  .map(
                    ({ parameter }) =>
                      `${parameterLabel(parameter.name)} ${displayParameterValue(parameter, candidate.values[parameter.name]!)}`,
                  )
                  .join(", "),
              })),
            ).then((ok) => ok && onOpenChange(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>Parameter sweep</DialogTitle>
            <DialogDescription>
              Make a variant for every combination of the values you list, starting from the current
              values. Up to 12 per sweep.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className={styles["model-sweep-grid"]}>
              <span>Parameter</span>
              <span>Values, comma separated</span>
              <Select
                value={firstAxis}
                items={items}
                onValueChange={(next) => next !== null && setFirst(next)}
              >
                <SelectTrigger size="sm" aria-label="Sweep parameter">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Input
                size="sm"
                aria-label="Sweep values"
                placeholder="e.g. 80, 90, 110"
                value={firstValues}
                onChange={(event) => setFirstValues(event.target.value)}
              />
              <Select
                value={secondAxis}
                items={[{ value: "", label: "No second parameter" }, ...items]}
                onValueChange={(next) => setSecond(next ?? "")}
              >
                <SelectTrigger size="sm" aria-label="Second sweep parameter">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">No second parameter</SelectItem>
                  {items
                    .filter((item) => item.value !== firstAxis)
                    .map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                </SelectPopup>
              </Select>
              <Input
                size="sm"
                aria-label="Second sweep values"
                placeholder="e.g. 2, 3"
                disabled={!secondAxis}
                value={secondValues}
                onChange={(event) => setSecondValues(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {firstValues.trim() && !preview.error
                ? `Makes ${preview.candidates.length} variant${preview.candidates.length === 1 ? "" : "s"}.`
                : "Switches take true or false. Text values do not need quotes."}
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive-foreground">
                {error}
              </p>
            )}
            {adding && <OperationStatus label="Saving variants" />}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={adding} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={adding || !firstAxis || !firstValues.trim()}>
              {preview.candidates.length && !preview.error
                ? `Make ${preview.candidates.length} variant${preview.candidates.length === 1 ? "" : "s"}`
                : "Make variants"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Variants tab: thumbnails of saved value combinations to render, compare and promote. */
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
  const [saveCandidate, setSaveCandidate] = useState<SaveCandidate | null>(null);
  const [candidateSetName, setSetName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [sweepOpen, setSweepOpen] = useState(false);
  const parameters = session?.data.parameters;
  const selection = selected.filter((id) => data.variants.some((variant) => variant.id === id));
  const chosen = useMemo(
    () =>
      data.variants
        .filter((variant) => selection.includes(variant.id))
        .map((variant) => ({
          ...variant,
          values: parameters ? rebaseParameterValues(parameters, variant.values) : variant.values,
        })),
    [data.variants, selection, parameters],
  );
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [queue, setQueue] = useState<readonly string[]>([]);
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
    setQueue([]);
    if (id)
      void runModelCommand(models.cancelVariant, {
        environmentId: threadRef.environmentId,
        input: { file: { threadId: threadRef.threadId, path }, variantId: id },
      }).catch(() => undefined);
  }, [threadRef.environmentId, threadRef.threadId, path]);
  useEffect(() => stop, [stop]);
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Source replacement cancels the external render process and its thumbnail work.
  useEffect(() => stop, [session?.data.sourceRevision, stop]);
  /** Saves candidates and resolves with their ids, or null when nothing was saved. */
  const add = async (candidates: readonly SaveCandidate[]) => {
    if (!session || adding) return null;
    setAdding(true);
    setError(null);
    try {
      if (data.variants.length + candidates.length > VARIANT_LIMIT)
        throw new Error(
          `Keep up to ${VARIANT_LIMIT} variants. Delete some before adding ${candidates.length === 1 ? "another" : "more"}.`,
        );
      const ids: string[] = [];
      for (const candidate of candidates) {
        const id = randomUUID();
        const saved = await mutate({
          kind: "variant",
          item: {
            id,
            name:
              candidate.name.slice(0, 100) || `Variant ${data.variants.length + ids.length + 1}`,
            values: candidate.values,
            sourceRevision: session.data.sourceRevision,
            thumbnail: null,
            dimensions: null,
            triangles: null,
            renderedRevision: null,
            origin: "user",
          },
        });
        if (!saved) break;
        ids.push(id);
      }
      return ids.length ? ids : null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setAdding(false);
    }
  };
  /** Renders the given variants one at a time and stores a thumbnail for each. */
  const render = async (ids: readonly string[], override?: ModelVariant) => {
    if (!session || running || !ids.length) return;
    const token = ++generation.current;
    setError(null);
    setMessage(null);
    setRunning("Preparing variant batch");
    const candidates = ids.flatMap((id) => {
      const variant = override?.id === id ? override : data.variants.find((item) => item.id === id);
      return variant ? [variant] : [];
    });
    setQueue(candidates.map((variant) => variant.id));
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
          if (token === generation.current) {
            setBatchProgress((current) => ({ ...current, completed: index + 1 }));
            setQueue((current) => current.filter((id) => id !== candidate.id));
          }
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
        setQueue([]);
        activeVariant.current = null;
      }
    }
  };

  if (!session)
    return (
      <div className={styles["model-inspector-scroll"]}>
        <div className="h-4" />
        <EmptyNote>Variants appear when the OpenSCAD file finishes loading.</EmptyNote>
      </div>
    );
  const defaults = parameterValues(session.data.parameters, {});
  const addAndRender = (candidates: readonly SaveCandidate[]) =>
    add(candidates).then((ids) => {
      if (ids) void render(ids);
      return !!ids;
    });
  const use = (name: string, values: Readonly<Record<string, string>>) => {
    session.promote(rebaseParameterValues(session.data.parameters, values), name);
    setError(null);
  };
  const remove = (ids: readonly string[]) => {
    for (const id of ids) void mutate({ kind: "remove", collection: "variants", id });
    setSelected((current) => current.filter((id) => !ids.includes(id)));
  };
  const openSaveSet = (candidate: SaveCandidate) => {
    setSaveError(null);
    setSaveCandidate(candidate);
    setSetName(candidate.name);
  };
  const detail = data.variants.find((variant) => variant.id === detailId);
  const unrendered = data.variants.filter((variant) => !variant.thumbnail).map((v) => v.id);
  const full = data.variants.length >= VARIANT_LIMIT;
  const dialogs = (
    <>
      <SweepDialog
        key={String(sweepOpen)}
        open={sweepOpen}
        onOpenChange={setSweepOpen}
        session={session}
        adding={adding}
        onGenerate={addAndRender}
      />
      <Dialog
        open={!!saveCandidate}
        onOpenChange={(open) => {
          if (!open && !saving) setSaveCandidate(null);
        }}
      >
        <DialogPopup>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!saveCandidate || saving || !candidateSetName.trim()) return;
              setSaving(true);
              setSaveError(null);
              void session
                .saveSet(
                  candidateSetName.trim(),
                  rebaseParameterValues(session.data.parameters, saveCandidate.values),
                )
                .then(() => setSaveCandidate(null))
                .catch((cause) =>
                  setSaveError(cause instanceof Error ? cause.message : String(cause)),
                )
                .finally(() => setSaving(false));
            }}
          >
            <DialogHeader>
              <DialogTitle>Save as parameter set</DialogTitle>
              <DialogDescription>
                The set appears in the Customize tab and in the OpenSCAD customizer.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <label className="flex flex-col gap-2 text-sm">
                Set name
                <Input
                  autoFocus
                  value={candidateSetName}
                  onChange={(event) => setSetName(event.target.value)}
                  maxLength={100}
                />
              </label>
              {session.data.sets.includes(candidateSetName.trim()) && (
                <p className="text-sm text-muted-foreground">
                  This replaces “{candidateSetName.trim()}”. Other saved sets are preserved.
                </p>
              )}
              {saveError && (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {saveError}
                </p>
              )}
              {saving && <OperationStatus label="Saving parameter set" />}
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setSaveCandidate(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !candidateSetName.trim()}>
                {saving
                  ? "Saving..."
                  : session.data.sets.includes(candidateSetName.trim())
                    ? "Replace set"
                    : "Save set"}
              </Button>
            </DialogFooter>
          </form>
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
              <XIcon />
            </DialogPrimitive.Close>
            <DialogHeader>
              <DialogTitle>Compare variants</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <p className="mb-3 text-xs text-muted-foreground">
                Both views move together. Drag either one to look around.
              </p>
              <div className={styles["model-compare-grid"]}>
                {chosen.slice(0, 2).map((variant) => (
                  <ComparePane
                    key={comparisonKey(variant)}
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
                <dl className={styles["model-facts"]} data-compare>
                  {(["Width", "Depth", "Height"] as const).map((label, index) => {
                    const a = compareDimensions[comparisonKey(chosen[0]!)];
                    const b = compareDimensions[comparisonKey(chosen[1]!)];
                    const delta = a && b ? b[index]! - a[index]! : 0;
                    return (
                      <Fragment key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {a && b
                            ? `${a[index]!.toFixed(1)} → ${b[index]!.toFixed(1)} mm${delta ? ` (${delta > 0 ? "+" : ""}${delta.toFixed(1)})` : ""}`
                            : "Measuring"}
                        </dd>
                      </Fragment>
                    );
                  })}
                  {changedParameters(
                    session.data.parameters,
                    chosen[1]!.values,
                    chosen[0]!.values,
                  ).map((parameter) => (
                    <Fragment key={parameter.name}>
                      <dt>{parameterLabel(parameter.name)}</dt>
                      <dd>
                        {displayParameterValue(parameter, chosen[0]!.values[parameter.name]!)} →{" "}
                        {displayParameterValue(parameter, chosen[1]!.values[parameter.name]!)}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              )}
            </DialogPanel>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </Dialog>
    </>
  );
  if (detail)
    return (
      <>
        <VariantDetail
          key={detail.id}
          variant={detail}
          session={session}
          volume={volume}
          mutate={mutate}
          rendering={queue.includes(detail.id)}
          onBack={() => setDetailId(null)}
          onRender={(variant) => void render([variant.id], variant)}
          onUse={(values) => use(detail.name, values)}
          onSaveSet={openSaveSet}
          onDuplicate={(candidate) =>
            void add([candidate]).then((ids) => {
              if (ids) {
                setDetailId(ids[0]!);
                void render(ids);
              }
            })
          }
          onDelete={() => {
            remove([detail.id]);
            setDetailId(null);
          }}
        />
        {dialogs}
      </>
    );
  return (
    <>
      <div className={styles["model-inspector-scroll"]} data-selecting={selection.length > 0}>
        <SectionHead title="Variants" count={data.variants.length || undefined}>
          <Tip
            label={
              unrendered.length
                ? `${unrendered.length} not rendered yet`
                : "Render every variant again"
            }
          >
            <Button
              variant="ghost-muted"
              size="xs"
              disabled={!!running || !data.variants.length}
              onClick={() =>
                void render(unrendered.length ? unrendered : data.variants.map((v) => v.id))
              }
            >
              <PlayIcon />
              Render all
            </Button>
          </Tip>
          <Menu>
            <MenuTrigger render={<Button variant="outline" size="xs" disabled={full || adding} />}>
              <PlusIcon />
              New
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => void addAndRender([{ name: "", values: session.values }])}>
                <CopyIcon />
                From current values
              </MenuItem>
              {session.data.sets.length > 0 && (
                <MenuGroup>
                  <MenuGroupLabel>From a parameter set</MenuGroupLabel>
                  {session.data.sets.map((name) => (
                    <MenuItem
                      key={name}
                      onClick={() =>
                        void addAndRender([
                          { name, values: { ...defaults, ...session.data.setValues[name] } },
                        ])
                      }
                    >
                      <BookmarkIcon />
                      {name}
                    </MenuItem>
                  ))}
                </MenuGroup>
              )}
              <MenuSeparator />
              <MenuItem onClick={() => setSweepOpen(true)}>
                <LayersIcon />
                Parameter sweep
                <MenuShortcut>Up to 12</MenuShortcut>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </SectionHead>
        {running && (
          <div className={styles["model-batch"]} role="status">
            <span>
              Rendering {Math.min(batchProgress.completed + 1, batchProgress.total)} of{" "}
              {batchProgress.total}
            </span>
            <progress
              aria-label={running}
              max={Math.max(1, batchProgress.total)}
              value={batchProgress.completed}
            />
            <Button
              variant="ghost-muted"
              size="xs"
              onClick={() => {
                stop();
                setMessage("Rendering stopped.");
              }}
            >
              Cancel
            </Button>
          </div>
        )}
        {adding && <OperationStatus label="Saving variants" />}
        {message && !running && (
          <p role="status" className={styles["model-help"]}>
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className={styles["model-help"]} data-tone="error">
            {error}
          </p>
        )}
        {data.variants.length ? (
          <div className={styles["model-variant-grid"]}>
            {data.variants.map((variant) => {
              const values = rebaseParameterValues(session.data.parameters, variant.values);
              const isSelected = selection.includes(variant.id);
              const inUse = same(values, session.values);
              const oversized = variant.dimensions && !fitsBuildVolume(variant.dimensions, volume);
              const stale =
                !!variant.thumbnail && variant.renderedRevision !== session.data.sourceRevision;
              const toggle = () =>
                setSelected((current) =>
                  isSelected ? current.filter((id) => id !== variant.id) : [...current, variant.id],
                );
              return (
                <div
                  key={variant.id}
                  className={styles["model-variant-card"]}
                  data-selected={isSelected}
                  role="button"
                  tabIndex={0}
                  aria-label={variant.name}
                  onClick={() => (selection.length ? toggle() : setDetailId(variant.id))}
                  onDoubleClick={() => use(variant.name, values)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter") setDetailId(variant.id);
                    else if (event.key === " ") {
                      event.preventDefault();
                      toggle();
                    }
                  }}
                >
                  <div className={styles["model-variant-thumb"]}>
                    {variant.thumbnail ? (
                      <img src={variant.thumbnail} alt="" />
                    ) : queue.includes(variant.id) ? (
                      <span className={styles["model-variant-queued"]}>
                        {queue[0] === variant.id ? "Rendering" : "Queued"}
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!!running}
                        onClick={(event) => {
                          event.stopPropagation();
                          void render([variant.id]);
                        }}
                      >
                        <PlayIcon />
                        Render
                      </Button>
                    )}
                    {inUse ? (
                      <Chip tone="primary">In use</Chip>
                    ) : oversized ? (
                      <Chip tone="warning">Too large</Chip>
                    ) : stale ? (
                      <Chip>Out of date</Chip>
                    ) : null}
                  </div>
                  <span
                    className={styles["model-variant-check"]}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      aria-label={`Select ${variant.name}`}
                      checked={isSelected}
                      onCheckedChange={toggle}
                    />
                  </span>
                  <span
                    className={styles["model-variant-menu"]}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            variant="outline"
                            size="icon-xs"
                            aria-label={`${variant.name} actions`}
                          />
                        }
                      >
                        <EllipsisIcon />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem disabled={inUse} onClick={() => use(variant.name, values)}>
                          <CheckIcon />
                          Use these values
                        </MenuItem>
                        <MenuItem onClick={() => setDetailId(variant.id)}>
                          <SlidersHorizontalIcon />
                          Edit values
                        </MenuItem>
                        <MenuItem disabled={!!running} onClick={() => void render([variant.id])}>
                          <PlayIcon />
                          {variant.thumbnail ? "Render again" : "Render"}
                        </MenuItem>
                        <MenuItem onClick={() => openSaveSet({ name: variant.name, values })}>
                          <BookmarkIcon />
                          Save as parameter set
                        </MenuItem>
                        <MenuItem onClick={() => setRenaming(variant.id)}>
                          <PencilIcon />
                          Rename
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem variant="destructive" onClick={() => remove([variant.id])}>
                          <Trash2Icon />
                          Delete
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </span>
                  <div className={styles["model-variant-meta"]}>
                    {renaming === variant.id ? (
                      <RenameInput
                        value={variant.name}
                        label={`Rename ${variant.name}`}
                        onDone={(name) => {
                          if (name) void mutate({ kind: "variant", item: { ...variant, name } });
                          setRenaming(null);
                        }}
                      />
                    ) : (
                      <div className={styles["model-variant-name"]}>
                        {variant.origin === "agent" && (
                          <Tip label="Proposed by the agent">
                            <SparklesIcon />
                          </Tip>
                        )}
                        <span className="truncate">{variant.name}</span>
                      </div>
                    )}
                    <div className={styles["model-variant-diff"]}>
                      {describeValues(session.data.parameters, values, defaults) ||
                        "Source defaults"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyNote>
            Save the current values as a variant to compare designs side by side.
            <Button
              variant="outline"
              size="xs"
              disabled={adding}
              onClick={() => void addAndRender([{ name: "", values: session.values }])}
            >
              <PlusIcon />
              Save current values
            </Button>
          </EmptyNote>
        )}
      </div>
      {selection.length > 0 && (
        <div
          className={styles["model-selection-bar"]}
          role="toolbar"
          aria-label="Selected variants"
        >
          <span>{selection.length} selected</span>
          <div className="flex-1" />
          <Tip label={selection.length === 2 ? "Compare side by side" : "Select two variants"}>
            <Button
              variant="ghost"
              size="xs"
              disabled={selection.length !== 2 || !!running}
              onClick={() => {
                setCamera(null);
                setCompareDimensions({});
                setCompare(true);
              }}
            >
              <Columns2Icon />
              Compare
            </Button>
          </Tip>
          <Button
            variant="ghost"
            size="xs"
            disabled={!!running}
            onClick={() => void render(selection)}
          >
            <PlayIcon />
            Render
          </Button>
          <Tip label="Delete selected">
            <Button
              variant="ghost-destructive"
              size="icon-xs"
              aria-label="Delete selected variants"
              onClick={() => remove(selection)}
            >
              <Trash2Icon />
            </Button>
          </Tip>
          <Tip label="Clear selection">
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Clear selection"
              onClick={() => setSelected([])}
            >
              <XIcon />
            </Button>
          </Tip>
        </div>
      )}
      {dialogs}
    </>
  );
}
