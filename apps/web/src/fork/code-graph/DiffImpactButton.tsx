import type { ScopedThreadRef } from "@t3tools/contracts";
import { NetworkIcon } from "lucide-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useServerConfigs } from "~/state/entities";
import type { ForkDiffHeaderActionProps } from "../diffHeader/registry";
import { FEATURE } from "./panel";
import { openImpact } from "./state";

/** The diff panel's scope labels, as they read inside a sentence. */
const SCOPE_TEXT: Record<string, string> = {
  Uncommitted: "the uncommitted changes",
  Changes: "these changes",
  "Latest turn": "the latest turn",
};

export default function DiffImpactButton({
  threadRef,
  files,
  scopeLabel,
}: ForkDiffHeaderActionProps & { readonly threadRef: ScopedThreadRef }) {
  const config = useServerConfigs().get(threadRef.environmentId);
  if (!loomFeaturesOf(config?.environment.capabilities).includes(FEATURE)) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Show impact of these changes"
            onClick={() =>
              openImpact(threadRef, {
                files: files.map((file) => file.filePath),
                scopeLabel: SCOPE_TEXT[scopeLabel] ?? scopeLabel,
              })
            }
          />
        }
      >
        <NetworkIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="top">Show impact of these changes</TooltipPopup>
    </Tooltip>
  );
}
