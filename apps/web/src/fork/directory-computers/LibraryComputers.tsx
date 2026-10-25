import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  directoryComputersView,
  supportsLoomFeature,
  type DirectoryCatalogRow,
  type DirectorySavedConnection,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { DIRECTORY_FEATURE } from "@t3tools/contracts/fork";
import { useState } from "react";
import { EnvironmentRow } from "~/components/settings/EnvironmentRow";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cancelLoomBrowserSignIn } from "~/rpc/loomIdentity";
import { useAtomCommand } from "~/state/use-atom-command";
import { connectLoomIdentity } from "../identity/connection";
import { useLibraryAuthority } from "../project-library/state";
import {
  connectLibraryComputer,
  openLibraryComputerSignInWindow,
  signInLibraryComputer,
  type LibraryComputerConnectOutcome,
  type LibraryComputerSignInStep,
} from "./connect";
import { directoryComputers } from "./state";

type RowState =
  | { readonly phase: "checking" }
  /** A browser waits for a second click to open the sign-in window. */
  | { readonly phase: "ready"; readonly step: LibraryComputerSignInStep }
  | { readonly phase: "signing-in"; readonly httpBaseUrl: string }
  /** The user cancelled; the sign-in's rejection is not a failure to show. */
  | { readonly phase: "cancelling" }
  | { readonly phase: "pairing"; readonly reasonText: string }
  | { readonly phase: "failed"; readonly message: string };

/** Opens the pairing form expecting this computer, with its address filled in when known. */
export type PairLibraryComputer = (environmentId: EnvironmentId, httpBaseUrl: string) => void;

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  windows: "Windows",
};

const machineKind = (os: string | undefined): EnvironmentMachineKind =>
  os === "linux" ? "linux" : os === "darwin" || os === "windows" ? "desktop" : "server";

function cancelSignIn(httpBaseUrl: string) {
  if (window.desktopBridge?.signInToLoom)
    void window.desktopBridge.cancelLoomSignIn?.({ httpBaseUrl });
  else cancelLoomBrowserSignIn(httpBaseUrl);
}

/**
 * Computers the Library's directory lists that this device has not saved. Hidden until a Library
 * is chosen. The list reads when the section opens and on Refresh, never on a timer.
 */
export function LibraryComputers({ onPair }: { readonly onPair: PairLibraryComputer }) {
  const authority = useLibraryAuthority();
  if (authority.authorityId === null) return null;
  const serverConfig = authority.environment?.serverConfig ?? null;
  return (
    <LibraryComputersSection
      libraryId={authority.authorityId}
      supportsDirectory={
        serverConfig === null
          ? null
          : supportsLoomFeature(serverConfig.environment.capabilities, DIRECTORY_FEATURE)
      }
      libraryConnection={authority.environment?.connection ?? null}
      saved={authority.environments}
      onPair={onPair}
    />
  );
}

