import { type ReactNode } from "react";
import { connectionStatusTitle } from "@t3tools/client-runtime/connection";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import type { EnvironmentPresentation } from "~/state/environments";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { EnvironmentRow } from "~/components/settings/EnvironmentRow";
import { searchableSetting } from "~/components/settings/settingsSearch";
import { ConnectAccount } from "./ConnectAccount";
import { ComputerWorkActions } from "./ComputerWorkActions";
import { ComputerConnectionDetails } from "./ComputerConnectionDetails";
import { FleetUpdatesSection } from "./FleetUpdatesSection";
import {
  LibraryComputers,
  type PairLibraryComputer,
} from "../directory-computers/LibraryComputers";
import { LibraryPushSection } from "../library-push/LibraryPushSection";
import { ComputerReachSection } from "../reach/ComputerReach";
import { LibraryReach } from "../reach/LibraryReach";

export function ComputerConnectionsHome({
  primaryEnvironment,
  primaryActions,
  computerRows,
  discoveredRows,
  headerActions,
  isReady,
  onPairComputer,
}: {
  readonly primaryEnvironment: EnvironmentPresentation | null;
  readonly primaryActions?: ReactNode;
  readonly computerRows: ReactNode;
  readonly discoveredRows: ReactNode;
  readonly headerActions: ReactNode;
  readonly isReady: boolean;
  /**
   * Opens the pairing form for a Library computer that does not get Loom sign-in here. The form
   * expects that computer and offers no unchecked Identity sign-in.
   */
  readonly onPairComputer: PairLibraryComputer;
}) {
  return (
    <>
      <p className="px-3 text-sm leading-relaxed text-muted-foreground sm:px-4">
        Choose where to work. Each computer keeps its own projects and conversations. Computers
        linked to your T3 Connect account are available on your other signed-in devices.
      </p>
      <SettingsSection
        {...searchableSetting("remote-environments")}
        title="Your computers"
        headerAction={headerActions}
      >
        {!isReady ? (
          <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
            Loading computers...
          </p>
        ) : null}
        <ConnectAccount />
        {primaryEnvironment ? (
          <EnvironmentRow
            kind={resolveEnvironmentMachineKind(primaryEnvironment.serverConfig)}
            label={primaryEnvironment.label}
            subtitle={`${window.desktopBridge ? "This computer" : "Direct connection"} · ${connectionStatusTitle(primaryEnvironment.connection)}`}
            detail={
              <>
                <ComputerWorkActions environment={primaryEnvironment} />
                <ComputerConnectionDetails label={primaryEnvironment.label}>
                  <ComputerReachSection environment={primaryEnvironment} />
                </ComputerConnectionDetails>
              </>
            }
          >
            {primaryActions}
          </EnvironmentRow>
        ) : null}
        {computerRows}
        {discoveredRows}
      </SettingsSection>
      <LibraryComputers onPair={onPairComputer} />
      <LibraryReach />
      <LibraryPushSection />
      <FleetUpdatesSection />
    </>
  );
}
