import { useState, type ComponentProps } from "react";
import type { PcbReviewResult, PcbReviewLocation } from "@t3tools/contracts/fork";
import { ChecksView } from "./ChecksView";
import { ReviewView } from "./ReviewView";
import { Bar } from "./InspectorKit";
import { Button } from "~/components/ui/button";
type Props = ComponentProps<typeof ChecksView> & {
  review: PcbReviewResult | null;
  reviewLoading: boolean;
  reviewError: string | null;
  onReviewRefresh: () => void;
  onReviewLocate: (surface: "schematic" | "pcb", point: PcbReviewLocation, sheet?: string) => void;
};
/** Separate result contracts keep ERC/DRC clients compatible with richer review findings. */
export function ChecksSection(props: Props) {
  const [selected, setSelected] = useState<"rules" | "review">(
    props.design.kind === "tscircuit" || props.activeId?.startsWith("review:") ? "review" : "rules",
  );
  const [previousActive, setPreviousActive] = useState(props.activeId);
  if (props.activeId !== previousActive) {
    setPreviousActive(props.activeId);
    if (props.activeId?.startsWith("review:")) setSelected("review");
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
      ) : (
        <ChecksView {...props} />
      )}
    </>
  );
}
