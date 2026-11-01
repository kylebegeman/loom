import { type ReactNode } from "react";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import type { EnvironmentPresentation } from "~/state/environments";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { EnvironmentMachineIcon } from "~/components/EnvironmentMachineIcon";
import { Badge } from "~/components/ui/badge";
import { searchableSetting } from "~/components/settings/settingsSearch";
import { ConnectAccount } from "./ConnectAccount";
import { ComputerWorkActions } from "./ComputerWorkActions";
import { ComputerConnectionDetails } from "./ComputerConnectionDetails";
import { CompatibilityNotice } from "./CompatibilityNotice";
import {
  LibraryComputers,
  type PairLibraryComputer,
} from "../directory-computers/LibraryComputers";
import { LibraryPushSection } from "../library-push/LibraryPushSection";
import { ComputerReachSection } from "../reach/ComputerReach";
import { LibraryReach } from "../reach/LibraryReach";
import { ComputerHealthSummary } from "../connection-health/ComputerHealthSummary";

export function ComputerConnectionsHome({
  primaryEnvironment,
  primaryActions,
  computerRows,
  discoveredRows,
  isReady,
}: {
  readonly primaryEnvironment: EnvironmentPresentation | null;
  readonly primaryActions?: ReactNode;
  readonly computerRows: ReactNode;
  readonly discoveredRows: ReactNode;
  readonly isReady: boolean;
}) {
  return (
    <>
      <SettingsSection
        {...searchableSetting("remote-environments")}
        title="Your computers"
        hideTitle
        variant="plain"
      >
        {!isReady ? (
          <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
            Loading computers...
          </p>
        ) : null}
        <ConnectAccount />
        {primaryEnvironment ? (
          <div className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-foreground">
                <EnvironmentMachineIcon
                  aria-hidden
                  kind={resolveEnvironmentMachineKind(primaryEnvironment.serverConfig)}
                  className="size-6"
                />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="truncate text-lg font-semibold tracking-tight">
                    {primaryEnvironment.label}
                  </h3>
                  <Badge
                    variant={
                      primaryEnvironment.connection.phase === "connected" ? "success" : "secondary"
                    }
                  >
                    {connectionStatusTitle(primaryEnvironment.connection)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {window.desktopBridge ? "This computer" : "Direct connection"}
                </p>
              </div>
              <div className="shrink-0">{primaryActions}</div>
            </div>
            <div className="mt-4 border-t border-border/60 pt-1">
              <ComputerHealthSummary environment={primaryEnvironment} />
              <ComputerWorkActions environment={primaryEnvironment} />
              <ComputerConnectionDetails label={primaryEnvironment.label}>
                <ComputerReachSection environment={primaryEnvironment} />
              </ComputerConnectionDetails>
            </div>
          </div>
        ) : null}
        {computerRows}
        {discoveredRows}
      </SettingsSection>
      <CompatibilityNotice />
    </>
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
    <>
      {children}
      <LibraryComputers onPair={onPairComputer} />
      <LibraryReach />
      <LibraryPushSection />
    </>
  );
}
