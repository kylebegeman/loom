import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";

export function ComposerErrorNotice(props: {
  readonly message: string;
  readonly onDismiss: () => void;
  readonly onReviewContext?: () => void;
}) {
  return (
    <View className="px-4 pb-3">
      <Notice
        message={props.message}
        icon="exclamationmark.circle"
        iconTone="danger"
        floating
        onDismiss={props.onDismiss}
        dismissLabel="Dismiss error"
      />
      {props.onReviewContext ? (
        <View className="pt-1">
          <Button label="Conversation details" tone="text" onPress={props.onReviewContext} />
        </View>
      ) : null}
    </View>
  );
}
