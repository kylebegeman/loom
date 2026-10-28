import type { ComponentProps, ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { ScreenContent } from "../../components/ui/ScreenContent";
import {
  ScreenScrollView,
  ScreenScrollViewBottomInset,
  ScreenScrollViewSurface,
} from "../../components/ui/ScreenScrollView";
import { useAdaptiveWorkspaceLayout } from "../../features/layout/adaptive-workspace-context";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useCompactWorkspaceTabs } from "../../features/workspace/useSystemWorkspaceTabBar";
import { cn } from "../../lib/cn";
import { useWorkspacePageBack } from "../library/workspacePageBack";
import { useDeviceType } from "../../native/native-layout-metrics";

/** SettingsScreen's surface, plus the header menus, Home fallback and unscrolled lists it lacks. */
export function BotPage({
  title,
  children,
  back = true,
  actions,
  menus,
  scroll = true,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly back?: boolean;
  readonly actions?: ComponentProps<typeof AppBar>["actions"];
  readonly menus?: ComponentProps<typeof AppBar>["menus"];
  readonly scroll?: boolean;
}) {
  const pageBack = useWorkspacePageBack();
  const insets = useSafeAreaInsets();
  const deviceType = useDeviceType();
  const compactTabs = useCompactWorkspaceTabs();
  const { layout } = useAdaptiveWorkspaceLayout();
  const surface = deviceType === "duo-folded" ? "bg-screen" : "bg-sheet";
  return (
    <View collapsable={false} className={cn("flex-1", surface)}>
      <AppBar
        title={title}
        sidebar={false}
        hideBottomBorder
        onBack={back ? pageBack : undefined}
        actions={actions}
        menus={menus}
      />
      <ScreenScrollViewBottomInset value={deviceType === "pad" || compactTabs ? 80 : 0}>
        <ScreenScrollViewSurface value={surface}>
          <ScreenContent insetHorizontal={Platform.OS === "android" && layout.usesSplitView}>
            {scroll ? (
              <ScreenScrollView
                className="flex-1"
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                contentInsetAdjustmentBehavior="automatic"
                contentContainerClassName="gap-6 px-5 pt-4"
                contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
              >
                {children}
              </ScreenScrollView>
            ) : (
              children
            )}
          </ScreenContent>
        </ScreenScrollViewSurface>
      </ScreenScrollViewBottomInset>
    </View>
  );
}

function renderBotListScrollView(props: ComponentProps<typeof ScreenScrollView>) {
  return <ScreenScrollView {...props} />;
}

/** For a `scroll={false}` page's list, so it takes the page surface under the iOS header. */
export const BOT_LIST_SCROLL_VIEW = Platform.OS === "ios" ? renderBotListScrollView : undefined;

export function BotNotice({
  error,
  detail,
  onRetry,
  retryLabel = "Reload bots",
}: {
  readonly error?: string | null;
  readonly detail?: string | null;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}) {
  return (
    <View className="gap-2">
      {detail ? <Text className="text-sm text-foreground-muted">{detail}</Text> : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="text-sm text-danger-foreground"
        >
          {error}
        </Text>
      ) : null}
      {onRetry ? <Button label={retryLabel} tone="text" onPress={onRetry} /> : null}
    </View>
  );
}

export function BotSection({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <SettingsSection title={title} footer={description}>
      <View className="gap-3 p-4">{children}</View>
    </SettingsSection>
  );
}

export function BotField({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-t3-medium text-foreground">{label}</Text>
      {children}
      {hint ? <Text className="text-xs text-foreground-muted">{hint}</Text> : null}
    </View>
  );
}

export function BotInput({
  label,
  disabled,
  multiline,
  ...props
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly multiline?: boolean;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly keyboardType?: ComponentProps<typeof TextInput>["keyboardType"];
  readonly secureTextEntry?: boolean;
}) {
  return (
    <BotField label={label}>
      <TextInput
        {...props}
        accessibilityLabel={label}
        multiline={multiline}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical={multiline ? "top" : "center"}
        className={multiline ? "min-h-28" : undefined}
      />
    </BotField>
  );
}

export function BotChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{
    readonly value: T;
    readonly label: string;
    readonly description?: string;
  }>;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  return (
    <BotField label={label}>
      <View
        accessibilityRole="radiogroup"
        className="overflow-hidden rounded-xl border border-border-subtle"
      >
        {options.map((option, index) => (
          <ListChoiceRow
            key={option.value}
            label={option.label}
            description={option.description}
            selected={value === option.value}
            separated={index > 0}
            disabled={disabled}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </BotField>
  );
}

export function BotToggle({
  label,
  value,
  onChange,
  disabled,
  description,
}: {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
  readonly disabled?: boolean;
  readonly description?: string;
}) {
  // A field, not a list row: it lines up with the inputs beside it in a section's padded card.
  return (
    <View className={cn("min-h-11 flex-row items-center gap-3", disabled && "opacity-45")}>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-sm font-t3-medium text-foreground">{label}</Text>
        {description ? (
          <Text textRole="footnote" className="text-foreground-muted">
            {description}
          </Text>
        ) : null}
      </View>
      <ThemedSwitch
        accessibilityLabel={label}
        accessibilityHint={description}
        disabled={disabled}
        value={value}
        onValueChange={onChange}
      />
    </View>
  );
}