function LibraryComputersSection({
  libraryId,
  supportsDirectory,
  libraryConnection,
  saved,
  onPair,
}: {
  readonly libraryId: EnvironmentId;
  readonly supportsDirectory: boolean | null;
  readonly libraryConnection: EnvironmentConnectionPresentation | null;
  readonly saved: readonly DirectorySavedConnection[];
  readonly onPair: PairLibraryComputer;
}) {
  const listingAtom = directoryComputers.listing(supportsDirectory === false ? null : libraryId);
  const live = useAtomValue(listingAtom);
  const stored = useAtomValue(directoryComputers.stored(libraryId));
  const refresh = useAtomRefresh(listingAtom);
  const plan = useAtomCommand(directoryComputers.planConnect, { reportFailure: false });
  const connect = useAtomCommand(connectLoomIdentity, { reportFailure: false });
  const [rowStates, setRowStates] = useState<ReadonlyMap<EnvironmentId, RowState>>(new Map());
  // The shared clock is a UTC minute written without its zone; ages are shown in minutes.
  const now = Date.parse(`${useNowMinute()}Z`);
  const view = directoryComputersView({
    authorityEnvironmentId: libraryId,
    supportsDirectory,
    libraryConnection,
    live,
    stored,
    saved,
    now,
  });

  const updateRowState = (
    environmentId: EnvironmentId,
    update: (state: RowState | null) => RowState | null,
  ) =>
    setRowStates((current) => {
      const state = update(current.get(environmentId) ?? null);
      const next = new Map(current);
      if (state === null) next.delete(environmentId);
      else next.set(environmentId, state);
      return next;
    });
  const setRowState = (environmentId: EnvironmentId, state: RowState | null) =>
    updateRowState(environmentId, () => state);

  const cancelRow = (environmentId: EnvironmentId, httpBaseUrl: string) => {
    setRowState(environmentId, { phase: "cancelling" });
    cancelSignIn(httpBaseUrl);
  };

  const showOutcome = (row: DirectoryCatalogRow, outcome: LibraryComputerConnectOutcome) => {
    switch (outcome.kind) {
      case "connected":
        setRowState(row.environmentId, null);
        toastManager.add({
          type: "success",
          title: "Computer connected",
          description: `${row.label} is saved on this device.`,
        });
        return;
      case "sign-in":
        setRowState(row.environmentId, { phase: "ready", step: outcome.step });
        return;
      case "pairing":
        // Connect stays offered, since the computer may turn on Loom sign-in later.
        setRowState(row.environmentId, { phase: "pairing", reasonText: outcome.reasonText });
        onPair(outcome.environmentId, outcome.httpBaseUrl ?? "");
        toastManager.add({
          type: "info",
          title: `Pair with ${row.label}`,
          description: outcome.reasonText,
        });
        return;
      case "failed":
        updateRowState(row.environmentId, (state) =>
          state?.phase === "cancelling" ? null : { phase: "failed", message: outcome.message },
        );
        return;
      case "cancelled":
        setRowState(row.environmentId, null);
    }
  };

  const onSignIn = (row: DirectoryCatalogRow) => (httpBaseUrl: string) =>
    setRowState(row.environmentId, { phase: "signing-in", httpBaseUrl });

  const connectRow = async (row: DirectoryCatalogRow) => {
    setRowState(row.environmentId, { phase: "checking" });
    showOutcome(
      row,
      await connectLibraryComputer({
        row,
        libraryEnvironmentId: libraryId,
        plan,
        connect,
        onSignIn: onSignIn(row),
      }),
    );
  };

  const signInRow = async (row: DirectoryCatalogRow, step: LibraryComputerSignInStep) => {
    const popup = openLibraryComputerSignInWindow();
    showOutcome(
      row,
      await signInLibraryComputer({ step, popup, connect, onSignIn: onSignIn(row) }),
    );
  };

  const status = (() => {
    switch (view.status) {
      case "no-library":
        return null;
      case "unsupported":
        return "Update Loom on your Library to list its computers here.";
      case "loading":
        return view.rows.length === 0
          ? "Loading your Library's computers..."
          : view.listing.cacheText;
      case "empty":
        return "No other computers in your Library";
      case "listed":
        return null;
      case "failed":
        return view.listing.cacheText;
    }
  })();

  return (
    <SettingsSection
      title="Other computers in your Library"
      headerAction={
        view.status === "unsupported" ? null : (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={view.refreshing}
            onClick={() => refresh()}
          >
            {view.refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        )
      }
    >
      {view.error || status ? (
        <div className="space-y-1 px-3 py-3 sm:px-4">
          {view.error ? (
            <p role="alert" className="text-xs text-destructive">
              {view.error}
            </p>
          ) : null}
          {status ? (
            <p role="status" className="text-xs text-muted-foreground">
              {status}
            </p>
          ) : null}
        </div>
      ) : null}
      {view.rows.map((row) => {
        const state = rowStates.get(row.environmentId) ?? null;
        const os = row.report?.platform.os;
        const platform = os === undefined ? null : (PLATFORM_LABELS[os] ?? os);
        const subtitle = [platform, row.proof?.text ?? "Not reported yet"]
          .filter(Boolean)
          .join(" · ");
        const note =
          row.action === "pair"
            ? {
                text: `Turn on Tailscale HTTPS or Reach on ${row.label}, or pair using an address this device can reach.`,
                error: false,
              }
            : state?.phase === "pairing"
              ? { text: state.reasonText, error: false }
              : state?.phase === "failed"
                ? { text: state.message, error: true }
                : null;
        return (
          <EnvironmentRow
            key={row.environmentId}
            kind={machineKind(os)}
            label={row.label}
            subtitle={subtitle}
            below={
              note ? (
                <p
                  role={note.error ? "alert" : undefined}
                  className={
                    note.error
                      ? "mt-1 text-xs text-destructive"
                      : "mt-1 text-xs text-muted-foreground"
                  }
                >
                  {note.text}
                </p>
              ) : null
            }
          >
            {row.action === "pair" ? (
              <Button size="xs" variant="outline" onClick={() => onPair(row.environmentId, "")}>
                Pair instead
              </Button>
            ) : row.action === null ? null : state?.phase === "signing-in" ? (
              <>
                <span className="text-xs text-muted-foreground">Waiting for sign-in...</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => cancelRow(row.environmentId, state.httpBaseUrl)}
                >
                  Cancel
                </Button>
              </>
            ) : state?.phase === "ready" ? (
              <Button size="xs" variant="outline" onClick={() => void signInRow(row, state.step)}>
                Sign in
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={state?.phase === "checking" || state?.phase === "cancelling"}
                onClick={() => void connectRow(row)}
              >
                {state?.phase === "checking"
                  ? "Checking..."
                  : state?.phase === "cancelling"
                    ? "Cancelling..."
                    : "Connect"}
              </Button>
            )}
          </EnvironmentRow>
        );
      })}
    </SettingsSection>
  );
}
