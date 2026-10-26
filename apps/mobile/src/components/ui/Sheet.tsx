import { useId, useState } from "react";
import { Platform, View } from "react-native";
import { FormSheet, ScreenStack } from "react-native-screens";
import { useResolveClassNames } from "uniwind";

import { nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import { formSheetDetents } from "../../native/sheet-surface";
import { NativeHeader, NativeScreen } from "../../native/ThemedScreenStack";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

export type { SheetProps } from "./Sheet.types";
import type { SheetProps } from "./Sheet.types";

/** Native presentation. Scrollable children use automatic insets beneath the iOS header. */
export function Sheet(props: SheetProps) {
  const containerStyle = useResolveClassNames("bg-sheet");
  const screenId = useId();
  const [isOpen, setIsOpen] = useState(true);
  // fork: sites-editor-dismiss -- Pending forms must retain their input until saving settles.
  const dismissible = props.dismissible ?? true;
  const close = () => {
    if (dismissible) setIsOpen(false);
  };

  return (
    <FormSheet
      isOpen={isOpen}
      preventNativeDismiss={!dismissible}
      detents={formSheetDetents(0.5, 0.9)}
      prefersGrabberVisible
      // The header holds the close button, so the Duo needs no rail inside this sheet.
      prefersHorizontalBars
      nativeContainerStyle={containerStyle}
      onDismiss={props.onClose}
      onNativeDismiss={props.onClose}
    >
      {/* Pin content to the native sheet bounds; flex sizing can grow with long forms. */}
      <View collapsable={false} className="absolute inset-0 bg-sheet">
        <ScreenStack style={{ flex: 1 }}>
          <NativeScreen
            activityState={2}
            enabled
            isNativeStack
            screenId={`app-sheet-${screenId}`}
            scrollEdgeEffects={HEADER_SCROLL_EDGE_EFFECTS}
            className="flex-1 bg-sheet"
          >
            {props.children}
            <NativeHeader
              backgroundColor="rgba(0,0,0,0)"
              tintColorClassName="accent-foreground"
              hideBackButton
              hideShadow={false}
              title={props.title}
              titleColorClassName="accent-foreground"
              titleFontSize={18}
              titleFontWeight="800"
              translucent
              headerRightBarButtonItems={[
                {
                  type: "button",
                  icon: { name: "xmark", type: "sfSymbol" },
                  disabled: !dismissible,
                  accessibilityLabel: `Close ${props.title}`,
                  identifier: `app-sheet-close-${screenId}`,
                  onPress: close,
                },
              ]}
            />
          </NativeScreen>
        </ScreenStack>
      </View>
    </FormSheet>
  );
}
