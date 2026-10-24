import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { LibraryProject, SiteAnalytics, SitesSnapshot } from "@t3tools/contracts/fork";
import {
  SITE_HEALTH_STATES,
  libraryProjectColor,
  siteChecksHealth,
  siteHealth,
  siteTrafficDays,
} from "@t3tools/client-runtime/fork";
import {
  ActivityIcon,
  AppWindowIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChartNoAxesColumnIcon,
  ChevronDownIcon,
  CirclePauseIcon,
  ClockIcon,
  ExternalLinkIcon,
  FoldersIcon,
  PauseIcon,
  InfoIcon,
  LayoutDashboardIcon,
  LinkIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  ServerIcon,
  StarIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import type { SitesSearch } from "~/routes/sites";
import type { EnvironmentQueryView } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryHero, LibraryVital, LibraryVitals } from "../project-library/LibraryCollection";
import {
  LIBRARY_OUTLINE,
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryNotice,
  LibraryPanel,
  LibrarySection,
  LibrarySpecSheet,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { Sparkline } from "../project-library/LibraryData";
import { LibraryTabs, type LibraryTab } from "../project-library/LibraryTabs";
import { ProjectColorDot } from "../project-library/ProjectIdentity";
import type { SiteEditTarget } from "./SiteEditor";
import {
  ActionHint,
  CertificateLabel,
  type ActiveToggle,
  CheckTicks,
  EndpointsTable,
  SERVICE_KINDS,
  SiteMark,
  checkIssues,
  checkVitals,
  formatDuration,
  orderServicesForAttention,
  siteChecks,
  siteHost,
  siteLastChecked,
  type CheckIssue,
} from "./SiteHealth";
import { SitePreview, normalizePreviewPath, type PreviewDevice } from "./SitePreview";
import {
  SiteTraffic,
  SiteTrafficBreakdown,
  SiteTrafficSkeleton,
  SiteTrafficSummary,
  formatCount,
} from "./SiteTraffic";

type Site = SitesSnapshot["sites"][number];
type Service = SitesSnapshot["services"][number];
type Check = SitesSnapshot["checks"][number];
type SiteTab = NonNullable<SitesSearch["tab"]>;
type SiteHealthSummary = ReturnType<typeof siteHealth>;

/** Said on every control that changes a site while the page cannot, unless the page says more. */
const DEFAULT_MANAGE_HINT =
  "Changing sites needs a connected Library with site management and settings access.";
/** The run endpoint takes no scope, so the label alone would overpromise on a site's page. */
const RUN_ALL_HINT = "Runs every check in your Library, this site's included.";

const EXPIRY_DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** The window a check result stays trustworthy for, in the unit a person would say it in. */
function formatWindow(seconds: number) {
  if (seconds < 120) return `${seconds} seconds`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
}

function healthHeadline(health: SiteHealthSummary) {
  switch (health.state) {
    case "failing":
      return `${health.failing} of ${health.total} ${health.total === 1 ? "check" : "checks"} failing`;
    case "stale":
      return "Results are out of date";
    case "healthy":
      return health.total === 1 ? "Its one check is passing" : `All ${health.total} checks passing`;
    case "unchecked":
      return "Waiting for the first results";
    case "unmonitored":
      return "Nothing watches this site yet";
    case "paused":
      return "Monitoring is paused";
  }
}

/**
 * One site, after the Projects page: a hero holding who it is, its vital signs and what to do
 * with it, then one view at a time. Overview is the glance, Preview the live site, Traffic its
 * visits and Checks its endpoints.
 */
export function SiteDetail({
  site,
  snapshot,
  now,
  projects,
  analytics,
  canManage,
  running,
  onRunChecks,
  onEdit,
  manageHint,
  activeToggle,
}: {
  readonly site: Site;
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly analytics: EnvironmentQueryView<SiteAnalytics>;
  readonly canManage: boolean;
  readonly running: boolean;
  readonly onRunChecks: () => void;
  readonly onEdit: (target: SiteEditTarget) => void;
  /** Why changes are off while `canManage` is false, when the page knows more than the default. */
  readonly manageHint?: string | null | undefined;
  /** Pauses and resumes in one click; without it, the editor is the way to either. */
  readonly activeToggle?: ActiveToggle | undefined;
}) {
  const search = useSearch({ from: "/sites" });
  const navigate = useNavigate();
  // Kept here rather than in the preview, so the chosen width survives a trip to another view.
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const tab: SiteTab = search.tab ?? "overview";
  const services = snapshot.services.filter((service) => site.serviceIds.includes(service.id));
  const checks = siteChecks(site, snapshot);
  const health = siteHealth(site, snapshot, now);
  const state = SITE_HEALTH_STATES[health.state];
  const lastChecked = siteLastChecked(checks);
  const blocked = canManage ? null : (manageHint ?? DEFAULT_MANAGE_HINT);
  const primary = snapshot.primarySiteId === site.id;

  const go = (next: Pick<SitesSearch, "tab" | "path">) =>
    void navigate({ to: "/sites", search: { ...search, siteId: site.id, ...next }, replace: true });
  const showTab = (next: SiteTab) =>
    go({ tab: next === "overview" ? undefined : next, path: search.path });
  const previewPage = (path: string | undefined) => go({ tab: "preview", path });
  const previewAnalyticsPage = (page: string) => {
    const result = normalizePreviewPath(page, site.url);
    previewPage(result.ok ? result.path : undefined);
  };
  const editSite = () => onEdit({ kind: "site", row: site });
  const editServes = () => onEdit({ kind: "site", row: site, step: "serves" });
  const editMonitoring = () => onEdit({ kind: "site", row: site, step: "monitoring" });
  const toggling = activeToggle?.pending === `site:${site.id}`;
  const editCheck = (check: Check) => onEdit({ kind: "check", row: check });
  const addCheck = (service: Service) => onEdit({ kind: "check", serviceId: service.id });

  const tabs: readonly LibraryTab<SiteTab>[] = [
    { value: "overview", label: "Overview", icon: LayoutDashboardIcon },
    { value: "preview", label: "Preview", icon: AppWindowIcon },
    { value: "traffic", label: "Traffic", icon: ChartNoAxesColumnIcon },
    {
      value: "checks",
      label: "Checks",
      icon: ActivityIcon,
      count: health.failing || checks.length,
      urgent: health.failing > 0,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <LibraryHero
        tile={
          <span className="shrink-0 rounded-2xl bg-card shadow-sm ring-1 ring-border">
            <SiteMark url={site.url} size="2xl" />
          </span>
        }
        title={site.name}
        meta={
          <>
            <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm font-mono text-foreground/80 underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="truncate">{siteHost(site.url)}</span>
              <ExternalLinkIcon aria-hidden className="size-3 shrink-0 opacity-70" />
            </a>
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon aria-hidden className="size-3.5 opacity-70" />
              {lastChecked ? (
                <time dateTime={lastChecked}>
                  Checked {formatRelativeTimeLabel(lastChecked, now)}
                </time>
              ) : (
                "Not checked yet"
              )}
            </span>
            {primary ? (
              <span className="inline-flex items-center gap-1.5">
                <StarIcon aria-hidden className="size-3.5 opacity-70" />
                Primary site
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <Button shape="pill" render={<a href={site.url} target="_blank" rel="noreferrer" />}>
              <ArrowUpRightIcon />
              Visit site
            </Button>
            <ActionHint hint={blocked ?? RUN_ALL_HINT}>
              <Button
                shape="pill"
                variant="outline"
                disabled={!canManage || running}
                onClick={onRunChecks}
              >
                <PlayIcon />
                {running ? "Running checks…" : "Run all checks"}
              </Button>
            </ActionHint>
            <ActionHint hint={blocked}>
              <Button shape="pill" variant="outline" disabled={!canManage} onClick={editSite}>
                <PencilIcon />
                Edit
              </Button>
            </ActionHint>
          </>
        }
        footer={<SiteVitals checks={checks} snapshot={snapshot} now={now} analytics={analytics} />}
      />

      {site.active ? null : (
        <LibraryNotice
          icon={CirclePauseIcon}
          action={
            <ActionHint hint={blocked}>
              {activeToggle ? (
                <Button
                  shape="pill"
                  size="sm"
                  variant="outline"
                  disabled={!canManage || toggling}
                  onClick={() => activeToggle.toggle({ kind: "site", row: site })}
                >
                  <PlayIcon />
                  {toggling ? "Resuming…" : "Resume monitoring"}
                </Button>
              ) : (
                <Button
                  shape="pill"
                  size="sm"
                  variant="outline"
                  disabled={!canManage}
                  onClick={editMonitoring}
                >
                  Resume in editor
                </Button>
              )}
            </ActionHint>
          }
        >
          This site is paused, so its checks don't count toward its health. Pausing keeps the site
          and its history.
        </LibraryNotice>
      )}

      <LibraryTabs
        label="Site views"
        tabs={tabs}
        selected={tab}
        onSelect={showTab}
        actions={
          tab === "checks" ? (
            <ChecksActions
              services={services}
              canManage={canManage}
              blocked={blocked}
              running={running}
              onRunChecks={onRunChecks}
              onAddCheck={addCheck}
              onLinkServices={editMonitoring}
            />
          ) : tab === "traffic" && analytics.data ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              Last {analytics.data.days} days
            </span>
          ) : null
        }
      >
        {tab === "overview" ? (
          <SiteOverview
            site={site}
            snapshot={snapshot}
            services={services}
            checks={checks}
            health={health}
            lastChecked={lastChecked}
            now={now}
            projects={projects}
            analytics={analytics}
            canManage={canManage}
            blocked={blocked}
            activeToggle={activeToggle}
            onShowTab={showTab}
            onEditServes={editServes}
            onEditMonitoring={editMonitoring}
            onEditCheck={editCheck}
          />
        ) : null}
        {tab === "preview" ? (
          <SitePreview
            site={site}
            path={search.path}
            device={device}
            pages={analytics.data?.pages.map((page) => page.path)}
            onPathChange={previewPage}
            onDeviceChange={setDevice}
          />
        ) : null}
        {tab === "traffic" ? (
          <div className="flex min-w-0 flex-col gap-8">
            <LibraryErrorNotice error={analytics.error} onRetry={analytics.refresh} />
            {analytics.data ? (
              <>
                <SiteTraffic analytics={analytics.data} />
                <SiteTrafficBreakdown analytics={analytics.data} onPreview={previewAnalyticsPage} />
              </>
            ) : analytics.isPending ? (
              <SiteTrafficSkeleton />
            ) : null}
            <VisitSources
              site={site}
              canManage={canManage}
              blocked={blocked}
              onEdit={editMonitoring}
            />
          </div>
        ) : null}
        {tab === "checks" ? (
          <div className="flex min-w-0 flex-col gap-3">
            {services.length ? (
              <EndpointsTable
                label={`${site.name} checks`}
                services={services}
                snapshot={snapshot}
                now={now}
                canManage={canManage}
                manageHint={blocked}
                activeToggle={activeToggle}
                onEditService={(service) => onEdit({ kind: "service", row: service })}
                onAddCheck={addCheck}
                onEditCheck={editCheck}
              />
            ) : (
              <LibraryEmpty
                icon={ActivityIcon}
                title="Nothing watches this site yet"
                action={
                  <ActionHint hint={blocked}>
                    <Button
                      shape="pill"
                      variant="outline"
                      disabled={!canManage}
                      onClick={editMonitoring}
                    >
                      <LinkIcon />
                      Link services
                    </Button>
                  </ActionHint>
                }
              >
                Link the services this site runs on, and their checks show here with what each one
                last saw.
              </LibraryEmpty>
            )}
            <p className="text-xs text-muted-foreground">
              A result counts as out of date {formatWindow(snapshot.staleAfterSeconds)} after its
              check last ran. Run all checks runs every check in your Library, not only this site's.
            </p>
          </div>
        ) : null}
      </LibraryTabs>
    </div>
  );
}

/** The hero's foot: what the checks last saw beside the window's traffic. */
function SiteVitals({
  checks,
  snapshot,
  now,
  analytics,
}: {
  readonly checks: readonly Check[];
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly analytics: EnvironmentQueryView<SiteAnalytics>;
}) {
  const vitals = checkVitals(checks, now);
  const traffic = analytics.data;
  const unavailable = analytics.error ? "Unavailable" : "None";
  return (
    <LibraryVitals>
      <LibraryVital label="Checks">
        <CheckTicks checks={checks} staleAfterSeconds={snapshot.staleAfterSeconds} now={now} />
      </LibraryVital>
      <LibraryVital label="Slowest response">
        {vitals.slowest === null ? (
          <span className="text-muted-foreground">None yet</span>
        ) : (
          formatDuration(vitals.slowest)
        )}
      </LibraryVital>
      <LibraryVital label="Certificate">
        <CertificateLabel days={vitals.certificate} />
      </LibraryVital>
      <LibraryVital label={traffic ? `Page views, ${traffic.days} days` : "Page views"}>
        {traffic ? (
          <span className="inline-flex items-center gap-2">
            <Sparkline
              values={siteTrafficDays(traffic).map((day) => day.pageviews)}
              label={`Daily page views over the last ${traffic.days} days`}
            />
            {formatCount(traffic.pageviews)}
          </span>
        ) : analytics.isPending ? (
          <Skeleton className="h-3.5 w-28" />
        ) : (
          <span className="text-muted-foreground">{unavailable}</span>
        )}
      </LibraryVital>
      <LibraryVital label={traffic ? `Visitors, ${traffic.days} days` : "Visitors"}>
        {traffic ? (
          formatCount(traffic.visitors)
        ) : analytics.isPending ? (
          <Skeleton className="h-3.5 w-10" />
        ) : (
          <span className="text-muted-foreground">{unavailable}</span>
        )}
      </LibraryVital>
    </LibraryVitals>
  );
}

const byName = (a: Service, b: Service) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** The Checks view's own controls, on the tab row so the view never stacks a second bar. */
function ChecksActions({
  services,
  canManage,
  blocked,
  running,
  onRunChecks,
  onAddCheck,
  onLinkServices,
}: {
  readonly services: readonly Service[];
  readonly canManage: boolean;
  readonly blocked: string | null;
  readonly running: boolean;
  readonly onRunChecks: () => void;
  readonly onAddCheck: (service: Service) => void;
  readonly onLinkServices: () => void;
}) {
  const only = services.length === 1 ? services[0] : undefined;
  return (
    <>
      <ActionHint hint={blocked ?? RUN_ALL_HINT}>
        <Button
          shape="pill"
          size="xs"
          variant="outline"
          disabled={!canManage || running}
          onClick={onRunChecks}
        >
          <PlayIcon />
          {running ? "Running checks…" : "Run all checks"}
        </Button>
      </ActionHint>
      {only ? (
        <ActionHint hint={blocked}>
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={!canManage}
            onClick={() => onAddCheck(only)}
          >
            <PlusIcon />
            Add check
          </Button>
        </ActionHint>
      ) : services.length > 1 ? (
        <ActionHint hint={blocked}>
          <Menu>
            <MenuTrigger
              disabled={!canManage}
              render={<Button shape="pill" size="xs" variant="outline" />}
            >
              <PlusIcon />
              Add check
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              <MenuGroup>
                <MenuGroupLabel>Watch an endpoint on</MenuGroupLabel>
                {services.toSorted(byName).map((service) => {
                  const Icon = SERVICE_KINDS[service.kind].icon;
                  return (
                    <MenuItem key={service.id} onClick={() => onAddCheck(service)}>
                      <Icon />
                      <span className="min-w-0 truncate">{service.name}</span>
                    </MenuItem>
                  );
                })}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        </ActionHint>
      ) : null}
      {services.length ? (
        <ActionHint hint={blocked}>
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={!canManage}
            onClick={onLinkServices}
          >
            <LinkIcon />
            Link services
          </Button>
        </ActionHint>
      ) : null}
    </>
  );
}

/** The glance: how the site is doing and who visits on the left, what it is made of on the right. */
function SiteOverview({
  site,
  snapshot,
  services,
  checks,
  health,
  lastChecked,
  now,
  projects,
  analytics,
  canManage,
  blocked,
  activeToggle,
  onShowTab,
  onEditServes,
  onEditMonitoring,
  onEditCheck,
}: {
  readonly site: Site;
  readonly snapshot: SitesSnapshot;
  readonly services: readonly Service[];
  readonly checks: readonly Check[];
  readonly health: SiteHealthSummary;
  readonly lastChecked: string | null;
  readonly now: number;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly analytics: EnvironmentQueryView<SiteAnalytics>;
  readonly canManage: boolean;
  readonly blocked: string | null;
  readonly activeToggle: ActiveToggle | undefined;
  readonly onShowTab: (tab: SiteTab) => void;
  readonly onEditServes: () => void;
  readonly onEditMonitoring: () => void;
  readonly onEditCheck: (check: Check) => void;
}) {
  return (
    <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-10">
        <HealthSection
          checks={checks}
          health={health}
          issues={checkIssues(checks, snapshot.staleAfterSeconds, now)}
          staleAfterSeconds={snapshot.staleAfterSeconds}
          lastChecked={lastChecked}
          now={now}
          hasServices={services.length > 0}
          canManage={canManage}
          blocked={blocked}
          onShowChecks={() => onShowTab("checks")}
          onLinkServices={onEditMonitoring}
          onEditCheck={onEditCheck}
        />
        <LibrarySection
          title="Traffic"
          icon={ChartNoAxesColumnIcon}
          action={
            <Button shape="pill" size="xs" variant="ghost" onClick={() => onShowTab("traffic")}>
              Details
              <ArrowRightIcon />
            </Button>
          }
        >
          <LibraryErrorNotice error={analytics.error} onRetry={analytics.refresh} />
          {analytics.data ? (
            <div className={cn(LIBRARY_OUTLINE, "p-4")}>
              <SiteTrafficSummary analytics={analytics.data} />
            </div>
          ) : analytics.isPending ? (
            <TrafficSummarySkeleton />
          ) : null}
        </LibrarySection>
        <PreviewInvite site={site} onOpen={() => onShowTab("preview")} />
      </div>
      <aside aria-label="About this site" className="flex min-w-0 flex-col gap-4">
        <ServesPanel
          site={site}
          projects={projects}
          canManage={canManage}
          blocked={blocked}
          onEdit={onEditServes}
        />
        <RunsOnPanel
          services={services}
          snapshot={snapshot}
          now={now}
          canManage={canManage}
          blocked={blocked}
          onShowChecks={() => onShowTab("checks")}
          onLinkServices={onEditMonitoring}
        />
        <DetailsPanel
          site={site}
          checks={checks}
          snapshot={snapshot}
          now={now}
          canManage={canManage}
          blocked={blocked}
          activeToggle={activeToggle}
        />
      </aside>
    </div>
  );
}

/** The site's health in one line, then each check that needs someone, in words. */
function HealthSection({
  checks,
  health,
  issues,
  staleAfterSeconds,
  lastChecked,
  now,
  hasServices,
  canManage,
  blocked,
  onShowChecks,
  onLinkServices,
  onEditCheck,
}: {
  readonly checks: readonly Check[];
  readonly health: SiteHealthSummary;
  readonly issues: readonly CheckIssue[];
  readonly staleAfterSeconds: number;
  readonly lastChecked: string | null;
  readonly now: number;
  readonly hasServices: boolean;
  readonly canManage: boolean;
  readonly blocked: string | null;
  readonly onShowChecks: () => void;
  readonly onLinkServices: () => void;
  readonly onEditCheck: (check: Check) => void;
}) {
  const state = SITE_HEALTH_STATES[health.state];
  return (
    <LibrarySection
      title="Health"
      icon={ActivityIcon}
      action={
        checks.length ? (
          <Button shape="pill" size="xs" variant="ghost" onClick={onShowChecks}>
            All checks
            <ArrowRightIcon />
          </Button>
        ) : null
      }
    >
      <div className={cn(LIBRARY_OUTLINE, "overflow-hidden")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <LibraryStateDot tone={state.tone} />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{healthHeadline(health)}</span>
            {lastChecked ? (
              <span className="ms-2 text-xs text-muted-foreground">
                Checked {formatRelativeTimeLabel(lastChecked, now)}
              </span>
            ) : null}
          </p>
          {checks.length ? (
            <CheckTicks checks={checks} staleAfterSeconds={staleAfterSeconds} now={now} />
          ) : hasServices ? (
            <Button shape="pill" size="xs" variant="outline" onClick={onShowChecks}>
              Open checks
              <ArrowRightIcon />
            </Button>
          ) : (
            <ActionHint hint={blocked}>
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={!canManage}
                onClick={onLinkServices}
              >
                <LinkIcon />
                Link services
              </Button>
            </ActionHint>
          )}
        </div>
        {issues.length ? (
          <ul
            aria-label="Needs attention"
            className="divide-y divide-border border-t border-border"
          >
            {issues.map((issue) => (
              <li key={issue.check.id} className="flex min-w-0 items-center gap-3 py-2 ps-4 pe-2">
                <LibraryStateDot tone={issue.tone} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-baseline gap-2 text-sm">
                    <span className="truncate font-medium">{issue.check.name}</span>
                    <span className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground sm:inline">
                      {siteHost(issue.check.url)}
                    </span>
                  </p>
                  <p
                    className={cn(
                      "text-xs wrap-anywhere",
                      issue.tone === "danger"
                        ? "text-destructive-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {issue.problem}
                  </p>
                </div>
                <ActionHint hint={blocked}>
                  <Button
                    shape="pill"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Edit check ${issue.check.name}`}
                    disabled={!canManage}
                    onClick={() => onEditCheck(issue.check)}
                  >
                    <PencilIcon />
                  </Button>
                </ActionHint>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </LibrarySection>
  );
}

const SUMMARY_SKELETON_ROWS = ["first", "second", "third"];

function TrafficSummarySkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading traffic"
      className={cn(LIBRARY_OUTLINE, "flex flex-col gap-3 p-4")}
    >
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton shape="card" className="h-16 w-full" />
      {SUMMARY_SKELETON_ROWS.map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

/**
 * The way to the live site. No live thumbnail here: every load runs the site's scripts and counts
 * as a visit, so the frame loads only once someone asks for it.
 */
function PreviewInvite({ site, onOpen }: { readonly site: Site; readonly onOpen: () => void }) {
  return (
    <div className={cn(LIBRARY_OUTLINE, "flex min-w-0 flex-wrap items-center gap-3 px-4 py-3")}>
      <span
        aria-hidden
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
      >
        <AppWindowIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-sm font-medium">See {siteHost(site.url)} live</p>
        <p className="text-xs text-muted-foreground">
          At desktop, tablet and phone widths, without leaving Loom.
        </p>
      </div>
      <Button shape="pill" size="sm" variant="outline" onClick={onOpen}>
        Open preview
        <ArrowRightIcon />
      </Button>
    </div>
  );
}

const PANEL_ROW =
  "flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-start text-sm outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function ServesPanel({
  site,
  projects,
  canManage,
  blocked,
  onEdit,
}: {
  readonly site: Site;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly canManage: boolean;
  readonly blocked: string | null;
  readonly onEdit: () => void;
}) {
  const ids = site.projectIds ?? [];
  return (
    <LibraryPanel title="Serves" icon={FoldersIcon} count={ids.length}>
      {ids.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {ids.map((id) => {
            const project = projects.get(id);
            return (
              <li key={id}>
                {project ? (
                  <Link to="/library/$projectId" params={{ projectId: id }} className={PANEL_ROW}>
                    <ProjectColorDot color={libraryProjectColor(project)} />
                    <span className="min-w-0 truncate">{project.title}</span>
                  </Link>
                ) : (
                  <p className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full bg-muted-foreground/40"
                    />
                    <span className="min-w-0 truncate">A project this Library can't open</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-2 px-3.5 pb-3">
          <p className="text-xs leading-relaxed text-warning-foreground">
            Not linked to a project yet, so it shows on no project's page.
          </p>
          <ActionHint hint={blocked}>
            <Button shape="pill" size="xs" variant="outline" disabled={!canManage} onClick={onEdit}>
              Choose projects
            </Button>
          </ActionHint>
        </div>
      )}
    </LibraryPanel>
  );
}

function RunsOnPanel({
  services,
  snapshot,
  now,
  canManage,
  blocked,
  onShowChecks,
  onLinkServices,
}: {
  readonly services: readonly Service[];
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly canManage: boolean;
  readonly blocked: string | null;
  readonly onShowChecks: () => void;
  readonly onLinkServices: () => void;
}) {
  return (
    <LibraryPanel title="Runs on" icon={ServerIcon} count={services.length}>
      {services.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {orderServicesForAttention(services, snapshot, now).map((service) => {
            const health = siteChecksHealth(
              snapshot.checks.filter((check) => check.service_id === service.id),
              snapshot.staleAfterSeconds,
              now,
              !service.active,
            );
            const state = SITE_HEALTH_STATES[health.state];
            const Icon = SERVICE_KINDS[service.kind].icon;
            return (
              <li key={service.id}>
                <button
                  type="button"
                  onClick={onShowChecks}
                  aria-label={`${service.name}, ${state.label}. Show its checks`}
                  className={PANEL_ROW}
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-3.5 shrink-0",
                      service.active ? "text-(--project-color)" : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      !service.active && "text-muted-foreground",
                    )}
                  >
                    {service.name}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                    <LibraryStateDot tone={state.tone} />
                    {health.total && health.state !== "paused"
                      ? `${health.passing}/${health.total}`
                      : state.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-2 px-3.5 pb-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Link the services this site runs on to watch their endpoints.
          </p>
          <ActionHint hint={blocked}>
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={!canManage}
              onClick={onLinkServices}
            >
              <LinkIcon />
              Link services
            </Button>
          </ActionHint>
        </div>
      )}
    </LibraryPanel>
  );
}

function DetailsPanel({
  site,
  checks,
  snapshot,
  now,
  canManage,
  blocked,
  activeToggle,
}: {
  readonly site: Site;
  readonly checks: readonly Check[];
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly canManage: boolean;
  readonly blocked: string | null;
  readonly activeToggle: ActiveToggle | undefined;
}) {
  const vitals = checkVitals(checks, now);
  const expires = vitals.certificateExpiresAt ? new Date(vitals.certificateExpiresAt) : null;
  return (
    <LibraryPanel title="Details" icon={InfoIcon}>
      <div className="border-t border-border px-3.5 py-1">
        <LibrarySpecSheet
          label="Site details"
          rows={[
            {
              label: "Address",
              value: <span className="font-mono font-normal">{siteHost(site.url)}</span>,
            },
            {
              label: "Counting visits from",
              value: site.origins.length ? (
                <span className="flex flex-col items-end gap-0.5 font-mono font-normal">
                  {site.origins.map((origin) => (
                    <span key={origin}>{siteHost(origin)}</span>
                  ))}
                </span>
              ) : (
                <span className="font-normal text-muted-foreground">No origins</span>
              ),
            },
            {
              label: "Monitoring",
              value:
                site.active && activeToggle ? (
                  <span className="inline-flex items-center gap-2">
                    On
                    <ActionHint hint={blocked}>
                      <Button
                        shape="pill"
                        size="xs"
                        variant="ghost"
                        disabled={!canManage || activeToggle.pending === `site:${site.id}`}
                        onClick={() => activeToggle.toggle({ kind: "site", row: site })}
                      >
                        <PauseIcon />
                        Pause
                      </Button>
                    </ActionHint>
                  </span>
                ) : site.active ? (
                  "On"
                ) : (
                  "Paused"
                ),
            },
            { label: "Out of date after", value: formatWindow(snapshot.staleAfterSeconds) },
            {
              label: "Certificate",
              value:
                expires && !Number.isNaN(expires.getTime()) ? (
                  <span>
                    {EXPIRY_DAY.format(expires)}
                    <span className="font-normal text-muted-foreground">
                      {", "}
                      <CertificateLabel days={vitals.certificate} />
                    </span>
                  </span>
                ) : (
                  <CertificateLabel days={null} />
                ),
            },
            {
              label: "ID",
              value: <span className="font-mono font-normal text-muted-foreground">{site.id}</span>,
            },
          ]}
        />
      </div>
    </LibraryPanel>
  );
}

/** Which addresses feed the site's traffic, at the foot of the Traffic view they shape. */
function VisitSources({
  site,
  canManage,
  blocked,
  onEdit,
}: {
  readonly site: Site;
  readonly canManage: boolean;
  readonly blocked: string | null;
  readonly onEdit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
      <span>Counting visits from</span>
      {site.origins.length ? (
        site.origins.map((origin) => (
          <span
            key={origin}
            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-foreground/80 dark:bg-accent"
          >
            {siteHost(origin)}
          </span>
        ))
      ) : (
        <span>no origins yet</span>
      )}
      <ActionHint hint={blocked}>
        <Button shape="pill" size="xs" variant="ghost" disabled={!canManage} onClick={onEdit}>
          <PencilIcon />
          Edit origins
        </Button>
      </ActionHint>
    </div>
  );
}

const SKELETON_VITALS = ["checks", "response", "certificate", "views", "visitors"];
const SKELETON_TABS = ["overview", "preview", "traffic", "checks"];

/**
 * A site's page while the Library lists its sites, in the final shape, so a link straight to a site
 * never shows the index first.
 */
export function SiteDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading site" className="flex min-w-0 flex-col gap-6">
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="flex items-start gap-5 p-5 sm:p-6">
          <Skeleton shape="card" className="size-16 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
            <Skeleton className="h-7 w-56 max-w-full" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border/70 px-5 py-3 sm:px-6">
          {SKELETON_VITALS.map((vital) => (
            <div key={vital} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex w-fit items-center gap-1 rounded-full bg-muted p-1 dark:bg-accent">
        {SKELETON_TABS.map((tab) => (
          <Skeleton key={tab} shape="pill" className="h-8 w-20" />
        ))}
      </div>
      <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton shape="card" className="h-48 w-full" />
        <Skeleton shape="card" className="h-40 w-full" />
      </div>
    </div>
  );
}
