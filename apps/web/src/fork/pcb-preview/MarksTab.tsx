import { useState } from "react";
import { RulerIcon, StickyNoteIcon, Trash2Icon, TriangleRightIcon } from "lucide-react";
import type { PcbPoint, PcbView, PcbWorkspace } from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Kbd } from "~/components/ui/kbd";
import { Bar, EmptyState, Group, revealTool, Scroll, Segmented, useWrite } from "./InspectorKit";
import { measurementParts } from "./geometry";
import { ToolButton } from "./ToolButton";
import k from "./inspector.module.css";

export type MarkTool = "distance" | "angle" | "annotate";
const TOOLS = [
  { id: "distance", label: "Distance", key: "M", icon: RulerIcon },
  { id: "angle", label: "Angle", key: "A", icon: TriangleRightIcon },
  { id: "annotate", label: "Note", key: "N", icon: StickyNoteIcon },
] as const;
type Mark = {
  id: string;
  kind: "distance" | "angle" | "note";
  value: string;
  detail: string;
  view: PcbView;
  sheet: string;
  point: PcbPoint | undefined;
  current: boolean;
};

export function MarksTab({
  data,
  sourceHash,
  canSave,
  canMark,
  onTool,
  onFocusMark,
  mutate,
}: {
  data: PcbWorkspace;
  sourceHash: string | null;
  canSave: boolean;
  canMark: boolean;
  onTool: (tool: MarkTool) => void;
  onFocusMark: (view: PcbView, sheet: string, point: PcbPoint) => void;
  mutate: (change: (data: PcbWorkspace) => PcbWorkspace) => Promise<unknown>;
}) {
  const [filter, setFilter] = useState<"all" | "measurements" | "notes">("all");
  const write = useWrite("The mark could not be removed.");
  const marks: Mark[] = [
    ...data.measurements.map((m) => ({
      id: m.id,
      kind: m.kind,
      ...measurementParts(m),
      view: m.view,
      sheet: m.sheet,
      point: m.kind === "angle" ? m.points[1] : m.points[0],
      current: !sourceHash || m.sourceHash === sourceHash,
    })),
    ...data.annotations.map((a) => ({
      id: a.id,
      kind: "note" as const,
      value: a.text,
      detail: "",
      view: a.view,
      sheet: a.sheet,
      point: a.point,
      current: !sourceHash || a.sourceHash === sourceHash,
    })),
  ];
  const shown = marks.filter((m) =>
    filter === "all" ? true : filter === "notes" ? m.kind === "note" : m.kind !== "note",
  );
  const remove = (mark: Mark) =>
    void write.run(() =>
      mutate((d) =>
        mark.kind === "note"
          ? { ...d, annotations: d.annotations.filter((v) => v.id !== mark.id) }
          : { ...d, measurements: d.measurements.filter((v) => v.id !== mark.id) },
      ),
    );
  return (
    <>
      <Bar>
        <div className={k.toolGrid} role="group" aria-label="Add a mark">
          {TOOLS.map(({ id, label, key, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={k.toolCard}
              disabled={!canMark}
              onClick={() => onTool(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              <Kbd>{key}</Kbd>
            </button>
          ))}
        </div>
        {marks.length > 0 && (
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              {
                value: "all",
                label: (
                  <>
                    All <span className={k.toggleCount}>{marks.length}</span>
                  </>
                ),
              },
              {
                value: "measurements",
                label: (
                  <>
                    Measures <span className={k.toggleCount}>{data.measurements.length}</span>
                  </>
                ),
              },
              {
                value: "notes",
                label: (
                  <>
                    Notes <span className={k.toggleCount}>{data.annotations.length}</span>
                  </>
                ),
              },
            ]}
          />
        )}
      </Bar>
      <Scroll>
        {write.error && (
          <p role="alert" className={k.error}>
            {write.error}
          </p>
        )}
        {!canMark && (
          <p className={k.hint}>Marks can be added once the design workspace has loaded.</p>
        )}
        {!marks.length ? (
          <EmptyState icon={<RulerIcon />} title="No marks yet">
            Measure distances and angles, or pin notes where a change belongs. Marks show up in
            captures you add to the draft.
          </EmptyState>
        ) : (
          (["pcb", "schematic"] as const).map((target) => {
            const group = shown.filter((m) => m.view === target);
            if (!group.length) return null;
            return (
              <Group
                key={target}
                title={target === "pcb" ? "Board" : "Schematic"}
                meta={group.length}
              >
                {group.map((m) => {
                  const Icon =
                    m.kind === "note"
                      ? StickyNoteIcon
                      : m.kind === "angle"
                        ? TriangleRightIcon
                        : RulerIcon;
                  return (
                    <div key={m.id} className={k.itemRow}>
                      <button
                        type="button"
                        className={k.item}
                        disabled={!m.point}
                        onClick={() => m.point && onFocusMark(m.view, m.sheet, m.point)}
                      >
                        <span
                          className={k.iconTile}
                          data-tone={m.kind === "note" ? "warning" : "info"}
                          aria-hidden="true"
                        >
                          <Icon />
                        </span>
                        <span className={k.itemText}>
                          <strong className={m.kind === "note" ? undefined : k.mono}>
                            {m.value}
                          </strong>
                          {(m.detail || !m.current) && (
                            <small>
                              {m.detail}
                              {!m.current && (
                                <Badge variant="warning" size="sm">
                                  Older revision
                                </Badge>
                              )}
                            </small>
                          )}
                        </span>
                      </button>
                      <ToolButton
                        className={revealTool}
                        label={m.kind === "note" ? "Remove note" : "Remove measurement"}
                        disabled={!canSave || write.busy}
                        onClick={() => remove(m)}
                      >
                        <Trash2Icon />
                      </ToolButton>
                    </div>
                  );
                })}
              </Group>
            );
          })
        )}
      </Scroll>
    </>
  );
}
