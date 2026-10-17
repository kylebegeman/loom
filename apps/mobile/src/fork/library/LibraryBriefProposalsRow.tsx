import { useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  libraryBriefProposalSourceLabel,
  libraryBriefSuggestionsLabel,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_BRIEF_PROPOSALS_FEATURE, type LibraryProject } from "@t3tools/contracts/fork";
import { useCallback } from "react";
import { Platform, View } from "react-native";
import { useResolveClassNames } from "uniwind";
import { AppText as Text } from "../../components/ui/AppText";
import { RowPressable } from "../../components/ui/RowPressable";
import { relativeTime } from "../../lib/time";
import { useEnvironmentQuery } from "../../state/query";
import { library, useLoomFeature } from "./libraryState";

/** One page of pending suggestions is plenty; the count is what is waiting, not history. */
const PENDING_LIMIT = 100;

export const pendingProposals = (environmentId: EnvironmentId, projectId: string) =>
  library.briefProposals({
    environmentId,
    input: { projectId, status: "pending", limit: PENDING_LIMIT },
  });

/**
 * The suggestions waiting on a project's brief, as a row inside the Brief section. Renders only
 * when the Library advertises `library-brief-proposals` and something is pending.
 */
export function LibraryBriefProposalsRow(props: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly hostLabel: (id: EnvironmentId) => string;
}) {
  const navigation = useNavigation();
  const keepsProposals = useLoomFeature(props.authorityId, LIBRARY_BRIEF_PROPOSALS_FEATURE);
  const query = useEnvironmentQuery(
    keepsProposals ? pendingProposals(props.authorityId, props.project.id) : null,
  );
  const refresh = query.refresh;
  useFocusEffect(
    useCallback(() => {
      if (keepsProposals) refresh();
    }, [keepsProposals, refresh]),
  );
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  const proposals = query.data?.proposals ?? [];
  const newest = proposals[0];
  if (!keepsProposals || !newest) return null;
  const title = libraryBriefSuggestionsLabel(proposals.length);
  const source = `${libraryBriefProposalSourceLabel(newest, props.hostLabel)}, ${relativeTime(newest.createdAt)} ago`;
  const detail = proposals.length > 1 ? `Newest: ${source}` : source;
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={`${detail}. Opens the review.`}
      onPress={() => navigation.navigate("LibraryBriefReview", { projectId: props.project.id })}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      className="border-t border-border-subtle bg-grouped-card"
    >
      <View className="gap-1 px-4 py-3">
        <Text className="text-sm font-t3-medium text-foreground">{title}</Text>
        <Text className="text-xs text-foreground-muted">{detail}</Text>
      </View>
    </RowPressable>
  );
}
