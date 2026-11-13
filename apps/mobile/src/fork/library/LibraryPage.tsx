import { useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { LEGACY_CONNECT_UI_ENABLED } from "@t3tools/client-runtime/fork"; // fork: connect-ui
import type { LibraryAccessRepair, LibraryError } from "@t3tools/contracts/fork";
import { type LibraryAccessRepairContext, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ScreenContent } from "../../components/ui/ScreenContent";
import {
  ScreenScrollView,
  ScreenScrollViewBottomInset,
  ScreenScrollViewSurface,
} from "../../components/ui/ScreenScrollView";
import { useHardwareKeyboardCommand } from "../../features/keyboard/hardwareKeyboardCommands";
import { useAdaptiveWorkspaceLayout } from "../../features/layout/adaptive-workspace-context";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import {
  useCompactWorkspaceTabs,
  useSystemWorkspaceTabBar,
} from "../../features/layout/workspace/useSystemWorkspaceTabBar";
import { cn } from "../../lib/cn";
import { useDeviceType } from "../../native/native-layout-metrics";
import { useEnvironments } from "../../state/environments";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { library, useLibraryAuthority } from "./libraryState";
import { LibrarySignInSection } from "./LibrarySignInStatus";
import { DevicesWithAccessSection } from "../connections/DevicesWithAccessSection";
import { AccountComputers } from "../connections/AccountComputers";
import { ApproveComputer } from "../connections/ApproveComputer";
import { AccountVaultEntry } from "../vault/AccountVaultEntry";
import { LibraryAccessBlock } from "./LibraryAccessBlock";
import { LibraryDeletedSettings } from "./LibraryDeletedSettings";
import { useWorkspacePageBack } from "./workspacePageBack";

/** SettingsScreen's surface, plus the Home fallback for Back and unscrolled pages it lacks. */
export function LibraryPage(props: {
  title: string;
  children: ReactNode;
  back?: boolean;
  scroll?: boolean;
  actions?: Parameters<typeof AppBar>[0]["actions"];
  menus?: Parameters<typeof AppBar>[0]["menus"];
}) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const route = useRoute();
  const pageBack = useWorkspacePageBack();
  const deviceType = useDeviceType();
  const compactTabs = useCompactWorkspaceTabs();
  const systemTabBar = useSystemWorkspaceTabBar();
  const { layout } = useAdaptiveWorkspaceLayout();
  useHardwareKeyboardCommand(
    "newTask",
    useCallback(() => {
      if (!focused) return false;
      const params = route.params;
      // A project in view only leads the picker, as on web; the others and No project follow it.
      if (params && "projectId" in params && typeof params.projectId === "string")
        navigation.navigate("NewTaskProject", { libraryProjectId: params.projectId });
      else navigation.navigate("NewTaskProject");
      return true;
    }, [focused, route.params, navigation]),
  );
  const insets = useSafeAreaInsets();
  // Heading the workspace, the list takes the workspace's surface, as Usage does.
  const surface = pageBack === undefined || deviceType === "duo-folded" ? "bg-screen" : "bg-sheet";
  return (
    <View collapsable={false} className={cn("flex-1", surface)}>
      <AppBar
        title={props.title}
        hideBottomBorder
        onBack={props.back === false ? undefined : pageBack}
        actions={props.actions}
        menus={props.menus}
      />
      <ScreenScrollViewBottomInset
        value={(deviceType === "pad" && !systemTabBar) || compactTabs ? 80 : 0}
      >
        <ScreenScrollViewSurface value={surface}>
          <ScreenContent insetHorizontal={Platform.OS === "android" && layout.usesSplitView}>
            {props.scroll === false ? (
              props.children
            ) : (
              <ScreenScrollView
                className="flex-1"
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                contentInsetAdjustmentBehavior="automatic"
                contentContainerClassName="gap-7 px-5 pt-5"
                contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
              >
                {props.children}
              </ScreenScrollView>
            )}
          </ScreenContent>
        </ScreenScrollViewSurface>
      </ScreenScrollViewBottomInset>
    </View>
  );
}

