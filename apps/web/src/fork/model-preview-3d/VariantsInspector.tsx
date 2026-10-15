import { useAtomValue } from "@effect/atom-react";
import {
  activeBed,
  MODEL_WORKSPACE_LIMITS,
  type ModelPreviewSettings,
  type SliceResult,
} from "@t3tools/contracts/fork";
import { usePrinterLibrary } from "./printers";
import { startSliceRequest } from "./useSlicing";
import { formatEstimate } from "./slicing";
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
import {
  formatDelta,
  formatLength,
  formatLengths,
  useDisplayPrecision,
  useDisplayUnits,
} from "./units";
import { MAX_VARIANTS, expandVariants, sweepValues, type VariantAxis } from "./variants";
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
import { bedFit, type Plate } from "./buildPlate";
import {
  Chip,
  CopyValue,
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
  plate,
  camera,
  onCamera,
  onDimensions,
}: {
  variant: ModelVariant;
  dimensionKey: string;
  threadRef: ScopedThreadRef;
  path: string;
  plate: Plate;
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
            plate={plate}
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

const VARIANT_LIMIT = MODEL_WORKSPACE_LIMITS.variants;
const SAVE_DELAY_MS = 500;
const same = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  Object.keys({ ...a, ...b }).every((key) => a[key] === b[key]);

type SaveCandidate = { name: string; values: Readonly<Record<string, string>> };

/** Variant detail: hero thumbnail, name and every value, saved shortly after each edit. */
function VariantDetail({
  variant,
  session,
  plate,
  mutate,
  rendering,
  printEstimate,
  estimating,
  canEstimate,
  estimateError,
  onCancelEstimate,
  onEstimate,
  onBack,
  onRender,
  onUse,
  onSaveSet,
  onDuplicate,
  onDelete,
}: {
  variant: ModelVariant;
  session: ScadSession;
  plate: Plate;
  mutate: Mutation;
  rendering: boolean;
  printEstimate: string | null;
  estimating: boolean;
  canEstimate: boolean;
  estimateError: string | null;
  onCancelEstimate: () => void;
  onEstimate: (variant: ModelVariant) => void;
  onBack: () => void;
  onRender: (variant: ModelVariant) => void;
  onUse: (values: Readonly<Record<string, string>>) => void;
  onSaveSet: (candidate: SaveCandidate) => void;
  onDuplicate: (candidate: SaveCandidate) => void;
  onDelete: () => void;
}) {
  const units = useDisplayUnits();
  const precision = useDisplayPrecision();
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
  const fit = variant.dimensions ? bedFit(variant.dimensions, plate.volume) : "fits";
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
            ? `, ${formatLengths(variant.dimensions, units, { digits: 0, precision })}`
            : ""}
          {dirty || fit === "fits"
            ? ""
            : fit === "rotated"
              ? ", fits the plate if rotated 90°"
              : ", too large for the plate"}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          {!dirty && printEstimate && <span>{printEstimate}</span>}
          <Button
            variant="outline"
            size="xs"
            disabled={!canEstimate || estimating || dirty}
            onClick={() => onEstimate(variant)}
          >
            {estimating ? "Estimating..." : "Estimate print"}
          </Button>
          {estimating && (
            <Button variant="ghost-muted" size="xs" onClick={onCancelEstimate}>
              Cancel
            </Button>
          )}
        </div>
        {estimateError && (
          <p role="alert" className="px-3 text-xs text-warning">
            {estimateError}
          </p>
        )}
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
  room,
  saveError,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ScadSession;
  adding: boolean;
  /** Variants the workspace can still keep. */
  room: number;
  saveError: string | null;
  onGenerate: (candidates: SaveCandidate[]) => Promise<boolean>;
}) {
  const eligible = session.data.parameters.filter((parameter) => parameter.kind !== "vector");
  const [first, setFirst] = useState(""),
    [firstValues, setFirstValues] = useState(""),
    [second, setSecond] = useState(""),
    [secondValues, setSecondValues] = useState(""),
    [tried, setTried] = useState(false);
  const firstAxis = eligible.find((p) => p.name === first) ?? eligible[0];
  const secondAxis =
    second !== firstAxis?.name ? eligible.find((p) => p.name === second) : undefined;
  const items = eligible.map((parameter) => ({
    value: parameter.name,
    label: parameterLabel(parameter.name),
  }));
  // Each typed list is read on every keystroke; errors show once the user has tried to submit.
  const plan = (() => {
    const axes: VariantAxis[] = [];
    for (const [parameter, input] of [
      [firstAxis, firstValues],
      [secondAxis, secondValues],
    ] as const) {
      if (!parameter) continue;
      const values = sweepValues(parameter, input);
      if ("error" in values) return { error: `${parameter.name}: ${values.error}` };
      axes.push({ name: parameter.name, values });
    }
    const candidates = expandVariants(session.data.parameters, session.values, axes);
    if ("error" in candidates || candidates.length <= room) return candidates;
    return {
      error: `Keep up to ${VARIANT_LIMIT} variants. ${room ? `${room} more fit; list fewer values or delete some first.` : "Delete some before adding more."}`,
    };
  })();
  const error = "error" in plan ? plan.error : (saveError ?? null);
  const count = "error" in plan ? 0 : plan.length;
  return (
    <Dialog open={open} onOpenChange={(next) => !adding && onOpenChange(next)}>
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if ("error" in plan || adding) return;
            void onGenerate(plan).then((ok) => ok && onOpenChange(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>Parameter sweep</DialogTitle>
            <DialogDescription>
              Make a variant for every combination of the values you list, starting from the current
              values. List up to six values for one parameter, or two parameters for a grid of up to{" "}
              {MAX_VARIANTS}.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className={styles["model-sweep-grid"]}>
              <span>Parameter</span>
              <span>Values</span>
              <Select
                value={firstAxis?.name ?? ""}
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
                aria-invalid={tried && !!error}
                placeholder="e.g. 30, 40, 50"
                value={firstValues}
                onChange={(event) => setFirstValues(event.target.value)}
              />
              <Select
                value={secondAxis?.name ?? ""}
                items={[{ value: "", label: "No second parameter" }, ...items]}
                onValueChange={(next) => setSecond(next ?? "")}
              >
                <SelectTrigger size="sm" aria-label="Second sweep parameter">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">No second parameter</SelectItem>
                  {items
                    .filter((item) => item.value !== firstAxis?.name)
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
              Separate numbers with commas, spaces or semicolons. Switches take true or false, and
              text values do not need quotes.
            </p>
            {tried && error && (
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
            <Button type="submit" disabled={adding || !firstAxis}>
              {count ? `Make ${count} variant${count === 1 ? "" : "s"}` : "Make variants"}
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
  plate,
  onActivity,
  settings,
  active = true,
  slicingEnabled = false,
}: {
  onActivity: (activity: OperationProgress | null) => void;
  settings: ModelPreviewSettings;
  active?: boolean;
  slicingEnabled?: boolean;
  data: ModelWorkspace;
  mutate: Mutation;
  session: ScadSession | null;
  threadRef: ScopedThreadRef;
  path: string;
  plate: Plate;
}) {
  const units = useDisplayUnits();
  const precision = useDisplayPrecision();
  const [error, setError] = useState<string | null>(null);
  const library = usePrinterLibrary(threadRef.environmentId);
  const bedId = activeBed(settings.buildPlate, { library }).id;
  const canSlice = useAtomValue(models.slice.permissionAtom(threadRef.environmentId));
  const [printResults, setPrintResults] = useState<
    Record<string, { key: string; result: SliceResult }>
  >({});
  const [sliceBatch, setSliceBatch] = useState<{
    name: string;
    completed: number;
    total: number;
  } | null>(null);
  const sliceLease = useRef<ReturnType<typeof startSliceRequest> | null>(null),
    sliceGeneration = useRef(0);
  const printKey = (variant: ModelVariant) =>
    JSON.stringify([
      threadRef.environmentId,
      threadRef.threadId,
      path,
      variant.values,
      session?.data.sourceRevision,
      data.orientation?.quaternion,
      bedId,
      settings.slicer.mappings[bedId],
      settings.slicer.paths,
      settings.slicer.currency,
      library?.materials,
      library?.printers.find((printer) => printer.id === bedId)?.defaultMaterialId,
    ]);
  const cancelSlicing = useCallback(() => {
    sliceGeneration.current++;
    sliceLease.current?.cancel();
    sliceLease.current = null;
    setSliceBatch(null);
  }, []);
  const estimateVariants = useEffectEvent(
    async (candidates: readonly ModelVariant[], cachedOnly = false) => {
      if (!slicingEnabled || !canSlice || !session) return;
      cancelSlicing();
      const token = sliceGeneration.current;
      try {
        for (const [index, variant] of (cachedOnly
          ? candidates
          : candidates.slice(0, 12)
        ).entries()) {
          if (token !== sliceGeneration.current) break;
          if (!cachedOnly)
            setSliceBatch({
              name: variant.name,
              completed: index,
              total: Math.min(candidates.length, 12),
            });
          const key = printKey(variant);
          const lease = startSliceRequest(threadRef.environmentId, {
            file: { threadId: threadRef.threadId, path },
            overrides: rebaseParameterValues(session.data.parameters, variant.values),
            parameterSet: null,
            variantId: variant.id,
            bedId,
            cachedOnly,
          });
          sliceLease.current = lease;
          const result = await lease.promise;
          if (token !== sliceGeneration.current) break;
          if (result.status === "ok")
            setPrintResults((current) => ({ ...current, [variant.id]: { key, result } }));
          else if (!cachedOnly)
            throw new Error(
              `${variant.name}: ${result.warnings[0] ?? "Slicing did not produce an estimate."}`,
            );
        }
      } catch (cause) {
        if (token === sliceGeneration.current && !cachedOnly)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (token === sliceGeneration.current) {
          sliceLease.current = null;
          setSliceBatch(null);
        }
      }
    },
  );
  const variantsKey = JSON.stringify(data.variants.map(printKey));
  /* oxlint-disable react/exhaustive-effect-dependencies, react/set-state-in-effect -- Source, values and profiles invalidate cached estimates and release their RPC leases. */
  useEffect(() => {
    cancelSlicing();
    if (active && slicingEnabled && session) void estimateVariants(data.variants, true);
    return cancelSlicing;
  }, [variantsKey, active, slicingEnabled, canSlice, session?.data.sourceRevision, cancelSlicing]);
  /* oxlint-enable react/exhaustive-effect-dependencies, react/set-state-in-effect */
  const estimateLabel = (variant: ModelVariant) => {
    const saved = printResults[variant.id];
    return saved?.result.estimate
      ? `${saved.key !== printKey(variant) ? "Out of date: " : ""}${formatEstimate(saved.result.estimate)}`
      : null;
  };
  const [saveCandidate, setSaveCandidate] = useState<SaveCandidate | null>(null);
  const [candidateSetName, setSetName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [sweepOpen, setSweepOpen] = useState(false);
  // The latest sweep's variants until each is kept or the set is discarded.
  const [generatedIds, setGenerated] = useState<readonly string[]>([]);
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
  const [running, setRunning] = useState<string | null>(null);
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0, detail: "" });
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    onActivity(
      running
        ? { label: running, ...batchProgress }
        : sliceBatch
          ? {
              label: "Estimating prints",
              completed: sliceBatch.completed,
              total: sliceBatch.total,
              detail: sliceBatch.name,
            }
          : null,
    );
    return () => onActivity(null);
  }, [running, batchProgress, sliceBatch, onActivity]);
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
  /** Saves candidates and resolves with the saved variants, or null when nothing was saved. */
  const add = async (candidates: readonly SaveCandidate[]) => {
    if (!session || adding) return null;
    setAdding(true);
    setError(null);
    try {
      if (data.variants.length + candidates.length > VARIANT_LIMIT)
        throw new Error(
          `Keep up to ${VARIANT_LIMIT} variants. Delete some before adding ${candidates.length === 1 ? "another" : "more"}.`,
        );
      const added: ModelVariant[] = [];
      for (const candidate of candidates) {
        const item: ModelVariant = {
          id: randomUUID(),
          name:
            candidate.name.slice(0, 100) || `Variant ${data.variants.length + added.length + 1}`,
          values: candidate.values,
          sourceRevision: session.data.sourceRevision,
          thumbnail: null,
          dimensions: null,
          triangles: null,
          renderedRevision: null,
          origin: "user",
        };
        if (!(await mutate({ kind: "variant", item }))) break;
        added.push(item);
      }
      return added.length ? added : null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setAdding(false);
    }
  };
  /**
   * Renders the given variants one at a time and stores a thumbnail for each. Variants saved
   * moments ago may not have reached this render's workspace data yet, so callers pass them.
   */
  const render = async (ids: readonly string[], known: readonly ModelVariant[] = []) => {
    if (!session || running || !ids.length) return;
    const token = ++generation.current;
    setError(null);
    setMessage(null);
    setRunning("Preparing variant batch");
    const candidates = ids.flatMap((id) => {
      const variant =
        known.find((item) => item.id === id) ??
        latestVariants.current.find((item) => item.id === id) ??
        data.variants.find((item) => item.id === id);
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
          viewer.setOrientation(data.orientation?.quaternion ?? null);
          viewer.setBed([plate.volume[0], plate.volume[1]], plate.pattern);
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
      if (token === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
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
    add(candidates).then((added) => {
      if (added)
        void render(
          added.map((item) => item.id),
          added,
        );
      return !!added;
    });
  const use = (name: string, values: Readonly<Record<string, string>>) => {
    session.promote(rebaseParameterValues(session.data.parameters, values), name);
    setError(null);
  };
  const remove = (ids: readonly string[]) => {
    for (const id of ids) void mutate({ kind: "remove", collection: "variants", id });
    setSelected((current) => current.filter((id) => !ids.includes(id)));
    setGenerated((current) => current.filter((id) => !ids.includes(id)));
  };
  const sweep = (candidates: readonly SaveCandidate[]) =>
    add(candidates).then((added) => {
      if (added) {
        const ids = added.map((item) => item.id);
        setGenerated(ids);
        void render(ids, added);
      }
      return !!added;
    });
  const generated = generatedIds.flatMap((id) => {
    const variant = data.variants.find((item) => item.id === id);
    return variant ? [variant] : [];
  });
  /** Promotes a generated variant to the working values; the card stays as a saved variant. */
  const keep = (variant: ModelVariant, values: Readonly<Record<string, string>>) => {
    use(variant.name, values);
    setGenerated((current) => current.filter((id) => id !== variant.id));
    setMessage(`Kept ${variant.name}.`);
  };
  /** Deletes every generated variant not yet kept, stopping their renders first. */
  const discardGenerated = () => {
    if (queue.some((id) => generatedIds.includes(id))) stop();
    remove(generatedIds);
    setGenerated([]);
    setMessage(null);
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
        room={VARIANT_LIMIT - data.variants.length}
        saveError={error}
        onGenerate={sweep}
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
                    plate={plate}
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
                    // A change that rounds to zero at the shown precision has no sign and is not shown.
                    const change = formatDelta(delta, units, { precision });
                    const changed = change.startsWith("+") || change.startsWith("\u2212");
                    return (
                      <Fragment key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {a && b ? (
                            <>
                              {formatLength(a[index]!, units, { unit: false, precision })} →{" "}
                              {formatLength(b[index]!, units, { unit: false, precision })} {units}
                              {changed ? (
                                <>
                                  {" ("}
                                  <CopyValue
                                    text={change}
                                    label={`Copy ${label.toLowerCase()} change, ${change}`}
                                  >
                                    {formatDelta(delta, units, { unit: false, precision })}
                                  </CopyValue>
                                  )
                                </>
                              ) : null}
                            </>
                          ) : (
                            "Measuring"
                          )}
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
          plate={plate}
          mutate={mutate}
          rendering={queue.includes(detail.id)}
          printEstimate={estimateLabel(detail)}
          estimating={sliceBatch !== null}
          canEstimate={slicingEnabled && canSlice}
          estimateError={error}
          onCancelEstimate={cancelSlicing}
          onEstimate={(variant) => void estimateVariants([variant])}
          onBack={() => setDetailId(null)}
          onRender={(variant) => void render([variant.id], [variant])}
          onUse={(values) => use(detail.name, values)}
          onSaveSet={openSaveSet}
          onDuplicate={(candidate) =>
            void add([candidate]).then((added) => {
              if (added) {
                setDetailId(added[0]!.id);
                void render([added[0]!.id], added);
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
                <MenuShortcut>Up to {MAX_VARIANTS}</MenuShortcut>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </SectionHead>
        {slicingEnabled && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Button
              variant="outline"
              size="xs"
              disabled={!canSlice || sliceBatch !== null || !data.variants.length}
              onClick={() => void estimateVariants(chosen.length ? chosen : data.variants)}
            >
              Estimate {chosen.length ? "selected" : "visible"} prints
            </Button>
            <span className="text-xs text-muted-foreground">Up to 12 at a time</span>
          </div>
        )}
        {sliceBatch && (
          <div className={styles["model-batch"]} role="status">
            <span>
              Estimating {sliceBatch.name} ({sliceBatch.completed + 1} of {sliceBatch.total})
            </span>
            <progress
              aria-label="Estimating variants"
              max={sliceBatch.total}
              value={sliceBatch.completed}
            />
            <Button variant="ghost-muted" size="xs" onClick={cancelSlicing}>
              Cancel
            </Button>
          </div>
        )}
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
                setMessage("Rendering stopped. Finished variants keep their thumbnails.");
              }}
            >
              Stop
            </Button>
          </div>
        )}
        {adding && <OperationStatus label="Saving variants" />}
        {generated.length > 0 && (
          <div className={styles["model-batch"]}>
            <span className="flex-1">
              Sweep of {generated.length} variant{generated.length === 1 ? "" : "s"}. Keep one to
              use its values.
            </span>
            <Button variant="ghost-muted" size="xs" onClick={discardGenerated}>
              Discard all
            </Button>
          </div>
        )}
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
              const fit = variant.dimensions ? bedFit(variant.dimensions, plate.volume) : "fits";
              const stale =
                !!variant.thumbnail && variant.renderedRevision !== session.data.sourceRevision;
              const isGenerated = generatedIds.includes(variant.id);
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
                    ) : fit !== "fits" ? (
                      <Chip tone="warning">{fit === "rotated" ? "Fits rotated" : "Too large"}</Chip>
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
                    {estimateLabel(variant) && (
                      <div className={styles["model-variant-diff"]}>{estimateLabel(variant)}</div>
                    )}
                    <div className={styles["model-variant-diff"]}>
                      {describeValues(session.data.parameters, values, defaults) ||
                        "Source defaults"}
                    </div>
                    {variant.dimensions && (
                      <div className={styles["model-variant-size"]}>
                        {formatLengths(variant.dimensions, units, { precision, trim: true })}
                      </div>
                    )}
                    {isGenerated && (
                      <Button
                        className="mt-2"
                        variant="outline"
                        size="xs"
                        aria-label={`Keep ${variant.name}`}
                        disabled={!variant.thumbnail || queue.includes(variant.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          keep(variant, values);
                        }}
                      >
                        <CheckIcon />
                        Keep
                      </Button>
                    )}
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
