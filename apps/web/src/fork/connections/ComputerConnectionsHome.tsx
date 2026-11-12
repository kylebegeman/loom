import { ComputerAccountSetup } from "./ComputerAccountSetup";
import { AccountAccessSummary } from "./AccountAccessSummary";
import { useOptionalSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useState, type ReactNode } from "react";
import * as Schema from "effect/Schema";
import { ArrowLeftIcon, ArrowUpRightIcon, ChevronRightIcon, NetworkIcon } from "lucide-react";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import { libraryProjectColor } from "@t3tools/client-runtime/fork";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { ENVIRONMENT_MACHINE_KIND_LABELS } from "~/components/EnvironmentMachineIcon";
import type { EnvironmentPresentation } from "~/state/environments";
import {
  SettingsSearchTarget,
  useSettingsSearchTargetId,
} from "~/components/settings/settingsLayout";
import { useEnvironmentTransportLabel } from "~/components/settings/EnvironmentRow";
import { searchableSetting } from "~/components/settings/settingsSearch";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { ComputerTile, projectColorStyle } from "../project-library/ProjectIdentity";
import {
  LIBRARY_CARD,
  LibraryLayoutToggle,
  type LibraryLayout,
} from "../project-library/LibraryCollection";
import { LibraryEmpty, LibraryStateDot } from "../project-library/LibraryControls";
import { ConnectAccount } from "./ConnectAccount";
import { ComputerWorkActions } from "./ComputerWorkActions";
import { CompatibilityNotice } from "./CompatibilityNotice";
import {
  LibraryComputers,
  type PairLibraryComputer,
} from "../directory-computers/LibraryComputers";
import { LibraryPushSection } from "../library-push/LibraryPushSection";
import { LibraryReach } from "../reach/LibraryReach";

const LAYOUT_KEY = "loom:computers:collection-layout:v1";
const ComputersLayout = Schema.Literals(["cards", "list"]);
const ROW_COLUMNS = "@min-[44rem]/computers:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.4fr)]";

const ROUTING_TARGETS = ["linked-environments", "load-balancing", "pull-request-routing"];

