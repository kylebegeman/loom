import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { Atom } from "effect/reactivity";
import { useEffect, type ComponentProps } from "react";
import { View } from "react-native";

import { ThreadSettingsPickerScreen } from "../../features/threads/ThreadSettingsSheet";
import { appAtomRegistry } from "../../state/atom-registry";

/** The settings a thread route presents with its conversation details page. */
export type ConversationDetailsSettingsSession = Omit<
  ComponentProps<typeof ThreadSettingsPickerScreen>,
  "onClose"
> & {
  readonly ownerId: string;
};

const sessionAtom = Atom.make<ConversationDetailsSettingsSession | null>(null).pipe(
  Atom.keepAlive,
);

const present = (session: ConversationDetailsSettingsSession) => {
  appAtomRegistry.set(sessionAtom, session);
};

const clear = (ownerId: string) => {
  if (appAtomRegistry.get(sessionAtom)?.ownerId === ownerId) {
    appAtomRegistry.set(sessionAtom, null);
  }
};

export function useConversationDetailsSettingsPresentation() {
  const session = useAtomValue(sessionAtom);
  return { session, present, clear };
}

export function ConversationDetailsSettingsRouteScreen() {
  const navigation = useNavigation();
  const { session } = useConversationDetailsSettingsPresentation();

  // oxlint-disable-next-line t3code/react-effect-budget -- leaves the sheet once its thread route clears the session
  useEffect(() => {
    if (!session) navigation.goBack();
  }, [navigation, session]);

  if (!session) {
    return <View className="flex-1 bg-sheet" />;
  }

  const { ownerId: _ownerId, ...settings } = session;
  return <ThreadSettingsPickerScreen {...settings} onClose={() => navigation.goBack()} />;
}
