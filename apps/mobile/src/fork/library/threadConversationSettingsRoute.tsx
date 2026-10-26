import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useSyncExternalStore, type ComponentProps } from "react";
import { View } from "react-native";

import { ThreadSettingsPickerScreen } from "../../features/threads/ThreadSettingsSheet";

export type ThreadConversationSettingsSession = Omit<
  ComponentProps<typeof ThreadSettingsPickerScreen>,
  "onClose"
> & {
  readonly ownerId: string;
};

let currentSession: ThreadConversationSettingsSession | null = null;
const listeners = new Set<() => void>();

function setSession(session: ThreadConversationSettingsSession | null) {
  if (session === currentSession) return;
  currentSession = session;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function present(session: ThreadConversationSettingsSession) {
  setSession(session);
}

function clear(ownerId: string) {
  if (currentSession?.ownerId === ownerId) setSession(null);
}

export function useThreadConversationSettingsRoute() {
  const session = useSyncExternalStore(subscribe, () => currentSession);
  return { session, present, clear };
}

export function ThreadConversationSettingsRouteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const { session } = useThreadConversationSettingsRoute();

  // oxlint-disable-next-line t3code/react-effect-budget -- leaves the sheet once its thread route unmounts
  useEffect(() => {
    if (session) return;
    navigation.goBack();
  }, [navigation, session]);

  if (!session) {
    return <View className="flex-1 bg-sheet" />;
  }

  const { ownerId: _ownerId, ...settings } = session;

  return <ThreadSettingsPickerScreen {...settings} onClose={() => navigation.goBack()} />;
}