export function LibraryNotice(props: {
  error?: string | null;
  accessRepair?: LibraryAccessRepair | undefined;
  accessContext?: LibraryAccessRepairContext | undefined;
  repair?: LibraryError["repair"] | undefined;
  detail?: string | null;
  onRetry?: () => void;
}) {
  return (
    <View className="gap-2">
      {props.detail ? <Text className="text-sm text-foreground-muted">{props.detail}</Text> : null}
      {props.error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
          {props.error}
        </Text>
      ) : null}
      <LibraryAccessBlock
        accessRepair={props.accessRepair}
        accessContext={props.accessContext}
        error={props.error}
        repair={props.repair}
      />
      {props.onRetry ? <Button label="Reload library" tone="text" onPress={props.onRetry} /> : null}
    </View>
  );
}

export function LibraryAuthorityScreen() {
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const navigation = useNavigation();
  const info = useAtomQueryRunner(library.info, { refresh: true, reportFailure: false });
  const [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  return (
    <LibraryPage title="Account">
      <Text className="text-sm text-foreground-muted">
        Sign in once to find your computers, projects and saved conversations on all your devices.
      </Text>
      {authority.environmentId ? (
        <Text className="text-sm text-foreground">
          {authority.connected
            ? `Connected to ${authority.label}.`
            : `Sign in to reconnect to ${authority.label}.`}
        </Text>
      ) : null}
      <LibrarySignInSection />
      <AccountVaultEntry />
      <ApproveComputer />
      <AccountComputers />
      {authority.environmentId ? (
        <DevicesWithAccessSection
          environmentId={authority.environmentId}
          connected={authority.ready}
          account
        />
      ) : null}
      {!authority.environmentId ? (
        <Button label="Sign in to Loom" onPress={() => navigation.navigate("LibrarySignIn", {})} />
      ) : null}
      <LibraryDeletedSettings />
      {error ? <LibraryNotice error={error} /> : null}
      <Button
        label={advanced ? "Hide advanced account settings" : "Advanced account settings"}
        tone="text"
        onPress={() => setAdvanced(!advanced)}
      />
      {advanced ? (
        <>
          <Text className="text-sm text-foreground-muted">
            Changing your Library opens a different account’s saved work. It does not move projects
            or enroll this device as an execution computer.
          </Text>
          <SettingsSection title="Library server">
            {environments.map((environment, index) => {
              const connected =
                environment.entry.enabled && environment.connection.phase === "connected";
              const supported = supportsLoomFeature(
                environment.serverConfig?.environment.capabilities,
                "project-library",
              );
              return (
                <ListChoiceRow
                  key={environment.environmentId}
                  label={environment.label}
                  selected={authority.environmentId === environment.environmentId}
                  separated={index > 0}
                  disabled={!connected || !supported || pending !== null}
                  description={
                    !connected
                      ? "Offline"
                      : !supported
                        ? "Update this server to support the library"
                        : "Connected"
                  }
                  onPress={() => {
                    setPending(environment.environmentId);
                    setError(null);
                    void info({ environmentId: environment.environmentId, input: {} })
                      .then(async (result) => {
                        if (AsyncResult.isFailure(result))
                          return Promise.reject(squashAtomCommandFailure(result));
                        if (result.value.isAuthority !== true)
                          return Promise.reject(
                            new Error(
                              "Choose your Library server. This computer runs work and does not own the shared catalog.",
                            ),
                          );
                        await authority.select(environment.environmentId);
                        navigation.navigate("Library");
                      })
                      .catch((cause: unknown) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "The library connection could not be saved.",
                        ),
                      )
                      .finally(() => setPending(null));
                  }}
                />
              );
            })}
          </SettingsSection>
          <Button
            label={authority.environmentId ? "Sign in to another library" : "Sign in to library"}
            tone={authority.environmentId ? "secondary" : "primary"}
            onPress={() => navigation.navigate("LibrarySignIn", {})}
          />
          <Button
            label="Manage computer connections"
            tone="text"
            onPress={() => navigation.navigate("Connections")}
          />
          {LEGACY_CONNECT_UI_ENABLED ? (
            <Button
              label="T3 Connect account settings"
              tone="text"
              onPress={() => navigation.navigate("SettingsAuth")}
            />
          ) : null}
        </>
      ) : null}
    </LibraryPage>
  );
}
