import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  libraryBriefAcceptance,
  libraryBriefDiff,
  libraryBriefProposalSourceLabel,
  libraryBriefReview,
  libraryBriefSuggestionsLabel,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_BRIEF_PROPOSALS_FEATURE,
  LibraryError,
  type LibraryBriefProposal,
  type LibraryProject,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { useResolveClassNames } from "uniwind";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { RowPressable } from "../../components/ui/RowPressable";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import { library, refreshLibraryProject, useLibraryAuthority } from "./libraryState";

/** One page of pending suggestions is plenty; the count is what is waiting, not history. */
const PENDING_LIMIT = 100;

/** Whether a computer advertises a Loom feature. Absent or unknown means no. */
export function useLoomFeature(environmentId: EnvironmentId | null, feature: string) {
  return supportsLoomFeature(
    useEnvironmentServerConfig(environmentId)?.environment.capabilities,
    feature,
  );
}

const pendingProposals = (environmentId: EnvironmentId, projectId: string) =>
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

export function LibraryBriefReviewRouteScreen({
  route,
}: StaticScreenProps<{ readonly projectId: string }>) {
  const authority = useLibraryAuthority(),
    navigation = useNavigation(),
    { environments } = useEnvironments();
  const target = authority.environmentId;
  const { projectId } = route.params;
  const keepsProposals = useLoomFeature(target, LIBRARY_BRIEF_PROPOSALS_FEATURE);
  const project = useEnvironmentQuery(
    target ? library.project({ environmentId: target, input: { projectId } }) : null,
  );
  const query = useEnvironmentQuery(
    target && keepsProposals ? pendingProposals(target, projectId) : null,
  );
  const [index, setIndex] = useState(0);
  const refreshProposals = query.refresh;
  useFocusEffect(
    useCallback(() => {
      if (!target || !authority.connected) return;
      refreshLibraryProject(target, projectId);
      refreshProposals();
    }, [target, authority.connected, projectId, refreshProposals]),
  );
  const hostLabel = (id: EnvironmentId) =>
    environments.find((env) => env.environmentId === id)?.label ??
    authority.computers.find((entry) => entry.environmentId === id)?.label ??
    "Saved computer";
  const proposals = query.data?.proposals ?? [];
  if (!target || !keepsProposals || !project.data || !query.data)
    return (
      <LibraryPage title="Suggested updates" back>
        <LibraryNotice
          error={project.error ?? query.error}
          detail={
            project.error || query.error
              ? null
              : target && authority.connected && !keepsProposals
                ? "Your Library needs a Loom update to keep brief suggestions."
                : !authority.connected
                  ? "Reconnect your Library to review suggested brief updates."
                  : "Loading suggested updates…"
          }
          onRetry={project.error ? project.refresh : query.error ? query.refresh : undefined}
        />
      </LibraryPage>
    );
  const shown = Math.min(index, Math.max(proposals.length - 1, 0));
  const proposal = proposals[shown];
  return (
    <LibraryPage title="Suggested updates" back>
      <Text className="text-sm text-foreground-muted">
        Agents can suggest changes to the brief. Nothing changes until you accept one.
      </Text>
      {proposals.length > 1 ? (
        <View className="flex-row items-center gap-2">
          <Text
            className="flex-1 text-sm text-foreground-muted"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {shown + 1} of {proposals.length}
          </Text>
          <Button
            label="Previous"
            tone="text"
            disabled={shown === 0}
            onPress={() => setIndex(shown - 1)}
          />
          <Button
            label="Next"
            tone="text"
            disabled={shown === proposals.length - 1}
            onPress={() => setIndex(shown + 1)}
          />
        </View>
      ) : null}
      {proposal ? (
        <BriefProposalReview
          key={proposal.id}
          proposal={proposal}
          project={project.data}
          authorityId={target}
          connected={authority.connected}
          hostLabel={hostLabel}
          onDecided={() => {
            refreshLibraryProject(target, projectId);
            query.refresh();
            if (proposals.length === 1) navigation.goBack();
          }}
          onConflict={() => refreshLibraryProject(target, projectId)}
        />
      ) : (
        <LibraryNotice detail="No suggestions are waiting. New ones from agents appear on the project's brief." />
      )}
      {query.error ? <LibraryNotice error={query.error} onRetry={query.refresh} /> : null}
    </LibraryPage>
  );
}

