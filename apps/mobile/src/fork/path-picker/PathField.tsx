import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { RowPressable } from "../../components/ui/RowPressable";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { FolderPicker, useFolderReadAccess } from "./FolderPicker";

/** A folder setting on one computer, chosen by browsing that computer's folders. */
export function PathField(props: {
  environmentId: EnvironmentId | null;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  startPath?: string | null;
  helperText?: string;
}): React.ReactElement {
  const [choosing, setChoosing] = useState(false);
  const access = useFolderReadAccess(props.environmentId);
  const reason =
    props.environmentId === null
      ? "Choose a computer to browse its folders."
      : !access.canReadFiles && !access.isPending
        ? (access.error ?? "This connection cannot browse this computer's folders.")
        : null;
  const disabled = props.disabled === true || reason !== null;
  const shown = props.value || props.placeholder || "Not chosen";
  const close = () => setChoosing(false);
  return (
    <>
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={`${props.label}, ${shown}`}
        accessibilityHint={reason ?? "Choose a folder by browsing this computer."}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setChoosing(true)}
        className="bg-grouped-card"
      >
        <ListRowLayout
          icon="folder"
          label={props.label}
          description={shown}
          disabled={disabled}
          accessory={<Text className="font-t3-medium text-primary-text">Choose</Text>}
        />
        {reason || props.helperText ? (
          <View className="gap-1 pr-4 pb-3 pl-13">
            {reason ? (
              <Text textRole="footnote" className="text-foreground-muted">
                {reason}
              </Text>
            ) : null}
            {props.helperText ? (
              <Text textRole="footnote" className="text-foreground-muted">
                {props.helperText}
              </Text>
            ) : null}
          </View>
        ) : null}
      </RowPressable>
      {choosing && props.environmentId !== null ? (
        <Sheet title={props.label} onClose={close}>
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="gap-4 p-4 pb-8"
          >
            <FolderPicker
              environmentId={props.environmentId}
              start={[props.value, props.startPath]}
              showHidden
            >
              {(folder) => (
                <View className="flex-row flex-wrap gap-2">
                  <Button label="Cancel" onPress={close} />
                  <Button
                    label="Use this folder"
                    tone="primary"
                    accessibilityHint={folder?.path}
                    disabled={folder === null}
                    onPress={() => {
                      if (!folder) return;
                      close();
                      if (folder.path !== props.value) props.onChange(folder.path);
                    }}
                  />
                </View>
              )}
            </FolderPicker>
          </ScreenScrollView>
        </Sheet>
      ) : null}
    </>
  );
}
