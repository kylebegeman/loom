import { useEffect, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { PcbDesign } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { usePcbPreview } from "./usePcbPreview";
import { SvgViewport } from "./SvgViewport";
import { OperationStatus } from "./OperationStatus";
import type { FabOutputPreview } from "./FabricationTab";
/** Dependency-free fallback plots current board layers, explicitly labelled as a board plot. */
export function GerberPreview(props: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  output: FabOutputPreview;
  onClose: () => void;
}) {
  const onClose = props.onClose;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- capturing window keydown listener that closes the outputs view on escape
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <strong>Outputs of {props.output.id}</strong>
        <Button size="sm" variant="outline" onClick={props.onClose}>
          Back to design
        </Button>
      </div>
      {props.design.kind === "kicad" ? (
        <BoardPlot {...props} />
      ) : (
        <p className="p-3">
          Preview needs the Gerber renderer. Download the zip to inspect it in your fab's viewer.
        </p>
      )}
    </div>
  );
}
function BoardPlot({
  threadRef,
  design,
  output,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  output: FabOutputPreview;
}) {
  const [selection, setSelection] = useState("top");
  const options = output.layers.filter((l) => l.type !== "drill");
  const layerNames =
    selection === "top" || selection === "bottom"
      ? options.filter((l) => l.side === selection || l.side === "all").map((l) => l.layer)
      : options.filter((l) => l.path === selection).map((l) => l.layer);
  const preview = usePcbPreview(
    threadRef,
    design,
    "pcb",
    selection === "bottom" ? "back" : "front",
    true,
    layerNames,
  );
  return (
    <>
      <div className="px-3">
        <p>Board plot of the packaged layers</p>
        <p>
          This plots the saved board. Inspect the Gerber zip in your fab's viewer before ordering.
        </p>
        {preview.sourceHash && preview.sourceHash !== output.sourceHash && (
          <p role="alert">
            The board changed since this package. This plot shows the current board.
          </p>
        )}
        <select
          aria-label="Output preview layers"
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
        >
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          {options.map((l) => (
            <option key={l.path} value={l.path}>
              {l.layer}
            </option>
          ))}
        </select>
      </div>
      <div className="relative min-h-0 flex-1">
        {preview.display ? (
          <SvgViewport
            svg={preview.display.svg}
            label="Board plot of the packaged layers"
            kind="pcb"
            busy={preview.rendering || preview.loadingSheet}
          />
        ) : preview.error || preview.cancelled ? (
          <div>
            <p role="alert">{preview.error ?? "Preview cancelled."}</p>
            <Button size="sm" variant="outline" onClick={preview.refresh}>
              Retry
            </Button>
          </div>
        ) : (
          <OperationStatus label="Plotting board layers" onCancel={preview.cancelRender} />
        )}
      </div>
    </>
  );
}
