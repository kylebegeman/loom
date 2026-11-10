import {
  Button,
  HStack,
  Image,
  Label,
  Menu,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityHint,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  menuActionDismissBehavior,
  menuIndicator,
  menuOrder,
  menuStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { MenuAction } from "@react-native-menu/menu";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

import { resolveScaledTextRole } from "../../lib/appearancePreferences";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import type { MenuProps, NativeMenuTrigger } from "./Menu.types";
import { NativeThemeHost } from "./NativeThemeHost";
import { useControlTheme } from "./useControlTheme";

type SystemImage = ComponentProps<typeof Image>["systemName"];

function nativeColor(value: number | ColorValue | undefined, fallback: ColorValue) {
  if (typeof value !== "number") return value ?? fallback;
  const color = value >>> 0;
  return `rgba(${(color >>> 16) & 255}, ${(color >>> 8) & 255}, ${color & 255}, ${(color >>> 24) / 255})`;
}

function MenuItemLabel({ action }: { readonly action: MenuAction }) {
  return (
    <Label systemImage={action.image as SystemImage}>
      <Text>{action.title}</Text>
      {action.subtitle ? <Text>{action.subtitle}</Text> : null}
    </Label>
  );
}

function NativeMenuItems(props: {
  readonly actions: readonly MenuAction[];
  readonly onSelect: (id: string) => void;
}) {
  const { colors } = useControlTheme();
  return props.actions.map((action, index) => {
    if (action.attributes?.hidden) return null;
    const id = action.id ?? String(index);
    const modifiers = [
      disabled(Boolean(action.attributes?.disabled)),
      menuActionDismissBehavior(action.attributes?.keepsMenuPresented ? "disabled" : "enabled"),
      ...(!action.attributes?.destructive
        ? [tint(nativeColor(action.imageColor, colors["--color-icon"]))]
        : []),
    ];
    if (action.subactions?.length) {
      const children = <NativeMenuItems actions={action.subactions} onSelect={props.onSelect} />;
      return action.displayInline ? (
        <Section key={id} title={action.title} modifiers={modifiers}>
          {children}
        </Section>
      ) : (
        <Menu key={id} label={<MenuItemLabel action={action} />} modifiers={modifiers}>
          {children}
        </Menu>
      );
    }
    if (action.state === "on" || action.state === "off") {
      return (
        <Toggle
          key={id}
          isOn={action.state === "on"}
          modifiers={modifiers}
          onIsOnChange={() => props.onSelect(id)}
        >
          <MenuItemLabel action={action} />
        </Toggle>
      );
    }
    return (
      <Button
        key={id}
        role={action.attributes?.destructive ? "destructive" : undefined}
        modifiers={modifiers}
        onPress={() => props.onSelect(id)}
      >
        <MenuItemLabel action={action} />
      </Button>
    );
  });
}

export function NativeMenuButton(props: MenuProps & { readonly trigger: NativeMenuTrigger }) {
  const { colors, fontSize } = useControlTheme();
  const { trigger } = props;
  const size = resolveScaledTextRole(trigger.size === "default" ? "body" : "footnote", fontSize);
  const image = typeof trigger.icon === "string" ? trigger.icon : trigger.icon?.ios;
  const detailImage =
    typeof trigger.detailIcon === "string" ? trigger.detailIcon : trigger.detailIcon?.ios;
  const style = NATIVE_LIQUID_GLASS_SUPPORTED
    ? trigger.selected
      ? "glassProminent"
      : "glass"
    : trigger.selected
      ? "borderedProminent"
      : "bordered";
  const items = (
    <NativeMenuItems
      actions={props.actions}
      onSelect={(id) => props.onPressAction?.({ nativeEvent: { event: id } })}
    />
  );
  return (
    <NativeThemeHost
      matchContents={trigger.fullWidth ? { vertical: true } : true}
      ignoreSafeArea="all"
      style={[
        { alignSelf: trigger.fullWidth ? "stretch" : "flex-start", maxWidth: "100%" },
        props.style,
      ]}
      testID={props.testID}
    >
      <Menu
        label={
          <HStack
            spacing={6}
            modifiers={[
              foregroundStyle(
                trigger.selected
                  ? colors["--color-primary-foreground"]
                  : colors["--color-foreground"],
              ),
              ...(trigger.fullWidth ? [frame({ maxWidth: Infinity, alignment: "leading" })] : []),
            ]}
          >
            {image ? <Image systemName={image as SystemImage} size={size.fontSize} /> : null}
            {trigger.label ? (
              <VStack alignment="leading" spacing={2}>
                <Text
                  modifiers={[
                    font({
                      family: "DMSans-Medium",
                      size: size.fontSize,
                      textStyle: trigger.size === "default" ? "body" : "footnote",
                    }),
                    lineLimit(trigger.fullWidth ? 2 : 1),
                  ]}
                >
                  {trigger.label}
                </Text>
                {trigger.subtitle ? (
                  <Text
                    modifiers={[
                      font({
                        family: "DMSans-Regular",
                        size: size.fontSize - 2,
                        textStyle: "footnote",
                      }),
                      foregroundStyle(colors["--color-foreground-muted"]),
                    ]}
                  >
                    {trigger.subtitle}
                  </Text>
                ) : null}
              </VStack>
            ) : null}
            {trigger.detail ? (
              <>
                <Spacer />
                {detailImage ? (
                  <Image
                    systemName={detailImage as SystemImage}
                    size={size.fontSize}
                    modifiers={[foregroundStyle(colors["--color-foreground-muted"])]}
                  />
                ) : null}
                <Text
                  modifiers={[
                    font({ family: "DMSans-Regular", size: size.fontSize, textStyle: "footnote" }),
                    foregroundStyle(colors["--color-foreground-muted"]),
                  ]}
                >
                  {trigger.detail}
                </Text>
              </>
            ) : null}
            {trigger.label ? <Image systemName="chevron.down" size={10} /> : null}
          </HStack>
        }
        modifiers={[
          menuStyle("button"),
          buttonStyle(style),
          buttonBorderShape(trigger.label ? "capsule" : "circle"),
          menuIndicator("hidden"),
          menuOrder("fixed"),
          controlSize("regular"),
          tint(colors["--color-primary"]),
          disabled(Boolean(trigger.disabled)),
          accessibilityLabel(trigger.accessibilityLabel),
          ...(trigger.accessibilityHint ? [accessibilityHint(trigger.accessibilityHint)] : []),
          ...(trigger.selected ? [accessibilityAddTraits(["isSelected"])] : []),
          frame({
            minWidth: 44,
            minHeight: 44,
            ...(trigger.fullWidth ? { maxWidth: Infinity } : {}),
          }),
        ]}
      >
        {props.title ? <Section title={props.title}>{items}</Section> : items}
      </Menu>
    </NativeThemeHost>
  );
}