/** One suggestion as changes against the brief as it reads now, with accept, edit and dismiss. */
function BriefProposalReview(props: {
  readonly proposal: LibraryBriefProposal;
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onDecided: () => void;
  readonly onConflict: () => void;
}) {
  const { proposal, project, authorityId } = props;
  const accept = useAtomCommand(library.acceptBriefProposal, { reportFailure: false });
  const dismiss = useAtomCommand(library.dismissBriefProposal, { reportFailure: false });
  const canAccept = useAtomValue(library.acceptBriefProposal.permissionAtom(authorityId));
  const canDismiss = useAtomValue(library.dismissBriefProposal.permissionAtom(authorityId));
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmingStale, setConfirmingStale] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = libraryBriefReview(proposal, project);
  const diff = useMemo(
    () => (review.unchanged ? [] : libraryBriefDiff(review.before, review.after)),
    [review.before, review.after, review.unchanged],
  );
  const blocked = !props.connected
    ? "Connect your Library to accept or dismiss suggestions."
    : project.archived
      ? "Reopen the project to accept or dismiss suggestions."
      : !canAccept && !canDismiss
        ? "This connection can't change the brief."
        : null;

  const run = async (
    attempt: () => Promise<AtomCommandResult<unknown, unknown>>,
    fallback: string,
  ) => {
    setBusy(true);
    setError(null);
    setConflict(false);
    const result = await attempt();
    setBusy(false);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      // The brief moved since this screen loaded it; reload so the changes show against it.
      if (cause instanceof LibraryError && cause.reason === "revision-conflict") {
        setConfirmingStale(false);
        setConflict(true);
        props.onConflict();
        return;
      }
      setError(cause instanceof Error ? cause.message : fallback);
      return;
    }
    props.onDecided();
  };

  const acceptNow = (confirmedStale: boolean) => {
    const decision = libraryBriefAcceptance(proposal, project, {
      ...(draft !== null ? { edited: draft } : {}),
      confirmedStale,
    });
    if (decision.kind === "confirm-stale") return setConfirmingStale(true);
    if (decision.kind === "unchanged")
      return setError("The brief already says this. Dismiss the suggestion instead.");
    void run(
      () =>
        accept({ environmentId: authorityId, input: { requestId: uuidv4(), ...decision.input } }),
      "Could not accept this suggestion.",
    );
  };

  return (
    <>
      <SettingsSection
        title="Why"
        footer={`${libraryBriefProposalSourceLabel(proposal, props.hostLabel)} · ${relativeTime(proposal.createdAt)} ago`}
      >
        <Text selectable className="p-4 text-sm leading-normal text-foreground">
          {proposal.summary}
        </Text>
      </SettingsSection>
      {conflict ? (
        <LibraryNotice detail="The brief changed while you were reviewing. The changes below now show against the latest brief. Check them, then accept again." />
      ) : review.stale ? (
        <LibraryNotice detail="The brief changed after this was suggested. The changes below are against the brief as it reads now." />
      ) : null}
      {draft !== null ? (
        <SettingsSection title="Edited brief">
          <TextInput
            accessibilityLabel="Edited brief"
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              setError(null);
            }}
            multiline
            autoFocus
            maxLength={65536}
            editable={!busy}
            className="min-h-48 p-4 text-sm leading-normal text-foreground"
          />
        </SettingsSection>
      ) : review.unchanged ? (
        <LibraryNotice detail="This already matches the brief." />
      ) : (
        <SettingsSection title="Changes to the brief" footer={diffSummary(diff)}>
          <View className="py-2">
            {diff.map((line, index) => (
              // Lines repeat and have no identity; the list is rebuilt whole when the brief changes.
              // oxlint-disable-next-line react/no-array-index-key
              <BriefDiffLine key={index} line={line} />
            ))}
          </View>
        </SettingsSection>
      )}
      {confirmingStale ? (
        <View className="gap-2">
          <LibraryNotice detail="Accepting replaces the newer brief with this text. Accept anyway?" />
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Accept anyway"
              tone="primary"
              disabled={busy}
              onPress={() => acceptNow(true)}
            />
            <Button
              label="Cancel"
              tone="text"
              disabled={busy}
              onPress={() => setConfirmingStale(false)}
            />
          </View>
        </View>
      ) : null}
      {error ? <LibraryNotice error={error} /> : null}
      {blocked ? (
        <LibraryNotice detail={blocked} />
      ) : (
        <View className="gap-2">
          <Button
            label={draft !== null ? "Accept edited brief" : "Accept"}
            tone="primary"
            loading={busy}
            disabled={!canAccept || confirmingStale}
            onPress={() => acceptNow(false)}
          />
          {draft !== null ? (
            <Button
              label="Cancel edit"
              tone="text"
              disabled={busy}
              onPress={() => {
                setDraft(null);
                setError(null);
              }}
            />
          ) : (
            <Button
              label="Edit, then accept"
              disabled={busy || !canAccept}
              onPress={() => setDraft(proposal.proposedBrief)}
            />
          )}
          <Button
            label="Dismiss"
            tone="text"
            disabled={busy || !canDismiss}
            onPress={() =>
              void run(
                () =>
                  dismiss({
                    environmentId: authorityId,
                    input: { requestId: uuidv4(), proposalId: proposal.id },
                  }),
                "Could not dismiss this suggestion.",
              )
            }
          />
        </View>
      )}
    </>
  );
}

