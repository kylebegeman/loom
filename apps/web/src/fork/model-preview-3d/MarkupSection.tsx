import styles from "./workspace.module.css";
import { useState, type ReactNode } from "react";
import {
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  CrosshairIcon,
  EllipsisIcon,
  EyeIcon,
  EyeOffIcon,
  FocusIcon,
  MapPinIcon,
  PencilIcon,
  RulerIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type {
  ModelAnnotation,
  ModelMeasurement,
  ModelPoint,
  ModelWorkspace,
  ModelWorkspaceOperation,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "~/components/ui/menu";
import { Chip, EmptyNote, RenameInput, SectionHead, TitleInput, Tip } from "./controls";

type Mutation = (operation: ModelWorkspaceOperation) => Promise<unknown>;
export type AnnotationStatus = "draft" | "requested" | "changed" | "accepted";

/** Where a change request stands relative to the geometry on screen. */
export function annotationStatus(annotation: ModelAnnotation, sourceRevision: string) {
  if (annotation.status === "accepted") return "accepted";
  if (annotation.sourceRevision !== sourceRevision) return "changed";
  return annotation.status === "review" ? "requested" : "draft";
}
const STATUS: Record<AnnotationStatus, [string, "primary" | "warning" | "success" | undefined]> = {
  draft: ["Draft", undefined],
  requested: ["Requested", "primary"],
  changed: ["Model changed", "warning"],
  accepted: ["Accepted", "success"],
};
/** Change requests still waiting on the agent or on a review. */
export const openRequestCount = (annotations: readonly ModelAnnotation[], revision: string) =>
  annotations.filter((annotation) => {
    const status = annotationStatus(annotation, revision);
    return status === "requested" || status === "changed";
  }).length;

function StatusChip({ status }: { status: AnnotationStatus }) {
  const [label, tone] = STATUS[status];
  return <Chip {...(tone ? { tone } : {})}>{label}</Chip>;
}
function Pin({ index, status }: { index: number; status: AnnotationStatus }) {
  return (
    <span className={styles["model-pin"]} data-status={status}>
      {index}
    </span>
  );
}
function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    // The wrapper stops row clicks and carries the hover reveal, so the button keeps its own look.
    <span className={styles["model-row-menu"]} onClick={(event) => event.stopPropagation()}>
      <Menu>
        <MenuTrigger render={<Button variant="ghost-muted" size="icon-xs" aria-label={label} />}>
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">{children}</MenuPopup>
      </Menu>
    </span>
  );
}

export type MarkupActions = {
  onTool: (mode: "measure" | "annotate") => void;
  onMovePin: () => void;
  onDiscard: () => void;
  onSave: (name: string, request: string, addToComposer: boolean) => Promise<boolean>;
  onRequest: (annotation: ModelAnnotation) => Promise<unknown>;
  onReselect: (annotation: ModelAnnotation) => void;
  onReview: (annotation: ModelAnnotation) => Promise<string>;
  onShow: (annotation: ModelAnnotation) => void;
  onCopy: (text: string) => void;
};

function Composer({
  index,
  relink,
  picking,
  busy,
  disabled,
  actions,
}: {
  index: number;
  relink: ModelAnnotation | null;
  picking: boolean;
  busy: boolean;
  disabled: boolean;
  actions: MarkupActions;
}) {
  const [name, setName] = useState(relink?.name ?? "");
  const [request, setRequest] = useState(relink?.request ?? "");
  const save = (add: boolean) =>
    void actions.onSave(name.trim() || "Selected region", request.trim(), add);
  return (
    <form
      className={styles["model-composer"]}
      onSubmit={(event) => {
        event.preventDefault();
        save(true);
      }}
    >
      <div className={styles["model-composer-head"]}>
        <Pin index={index} status="draft" />
        {relink ? `Move pin for ${relink.name}` : "New change request"}
        <div className="flex-1" />
        <Tip label="Discard" kbd="Esc">
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Discard change request"
            onClick={actions.onDiscard}
          >
            <XIcon />
          </Button>
        </Tip>
      </div>
      <Input
        size="sm"
        aria-label="Change request title"
        placeholder="Title (optional)"
        maxLength={100}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        size="sm"
        autoFocus
        aria-label="Requested model change"
        placeholder="Describe the change, for example: add a 20 mm cable notch here."
        maxLength={4000}
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (request.trim()) save(true);
          }
        }}
      />
      <div className={styles["model-composer-actions"]}>
        <Tip label="Click the model again to move the pin">
          <Button
            variant="ghost-muted"
            size="xs"
            data-pressed={picking ? "" : undefined}
            onClick={actions.onMovePin}
          >
            <CrosshairIcon />
            Move pin
          </Button>
        </Tip>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="xs"
          disabled={!request.trim() || busy || disabled}
          onClick={() => save(false)}
        >
          Save draft
        </Button>
        <Tip label="Adds the request and a marked capture to the composer" kbd="⌘↵">
          <Button type="submit" size="xs" disabled={!request.trim() || busy || disabled}>
            Save and add to composer
          </Button>
        </Tip>
      </div>
    </form>
  );
}

