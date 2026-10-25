import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect, useState } from "react";
import { Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SettingsActionRow } from "../../features/settings/components/SettingsActionRow";
import { SettingsRow } from "../../features/settings/components/SettingsRow";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { useSavedRemoteConnection } from "../../state/use-remote-environment-registry";
import { currentLibraryPushBuild, supportsLibraryPushBuild } from "./libraryPushBuild";
import {
  LIBRARY_PUSH_COPY,
  libraryPushContent,
  type LibraryPushTestState,
} from "./libraryPushContent";
import { libraryPushServes, recordFor } from "./libraryPushPlan";
import {
  libraryPush,
  libraryPushActivityAtom,
  libraryPushPermissionAtom,
  libraryPushSnapshotAtom,
  reconcileLibraryPushStatus,
  retryLibraryPush,
  sendLibraryPushTest,
  setLibraryPushOptIn,
  type LibraryPushOptInOutcome,
} from "./libraryPushSync";

/**
 * Imported as a namespace (`LibraryPush.Screen`) so each upstream screen needs one short marked
 * import line, and its seam lines stay short enough not to wrap.
 */
export const isSupported = supportsLibraryPushBuild;

/** Notifications in a build without T3 Connect, where Library push is all there is. */
export function Screen() {
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="Notifications">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Section />
      </ScrollView>
    </SettingsScreen>
  );
}

export function Section() {
  return supportsLibraryPushBuild() ? <LibraryNotificationsContent /> : null;
}

/** The Settings entry for builds whose Settings has no Notifications row of its own. */
export function Row() {
  if (!supportsLibraryPushBuild()) return null;
  return (
    <SettingsRow
      icon="bell.badge"
      label={LIBRARY_PUSH_COPY.rowLabel}
      target="SettingsNotifications"
    />
  );
}

const IDLE_TEST: LibraryPushTestState = { phase: "idle" };

function LibraryNotificationsContent() {
  const registry = useContext(RegistryContext);
  const navigation = useNavigation();
  const snapshot = useAtomValue(libraryPushSnapshotAtom);
  const permission = useAtomValue(libraryPushPermissionAtom);
  const activity = useAtomValue(libraryPushActivityAtom);
  const library = snapshot.chosen;
  const statusAtom = libraryPush.status(
    library !== null && library.connected && library.advertised === true ? library.id : null,
  );
  const statusResult = useAtomValue(statusAtom);
  const saved = useSavedRemoteConnection(library?.id ?? null);
  // The switch shows the requested value while iOS asks for permission and the keychain saves.
  const [pending, setPending] = useState<boolean | null>(null);
  const [test, setTest] = useState<LibraryPushTestState>(IDLE_TEST);

  const status = AsyncResult.isSuccess(statusResult) ? statusResult.value : null;
  const build = currentLibraryPushBuild();
  const libraryId = library?.id ?? null;
  // The Library may have dropped this iPhone since it registered, or changed which builds it
  // serves; the record follows, so the phone registers again or stops asking.
  useEffect(() => {
    if (libraryId === null || !AsyncResult.isSuccess(statusResult) || statusResult.waiting) return;
    void reconcileLibraryPushStatus(
      registry,
      libraryId,
      statusResult.value,
      statusResult.timestamp,
    ).catch(() => undefined);
  }, [registry, libraryId, statusResult]);
  const view = libraryPushContent({
    supported: true,
    snapshot,
    permission,
    activity,
    status: status === null ? null : { state: status.state, reason: status.reason },
    served: status === null || build === null ? null : libraryPushServes(status.topics, build),
    libraryLabel: saved?.environmentLabel ?? null,
    test,
  });
  const registrationId =
    library === null ? null : (recordFor(snapshot.record, library)?.registration?.id ?? null);

  const settleOptIn = (outcome: LibraryPushOptInOutcome) => {
    setPending(null);
    if (outcome === "denied") {
      Dialog.alert(LIBRARY_PUSH_COPY.deniedAlertTitle, LIBRARY_PUSH_COPY.deniedAlertMessage, [
        { text: LIBRARY_PUSH_COPY.cancel, style: "cancel" },
        { text: LIBRARY_PUSH_COPY.openSettings, onPress: () => void Linking.openSettings() },
      ]);
    } else if (outcome === "failed") {
      Dialog.alert(LIBRARY_PUSH_COPY.sectionTitle, LIBRARY_PUSH_COPY.saveFailed);
    }
  };

  const changeOptIn = (optedIn: boolean) => {
    setPending(optedIn);
    setTest(IDLE_TEST);
    void setLibraryPushOptIn(registry, optedIn).then(settleOptIn, () => settleOptIn("failed"));
  };

  const retry = () => {
    retryLibraryPush(registry);
    if (status !== null) registry.refresh(statusAtom);
  };

  const sendTest = () => {
    if (library === null || registrationId === null) return;
    setTest({ phase: "sending" });
    void sendLibraryPushTest(registry, library.id, registrationId).then(setTest, () =>
      setTest({ phase: "failed", reason: null }),
    );
  };

  return (
    <SettingsSection title={LIBRARY_PUSH_COPY.sectionTitle} footer={view.footer}>
      {view.toggle !== null ? (
        <SettingsSwitchRow
          icon="bell.badge"
          label={view.toggle.label}
          {...(view.toggle.description === null ? {} : { subtitle: view.toggle.description })}
          value={pending ?? view.toggle.value}
          disabled={view.toggle.disabled || pending !== null}
          onValueChange={changeOptIn}
        />
      ) : null}
      {view.message !== null ? (
        <AppText
          className={
            view.message.tone === "danger"
              ? "p-4 text-sm text-danger-foreground"
              : "p-4 text-sm text-foreground-muted"
          }
        >
          {view.message.text}
        </AppText>
      ) : null}
      {view.chooseLibrary ? (
        <SettingsRow
          icon="server.rack"
          label={LIBRARY_PUSH_COPY.chooseLibraryAction}
          onPress={() => navigation.navigate("LibrarySettings")}
        />
      ) : null}
      {view.openSettings ? (
        <SettingsActionRow
          icon="gearshape"
          label={LIBRARY_PUSH_COPY.openSettings}
          onPress={() => void Linking.openSettings()}
        />
      ) : null}
      {view.retry ? (
        <SettingsActionRow icon="arrow.clockwise" label={LIBRARY_PUSH_COPY.retry} onPress={retry} />
      ) : null}
      {view.test !== null ? (
        <SettingsActionRow
          icon="iphone"
          label={LIBRARY_PUSH_COPY.testLabel}
          {...(view.test.description === null ? {} : { description: view.test.description })}
          loading={view.test.loading}
          onPress={sendTest}
        />
      ) : null}
    </SettingsSection>
  );
}
