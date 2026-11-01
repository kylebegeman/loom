import { lazy, Suspense } from "react";
import type { ForkDiffHeaderAction, ForkDiffHeaderActionProps } from "../diffHeader/registry";
import { FEATURE } from "./panel";

// Lazy so the diff panel's import graph stays free of thread state and the panel registry.
const DiffImpactButton = lazy(() => import("./DiffImpactButton"));

function DiffImpactAction(props: ForkDiffHeaderActionProps) {
  const { threadRef } = props;
  if (!threadRef || props.files.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <DiffImpactButton {...props} threadRef={threadRef} />
    </Suspense>
  );
}

export const codeGraphDiffHeaderAction: ForkDiffHeaderAction = {
  id: FEATURE,
  Component: DiffImpactAction,
};
