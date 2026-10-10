import styles from "./workspace.module.css";
import { useEffect, useState, type ReactNode } from "react";
import {
  CameraIcon,
  EllipsisIcon,
  Grid2X2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  ModelCapturePreset,
  ModelSavedView,
  ModelWorkspace,
  ModelWorkspaceOperation,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "~/components/ui/menu";
import { randomUUID } from "~/lib/utils";
import { EmptyNote, RenameInput, SectionHead } from "./controls";

type Mutation = (operation: ModelWorkspaceOperation) => Promise<unknown>;
const SHEET_VIEWS = 4;
const VIEW_LIMIT = 30;
const SHEET_LIMIT = 20;

/** Thumbnails are kept in memory, keyed by the camera and geometry they show. */
const thumbnailKey = (view: ModelSavedView, revision: string) =>
  JSON.stringify([view.id, view.camera, revision]);

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

type SheetDraft = { id: string | null; name: string; ids: string[]; measurements: boolean };

/** Views tab: saved cameras to return to, and review sheets that capture up to four of them. */
export function ViewsSection({
  data,
  mutate,
  sourceRevision,
  visible,
  activeViewId,
  disabled,
  onSave,
  onRecall,
  onUpdate,
  onCapture,
  onThumbnail,
}: {
  data: ModelWorkspace;
  mutate: Mutation;
  sourceRevision: string;
  visible: boolean;
  activeViewId: string | null;
  disabled: boolean;
  onSave: () => void;
  onRecall: (view: ModelSavedView) => void;
  onUpdate: (view: ModelSavedView) => void;
  onCapture: (ids: readonly string[], measurements: boolean, name: string) => Promise<void>;
  onThumbnail: (view: ModelSavedView) => Promise<string | null>;
}) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState<SheetDraft | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);
  const missing =
    visible && !disabled
      ? data.views.find((view) => thumbnails[thumbnailKey(view, sourceRevision)] === undefined)
      : undefined;
  // One capture per pass keeps the viewport responsive while thumbnails fill in.
  useEffect(() => {
    if (!missing) return;
    let active = true;
    const key = thumbnailKey(missing, sourceRevision);
    // A failed capture is stored as empty so the remaining views still get thumbnails.
    void onThumbnail(missing)
      .catch(() => null)
      .then((image) => {
        if (active) setThumbnails((current) => ({ ...current, [key]: image ?? "" }));
      });
    return () => {
      active = false;
    };
  }, [missing, sourceRevision, onThumbnail]);
  const image = (id: string) => {
    const view = data.views.find((item) => item.id === id);
    return view ? thumbnails[thumbnailKey(view, sourceRevision)] || null : null;
  };
  const removeView = (view: ModelSavedView) => {
    void mutate({ kind: "remove", collection: "views", id: view.id });
    for (const preset of data.presets) {
      if (!preset.viewIds.includes(view.id)) continue;
      const viewIds = preset.viewIds.filter((id) => id !== view.id);
      void mutate(
        viewIds.length
          ? { kind: "preset", item: { ...preset, viewIds } }
          : { kind: "remove", collection: "presets", id: preset.id },
      );
    }
  };
  const toggle = (id: string) =>
    setDraft(
      (current) =>
        current && {
          ...current,
          ids: current.ids.includes(id)
            ? current.ids.filter((item) => item !== id)
            : current.ids.length < SHEET_VIEWS
              ? [...current.ids, id]
              : current.ids,
        },
    );
  const capture = async (
    preset: Pick<ModelCapturePreset, "id" | "name" | "viewIds" | "includeMeasurements">,
  ) => {
    setCapturing(preset.id);
    try {
      await onCapture(preset.viewIds, preset.includeMeasurements, preset.name);
    } finally {
      setCapturing(null);
    }
  };
  const saveDraft = () => {
    if (!draft?.ids.length) return;
    void mutate({
      kind: "preset",
      item: {
        id: draft.id ?? randomUUID(),
        name: draft.name.trim() || "Review sheet",
        viewIds: draft.ids,
        includeMeasurements: draft.measurements,
      },
    }).then((saved) => {
      if (saved) setDraft(null);
    });
  };
  return (
    <>
      <div className={styles["model-inspector-scroll"]}>
        <SectionHead title="Saved views" count={data.views.length || undefined}>
          <Button
            variant="ghost-muted"
            size="xs"
            disabled={!!draft || disabled || data.views.length >= VIEW_LIMIT}
            onClick={onSave}
          >
            <PlusIcon />
            Save view
          </Button>
        </SectionHead>
        {draft && (
          <div className={styles["model-pickbar"]}>
            <Grid2X2Icon />
            <span>Pick up to four views for the sheet.</span>
            <div className="flex-1" />
            <span className="text-muted-foreground tabular-nums">
              {draft.ids.length} of {SHEET_VIEWS}
            </span>
          </div>
        )}
        {data.views.length ? (
          data.views.map((view) => {
            const section = view.camera.section;
            const active = !draft && activeViewId === view.id;
            const thumb = image(view.id);
            return (
              <div
                key={view.id}
                className={styles["model-view-row"]}
                data-active={active}
                role="button"
                tabIndex={0}
                aria-label={draft ? `Include ${view.name}` : `Go to ${view.name}`}
                onClick={() => (draft ? toggle(view.id) : onRecall(view))}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (draft) toggle(view.id);
                    else onRecall(view);
                  }
                }}
              >
                {draft ? (
                  <Checkbox
                    aria-label={`Include ${view.name}`}
                    checked={draft.ids.includes(view.id)}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={() => toggle(view.id)}
                  />
                ) : (
                  <span />
                )}
                {thumb ? (
                  <img src={thumb} alt="" />
                ) : (
                  <span className={styles["model-view-thumb"]} />
                )}
                <div className="min-w-0">
                  {renaming === view.id ? (
                    <RenameInput
                      value={view.name}
                      label={`Rename ${view.name}`}
                      onDone={(name) => {
                        if (name) void mutate({ kind: "view", item: { ...view, name } });
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <div className={styles["model-row-name"]}>{view.name}</div>
                  )}
                  {(section.enabled || active || view.sourceRevision !== sourceRevision) && (
                    <div className={styles["model-row-detail"]}>
                      {section.enabled
                        ? `Section ${section.axis.toUpperCase()} at ${section.offset.toFixed(1)} mm`
                        : active
                          ? "Current view"
                          : "Saved on an earlier version, refits on open"}
                    </div>
                  )}
                </div>
                {draft ? (
                  <span />
                ) : (
                  <RowMenu label={`${view.name} actions`}>
                    <MenuItem disabled={disabled} onClick={() => onUpdate(view)}>
                      <RefreshCwIcon />
                      Update to current view
                    </MenuItem>
                    <MenuItem onClick={() => setRenaming(view.id)}>
                      <PencilIcon />
                      Rename
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem variant="destructive" onClick={() => removeView(view)}>
                      <Trash2Icon />
                      Delete
                    </MenuItem>
                  </RowMenu>
                )}
              </div>
            );
          })
        ) : (
          <EmptyNote>
            Save a camera position to come back to it, or to build a review sheet.
          </EmptyNote>
        )}
        <SectionHead title="Review sheets" count={data.presets.length || undefined}>
          <Button
            variant="ghost-muted"
            size="xs"
            disabled={!!draft || !data.views.length || data.presets.length >= SHEET_LIMIT}
            onClick={() =>
              setDraft({
                id: null,
                name: `Sheet ${data.presets.length + 1}`,
                ids: data.views.slice(0, SHEET_VIEWS).map((view) => view.id),
                measurements: true,
              })
            }
          >
            <PlusIcon />
            New sheet
          </Button>
        </SectionHead>
        {data.presets.length ? (
          data.presets.map((preset) => (
            <div key={preset.id} className={styles["model-sheet-row"]}>
              <div className={styles["model-sheet-thumbs"]}>
                {preset.viewIds.slice(0, SHEET_VIEWS).map((id) => {
                  const thumb = image(id);
                  return thumb ? <img key={id} src={thumb} alt="" /> : <span key={id} />;
                })}
              </div>
              <div className="min-w-0">
                <div className={styles["model-row-name"]}>{preset.name}</div>
                <div className={styles["model-row-detail"]}>
                  {preset.viewIds.length} view{preset.viewIds.length === 1 ? "" : "s"}
                  {preset.includeMeasurements ? ", with measurements" : ""}
                </div>
              </div>
              <Button
                variant="outline"
                size="xs"
                disabled={disabled || capturing !== null}
                onClick={() => void capture(preset)}
              >
                <CameraIcon />
                {capturing === preset.id ? "Capturing" : "Capture"}
              </Button>
              <RowMenu label={`${preset.name} actions`}>
                <MenuItem
                  onClick={() =>
                    setDraft({
                      id: preset.id,
                      name: preset.name,
                      ids: [...preset.viewIds],
                      measurements: preset.includeMeasurements,
                    })
                  }
                >
                  <PencilIcon />
                  Edit views
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  variant="destructive"
                  onClick={() =>
                    void mutate({ kind: "remove", collection: "presets", id: preset.id })
                  }
                >
                  <Trash2Icon />
                  Delete
                </MenuItem>
              </RowMenu>
            </div>
          ))
        ) : (
          <EmptyNote>
            A review sheet captures up to four saved views as one image for the agent.
          </EmptyNote>
        )}
        <div className="h-4" />
      </div>
      {draft && (
        <form
          className={styles["model-inspector-foot"]}
          data-stacked
          onSubmit={(event) => {
            event.preventDefault();
            saveDraft();
          }}
        >
          <Input
            size="sm"
            aria-label="Sheet name"
            maxLength={100}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <div className="flex items-center gap-2">
            <label className={styles["model-live"]}>
              <Switch
                size="sm"
                checked={draft.measurements}
                onCheckedChange={(measurements) => setDraft({ ...draft, measurements })}
              />
              Include measurements
            </label>
            <div className="flex-1" />
            <Button variant="ghost-muted" size="xs" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" size="xs" disabled={!draft.ids.length}>
              {draft.id ? "Save sheet" : "Create sheet"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
