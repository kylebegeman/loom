import { Alert } from "react-native";

export const confirmBotAutomation = (title: string, detail: string, action: string) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      detail,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: action, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
