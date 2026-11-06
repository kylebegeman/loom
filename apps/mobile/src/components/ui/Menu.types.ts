import type { MenuView } from "@react-native-menu/menu";
import type { ComponentProps, ReactNode } from "react";
import type { AccessibilityProps } from "react-native";
import type { AppSymbolName } from "./AppSymbol";

// fork: native-menus
export interface NativeMenuTrigger {
  readonly label?: string;
  readonly subtitle?: string;
  readonly detail?: string;
  readonly detailIcon?: AppSymbolName;
  readonly icon?: AppSymbolName;
  readonly accessibilityLabel: string;
  readonly accessibilityHint?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly size?: "compact" | "default";
  readonly fullWidth?: boolean;
}

export type MenuProps = Omit<ComponentProps<typeof MenuView>, "children" | "themeVariant"> &
  Pick<AccessibilityProps, "accessible" | "accessibilityLabel" | "accessibilityRole"> & {
    readonly children: ReactNode;
    readonly className?: string;
    readonly nativeTrigger?: NativeMenuTrigger;
  };
