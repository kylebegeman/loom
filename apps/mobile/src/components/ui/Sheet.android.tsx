import { useState } from "react";
import { View } from "react-native";
import { FormSheet } from "react-native-screens";
import { useResolveClassNames } from "uniwind";
import { AndroidSheetHeader } from "./AndroidScreenHeader";
import { ScreenContent } from "./ScreenContent";
import type { SheetProps } from "./Sheet.types";
export type { SheetProps } from "./Sheet.types";

export function Sheet(props: SheetProps) {
  const containerStyle = useResolveClassNames("bg-header");
  const [isOpen, setIsOpen] = useState(true);
  // fork: sites-editor-dismiss -- Pending forms must retain their input until saving settles.
  const dismissible = props.dismissible ?? true;
  return (
    <FormSheet
      isOpen={isOpen}
      preventNativeDismiss={!dismissible} // fork: sites-editor-dismiss
      detents={[0.5, 0.9]}
      prefersGrabberVisible={false}
      nativeContainerStyle={containerStyle}
      onDismiss={props.onClose}
      onNativeDismiss={props.onClose}
    >
      {/* Android FormSheet does not bound flex children. Material drags target the first scroll view, so place content before the header. */}
      <View collapsable={false} className="absolute inset-0 flex-col-reverse bg-header">
        <ScreenContent>{props.children}</ScreenContent>
        <AndroidSheetHeader
          title={props.title}
          onBack={dismissible ? () => setIsOpen(false) : undefined} // fork: sites-editor-dismiss
          hideBottomBorder
        />
        <View
          pointerEvents="none"
          className="absolute top-1 h-1 w-8 self-center rounded-full bg-header-foreground/40"
        />
      </View>
    </FormSheet>
  );
}
