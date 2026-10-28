import { useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { needsLibrarySignIn, supportsLoomFeature } from "@t3tools/client-runtime/fork";
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
import { useCompactWorkspaceTabs } from "../../features/workspace/useSystemWorkspaceTabBar";
import { useWorkspaceSurface } from "../../features/workspace/useWorkspaceSurface";
import { cn } from "../../lib/cn";
import { useDeviceType } from "../../native/native-layout-metrics";
import { useEnvironments } from "../../state/environments";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { library, useLibraryAuthority } from "./libraryState";
import { LibrarySignInAgainButton, LibrarySignInSection } from "./LibrarySignInStatus";
import { useWorkspacePageBack } from "./workspacePageBack";

/** SettingsScreen's surface, plus the Home fallback for Back and unscrolled pages it lacks. */
export function LibraryPage(props: {
  title: string;
  children: ReactNode;
  back?: boolean;
  scroll?: boolean;
  actions?: Parameters<typeof AppBar>[0]["actions"];
}) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const route = useRoute();
  const pageBack = useWorkspacePageBack();
  const workspaceSurface = useWorkspaceSurface();
  const deviceType = useDeviceType();
  const compactTabs = useCompactWorkspaceTabs();
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
  const surface =
    deviceType === "duo-folded"
      ? "bg-screen"
      : pageBack === undefined
        ? workspaceSurface.className
        : "bg-sheet";
  return (
    <View collapsable={false} className={cn("flex-1", surface)}>
      <AppBar
        title={props.title}
        // With no Back, the sidebar toggle is the only way to bring back a hidden list.
        sidebar={pageBack === undefined}
        hideBottomBorder
        onBack={props.back === false ? undefined : pageBack}
        actions={props.actions}
      />
      <ScreenScrollViewBottomInset value={deviceType === "pad" || compactTabs ? 80 : 0}>
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
                contentContainerClassName="gap-6 px-5 pt-4"
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
      {needsLibrarySignIn(props.error) ? <LibrarySignInAgainButton /> : null}
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
  return (
    <LibraryPage title="Connect your library">
      <Text className="text-sm text-foreground-muted">
        Choose where Loom keeps your shared library once. Projects can use any connected execution
        computer later.
      </Text>
      {authority.environmentId ? (
        <Text className="text-sm text-foreground">
          Current library: {authority.label}. Changing it opens another library; it does not move
          saved projects.
        </Text>
      ) : null}
      <LibrarySignInSection />
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
      {error ? <LibraryNotice error={error} /> : null}
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
      <Button
        label="T3 Connect account settings"
        tone="text"
        onPress={() => navigation.navigate("SettingsAuth")}
      />
    </LibraryPage>
  );
}