type DiffLine = ReturnType<typeof libraryBriefDiff>[number];

function diffSummary(diff: readonly DiffLine[]) {
  const added = diff.filter((line) => line.kind === "added").length;
  const removed = diff.filter((line) => line.kind === "removed").length;
  const count = (n: number, verb: string) => `${n} ${n === 1 ? "line" : "lines"} ${verb}`;
  return [added ? count(added, "added") : null, removed ? count(removed, "removed") : null]
    .filter(Boolean)
    .join(", ");
}

function BriefDiffLine({ line }: { readonly line: DiffLine }) {
  if (line.kind === "folded")
    return (
      <Text className="px-4 py-1 text-xs text-foreground-muted">
        {line.count} unchanged {line.count === 1 ? "line" : "lines"}
      </Text>
    );
  const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";
  return (
    <View
      accessibilityLabel={`${line.kind === "same" ? "Unchanged" : line.kind === "added" ? "Added" : "Removed"}: ${line.text || "blank line"}`}
      className={cn(
        "flex-row gap-2 px-4 py-0.5",
        line.kind === "added" && "bg-adaptive-emerald-500-a12-a16",
        line.kind === "removed" && "bg-adaptive-rose-500-a12-a16",
      )}
    >
      <Text
        className={cn(
          "w-3 font-mono text-sm",
          line.kind === "added"
            ? "text-adaptive-emerald-700-300"
            : line.kind === "removed"
              ? "text-adaptive-rose-700-300"
              : "text-foreground-muted",
        )}
      >
        {marker}
      </Text>
      <Text
        selectable
        className={cn(
          "min-w-0 flex-1 text-sm leading-normal",
          line.kind === "same" ? "text-foreground-muted" : "text-foreground",
          line.kind === "removed" && "line-through",
        )}
      >
        {line.text}
      </Text>
    </View>
  );
}
