import { useState } from "react";
import type {
  ModelWorkspace,
  ModelWorkspaceOperation,
  ModelSection,
  ModelCamera,
  ModelPoint,
  ModelAnnotation,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { EyeIcon, EyeOffIcon, Trash2Icon, CameraIcon, PlusIcon } from "lucide-react";
import { ModelTool } from "./WorkspaceTools";
import styles from "./workspace.module.css";
import { randomUUID } from "~/lib/utils";
type Mutation = (operation: ModelWorkspaceOperation) => Promise<unknown>;
export function ItemName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  return (
    <Input
      size="sm"
      aria-label={`Rename ${name}`}
      maxLength={100}
      defaultValue={name}
      key={name}
      onBlur={(event) => {
        const next = event.target.value.trim();
        if (next && next !== name) onRename(next);
        else event.target.value = name;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
function Remove({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <ModelTool label={label} onClick={onClick}>
      <Trash2Icon />
    </ModelTool>
  );
}
export function ToolsInspector({
  data,
  mutate,
  sourceRevision,
  section,
  onSection,
  picking,
  onPicking,
  pendingPoint,
}: {
  data: ModelWorkspace;
  mutate: Mutation;
  sourceRevision: string;
  section: ModelSection;
  onSection: (section: ModelSection) => void;
  picking: "measure" | "annotate" | null;
  onPicking: (mode: "measure" | "annotate" | null) => void;
  pendingPoint: ModelPoint | null;
}) {
  return (
    <div className={styles["model-inspector-scroll"]}>
      <div className={styles["model-inspector-page"]}>
        <h3 className={styles["model-section-title"]}>Section plane</h3>
        <label className={styles["model-preview-switch"]}>
          Reveal the interior
          <Switch
            size="sm"
            checked={section.enabled}
            onCheckedChange={(enabled) => onSection({ ...section, enabled })}
          />
        </label>
        {section.enabled && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex gap-1" role="group" aria-label="Section axis">
              {(["x", "y", "z"] as const).map((axis) => (
                <button
                  className={styles["model-tool"]}
                  key={axis}
                  aria-pressed={section.axis === axis}
                  onClick={() => onSection({ ...section, axis })}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="text-xs text-muted-foreground">
              Position / mm
              <Input
                size="sm"
                type="number"
                aria-label="Section position"
                value={section.offset}
                onChange={(event) => {
                  const offset = event.target.valueAsNumber;
                  if (Number.isFinite(offset)) onSection({ ...section, offset });
                }}
              />
            </label>
            <label className={styles["model-preview-switch"]}>
              Flip retained side
              <Switch
                size="sm"
                checked={section.flipped}
                onCheckedChange={(flipped) => onSection({ ...section, flipped })}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              A visual cut through the mesh. Source geometry stays intact.
            </p>
          </div>
        )}
        <h3 className={styles["model-section-title"] + " mt-6"}>Measurements</h3>
        <Button
          size="sm"
          variant={picking === "measure" ? "default" : "outline"}
          onClick={() => onPicking(picking === "measure" ? null : "measure")}
        >
          {picking === "measure" ? "Finish measuring" : "Measure two points"}
        </Button>
        <p className="my-3 text-xs leading-relaxed text-muted-foreground">
          {picking === "measure"
            ? pendingPoint
              ? "Pick the second point on the model. Escape cancels."
              : "Pick the first point on the model."
            : "Distances are measured on triangle surfaces in millimetres."}
        </p>
        {data.measurements.map((item) => {
          const delta = item.end.map((v, i) => v - item.start[i]!);
          const stale = item.sourceRevision !== sourceRevision;
          return (
            <div className={styles["model-edit-item"]} key={item.id}>
              <div className="flex items-center gap-1">
                <ItemName
                  name={item.name}
                  onRename={(name) => void mutate({ kind: "measurement", item: { ...item, name } })}
                />
                <ModelTool
                  label={item.visible ? `Hide ${item.name}` : `Show ${item.name}`}
                  onClick={() =>
                    void mutate({ kind: "measurement", item: { ...item, visible: !item.visible } })
                  }
                >
                  {item.visible ? <EyeIcon /> : <EyeOffIcon />}
                </ModelTool>
                <Remove
                  label={`Delete ${item.name}`}
                  onClick={() =>
                    void mutate({ kind: "remove", collection: "measurements", id: item.id })
                  }
                />
              </div>
              <strong className="block mt-2 text-sm tabular-nums">
                {Math.hypot(...delta).toFixed(2)} mm
              </strong>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                ΔX {delta[0]!.toFixed(2)} · ΔY {delta[1]!.toFixed(2)} · ΔZ {delta[2]!.toFixed(2)}
              </p>
              {stale && (
                <p className="mt-2 text-xs text-warning-foreground">
                  Model changed. Re-measure before relying on this distance.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function ViewsInspector({
  data,
  mutate,
  camera,
  sourceRevision,
  onRecall,
  onCapture,
  disabled,
}: {
  data: ModelWorkspace;
  mutate: Mutation;
  camera: () => ModelCamera | null;
  sourceRevision: string;
  onRecall: (camera: ModelCamera, refit: boolean) => void;
  onCapture: (ids: readonly string[], measurements: boolean, name: string) => Promise<void>;
  disabled: boolean;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const selectedViews = selected.filter((id) => data.views.some((view) => view.id === id));
  const [include, setInclude] = useState(true);
  const [busy, setBusy] = useState(false);
  const capture = async (ids: readonly string[], measurements: boolean, title: string) => {
    setBusy(true);
    try {
      await onCapture(ids, measurements, title);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles["model-inspector-scroll"]}>
      <div className={styles["model-inspector-page"]}>
        <h3 className={styles["model-section-title"]}>Named views</h3>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Save a camera, display settings and section plane. Select up to four views for a
          repeatable review sheet.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = camera();
            if (!value || !name.trim()) return;
            void mutate({
              kind: "view",
              item: { id: randomUUID(), name: name.trim(), sourceRevision, camera: value },
            }).then((result) => {
              if (result) setName("");
            });
          }}
        >
          <Input
            size="sm"
            aria-label="View name"
            placeholder="e.g. Mounting underside"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Save current view"
            disabled={disabled || !name.trim()}
          >
            <PlusIcon />
          </Button>
        </form>
        {data.views.map((view) => (
          <div className={styles["model-edit-item"]} key={view.id}>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Include ${view.name} in sheet`}
                checked={selected.includes(view.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, view.id].slice(-4)
                      : current.filter((id) => id !== view.id),
                  )
                }
              />
              <ItemName
                name={view.name}
                onRename={(name) => void mutate({ kind: "view", item: { ...view, name } })}
              />
              <Remove
                label={`Delete ${view.name}`}
                onClick={() => void mutate({ kind: "remove", collection: "views", id: view.id })}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRecall(view.camera, view.sourceRevision !== sourceRevision)}
              >
                Recall{view.sourceRevision !== sourceRevision ? " and refit" : ""}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const value = camera();
                  if (value)
                    void mutate({ kind: "view", item: { ...view, camera: value, sourceRevision } });
                }}
              >
                Update view
              </Button>
            </div>
          </div>
        ))}
        <h3 className={styles["model-section-title"] + " mt-6"}>Capture presets</h3>
        <label className={styles["model-preview-switch"]}>
          Include measurements
          <Switch size="sm" checked={include} onCheckedChange={setInclude} />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || disabled || !selectedViews.length}
            onClick={() => void capture(selectedViews, include, "Review sheet")}
          >
            <CameraIcon />
            Capture selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!name.trim() || !selectedViews.length}
            onClick={() =>
              void mutate({
                kind: "preset",
                item: {
                  id: randomUUID(),
                  name: name.trim(),
                  viewIds: selectedViews,
                  includeMeasurements: include,
                },
              }).then((result) => {
                if (result) setName("");
              })
            }
          >
            Save preset
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Use the name field above to name your preset.
        </p>
        {data.presets.map((preset) => (
          <div className={styles["model-edit-item"]} key={preset.id}>
            <div className="flex items-center gap-1">
              <ItemName
                name={preset.name}
                onRename={(name) => void mutate({ kind: "preset", item: { ...preset, name } })}
              />
              <Remove
                label={`Delete ${preset.name}`}
                onClick={() =>
                  void mutate({ kind: "remove", collection: "presets", id: preset.id })
                }
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || disabled}
              onClick={() => void capture(preset.viewIds, preset.includeMeasurements, preset.name)}
            >
              {preset.viewIds.length} views · Capture
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
export function ReviewInspector({
  data,
  mutate,
  sourceRevision,
  pending,
  onCancel,
  onAdd,
  onRequest,
  onRelink,
  onReview,
  disabled,
}: {
  data: ModelWorkspace;
  mutate: Mutation;
  sourceRevision: string;
  pending: ModelPoint[] | null;
  onCancel: () => void;
  onAdd: (name: string, request: string) => Promise<boolean>;
  onRequest: (annotation: ModelAnnotation) => Promise<void>;
  onRelink: (annotation: ModelAnnotation) => void;
  onReview: (annotation: ModelAnnotation) => Promise<string>;
  disabled: boolean;
}) {
  const [name, setName] = useState("");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentImages, setCurrentImages] = useState<
    Record<string, { image: string; revision: string }>
  >({});
  const work = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles["model-inspector-scroll"]}>
      <div className={styles["model-inspector-page"]}>
        <h3 className={styles["model-section-title"]}>Model review</h3>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Select the annotate tool, then click a surface or drag across a region. Your request
          includes a marked image, coordinates and the applied parameters.
        </p>
        {pending && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void work(async () => {
                if (await onAdd(name.trim() || "Selected region", request.trim())) {
                  setName("");
                  setRequest("");
                }
              });
            }}
          >
            <Input
              size="sm"
              aria-label="Annotation name"
              placeholder="e.g. Cable opening"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <Textarea
              aria-label="Requested model change"
              placeholder="Describe what should change here..."
              value={request}
              maxLength={4000}
              onChange={(e) => setRequest(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!request.trim() || busy || disabled}>
                Save annotation
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {data.annotations.map((annotation) => {
          const changed = annotation.sourceRevision !== sourceRevision;
          return (
            <div className={styles["model-edit-item"]} key={annotation.id}>
              <div className="flex items-center gap-1">
                <ItemName
                  name={annotation.name}
                  onRename={(name) =>
                    void mutate({ kind: "annotation", item: { ...annotation, name } })
                  }
                />
                <Remove
                  label={`Delete ${annotation.name}`}
                  onClick={() =>
                    void mutate({ kind: "remove", collection: "annotations", id: annotation.id })
                  }
                />
              </div>
              <Textarea
                aria-label={`Request for ${annotation.name}`}
                defaultValue={annotation.request}
                key={annotation.request}
                maxLength={4000}
                onBlur={(event) => {
                  const request = event.target.value.trim();
                  if (request && request !== annotation.request)
                    void mutate({ kind: "annotation", item: { ...annotation, request } });
                }}
              />
              <p className="my-2 text-xs text-muted-foreground">
                {annotation.status === "accepted"
                  ? annotation.reviewedRevision === sourceRevision
                    ? "Accepted"
                    : "Accepted an earlier revision. The model changed; review it again."
                  : changed
                    ? "Model changed. Review the result or reselect this region."
                    : annotation.status === "review"
                      ? "Request prepared for the agent"
                      : "Open request"}
              </p>
              {annotation.referenceImage && (
                <img
                  className={styles["model-review-image"]}
                  src={annotation.referenceImage}
                  alt={`Original marked view for ${annotation.name}`}
                />
              )}{" "}
              {currentImages[annotation.id]?.revision === sourceRevision && (
                <img
                  className={styles["model-review-image"]}
                  src={currentImages[annotation.id]!.image}
                  alt={`Current model for ${annotation.name}`}
                />
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || disabled || changed}
                  onClick={() => void work(() => onRequest(annotation))}
                >
                  Prepare agent request
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || disabled}
                  onClick={() =>
                    void work(async () => {
                      const image = await onReview(annotation);
                      if (image)
                        setCurrentImages((current) => ({
                          ...current,
                          [annotation.id]: { image, revision: sourceRevision },
                        }));
                    })
                  }
                >
                  Compare current
                </Button>
                {changed && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setName(annotation.name);
                      setRequest(annotation.request);
                      onRelink(annotation);
                    }}
                  >
                    Reselect region
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void mutate({
                      kind: "annotation",
                      item: {
                        ...annotation,
                        status: annotation.status === "accepted" ? "open" : "accepted",
                        reviewedRevision: sourceRevision,
                      },
                    })
                  }
                >
                  {annotation.status === "accepted" ? "Reopen" : "Accept result"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
