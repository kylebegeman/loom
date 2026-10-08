import { useState } from "react";
import {
  BookmarkIcon,
  BookmarkPlusIcon,
  CircuitBoardIcon,
  FileTextIcon,
  Trash2Icon,
} from "lucide-react";
import type { PcbWorkspace } from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { EmptyState, revealTool, Scroll, Section, useWrite } from "./InspectorKit";
import { ToolButton } from "./ToolButton";
import k from "./inspector.module.css";

export function ViewsTab({
  data,
  sourceHash,
  canSave,
  canSaveView,
  onSaveView,
  onLoadView,
  mutate,
}: {
  data: PcbWorkspace;
  sourceHash: string | null;
  canSave: boolean;
  canSaveView: boolean;
  onSaveView: (name: string) => Promise<unknown>;
  onLoadView: (id: string) => void;
  mutate: (change: (data: PcbWorkspace) => PcbWorkspace) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const write = useWrite("The editor workspace could not be saved.");
  const save = () => {
    if (!canSave || !canSaveView || !name.trim()) return;
    void write.run(() => onSaveView(name.trim())).then((saved) => saved && setName(""));
  };
  return (
    <Scroll>
      <form
        className={k.saveCard}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className={k.saveCardHead}>
          <span className={k.iconTile} data-tone="primary" aria-hidden="true">
            <BookmarkPlusIcon />
          </span>
          <div>
            <strong>Save this view</strong>
            <small>Keeps the sheet, position, zoom and visible layers.</small>
          </div>
        </div>
        <div className={k.inlineForm}>
          <Input
            size="sm"
            aria-label="View name"
            placeholder="Name the current view"
            disabled={write.busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!canSave || !canSaveView || !name.trim() || write.busy}
          >
            Save current view
          </Button>
        </div>
        {!canSaveView && <p className={k.hint}>Views save the 2D drawing once it has loaded.</p>}
        {write.error && (
          <p role="alert" className={k.error}>
            {write.error}
          </p>
        )}
      </form>
      {data.views.length ? (
        <Section title="Saved views" count={data.views.length}>
          <div className={k.list}>
            {data.views.map((v) => {
              const visible = v.layers.filter((l) => l.visible).length;
              return (
                <div key={v.id} className={k.itemRow}>
                  <button type="button" className={k.item} onClick={() => onLoadView(v.id)}>
                    <span className={k.iconTile} aria-hidden="true">
                      {v.view === "pcb" ? <CircuitBoardIcon /> : <FileTextIcon />}
                    </span>
                    <span className={k.itemText}>
                      <strong>{v.name}</strong>
                      <small>
                        {[
                          v.view === "pcb" ? "Board" : "Schematic",
                          v.view === "pcb" && v.layers.length ? `${visible} layers` : null,
                          `${Math.round(v.camera.scale * 100)}%`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {sourceHash && v.sourceHash !== sourceHash && (
                          <Badge variant="outline" size="sm">
                            Older revision
                          </Badge>
                        )}
                      </small>
                    </span>
                  </button>
                  <ToolButton
                    className={revealTool}
                    label={`Remove ${v.name}`}
                    disabled={!canSave || write.busy}
                    onClick={() =>
                      void write.run(() =>
                        mutate((d) => ({ ...d, views: d.views.filter((s) => s.id !== v.id) })),
                      )
                    }
                  >
                    <Trash2Icon />
                  </ToolButton>
                </div>
              );
            })}
          </div>
        </Section>
      ) : (
        <EmptyState icon={<BookmarkIcon />} title="No saved views">
          Name a view to come back to a sheet, a detail or a layer set in one click. Back and
          Forward in the drawing revisit recent positions.
        </EmptyState>
      )}
    </Scroll>
  );
}
