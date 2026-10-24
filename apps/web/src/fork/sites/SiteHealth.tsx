import type { ReactNode } from "react";
import type { SitesSnapshot } from "@t3tools/contracts/fork";
import {
  SITE_CHECK_STATES,
  SITE_HEALTH_STATES,
  SITE_TLS_WARNING_DAYS,
  siteCheckState,
  siteChecksHealth,
  siteTlsDaysLeft,
} from "@t3tools/client-runtime/fork";
import {
  ArrowRightLeftIcon,
  BracesIcon,
  GlobeIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TimerIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  LIBRARY_OUTLINE,
  LIBRARY_ROW,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";

type Service = SitesSnapshot["services"][number];
type Check = SitesSnapshot["checks"][number];

export const SERVICE_KINDS: Record<
  Service["kind"],
  { readonly label: string; readonly icon: LucideIcon }
> = {
  website: { label: "Website", icon: GlobeIcon },
  api: { label: "API", icon: BracesIcon },
  redirect: { label: "Redirect", icon: ArrowRightLeftIcon },
};

/** Drops the scheme, which every entry shares, so the part that differs is what you read. */
export function siteHost(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

const formatDuration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** One service and the endpoint checks that watch it, worst news first in each row. */
export function SiteServiceCard({
  service,
  checks,
  staleAfterSeconds,
  now,
  canManage,
  usedBy,
  onEditService,
  onAddCheck,
  onEditCheck,
}: {
  readonly service: Service;
  readonly checks: readonly Check[];
  readonly staleAfterSeconds: number;
  readonly now: number;
  readonly canManage: boolean;
  /** Shown in the shared registry, where a service is read apart from its sites. */
  readonly usedBy?: ReactNode;
  readonly onEditService: () => void;
  readonly onAddCheck: () => void;
  readonly onEditCheck: (check: Check) => void;
}) {
  const kind = SERVICE_KINDS[service.kind];
  const health = siteChecksHealth(checks, staleAfterSeconds, now, !service.active);
  const state = SITE_HEALTH_STATES[health.state];
  return (
    <section aria-label={service.name} className={cn(LIBRARY_OUTLINE, "overflow-hidden")}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span
          aria-hidden
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
        >
          <kind.icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{service.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{kind.label}</span>
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {siteHost(service.url)}
          </p>
        </div>
        <LibraryStateBadge tone={state.tone}>
          {health.state === "healthy" || health.state === "failing"
            ? `${health.passing} of ${health.total} passing`
            : state.label}
        </LibraryStateBadge>
        <div className="flex items-center gap-0.5">
          <Button shape="pill" size="xs" variant="ghost" disabled={!canManage} onClick={onAddCheck}>
            <PlusIcon />
            Add check
          </Button>
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`Edit service ${service.name}`}
            disabled={!canManage}
            onClick={onEditService}
          >
            <PencilIcon />
          </Button>
        </div>
      </div>
      {usedBy ? <div className="-mt-1 px-4 pb-3 ps-16">{usedBy}</div> : null}
      <div className="border-t border-border px-4 py-2">
        {checks.length ? (
          <ul className="flex flex-col">
            {checks.map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                staleAfterSeconds={staleAfterSeconds}
                now={now}
                canManage={canManage}
                onEdit={() => onEditCheck(check)}
              />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">
            Nothing watches this service yet. Add a check to know when it stops answering.
          </p>
        )}
      </div>
    </section>
  );
}

function CheckRow({
  check,
  staleAfterSeconds,
  now,
  canManage,
  onEdit,
}: {
  readonly check: Check;
  readonly staleAfterSeconds: number;
  readonly now: number;
  readonly canManage: boolean;
  readonly onEdit: () => void;
}) {
  const state = siteCheckState(check, staleAfterSeconds, now);
  const presentation = SITE_CHECK_STATES[state];
  const last = check.last;
  const tlsDays = siteTlsDaysLeft(last?.tls_expires_at, now);
  const expected = check.expected_status ?? 200;
  const problem =
    last?.error ??
    (state === "failing" && last?.status != null && last.status !== expected
      ? `Answered ${last.status}, expected ${expected}.`
      : null);
  return (
    <li className={cn(LIBRARY_ROW, "-mx-2 flex min-w-0 flex-col gap-1 px-2 py-2")}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <LibraryStateDot tone={presentation.tone} />
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-medium">{check.name}</p>
          <p className="truncate font-mono text-2xs text-muted-foreground">{siteHost(check.url)}</p>
        </div>
        {last ? (
          <dl className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
            <div className="flex items-center gap-1">
              <dt className="sr-only">Status</dt>
              <dd
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-mono text-2xs font-medium",
                  last.ok
                    ? "bg-muted text-foreground/80 dark:bg-accent"
                    : "bg-destructive/10 text-destructive-foreground",
                )}
              >
                {last.status ?? "No answer"}
              </dd>
            </div>
            <div className="flex items-center gap-1">
              <dt>
                <TimerIcon aria-label="Response time" className="size-3.5 opacity-70" />
              </dt>
              <dd>{formatDuration(last.duration_ms)}</dd>
            </div>
            {tlsDays !== null ? (
              <div
                className={cn(
                  "flex items-center gap-1",
                  tlsDays < 0
                    ? "text-destructive-foreground"
                    : tlsDays <= SITE_TLS_WARNING_DAYS && "text-warning-foreground",
                )}
              >
                <dt>
                  {tlsDays <= SITE_TLS_WARNING_DAYS ? (
                    <ShieldAlertIcon aria-label="Certificate" className="size-3.5" />
                  ) : (
                    <ShieldCheckIcon aria-label="Certificate" className="size-3.5 opacity-70" />
                  )}
                </dt>
                <dd>{tlsDays < 0 ? "expired" : `${tlsDays}d left`}</dd>
              </div>
            ) : null}
            <div>
              <dt className="sr-only">Checked</dt>
              <dd>
                <time dateTime={last.checked_at}>{formatRelativeTimeLabel(last.checked_at)}</time>
              </dd>
            </div>
          </dl>
        ) : null}
        <LibraryStateBadge tone={presentation.tone}>{presentation.label}</LibraryStateBadge>
        <Button
          shape="pill"
          size="icon-xs"
          variant="ghost"
          aria-label={`Edit check ${check.name}`}
          disabled={!canManage}
          onClick={onEdit}
        >
          <PencilIcon />
        </Button>
      </div>
      {problem ? (
        <p className="ps-5 text-xs text-destructive-foreground wrap-anywhere">{problem}</p>
      ) : null}
    </li>
  );
}
