import { useAtomValue } from "@effect/atom-react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { lazy, Suspense } from "react";
import { serverEnvironment } from "~/state/server";
import type { ForkDiffHeaderAction, ForkDiffHeaderActionProps } from "../diffHeader/registry";
import { FEATURE } from "./panel";

// Lazy, and only on a code-graph server, so the diff panel's import graph stays free of
// thread state and the panel registry.
const DiffImpactButton = lazy(() => import("./DiffImpactButton"));

function DiffImpactAction(props: ForkDiffHeaderActionProps) {
  const { threadRef } = props;
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef?.environmentId ?? null));
  if (!threadRef || props.files.length === 0) return null;
  if (!supportsLoomFeature(config?.environment.capabilities, FEATURE)) return null;
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
