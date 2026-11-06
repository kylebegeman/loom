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
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";

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

/** One service and the endpoint checks that watch it, as rows in its section's group. */
export function SiteServiceGroup({
  service,
  checks,
  staleAfterSeconds,
  now,
  canManage,
  separated = false,
  inset = true,
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
  /** Divides this service from the one above it in the same group. */
  readonly separated?: boolean;
  readonly inset?: boolean;
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
      className={cn(separated && "border-t border-border")}
    >
      <View className={cn("flex-row items-start gap-2 py-4", inset && "ps-5 pe-2")}>
        <View className="min-w-0 flex-1 gap-1.5">
          <View className="flex-row items-baseline gap-2">
            <Text textRole="headline" className="shrink font-t3-bold text-foreground">
              {service.name}
            </Text>
            <Text textRole="footnote" className="text-foreground-muted">
              {SERVICE_KIND_LABELS[service.kind]}
            </Text>
          </View>
          <Text textRole="footnote" className="text-foreground-muted">
            {siteHost(service.url)}
          </Text>
          <View className="flex-row items-center gap-2 pt-1">
            <SiteStateDot tone={state.tone} />
            <Text textRole="footnote" className="text-foreground-muted">
              {health.state === "healthy" || health.state === "failing"
                ? `${health.passing} of ${health.total} passing`
                : state.label}
            </Text>
          </View>
        </View>
        {canManage ? (
          <Menu
            title={service.name}
            actions={[
              { id: "edit", title: "Edit service", image: "pencil" },
              { id: "check", title: "Add check", image: "plus" },
            ]}
            onPressAction={({ nativeEvent }) =>
              nativeEvent.event === "edit" ? onEditService() : onAddCheck()
            }
          >
            <IconButton
              icon="ellipsis"
              accessibilityLabel={`Actions for ${service.name}`}
              tintColorClassName="accent-icon-muted"
            />
          </Menu>
        ) : null}
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
            inset={inset}
            onEdit={() => onEditCheck(check)}
          />
        ))
      ) : (
        <Text
          textRole="body"
          className={cn(
            "border-t border-border-subtle py-4 text-foreground-muted",
            inset && "px-5",
          )}
        >
          Nothing watches this service yet. Add a check to know when it stops answering.
        </Text>
      )}
      {!checks.length && canManage ? (
        <View className={cn("pb-2", inset && "px-2")}>
          <Button
            label="Add check"
            icon="plus"
            tone="text"
            accessibilityLabel={`Add check to ${service.name}`}
            disabled={!canManage}
            onPress={onAddCheck}
          />
        </View>
      ) : null}
    </View>
  );
}

function SiteCheckRow({
  check,
  staleAfterSeconds,
  now,
  canManage,
  inset,
  onEdit,
}: {
  readonly check: Check;
  readonly staleAfterSeconds: number;
  readonly now: number;
  readonly canManage: boolean;
  readonly inset: boolean;
  readonly onEdit: () => void;
}) {
  const state = siteCheckState(check, staleAfterSeconds, now);
  const presentation = SITE_CHECK_STATES[state];
  const last = check.last;
  const tlsDays = siteTlsDaysLeft(last?.tls_expires_at, now);
  const problem = siteCheckProblem(check, state);
  return (
    <View
      className={cn(
        "flex-row items-start gap-2 border-t border-border-subtle py-4",
        inset && "ps-5 pe-2",
      )}
    >
      <View className="min-w-0 flex-1 gap-2">
        <View className="flex-row items-center gap-2">
          <SiteStateDot tone={presentation.tone} />
          <Text textRole="body" className="min-w-0 flex-1 font-t3-medium text-foreground">
            {check.name}
          </Text>
        </View>
        <Text textRole="footnote" className="text-foreground-muted">
          {siteHost(check.url)}
        </Text>
        {last ? (
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
            <Text
              accessibilityLabel={`Status ${last.status ?? "no answer"}`}
              textRole="footnote"
              className={cn(
                "font-t3-medium tabular-nums",
                last.ok ? "text-foreground-muted" : "text-danger-foreground",
              )}
            >
              {last.status !== null ? `HTTP ${last.status}` : "No answer"}
            </Text>
            <Text
              accessibilityLabel={`Response time ${formatDuration(last.duration_ms)}`}
              textRole="footnote"
              className="tabular-nums text-foreground-muted"
            >
              {formatDuration(last.duration_ms)}
            </Text>
            {tlsDays !== null ? (
              <Text
                textRole="footnote"
                className={cn(
                  "tabular-nums",
                  tlsDays < 0
                    ? "text-danger-foreground"
                    : tlsDays <= SITE_TLS_WARNING_DAYS
                      ? "text-warning-foreground"
                      : "text-foreground-muted",
                )}
              >
                {tlsDays < 0 ? "Certificate expired" : `Certificate: ${tlsDays} days left`}
              </Text>
            ) : null}
          </View>
        ) : null}
        {problem ? (
          <Text textRole="footnote" className="text-danger-foreground">
            {problem}
          </Text>
        ) : null}
        <Text textRole="footnote" className="text-foreground-muted">
          {presentation.label}
          {last ? ` · Checked ${ago(last.checked_at)}` : " · Waiting for the first check"}
        </Text>
      </View>
      {canManage ? (
        <Menu
          title={check.name}
          actions={[{ id: "edit", title: "Edit check", image: "pencil" }]}
          onPressAction={onEdit}
        >
          <IconButton
            icon="ellipsis"
            accessibilityLabel={`Actions for ${check.name}`}
            tintColorClassName="accent-icon-muted"
          />
        </Menu>
      ) : null}
    </View>
  );
}
