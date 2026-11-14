import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  computerDirectoryHealth,
  directoryComputersView,
  directoryCatalogRows,
  directoryOldMachines,
  libraryListRows,
  supportsLoomFeature,
  libraryProjectColor,
  type DirectoryCatalogRow,
  type DirectorySavedConnection,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { DIRECTORY_FEATURE } from "@t3tools/contracts/fork";
import { useState } from "react";
import { ChevronRightIcon, HardDriveIcon, RefreshCwIcon } from "lucide-react";
import { EnvironmentMachineIcon } from "~/components/EnvironmentMachineIcon";
import { SettingsSearchTarget } from "~/components/settings/settingsLayout";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Skeleton } from "~/components/ui/skeleton";
import { LibraryEmpty, LibrarySection, LibraryStateDot } from "../project-library/LibraryControls";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cancelLoomBrowserSignIn } from "~/rpc/loomIdentity";
import { useAtomCommand } from "~/state/use-atom-command";
import { connectLoomIdentity } from "../identity/connection";
import { LIBRARY_COMPUTERS_TARGET } from "../project-library/LibraryConnectDialog";
import { useLibraryAuthority } from "../project-library/state";
import {
  connectLibraryComputer,
  openLibraryComputerSignInWindow,
  signInLibraryComputer,
  type LibraryComputerConnectOutcome,
  type LibraryComputerSignInStep,
} from "./connect";
import { directoryComputers } from "./state";
import { ForgetDirectoryEntry } from "./ForgetDirectoryEntry";

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
 * Computers the Library's directory lists, including connections saved on this device.
 * The list reads when the section opens and on Refresh, never on a timer.
 */
export function LibraryComputers({ onPair }: { readonly onPair: PairLibraryComputer }) {
  const authority = useLibraryAuthority();
  if (authority.authorityId === null)
    return (
      <SettingsSearchTarget id={LIBRARY_COMPUTERS_TARGET}>
        <LibraryEmpty icon={HardDriveIcon} title="Find your other computers">
          Connect your Library above to discover computers and manage remembered connections.
        </LibraryEmpty>
      </SettingsSearchTarget>
    );
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
      connected={authority.environments
        .filter((entry) => entry.connection.phase === "connected")
        .map((entry) => entry.environmentId)}
      reconnectable={authority.environments
        .filter(
          (entry) => entry.entry.enabled && entry.entry.target._tag !== "PrimaryConnectionTarget",
        )
        .map((entry) => entry.environmentId)}
      onPair={onPair}
    />
  );
}

