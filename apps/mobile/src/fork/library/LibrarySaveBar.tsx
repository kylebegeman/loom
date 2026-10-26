import { libraryThreadSaveState } from "@t3tools/client-runtime/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useEnvironmentQuery } from "../../state/query";
import { library } from "./libraryState";

/** Shown above the composer while a conversation the Library saves has work it does not have. */
export function LibrarySaveBar(props: { readonly threadRef: ScopedThreadRef | null }) {
  const { threadRef } = props;
  const query = useEnvironmentQuery(
    threadRef === null
      ? null
      : library.threadSaveStatus({
          environmentId: threadRef.environmentId,
          input: { threadIds: [threadRef.threadId] },
        }),
  );
  const state = threadRef === null ? null : libraryThreadSaveState(query.data, threadRef.threadId);
  if (state === null) return null;
  return (
    <View className="flex-row items-center gap-2 px-4 pb-2">
      <SymbolView name="cloud" size={12} tintColorClassName="accent-foreground-muted" />
      <Text
        accessibilityLiveRegion="polite"
        className="min-w-0 flex-1 text-xs text-foreground-muted"
        numberOfLines={1}
      >
        {state.kind === "unsaved" ? "Not saved to Library yet" : "Library copy is behind"}
      </Text>
    </View>
  );
}
