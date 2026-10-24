import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createDirectoryComputersAtoms,
  directoryComputersView,
  supportsLoomFeature,
  type DirectoryCatalogRow,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { DIRECTORY_FEATURE } from "@t3tools/contracts/fork";
import { useFocusEffect } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { RowPressable } from "../../components/ui/RowPressable";
import { environmentCatalog } from "../../connection/catalog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  saveNativeIdentitySignIn,
  signInWithNativeIdentity,
} from "../library/nativeIdentitySignIn";
import {
  connectDirectoryComputer,
  directoryPairing,
  directorySectionContent,
  type DirectoryConnectOutcome,
  type DirectoryPairing,
  type DirectorySectionContent,
} from "./directoryComputers";

const directoryComputers = createDirectoryComputersAtoms(connectionAtomRuntime);

const FOOTER =
  "Computers your Library knows about that are not on this device yet. Connect signs in with Loom Identity, or asks for a pairing code when a computer does not offer it.";

const SIGN_IN_PROGRESS = { "signing-in": "Signing in...", verifying: "Verifying..." } as const;

/**
 * The Library's computer list for the Connections screen. It reads when the screen opens (if
 * the last read is a few seconds old) and on `refresh`, never on a timer. Report ages count from
 * when the screen or app was last shown, the list refreshed or a new answer arrived, so nothing
 * re-renders to keep them ticking.
 */
export function useDirectoryComputers() {
  const [shownAt, setShownAt] = useState(Date.now);
  useFocusEffect(useCallback(() => setShownAt(Date.now()), []));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setShownAt(Date.now());
    });
    return () => subscription.remove();
  }, []);
  const preferences = useAtomValue(mobilePreferencesAtom);
  // The same preference `useLibraryAuthority` reads, without its Library queries.
  const chosen = AsyncResult.isSuccess(preferences)
    ? preferences.value["loom.library.authorityEnvironmentId"]
    : null;
  const libraryId = chosen ? EnvironmentId.make(chosen) : null;
  const config = useEnvironmentServerConfig(libraryId);
  const { presentation } = useEnvironmentPresentation(libraryId);
  const supportsDirectory =
    config === null
      ? null
      : supportsLoomFeature(config.environment.capabilities, DIRECTORY_FEATURE);
  const listingAtom = directoryComputers.listing(supportsDirectory === false ? null : libraryId);
  const live = useAtomValue(listingAtom);
  const stored = useAtomValue(directoryComputers.stored(libraryId));
  const refreshListing = useAtomRefresh(listingAtom);
  const refresh = () => {
    setShownAt(Date.now());
    refreshListing();
  };
  const answeredAt = AsyncResult.isSuccess(live) ? Date.parse(live.value.fetchedAt) : Number.NaN;
  const now = Number.isFinite(answeredAt) ? Math.max(shownAt, answeredAt) : shownAt;
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const saved = [...catalog.entries.values()].map((entry) => ({
    environmentId: entry.target.environmentId,
    label: entry.target.label,
  }));
  const view = directoryComputersView({
    authorityEnvironmentId: libraryId,
    supportsDirectory,
    libraryConnection: presentation?.connection ?? null,
    live,
    stored,
    saved,
    now,
  });
  return { libraryId, content: directorySectionContent(view, catalog.isReady), refresh } as const;
}

export type DirectoryComputers = ReturnType<typeof useDirectoryComputers>;

