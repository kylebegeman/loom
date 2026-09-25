import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useInspectorActions } from "./actions";
import { deriveInspectorModel, type InspectorModel, type InspectorSectionModel } from "./model";
import { InspectorCollapsedSection, InspectorRowView, InspectorSection } from "./parts";
import { FORK_INSPECTOR_SECTIONS, type InspectorDensity } from "./sections";
import { useInspectorInputs } from "./useInspectorInputs";

/**
 * The thread status card. `full` lists every section; `compact` puts Status and Attention
 * first and folds the rest to one line each.
 */
export function ThreadInspector({
  threadRef,
  density,
  onActionDone,
}: {
  threadRef: ScopedThreadRef;
  density: InspectorDensity;
  /** Called after a row action runs; the card closes itself here. */
  onActionDone?: () => void;
}) {
  const inputs = useInspectorInputs(threadRef);
  const model = useMemo(() => deriveInspectorModel(inputs), [inputs]);
  const runAction = useInspectorActions(threadRef, onActionDone);
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());

  const renderRows = (section: InspectorSectionModel) =>
    section.rows.map((row) => <InspectorRowView key={row.id} row={row} onAction={runAction} />);

  return (
    <div className={density === "full" ? "flex flex-col gap-3" : "flex flex-col gap-1.5"}>
      {orderSections(model, density).map((section) =>
        density === "compact" && !section.essential ? (
          <InspectorCollapsedSection
            key={section.id}
            title={section.title}
            summary={section.summary}
            tone={section.summaryTone}
            open={openSections.has(section.id)}
            onToggle={() =>
              setOpenSections((current) => {
                const next = new Set(current);
                if (!next.delete(section.id)) next.add(section.id);
                return next;
              })
            }
          >
            {renderRows(section)}
          </InspectorCollapsedSection>
        ) : (
          <InspectorSection key={section.id} title={section.title}>
            {renderRows(section)}
          </InspectorSection>
        ),
      )}
      {FORK_INSPECTOR_SECTIONS.map(({ id, Component }) => (
        <Component key={id} threadRef={threadRef} density={density} />
      ))}
    </div>
  );
}

function orderSections(
  model: InspectorModel,
  density: InspectorDensity,
): ReadonlyArray<InspectorSectionModel> {
  if (density === "full") return model.sections;
  return [
    ...model.sections.filter((section) => section.essential),
    ...model.sections.filter((section) => !section.essential),
  ];
}