function RequestDetail({
  annotation,
  index,
  sourceRevision,
  mutate,
  busy,
  disabled,
  actions,
  onBack,
}: {
  annotation: ModelAnnotation;
  index: number;
  sourceRevision: string;
  mutate: Mutation;
  busy: boolean;
  disabled: boolean;
  actions: MarkupActions;
  onBack: () => void;
}) {
  const status = annotationStatus(annotation, sourceRevision);
  const [current, setCurrent] = useState<{ image: string; revision: string } | null>(null);
  const [working, setWorking] = useState(false);
  const save = (patch: Partial<ModelAnnotation>) =>
    void mutate({ kind: "annotation", item: { ...annotation, ...patch } });
  const work = async (task: () => Promise<unknown>) => {
    setWorking(true);
    try {
      await task();
    } finally {
      setWorking(false);
    }
  };
  const remove = () => {
    void mutate({ kind: "remove", collection: "annotations", id: annotation.id });
    onBack();
  };
  const blocked = busy || disabled || working;
  const now = current?.revision === sourceRevision ? current.image : null;
  return (
    <>
      <div className={styles["model-detail-head"]}>
        <Button variant="ghost-muted" size="xs" onClick={onBack}>
          <ChevronLeftIcon />
          Markup
        </Button>
        <div className="flex-1" />
        <Tip label="Show in viewport">
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Show in viewport"
            onClick={() => actions.onShow(annotation)}
          >
            <FocusIcon />
          </Button>
        </Tip>
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost-muted" size="icon-sm" aria-label="Change request actions" />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem disabled={blocked} onClick={() => actions.onReselect(annotation)}>
              <CrosshairIcon />
              Move pin
            </MenuItem>
            <MenuItem onClick={() => actions.onCopy(annotation.request)}>
              <CopyIcon />
              Copy request text
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={remove}>
              <Trash2Icon />
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className={styles["model-inspector-scroll"]}>
        <TitleInput
          value={annotation.name}
          label="Change request title"
          onSave={(name) => save({ name })}
        />
        <div className={styles["model-detail-sub"]}>
          <Pin index={index} status={status} />
          <StatusChip status={status} />
        </div>
        <div className={styles["model-pair"]}>
          <figure>
            {annotation.referenceImage ? (
              <img src={annotation.referenceImage} alt={`${annotation.name} when requested`} />
            ) : (
              <div className={styles["model-pair-empty"]}>No capture</div>
            )}
            <figcaption>When requested</figcaption>
          </figure>
          <figure>
            {now ? (
              <img src={now} alt={`${annotation.name} now`} />
            ) : (
              <button
                type="button"
                className={styles["model-pair-empty"]}
                disabled={blocked}
                onClick={() =>
                  void work(async () => {
                    const image = await actions.onReview(annotation);
                    if (image) setCurrent({ image, revision: sourceRevision });
                  })
                }
              >
                <CameraIcon />
                Capture now
              </button>
            )}
            <figcaption>Now</figcaption>
          </figure>
        </div>
        <label className={styles["model-field-label"]} htmlFor={`request-${annotation.id}`}>
          Request
        </label>
        <div className="px-4">
          <Textarea
            id={`request-${annotation.id}`}
            key={annotation.request}
            size="sm"
            defaultValue={annotation.request}
            maxLength={4000}
            disabled={status === "accepted"}
            onBlur={(event) => {
              const request = event.target.value.trim();
              if (request && request !== annotation.request) save({ request });
            }}
          />
        </div>
        {status === "requested" && (
          <p className={styles["model-help"]}>
            The request is in the composer. Send it when you are ready; the model updates here when
            the agent edits the file.
          </p>
        )}
        {status === "changed" && (
          <p className={styles["model-help"]}>
            The file changed after this request. Capture the model now to compare, then accept the
            change or move the pin and ask again.
          </p>
        )}
      </div>
      <div className={styles["model-inspector-foot"]}>
        {status === "draft" && (
          <>
            <Button variant="ghost-destructive" size="xs" onClick={remove}>
              Delete draft
            </Button>
            <div className="flex-1" />
            <Button
              size="xs"
              disabled={blocked || !annotation.request.trim()}
              onClick={() => void work(() => actions.onRequest(annotation))}
            >
              Add to composer
            </Button>
          </>
        )}
        {status === "requested" && (
          <>
            <span className={styles["model-preview-status"]}>
              <span className={styles["model-state-dot"]} data-tone="busy" />
              Added to the composer
            </span>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="xs"
              disabled={blocked}
              onClick={() => void work(() => actions.onRequest(annotation))}
            >
              Add again
            </Button>
          </>
        )}
        {status === "changed" && (
          <>
            <Button
              variant="outline"
              size="xs"
              disabled={blocked}
              onClick={() => actions.onReselect(annotation)}
            >
              <CrosshairIcon />
              Move pin
            </Button>
            <div className="flex-1" />
            <Button
              size="xs"
              onClick={() => save({ status: "accepted", reviewedRevision: sourceRevision })}
            >
              <CheckIcon />
              Accept change
            </Button>
          </>
        )}
        {status === "accepted" && (
          <>
            <span className={styles["model-preview-status"]}>
              <span className={styles["model-state-dot"]} data-tone="ready" />
              Accepted
            </span>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="xs"
              onClick={() => save({ status: "open", reviewedRevision: sourceRevision })}
            >
              Reopen
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function MeasurementRow({
  measurement,
  stale,
  renaming,
  mutate,
  onRename,
  onMeasureAgain,
  onCopy,
}: {
  measurement: ModelMeasurement;
  stale: boolean;
  renaming: boolean;
  mutate: Mutation;
  onRename: (renaming: boolean) => void;
  onMeasureAgain: () => void;
  onCopy: (text: string) => void;
}) {
  const delta = measurement.end.map((value, axis) => value - measurement.start[axis]!);
  const distance = Math.hypot(...delta);
  const save = (patch: Partial<ModelMeasurement>) =>
    void mutate({ kind: "measurement", item: { ...measurement, ...patch } });
  const remove = () =>
    void mutate({ kind: "remove", collection: "measurements", id: measurement.id });
  return (
    <div
      className={styles["model-measure-row"]}
      data-hidden={!measurement.visible}
      data-stale={stale}
    >
      {stale ? (
        <Tip label="Measured on an earlier version of the file">
          <span className={styles["model-row-icon"]}>
            <TriangleAlertIcon />
          </span>
        </Tip>
      ) : (
        <Tip label={measurement.visible ? "Hide in viewport" : "Show in viewport"}>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={`${measurement.visible ? "Hide" : "Show"} ${measurement.name}`}
            onClick={() => save({ visible: !measurement.visible })}
          >
            {measurement.visible ? <EyeIcon /> : <EyeOffIcon />}
          </Button>
        </Tip>
      )}
      <div className="min-w-0">
        {renaming ? (
          <RenameInput
            value={measurement.name}
            label={`Rename ${measurement.name}`}
            onDone={(name) => {
              if (name) save({ name });
              onRename(false);
            }}
          />
        ) : (
          <div className={styles["model-row-name"]} onDoubleClick={() => onRename(true)}>
            {measurement.name}
          </div>
        )}
        <div className={styles["model-row-detail"]}>
          {stale
            ? "From an earlier version of the file"
            : delta
                .map((value, axis) => `Δ${"XYZ"[axis]} ${Math.abs(value).toFixed(1)}`)
                .join("   ")}
        </div>
      </div>
      <span className={styles["model-measure-value"]}>{distance.toFixed(2)} mm</span>
      <RowMenu label={`${measurement.name} actions`}>
        <MenuItem onClick={() => onRename(true)}>
          <PencilIcon />
          Rename
        </MenuItem>
        <MenuItem onClick={() => onCopy(distance.toFixed(2))}>
          <CopyIcon />
          Copy value
        </MenuItem>
        {stale && (
          <MenuItem
            onClick={() => {
              remove();
              onMeasureAgain();
            }}
          >
            <RulerIcon />
            Measure again
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem variant="destructive" onClick={remove}>
          <Trash2Icon />
          Delete
        </MenuItem>
      </RowMenu>
    </div>
  );
}

/** Markup tab: change requests pinned to the model, and saved measurements. */
export function MarkupSection({
  data,
  mutate,
  sourceRevision,
  picking,
  pendingRegion,
  relink,
  busy,
  disabled,
  actions,
}: {
  data: ModelWorkspace;
  mutate: Mutation;
  sourceRevision: string;
  picking: "measure" | "annotate" | null;
  pendingRegion: ModelPoint[] | null;
  relink: ModelAnnotation | null;
  busy: boolean;
  disabled: boolean;
  actions: MarkupActions;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const detail = data.annotations.find((annotation) => annotation.id === detailId);
  if (detail)
    return (
      <RequestDetail
        key={detail.id}
        annotation={detail}
        index={data.annotations.indexOf(detail) + 1}
        sourceRevision={sourceRevision}
        mutate={mutate}
        busy={busy}
        disabled={disabled}
        actions={{
          ...actions,
          onReselect: (annotation) => {
            setDetailId(null);
            actions.onReselect(annotation);
          },
        }}
        onBack={() => setDetailId(null)}
      />
    );
  const current = data.measurements.filter((m) => m.sourceRevision === sourceRevision);
  const stale = data.measurements.filter((m) => m.sourceRevision !== sourceRevision);
  const measurementRow = (measurement: ModelMeasurement) => (
    <MeasurementRow
      key={measurement.id}
      measurement={measurement}
      stale={measurement.sourceRevision !== sourceRevision}
      renaming={renaming === measurement.id}
      mutate={mutate}
      onRename={(next) => setRenaming(next ? measurement.id : null)}
      onMeasureAgain={() => actions.onTool("measure")}
      onCopy={actions.onCopy}
    />
  );
  return (
    <div className={styles["model-inspector-scroll"]}>
      {pendingRegion && (
        <Composer
          key={relink?.id ?? "new"}
          index={relink ? data.annotations.indexOf(relink) + 1 : data.annotations.length + 1}
          relink={relink}
          picking={picking === "annotate"}
          busy={busy}
          disabled={disabled}
          actions={actions}
        />
      )}
      <SectionHead title="Change requests" count={data.annotations.length || undefined}>
        <Tip label="Pin a region for the agent" kbd="N">
          <Button
            variant="ghost-muted"
            size="xs"
            disabled={disabled}
            data-pressed={picking === "annotate" ? "" : undefined}
            onClick={() => actions.onTool("annotate")}
          >
            <MapPinIcon />
            Annotate
          </Button>
        </Tip>
      </SectionHead>
      {data.annotations.length ? (
        data.annotations.map((annotation, index) => {
          const status = annotationStatus(annotation, sourceRevision);
          return (
            <button
              key={annotation.id}
              type="button"
              className={styles["model-request-row"]}
              onClick={() => setDetailId(annotation.id)}
            >
              <Pin index={index + 1} status={status} />
              <div className="min-w-0">
                <div className={styles["model-request-top"]}>
                  <span className={styles["model-row-name"]}>{annotation.name}</span>
                  <StatusChip status={status} />
                </div>
                <div className={styles["model-request-text"]}>
                  {annotation.request || "No description yet."}
                </div>
              </div>
              {annotation.referenceImage ? (
                <img
                  className={styles["model-request-thumb"]}
                  src={annotation.referenceImage}
                  alt=""
                />
              ) : (
                <span className={styles["model-request-thumb"]} />
              )}
            </button>
          );
        })
      ) : pendingRegion ? null : (
        <EmptyNote>
          {picking === "annotate"
            ? "Click the part of the model you want changed, or drag across a region."
            : "Pin the part of the model you want changed and describe it. The request goes to the composer with a marked capture of the view."}
        </EmptyNote>
      )}
      <SectionHead title="Measurements" count={current.length || undefined}>
        <Tip label="Click two points" kbd="M">
          <Button
            variant="ghost-muted"
            size="xs"
            disabled={disabled}
            data-pressed={picking === "measure" ? "" : undefined}
            onClick={() => actions.onTool("measure")}
          >
            <RulerIcon />
            Measure
          </Button>
        </Tip>
      </SectionHead>
      {current.length ? (
        current.map(measurementRow)
      ) : (
        <EmptyNote>Click two points on the model to measure the distance between them.</EmptyNote>
      )}
      {stale.length > 0 && (
        <>
          <div className={styles["model-subhead"]}>
            <span>Earlier versions</span>
            <div className="flex-1" />
            <Button
              variant="ghost-muted"
              size="xs"
              onClick={() => {
                for (const measurement of stale)
                  void mutate({ kind: "remove", collection: "measurements", id: measurement.id });
              }}
            >
              Clear
            </Button>
          </div>
          {stale.map(measurementRow)}
        </>
      )}
      <div className="h-4" />
    </div>
  );
}