function showOutcome(
  label: string,
  outcome: DirectoryConnectOutcome,
  onPair: (pairing: DirectoryPairing) => void,
) {
  switch (outcome.kind) {
    case "connected":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case "cancelled":
      return;
    case "failed":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Dialog.alert(`Could not connect ${label}`, outcome.message);
      return;
    case "pairing":
      Dialog.alert(
        `Pair ${label}`,
        `${outcome.step.reasonText} Enter a pairing code from Connections settings in Loom on that computer.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Pair", onPress: () => onPair(directoryPairing(outcome.step)) },
        ],
      );
  }
}

/** One connect at a time: a second provider sheet cannot open over the first. */
function useDirectoryConnect(
  libraryId: EnvironmentId | null,
  onPair: (pairing: DirectoryPairing) => void,
) {
  const plan = useAtomCommand(directoryComputers.planConnect, { reportFailure: false });
  const register = useAtomCommand(environmentCatalog.register, { reportFailure: false });
  const enable = useAtomCommand(environmentCatalog.setEnabled, { reportFailure: false });
  const [active, setActive] = useState<{
    readonly environmentId: EnvironmentId;
    readonly progress: string;
  } | null>(null);
  const running = useRef<AbortController | null>(null);
  // Leaving the screen closes an open provider sheet and drops the result.
  useEffect(() => () => running.current?.abort(), []);

  const connect = (row: DirectoryCatalogRow) => {
    if (running.current !== null || libraryId === null) return;
    const abort = new AbortController();
    running.current = abort;
    const onProgress = (progress: string) => {
      if (!abort.signal.aborted) setActive({ environmentId: row.environmentId, progress });
    };
    onProgress("Checking...");
    void connectDirectoryComputer(
      { row, libraryEnvironmentId: libraryId },
      {
        plan,
        signIn: (request) =>
          signInWithNativeIdentity({
            ...request,
            signal: abort.signal,
            onProgress: (stage) => onProgress(SIGN_IN_PROGRESS[stage]),
          }),
        save: (signedIn) => {
          onProgress("Saving...");
          return saveNativeIdentitySignIn(signedIn, { register, enable });
        },
      },
    ).then((outcome) => {
      running.current = null;
      if (abort.signal.aborted) return;
      setActive(null);
      showOutcome(row.label, outcome, onPair);
    });
  };
  return { active, connect };
}

/**
 * `SettingsActionRow` speaks only its label and description, so screen readers would never hear
 * the action or progress shown at the end of the row. Here that text is the row's value.
 */
function DirectoryComputerRow(props: {
  readonly label: string;
  readonly description: string;
  readonly detail: string | undefined;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const ripple = useResolveClassNames("bg-subtle-strong");
  const disabled = props.disabled || props.loading;
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityValue={props.detail === undefined ? undefined : { text: props.detail }}
      accessibilityHint={props.description}
      accessibilityState={{ disabled, busy: props.loading }}
      disabled={disabled}
      onPress={props.onPress}
      android_ripple={{ color: ripple.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      className="bg-grouped-card"
    >
      <ListRowLayout
        icon="desktopcomputer"
        label={props.label}
        description={props.description}
        detail={props.detail}
        disabled={disabled}
        accessory={
          props.loading ? <AppActivityIndicator colorClassName="accent-icon" /> : undefined
        }
      />
    </RowPressable>
  );
}

function footerText(content: DirectorySectionContent) {
  return content.kind === "computers" && content.cacheText !== null
    ? `${content.cacheText}. ${FOOTER}`
    : FOOTER;
}

export function DirectoryComputersSection({
  directory,
  onPair,
}: {
  readonly directory: DirectoryComputers;
  /** Opens the pairing form for this computer with its address filled in. */
  readonly onPair: (pairing: DirectoryPairing) => void;
}) {
  const { content, libraryId, refresh } = directory;
  const { active, connect } = useDirectoryConnect(libraryId, onPair);
  if (content.kind === "hidden") return null;
  const retry = <SettingsActionRow icon="arrow.clockwise" label="Try again" onPress={refresh} />;
  return (
    <SettingsSection title="From your Library" footer={footerText(content)}>
      {content.kind === "loading" ? (
        <Text className="p-4 text-sm text-foreground-muted">
          Checking your Library for computers...
        </Text>
      ) : content.kind === "empty" ? (
        <Text className="p-4 text-sm text-foreground-muted">
          Every computer in your Library is already on this device.
        </Text>
      ) : content.kind === "failed" ? (
        <>
          <Text selectable className="p-4 text-sm text-danger-foreground">
            {content.error}
          </Text>
          {retry}
        </>
      ) : (
        <>
          {content.error === null ? null : (
            <>
              <Text selectable className="p-4 text-sm text-danger-foreground">
                {content.error}
              </Text>
              {retry}
            </>
          )}
          {content.computers.map(({ row, description, connectable }) => {
            const progress = active?.environmentId === row.environmentId ? active.progress : null;
            return (
              <DirectoryComputerRow
                key={row.environmentId}
                label={row.label}
                description={description}
                detail={progress ?? (connectable ? "Connect" : undefined)}
                loading={progress !== null}
                disabled={!connectable || (active !== null && progress === null)}
                onPress={() => connect(row)}
              />
            );
          })}
        </>
      )}
    </SettingsSection>
  );
}
