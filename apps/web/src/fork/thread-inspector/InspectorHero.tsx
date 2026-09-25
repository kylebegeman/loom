import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { PROVIDER_ICON_BY_PROVIDER } from "~/components/chat/providerIconUtils";
import { cn } from "~/lib/utils";
import type { InspectorAction, InspectorFact, InspectorModel } from "./model";
import {
  InspectorElapsed,
  InspectorProgressBar,
  InspectorStatusDot,
  inspectorToneText,
} from "./parts";

/**
 * The status block both surfaces open with: what the thread is doing, for how long, the
 * current step, and the facts that explain the rest (model, runtime mode, plan mode). The
 * card keeps it to one line each; the panel lets the detail breathe.
 */
export function InspectorHero({
  model,
  size,
  onAction,
}: {
  model: InspectorModel;
  size: "card" | "panel";
  onAction: (action: InspectorAction) => void;
}) {
  const { status } = model;
  const panel = size === "panel";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <InspectorStatusDot tone={status.tone} size={panel ? "md" : "sm"} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-medium",
            inspectorToneText(status.tone),
          )}
        >
          {status.label}
        </span>
        {status.since ? <InspectorElapsed since={status.since} /> : null}
        {status.respond ? (
          <Button
            size={panel ? "xs" : "micro"}
            variant="default"
            onClick={() => onAction({ kind: "focus-composer" })}
          >
            Respond
          </Button>
        ) : null}
      </div>
      {status.detail || status.progress || model.facts.length > 0 ? (
        <div className={cn("flex flex-col gap-1.5", panel ? "pl-4" : "pl-3.5")}>
          {status.detail ? (
            <p
              className={cn(
                "text-xs text-muted-foreground",
                panel ? "line-clamp-3" : "line-clamp-2",
              )}
            >
              {status.detail}
            </p>
          ) : null}
          {status.progress ? (
            <div className="flex items-center gap-2">
              <InspectorProgressBar
                value={(status.progress.completed / Math.max(status.progress.total, 1)) * 100}
                tone="info"
                label="Plan progress"
              />
              <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                {status.progress.completed}/{status.progress.total}
              </span>
            </div>
          ) : null}
          {model.facts.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {model.facts.map((fact) => (
                <FactChip key={fact.id} fact={fact} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FactChip({ fact }: { fact: InspectorFact }) {
  const Icon = fact.driverKind ? (PROVIDER_ICON_BY_PROVIDER[fact.driverKind] ?? null) : null;
  return (
    <Badge variant="outline" size="sm" title={fact.title}>
      {Icon ? <Icon aria-hidden /> : null}
      {fact.label}
    </Badge>
  );
}
