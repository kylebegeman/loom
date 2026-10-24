import { useNavigation } from "@react-navigation/native";
import type { ComponentProps, ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";

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
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={title}
        onBack={
          back
            ? () => {
                if (navigation.canGoBack()) navigation.goBack();
                else navigation.navigate("Home");
              }
            : undefined
        }
        actions={actions}
        menus={menus}
      />
      {scroll ? (
        <ScreenScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: 16,
            gap: 20,
            paddingBottom: Math.max(insets.bottom, 24) + 24,
          }}
        >
          {children}
        </ScreenScrollView>
      ) : (
        children
      )}
    </View>
  );
}

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
    <View className="gap-3">
      <Text accessibilityRole="header" className="text-lg font-t3-semibold text-foreground">
        {title}
      </Text>
      {description ? <Text className="text-sm text-foreground-muted">{description}</Text> : null}
      {children}
    </View>
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
  return (
    <ListToggleRow
      label={label}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      description={description}
    />
  );
}
