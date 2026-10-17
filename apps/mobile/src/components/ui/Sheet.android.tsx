import { useState } from "react";
import { View } from "react-native";
import { FormSheet } from "react-native-screens";
import { useResolveClassNames } from "uniwind";
import { AndroidSheetHeader } from "./AndroidScreenHeader";
import type { SheetProps } from "./Sheet.types";
export type { SheetProps } from "./Sheet.types";

export function Sheet(props: SheetProps) {
  const containerStyle = useResolveClassNames("bg-sheet");
  const [isOpen, setIsOpen] = useState(true);
  // fork: sites-editor-dismiss -- Pending forms must retain their input until saving settles.
  const dismissible = props.dismissible ?? true;
  return (
    <FormSheet
      isOpen={isOpen}
      preventNativeDismiss={!dismissible}
      detents={[0.5, 0.9]}
      prefersGrabberVisible
      nativeContainerStyle={containerStyle}
      onDismiss={props.onClose}
      onNativeDismiss={props.onClose}
    >
      <View collapsable={false} className="flex-1 bg-sheet">
        <AndroidSheetHeader
          title={props.title}
          onBack={dismissible ? () => setIsOpen(false) : undefined}
        />
        {props.children}
      </View>
    </FormSheet>
  );
}
