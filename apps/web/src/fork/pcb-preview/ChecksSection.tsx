import { useState, type ComponentProps } from "react";
import type {
  PcbBoardStats,
  PcbFabCheckResult,
  PcbFabCatalog,
  PcbReviewResult,
  PcbReviewLocation,
} from "@t3tools/contracts/fork";
import { ChecksView } from "./ChecksView";
import { FabCheckView } from "./FabCheckView";
import { ReviewView } from "./ReviewView";
import { Bar } from "./InspectorKit";
import { Button } from "~/components/ui/button";
type Props = ComponentProps<typeof ChecksView> & {
  boardStats?: PcbBoardStats | null | undefined;
  fabResult: PcbFabCheckResult | null;
  fabCatalog: PcbFabCatalog | null;
  fabId: string | undefined;
  onFabId: (id: string) => void;
  fabLoading: boolean;
  fabError: string | null;
  onFabRefresh: () => void;
  onFabLocate: (point: { x: number; y: number }, description?: string) => void;
  review: PcbReviewResult | null;
  reviewLoading: boolean;
  reviewError: string | null;
  onReviewRefresh: () => void;
  onReviewLocate: (
    surface: "schematic" | "pcb",
    point: PcbReviewLocation,
    sheet?: string,
    description?: string,
  ) => void;
};
/** Separate result contracts keep ERC/DRC clients compatible with richer review findings. */
export function ChecksSection(props: Props) {
  const [selected, setSelected] = useState<"rules" | "review" | "fab">(
    props.activeId?.startsWith("fab:")
      ? "fab"
      : props.design.kind === "tscircuit" || props.activeId?.startsWith("review:")
        ? "review"
        : "rules",
  );
  const [previousActive, setPreviousActive] = useState(props.activeId);
  if (props.activeId !== previousActive) {
    setPreviousActive(props.activeId);
    if (props.activeId?.startsWith("review:")) setSelected("review");
    if (props.activeId?.startsWith("fab:")) setSelected("fab");
  }
  return (
    <>
      <Bar>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="xs"
            aria-pressed={selected === "rules"}
            disabled={props.design.kind !== "kicad"}
            onClick={() => setSelected("rules")}
          >
            ERC / DRC
          </Button>
          <Button
            variant="outline"
            size="xs"
            aria-pressed={selected === "fab"}
            onClick={() => setSelected("fab")}
          >
            Fab
          </Button>
          <Button
            variant="outline"
            size="xs"
            aria-pressed={selected === "review"}
            onClick={() => setSelected("review")}
          >
            Review
          </Button>
        </div>
      </Bar>
      {selected === "review" ? (
        <ReviewView
          threadRef={props.threadRef}
          design={props.design}
          result={props.review}
          loading={props.reviewLoading}
          error={props.reviewError}
          sourceHash={props.sourceHash}
          onRefresh={props.onReviewRefresh}
          onLocate={props.onReviewLocate}
        />
      ) : selected === "fab" ? (
        <FabCheckView
          threadRef={props.threadRef}
          design={props.design}
          result={props.fabResult}
          catalog={props.fabCatalog}
          fabId={props.fabId}
          onFabId={props.onFabId}
          sourceHash={props.sourceHash}
          loading={props.fabLoading}
          error={props.fabError}
          onRefresh={props.onFabRefresh}
          onLocate={props.onFabLocate}
          onDrc={() => setSelected("rules")}
          boardStats={props.boardStats}
          showExcluded={props.showExcluded}
        />
      ) : (
        <ChecksView {...props} />
      )}
    </>
  );
}