function LibraryComputersSection({
  libraryId,
  supportsDirectory,
  libraryConnection,
  saved,
  connected,
  reconnectable,
  onPair,
}: {
  readonly libraryId: EnvironmentId;
  readonly supportsDirectory: boolean | null;
  readonly libraryConnection: EnvironmentConnectionPresentation | null;
  readonly saved: readonly DirectorySavedConnection[];
  readonly connected: readonly EnvironmentId[];
  readonly reconnectable: readonly EnvironmentId[];
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
  const listing = view.listing.listing;
  const old = listing ? directoryOldMachines(listing, now) : { environments: [], machines: [] };
  const oldIds = new Set(old.environments.map((row) => row.environmentId));
  const rows = libraryListRows(
    directoryCatalogRows({ listing, saved, connected, reconnectable, now }),
    { libraryEnvironmentId: libraryId, oldIds },
  );

  const recentRows = rows.filter((row) => !oldIds.has(row.environmentId));
  const oldRows = rows.filter((row) => oldIds.has(row.environmentId));

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
        return rows.length === 0 && old.machines.length === 0
          ? "No other computers in your Library"
          : null;
      case "listed":
        return null;
      case "failed":
        return view.listing.cacheText;
    }
  })();

  const renderRow = (row: DirectoryCatalogRow) => {
    const state = rowStates.get(row.environmentId) ?? null;
    const os = row.report?.platform.os;
    const platform = os === undefined ? null : (PLATFORM_LABELS[os] ?? os);
    const health =
      listing === null
        ? null
        : computerDirectoryHealth({
            listing,
            environmentId: row.environmentId,
            label: row.label,
            now,
            source: view.listing.source === "live" ? "live" : "cache",
          });
    const note =
      row.action === "pair"
        ? {
            text: `Turn on Tailscale HTTPS or Loomhost on ${row.label}, or pair using an address this device can reach.`,
            error: false,
          }
        : state?.phase === "pairing"
          ? { text: state.reasonText, error: false }
          : state?.phase === "failed"
            ? { text: state.message, error: true }
            : null;
    return (
      <li
        key={row.environmentId}
        className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 py-4"
      >
        <div
          className="flex min-w-0 flex-1 basis-64 items-start gap-3"
          style={projectColorStyle(libraryProjectColor({ id: row.environmentId }))}
        >
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--project-color)/12 text-(--project-color)"
          >
            <EnvironmentMachineIcon kind={machineKind(os)} className="size-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h3 className="text-sm font-medium wrap-anywhere">{row.label}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {platform ? <span>{platform}</span> : null}
              {row.saved ? (
                <span className="inline-flex items-center gap-1.5">
                  <LibraryStateDot tone="neutral" />
                  Saved on this device
                </span>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {health?.text ?? "Not reported yet"}
            </p>
            {health?.attention ? (
              <p className="text-xs leading-relaxed text-warning-foreground">{health.attention}</p>
            ) : null}
            {note ? (
              <p
                role={note.error ? "alert" : undefined}
                className={`max-w-prose text-xs leading-relaxed ${note.error ? "text-destructive" : "text-muted-foreground"}`}
              >
                {note.text}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <ForgetDirectoryEntry
            request={{ kind: "environment", environmentId: row.environmentId }}
            label={row.label}
          />
          {row.action === "pair" ? (
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              onClick={() => onPair(row.environmentId, "")}
            >
              Pair instead
            </Button>
          ) : row.action === null ? null : state?.phase === "signing-in" ? (
            <>
              <span role="status" className="text-xs text-muted-foreground">
                Waiting for sign-in...
              </span>
              <Button
                shape="pill"
                size="sm"
                variant="outline"
                onClick={() => cancelRow(row.environmentId, state.httpBaseUrl)}
              >
                Cancel
              </Button>
            </>
          ) : state?.phase === "ready" ? (
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              onClick={() => void signInRow(row, state.step)}
            >
              Sign in
            </Button>
          ) : (
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              disabled={state?.phase === "checking" || state?.phase === "cancelling"}
              onClick={() => void connectRow(row)}
            >
              {state?.phase === "checking"
                ? "Checking..."
                : state?.phase === "cancelling"
                  ? "Cancelling..."
                  : row.saved
                    ? "Reconnect with Library"
                    : "Connect"}
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <SettingsSearchTarget id={LIBRARY_COMPUTERS_TARGET}>
      <LibrarySection
        title="Computers in your Library"
        count={rows.length}
        action={
          view.status === "unsupported" ? null : (
            <Button
              shape="pill"
              size="sm"
              variant="ghost-muted"
              disabled={view.refreshing}
              onClick={() => refresh()}
            >
              <RefreshCwIcon aria-hidden />
              {view.refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          )
        }
      >
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Connect a computer to use it on this device. Reconnect with Library adds its current
          address while keeping saved conversations and drafts. Access away from home needs Loomhost
          or Tailscale HTTPS on that computer.
        </p>
        {view.error ? (
          <p role="alert" className="text-sm text-destructive">
            {view.error}
          </p>
        ) : null}
        {status && view.status !== "empty" ? (
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        ) : null}
        {view.status === "loading" && rows.length === 0 ? (
          <div aria-label="Loading Library computers" role="status" className="space-y-4 py-3">
            {[0, 1].map((key) => (
              <div key={key} className="flex items-center gap-3">
                <Skeleton className="size-10" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : recentRows.length > 0 ? (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {recentRows.map(renderRow)}
          </ul>
        ) : view.status === "empty" && rows.length === 0 && old.machines.length === 0 ? (
          <LibraryEmpty icon={HardDriveIcon} title="No other computers yet">
            Computers connected to your Library will appear here when they report in.
          </LibraryEmpty>
        ) : view.status === "listed" && rows.length === 0 && old.machines.length === 0 ? (
          <LibraryEmpty icon={HardDriveIcon} title="Every computer is on this device">
            Each computer in your Library is already saved here. New ones appear when they join.
          </LibraryEmpty>
        ) : null}
        {oldRows.length > 0 || old.machines.length > 0 ? (
          <Collapsible>
            <CollapsibleTrigger render={<Button shape="pill" size="sm" variant="ghost-muted" />}>
              <ChevronRightIcon aria-hidden className="[[data-panel-open]_&]:rotate-90" />
              Older computers ({oldRows.length + old.machines.length})
            </CollapsibleTrigger>
            <CollapsiblePanel keepMounted>
              <div className="space-y-2 pt-3">
                <p className="text-xs text-muted-foreground">
                  These computers have stopped reporting. Forget entries you no longer use.
                </p>
                <ul className="divide-y divide-border/60 border-y border-border/60">
                  {oldRows.map(renderRow)}
                  {old.machines.map((machine) => (
                    <li
                      key={machine.keyFingerprint}
                      className="flex flex-wrap items-start justify-between gap-3 py-4"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          aria-hidden
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground"
                        >
                          <EnvironmentMachineIcon kind="linux" className="size-5" />
                        </span>
                        <div className="min-w-0 space-y-1">
                          <h3 className="text-sm font-medium wrap-anywhere">{machine.hostname}</h3>
                          <p className="text-xs text-muted-foreground">
                            Reporting computer is no longer in your Library
                          </p>
                        </div>
                      </div>
                      <ForgetDirectoryEntry
                        request={{ kind: "machine", keyFingerprint: machine.keyFingerprint }}
                        label={machine.hostname}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ) : null}
      </LibrarySection>
    </SettingsSearchTarget>
  );
}
