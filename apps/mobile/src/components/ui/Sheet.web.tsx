import { Modal, View } from "react-native";
import { AppText } from "./AppText";
import { Button } from "./Button";
import type { SheetProps } from "./Sheet.types";
export type { SheetProps } from "./Sheet.types";

/** FormSheet is native-only, so web uses the same dismissal policy in a modal. */
export function Sheet(props: SheetProps) {
  const dismissible = props.dismissible ?? true;
  const close = () => {
    if (dismissible) props.onClose();
  };
  return (
    <Modal transparent visible onRequestClose={close}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[90%] rounded-t-2xl bg-sheet">
          <View className="flex-row items-center justify-between p-4">
            <AppText accessibilityRole="header" className="text-lg font-t3-semibold">
              {props.title}
            </AppText>
            <Button label="Done" disabled={!dismissible} onPress={close} />
          </View>
          {props.children}
        </View>
      </View>
    </Modal>
  );
}
