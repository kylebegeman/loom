// fork: project-navigation - Icon-only navigation reuses finite sliding selection and reduced motion.
import { useEffect, useState } from "react";
import { I18nManager, Platform, Pressable, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { AppText as Text } from "./AppText";
import { SymbolView } from "./AppSymbol";
import { cn } from "../lib/cn";
import { MaterialSegmentedControl } from "./MaterialSegmentedControl";
import type { SegmentedControlProps } from "./SegmentedControl.types";

export type { SegmentedControlProps } from "./SegmentedControl.types";

export function SegmentedControl<Value extends number | string>(
  props: SegmentedControlProps<Value>,
) {
  const compact = props.size === "compact";
  // Paired icon navigation keeps a compact track inside two full native touch targets.
  const compactIcons = props.iconOnly && compact && props.options.length === 2;
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.selected),
  );
  const position = useSharedValue(index);
  useEffect(() => {
    position.set(
      withTiming(index, {
        duration: 200,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [index, position]);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          position.value *
          (compactIcons ? 28 : width / props.options.length) *
          (I18nManager.isRTL ? -1 : 1),
      },
    ],
  }));
  if (Platform.OS === "android" && !props.iconOnly) {
    return <MaterialSegmentedControl {...props} />;
  }
  return (
    <View
      accessible={false}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      className={cn(
        "flex-row",
        compactIcons
          ? "h-[44px] w-[88px]"
          : "overflow-hidden rounded-full border-continuous bg-card",
        props.iconOnly && "self-start",
        props.className,
      )}
    >
      {compactIcons ? (
        <View
          pointerEvents="none"
          accessible={false}
          className="absolute h-[32px] w-[60px] rounded-full border-continuous bg-card"
          style={{ top: 6, start: 14 }}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        className={cn(
          "absolute rounded-full bg-secondary",
          compactIcons ? "top-[8px] h-[28px]" : "inset-y-0",
        )}
        style={[
          compactIcons
            ? { width: 28, start: 16 }
            : { width: `${100 / props.options.length}%`, start: 0 },
          indicatorStyle,
        ]}
      />
      {props.options.map((option, optionIndex) => {
        const active = option.value === props.selected;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole={Platform.OS === "ios" ? "button" : (props.role ?? "button")}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected: active }}
            onPress={() => props.onSelect(option.value)}
            className={cn(
              "items-center justify-center rounded-full",
              compactIcons
                ? "h-[44px] w-[44px]"
                : props.iconOnly
                  ? "h-[48px] w-[48px]"
                  : cn("flex-1", compact ? "h-9" : "h-11"),
            )}
          >
            {props.iconOnly && option.icon ? (
              <SymbolView
                name={option.icon}
                size={compactIcons ? 16 : 20}
                style={
                  compactIcons
                    ? {
                        transform: [
                          {
                            translateX: (optionIndex === 0 ? 8 : -8) * (I18nManager.isRTL ? -1 : 1),
                          },
                        ],
                      }
                    : undefined
                }
                tintColorClassName={
                  active ? "accent-secondary-foreground" : "accent-foreground-muted"
                }
                type="monochrome"
              />
            ) : (
              <Text
                className={cn(
                  compact ? "text-xs" : "text-sm",
                  active ? "font-t3-medium text-secondary-foreground" : "text-foreground-muted",
                )}
              >
                {option.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
