import type { ReactNode } from "react";
import { View } from "react-native";
import type { SitesSnapshot } from "@t3tools/contracts/fork";
import {
  SITE_CHECK_STATES,
  SITE_HEALTH_STATES,
  SITE_TLS_WARNING_DAYS,
  siteCheckState,
  siteChecksHealth,
  siteTlsDaysLeft,
  type LibraryWorkflowTone,
  type SiteCheckState,
} from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { LibraryStateBadge } from "../library/LibraryStateBadge";

type Service = SitesSnapshot["services"][number];
type Check = SitesSnapshot["checks"][number];

export const SERVICE_KIND_LABELS: Record<Service["kind"], string> = {
  website: "Website",
  api: "API",
  redirect: "Redirect",
};

const DOT_FILL: Record<LibraryWorkflowTone, string> = {
  neutral: "bg-foreground-muted",
  active: "bg-adaptive-sky-600-400",
  success: "bg-adaptive-emerald-600-400",
  warning: "bg-warning-foreground",
  danger: "bg-danger-foreground",
};

export const ago = (iso: string) => `${relativeTime(iso)} ago`;

/** Drops the scheme, which every entry shares, so the part that differs is what you read. */
export function siteHost(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export const formatDuration = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

/** What went wrong with a check, in words, or nothing when it answered as expected. */
export function siteCheckProblem(check: Check, state: SiteCheckState) {
  const last = check.last;
  const expected = check.expected_status ?? 200;
  return (
    last?.error ??
    (state === "failing" && last?.status != null && last.status !== expected
      ? `Answered ${last.status}, expected ${expected}.`
      : null)
  );
}

export function SiteStateDot({ tone }: { readonly tone: LibraryWorkflowTone }) {
  return <View className={cn("size-2 shrink-0 rounded-full", DOT_FILL[tone])} />;
}

/** A section heading in the grouped-list voice the rest of the app uses. */
export function SitesSection({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-2.5">
      <View className="flex-row items-baseline justify-between gap-3 px-1">
        <Text accessibilityRole="header" className="text-sm font-t3-medium text-foreground-muted">
          {title}
        </Text>
        {detail ? (
          <Text className="text-xs tabular-nums text-foreground-muted">{detail}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** One service and the endpoint checks that watch it, in an outline group without a fill. */
export function SiteServiceGroup({
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
  const health = siteChecksHealth(checks, staleAfterSeconds, now, !service.active);
  const state = SITE_HEALTH_STATES[health.state];
  return (
    <View
      accessibilityLabel={`${service.name}, ${state.label}`}
      className="overflow-hidden rounded-2xl border border-border"
    >
      <View className="flex-row items-start gap-2 py-3 ps-4 pe-1">
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-baseline gap-2">
            <Text numberOfLines={1} className="shrink font-t3-semibold text-foreground">
              {service.name}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {SERVICE_KIND_LABELS[service.kind]}
            </Text>
          </View>
          <Text numberOfLines={1} className="font-mono text-2xs text-foreground-muted">
            {siteHost(service.url)}
          </Text>
          <View className="pt-1">
            <LibraryStateBadge
              tone={state.tone}
              label={
                health.state === "healthy" || health.state === "failing"
                  ? `${health.passing} of ${health.total} passing`
                  : state.label
              }
            />
          </View>
        </View>
        <IconButton
          icon="pencil"
          accessibilityLabel={`Edit service ${service.name}`}
          tintColorClassName="accent-icon-muted"
          disabled={!canManage}
          onPress={onEditService}
        />
      </View>
      {usedBy ? <View className="px-4 pb-3">{usedBy}</View> : null}
      {checks.length ? (
        checks.map((check) => (
          <SiteCheckRow
            key={check.id}
            check={check}
            staleAfterSeconds={staleAfterSeconds}
            now={now}
            canManage={canManage}
            onEdit={() => onEditCheck(check)}
          />
        ))
      ) : (
        <Text className="border-t border-border-subtle px-4 py-3 text-xs text-foreground-muted">
          Nothing watches this service yet. Add a check to know when it stops answering.
        </Text>
      )}
      <View className="border-t border-border-subtle px-1">
        <Button
          label="Add check"
          icon="plus"
          tone="text"
          accessibilityLabel={`Add check to ${service.name}`}
          disabled={!canManage}
          onPress={onAddCheck}
        />
      </View>
    </View>
  );
}

function SiteCheckRow({
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
  const problem = siteCheckProblem(check, state);
  return (
    <View className="flex-row items-start gap-2 border-t border-border-subtle py-2.5 ps-4 pe-1">
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-t3-medium text-foreground">
            {check.name}
          </Text>
          <LibraryStateBadge tone={presentation.tone} label={presentation.label} />
        </View>
        <Text numberOfLines={1} className="font-mono text-2xs text-foreground-muted">
          {siteHost(check.url)}
        </Text>
        {last ? (
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
            <View
              className={cn("rounded-md px-1.5 py-0.5", last.ok ? "bg-row-hover" : "bg-danger")}
            >
              <Text
                accessibilityLabel={`Status ${last.status ?? "no answer"}`}
                className={cn(
                  "font-mono text-2xs font-t3-medium",
                  last.ok ? "text-foreground" : "text-danger-foreground",
                )}
              >
                {last.status ?? "No answer"}
              </Text>
            </View>
            <Text
              accessibilityLabel={`Response time ${formatDuration(last.duration_ms)}`}
              className="text-xs tabular-nums text-foreground-muted"
            >
              {formatDuration(last.duration_ms)}
            </Text>
            {tlsDays !== null ? (
              <Text
                className={cn(
                  "text-xs tabular-nums",
                  tlsDays < 0
                    ? "text-danger-foreground"
                    : tlsDays <= SITE_TLS_WARNING_DAYS
                      ? "text-warning-foreground"
                      : "text-foreground-muted",
                )}
              >
                {tlsDays < 0 ? "Certificate expired" : `Certificate ${tlsDays}d left`}
              </Text>
            ) : null}
            <Text className="text-xs tabular-nums text-foreground-muted">
              {ago(last.checked_at)}
            </Text>
          </View>
        ) : null}
        {problem ? <Text className="text-xs text-danger-foreground">{problem}</Text> : null}
      </View>
      <IconButton
        icon="pencil"
        accessibilityLabel={`Edit check ${check.name}`}
        tintColorClassName="accent-icon-muted"
        disabled={!canManage}
        onPress={onEdit}
      />
    </View>
  );
}
