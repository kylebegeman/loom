import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

export function ThreadSearchNotice(props: {
  readonly pending: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <View className="gap-2 px-4 py-3">
      <Text accessibilityLiveRegion="polite" className="text-sm text-warning-foreground">
        Search could not reach every computer. Results may be incomplete.
      </Text>
      <Button label="Retry search" tone="text" disabled={props.pending} onPress={props.onRetry} />
    </View>
  );
}
