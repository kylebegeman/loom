import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  libraryBriefAcceptance,
  libraryBriefDiff,
  libraryBriefProposalAfterDecision,
  libraryBriefProposalSelection,
  libraryBriefProposalSourceLabel,
  libraryBriefReview,
  type LibraryBriefProposalPick,
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
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { pendingProposals } from "./LibraryBriefProposalsRow";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import {
  library,
  refreshLibraryProject,
  useLibraryAuthority,
  useLoomFeature,
} from "./libraryState";

type Decision = "accept" | "dismiss";

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
  const [pick, setPick] = useState<LibraryBriefProposalPick | null>(null);
  // Decided here, so they leave the review at once instead of when the refreshed list lands.
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmation, setConfirmation] = useState<{
    readonly text: string;
    readonly beforeId: string;
  } | null>(null);
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
  const waiting = (query.data?.proposals ?? []).filter((entry) => !decided.has(entry.id));
  const selection = libraryBriefProposalSelection(waiting, pick);
  // Pin the first suggestion shown, so one that arrives later can't take its place.
  if (pick === null && selection.proposal)
    setPick({ id: selection.proposal.id, index: selection.index });
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
  const { index: shown, proposal } = selection;
  // The last suggestion decided here leaves with the screen; it was not decided somewhere else.
  const missing = selection.missing && !(pick && decided.has(pick.id));
  const show = (index: number) => {
    const next = waiting[index];
    if (next) setPick({ id: next.id, index });
  };
  const decide = (decidedId: string, kind: Decision) => {
    const next = libraryBriefProposalAfterDecision(waiting, decidedId, shown);
    setDecided((ids) => new Set(ids).add(decidedId));
    refreshLibraryProject(target, projectId);
    query.refresh();
    if (!next) {
      navigation.goBack();
      return;
    }
    setPick(next);
    setConfirmation({
      text: kind === "accept" ? "Brief updated." : "Suggestion dismissed.",
      beforeId: next.id,
    });
  };
  return (
    <LibraryPage title="Suggested updates" back>
      <Text className="text-sm text-foreground-muted">
        Agents can suggest changes to the brief. Nothing changes until you accept one.
      </Text>
      {confirmation && proposal?.id === confirmation.beforeId ? (
        <Notice
          message={confirmation.text}
          icon="checkmark.circle"
          onDismiss={() => setConfirmation(null)}
        />
      ) : null}
      {missing ? (
        <View className="gap-2">
          <LibraryNotice detail="That suggestion was replaced or decided somewhere else." />
          {waiting.length ? (
            <Button
              label="Review the next suggestion"
              tone="secondary"
              onPress={() => show(shown)}
            />
          ) : null}
        </View>
      ) : waiting.length > 1 ? (
        <View className="flex-row items-center gap-2">
          <Text
            className="flex-1 text-sm text-foreground-muted"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {shown + 1} of {waiting.length}
          </Text>
          <Button
            label="Previous"
            tone="text"
            disabled={shown === 0}
            onPress={() => show(shown - 1)}
          />
          <Button
            label="Next"
            tone="text"
            disabled={shown === waiting.length - 1}
            onPress={() => show(shown + 1)}
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
          onDeciding={() => setConfirmation(null)}
          onDecided={(kind) => decide(proposal.id, kind)}
          onConflict={() => {
            // A conflict can also mean the suggestion was decided elsewhere, so reload both.
            refreshLibraryProject(target, projectId);
            query.refresh();
          }}
        />
      ) : !waiting.length ? (
        <LibraryNotice detail="No suggestions are waiting. New ones from agents appear on the project's brief." />
      ) : null}
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
  /** A decision is on its way, so an earlier confirmation no longer applies. */
  readonly onDeciding: () => void;
  readonly onDecided: (kind: Decision) => void;
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
  const [pending, setPending] = useState<Decision | null>(null);
  const busy = pending !== null;
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
    action: Decision,
    attempt: () => Promise<AtomCommandResult<unknown, unknown>>,
    fallback: string,
  ) => {
    setPending(action);
    setError(null);
    setConflict(false);
    props.onDeciding();
    const result = await attempt();
    setPending(null);
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
    props.onDecided(action);
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
      "accept",
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
            textAlignVertical="top"
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
              loading={pending === "accept"}
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
            loading={pending === "accept" && !confirmingStale}
            disabled={busy || !canAccept || confirmingStale}
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
            loading={pending === "dismiss"}
            disabled={busy || !canDismiss}
            onPress={() =>
              void run(
                "dismiss",
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
      accessible
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
