import { useRef } from "react";
import { Pressable, View } from "react-native";
import { nextAttentionThread } from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { AppText } from "../../components/ui/AppText";
import { ListFilterMenu } from "../../features/workspace/ListFilterMenu";

export type AttentionFilter = "all" | "needs-you" | "waiting";
export function ThreadAttentionHeader(props: {
  threads: readonly EnvironmentThreadShell[];
  filter: AttentionFilter;
  onFilter: (filter: AttentionFilter) => void;
  onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  const last = useRef<ScopedThreadRef | null>(null);
  return (
    <View className="flex-row items-center justify-between px-4 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.threads.length} need you. Go to next thread that needs you`}
        disabled={props.threads.length === 0}
        hitSlop={8}
        onPress={() => {
          const next = nextAttentionThread(props.threads, last.current);
          if (next) {
            last.current = { environmentId: next.environmentId, threadId: next.id };
            props.onSelect(next);
          }
        }}
      >
        <AppText className="text-foreground-muted text-sm">{props.threads.length} need you</AppText>
      </Pressable>
      <ListFilterMenu
        label={
          props.filter === "all"
            ? "All statuses"
            : props.filter === "needs-you"
              ? "Needs you"
              : "Waiting on you"
        }
        accessibilityLabel="Filter threads by attention"
        active={props.filter !== "all"}
        actions={[
          { id: "all", title: "All statuses", state: props.filter === "all" ? "on" : "off" },
          {
            id: "needs-you",
            title: "Needs you",
            state: props.filter === "needs-you" ? "on" : "off",
          },
          {
            id: "waiting",
            title: "Waiting on you",
            state: props.filter === "waiting" ? "on" : "off",
          },
        ]}
        onSelect={(id) => {
          if (id === "all" || id === "needs-you" || id === "waiting") props.onFilter(id);
        }}
      />
    </View>
  );
}