export function ComputerConnectionsHome({
  primaryEnvironment,
  environments,
  renderComputerDetails,
  discoveredRows,
  routing,
  appSettings,
  isReady,
}: {
  readonly primaryEnvironment: EnvironmentPresentation | null;
  readonly environments: readonly EnvironmentPresentation[];
  readonly renderComputerDetails: (environment: EnvironmentPresentation) => ReactNode;
  readonly discoveredRows: ReactNode;
  readonly routing?: ReactNode;
  readonly appSettings?: ReactNode;
  readonly isReady: boolean;
}) {
  const [layout, setLayout] = useLocalStorage(LAYOUT_KEY, "cards", ComputersLayout);
  const repairComputer = useOptionalSettingsScope()?.search.machine;
  const [seenRepairComputer, setSeenRepairComputer] = useState(repairComputer);
  const [selectedId, setSelectedId] = useState<string | null>(repairComputer ?? null);
  if (repairComputer !== seenRepairComputer) {
    setSeenRepairComputer(repairComputer);
    if (repairComputer) setSelectedId(repairComputer);
  }
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  const searchTarget = useSettingsSearchTargetId();
  const [seenTarget, setSeenTarget] = useState<string | null>(null);
  const [routingOpen, setRoutingOpen] = useState(false);
  if (searchTarget !== seenTarget) {
    setSeenTarget(searchTarget);
    if (searchTarget === "remote-environments" && !repairComputer) setSelectedId(null);
    if (searchTarget === "local-environment" || searchTarget === "this-app") {
      setSelectedId(primaryEnvironment?.environmentId ?? null);
      if (!primaryEnvironment) setRoutingOpen(true);
    }
    if (searchTarget && ROUTING_TARGETS.includes(searchTarget)) {
      setSelectedId(null);
      setRoutingOpen(true);
    }
  }
  const selected = environments.find((environment) => environment.environmentId === selectedId);
  if (isReady && selectedId !== null && !selected) setSelectedId(null);
  const connected = environments.filter(
    (environment) => environment.entry.enabled && environment.connection.phase === "connected",
  ).length;

  return (
    <SettingsSearchTarget
      id={searchableSetting("remote-environments").id}
      className="@container/computers space-y-7"
    >
      {selected ? (
        <div className="space-y-6">
          <Button
            shape="pill"
            size="sm"
            variant="ghost"
            autoFocus
            onClick={() => {
              setReturnFocusId(selected.environmentId);
              setSelectedId(null);
            }}
          >
            <ArrowLeftIcon aria-hidden />
            All computers
          </Button>
          <header
            style={projectColorStyle(libraryProjectColor({ id: selected.environmentId }))}
            className="flex flex-wrap items-center gap-4"
          >
            <ComputerTile
              environmentId={selected.environmentId}
              className="size-14 rounded-2xl [&_svg]:size-7"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <h2 className="wrap-anywhere text-2xl font-semibold tracking-tight">
                {selected.label}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <ComputerState environment={selected} />
                <ComputerLocation
                  environment={selected}
                  primary={selected.environmentId === primaryEnvironment?.environmentId}
                />
              </div>
            </div>
          </header>
          <ComputerWorkActions environment={selected} />
          <ComputerAccountSetup environment={selected} />
          <section
            className="space-y-3 border-t border-border/60 pt-6"
            aria-label="Connection settings"
          >
            <h3 className="text-sm font-medium">Connection</h3>
            {renderComputerDetails(selected)}
            {selected.environmentId === primaryEnvironment?.environmentId ? appSettings : null}
          </section>
        </div>
      ) : !isReady ? (
        <div
          role="status"
          aria-label="Loading computers"
          className="grid gap-4 @min-[38rem]/computers:grid-cols-2"
        >
          {[0, 1].map((key) => (
            <div key={key} className="space-y-5 rounded-xl border border-border/60 p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <AccountAccessSummary />
          {primaryEnvironment ? <ComputerAccountSetup environment={primaryEnvironment} /> : null}
          {environments.length ? (
            <section className="space-y-3" aria-label="Your computers">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {environments.length} {environments.length === 1 ? "computer" : "computers"}
                  <span aria-hidden className="mx-2 text-muted-foreground/50">
                    /
                  </span>
                  {connected} connected
                </p>
                <LibraryLayoutToggle value={layout} onChange={setLayout} />
              </div>
              {layout === "list" ? (
                <div
                  aria-hidden
                  className={cn(
                    "hidden gap-x-5 px-1 text-xs text-muted-foreground @min-[44rem]/computers:grid",
                    ROW_COLUMNS,
                  )}
                >
                  <span>Computer</span>
                  <span>Connection</span>
                  <span>Work</span>
                </div>
              ) : null}
              <ul
                className={
                  layout === "cards"
                    ? "grid gap-4 @min-[38rem]/computers:grid-cols-2"
                    : "divide-y divide-border/60 border-y border-border/60"
                }
              >
                {environments.map((environment) => (
                  <ComputerItem
                    key={environment.environmentId}
                    environment={environment}
                    layout={layout}
                    primary={environment.environmentId === primaryEnvironment?.environmentId}
                    returnFocus={returnFocusId === environment.environmentId}
                    onOpen={() => setSelectedId(environment.environmentId)}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <LibraryEmpty icon={NetworkIcon} title="Your next place to work">
              Connect a computer to run agents and keep its projects and conversations here.
            </LibraryEmpty>
          )}
          <div className="space-y-3 empty:hidden">
            <ConnectAccount />
            {discoveredRows}
          </div>
          {routing || (!primaryEnvironment && appSettings) ? (
            <Collapsible open={routingOpen} onOpenChange={setRoutingOpen}>
              <CollapsibleTrigger className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-md text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <NetworkIcon aria-hidden className="size-3.5" />
                Work across computers
                <ChevronRightIcon
                  aria-hidden
                  className={cn("size-3.5", routingOpen && "rotate-90")}
                />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                {routingOpen ? (
                  <div className="space-y-6 pt-4">
                    {routing}
                    {!primaryEnvironment ? appSettings : null}
                  </div>
                ) : null}
              </CollapsiblePanel>
            </Collapsible>
          ) : null}
          <CompatibilityNotice />
        </>
      )}
    </SettingsSearchTarget>
  );
}

function ComputerItem({
  environment,
  layout,
  primary,
  returnFocus,
  onOpen,
}: {
  readonly environment: EnvironmentPresentation;
  readonly layout: LibraryLayout;
  readonly primary: boolean;
  readonly returnFocus: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <li
      style={projectColorStyle(libraryProjectColor({ id: environment.environmentId }))}
      className={
        layout === "cards"
          ? cn(LIBRARY_CARD, "gap-4 p-4")
          : cn("grid items-start gap-x-5 gap-y-3 px-1 py-4", ROW_COLUMNS)
      }
    >
      <div className="flex min-w-0 items-start gap-3">
        <ComputerTile
          environmentId={environment.environmentId}
          className={layout === "cards" ? "size-11 [&_svg]:size-6" : "size-9 [&_svg]:size-5"}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <h3
            className={cn(
              "truncate leading-5 font-semibold tracking-tight",
              layout === "cards" ? "text-base" : "text-sm",
            )}
          >
            <button
              onClick={onOpen}
              autoFocus={returnFocus}
              aria-label={`Open ${environment.label}`}
              className="cursor-pointer rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {environment.label}
            </button>
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            <ComputerLocation environment={environment} primary={primary} />
          </p>
        </div>
        <Button
          variant="ghost-muted"
          size="icon-xs"
          shape="pill"
          aria-label={`Manage ${environment.label}`}
          onClick={onOpen}
        >
          <ArrowUpRightIcon aria-hidden />
        </Button>
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
          layout === "list" && "@min-[44rem]/computers:flex-col @min-[44rem]/computers:items-start",
        )}
      >
        <ComputerState environment={environment} />
        <span>
          {ENVIRONMENT_MACHINE_KIND_LABELS[resolveEnvironmentMachineKind(environment.serverConfig)]}
        </span>
      </div>
      <ComputerWorkActions
        environment={environment}
        presentation={layout === "cards" ? "card" : "row"}
      />
    </li>
  );
}

function ComputerLocation({
  environment,
  primary,
}: {
  readonly environment: EnvironmentPresentation;
  readonly primary: boolean;
}) {
  const route = useEnvironmentTransportLabel(environment);
  return <>{primary ? (window.desktopBridge ? "This computer" : "Current connection") : route}</>;
}

function ComputerState({ environment }: { readonly environment: EnvironmentPresentation }) {
  const phase = environment.connection.phase;
  const tone = !environment.entry.enabled
    ? "neutral"
    : phase === "connected"
      ? "success"
      : phase === "error" || phase === "unsupported"
        ? "danger"
        : phase === "reconnecting"
          ? "warning"
          : "neutral";
  return (
    <span className="inline-flex items-center gap-1.5">
      <LibraryStateDot tone={tone} />
      {environment.entry.enabled ? connectionStatusTitle(environment.connection) : "Switched off"}
    </span>
  );
}

export function ComputerLibrarySettings({
  children,
  onPairComputer,
}: {
  children: ReactNode;
  onPairComputer: PairLibraryComputer;
}) {
  return (
    <div className="@container/library-settings min-w-0 space-y-8">
      {children}
      <LibraryComputers onPair={onPairComputer} />
      <div className="grid min-w-0 gap-7 border-t border-border/60 pt-7 @min-[44rem]/library-settings:grid-cols-2 [&>*:only-child]:col-span-full">
        <LibraryReach />
        <LibraryPushSection />
      </div>
    </div>
  );
}
