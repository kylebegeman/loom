import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  LIBRARY_BRIEF_SUGGESTION_CHOICES,
  libraryBriefSuggestionAvailability,
  libraryBriefSuggestionChoice,
  libraryBriefSuggestionDraftValue,
  libraryBriefSuggestionNotice,
  libraryBriefSuggestionPrompt,
} from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  MessageId,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  LIBRARY_BRIEF_PROPOSALS_FEATURE,
  LIBRARY_BRIEF_SUGGESTIONS_FEATURE,
  type LibraryBriefSuggestionMode,
  type LibraryThreadSummary,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { uuidv4 } from "../../lib/uuid";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLoomFeature } from "./libraryState";

const ASKED_MESSAGE =
  "Asked the agent. Its suggestions will wait on the project page for you to review.";

/**
 * Whether a conversation that settles asks its agent for brief updates. The agent only proposes;
 * a person still accepts each change on the project page. Shown only when the Library keeps it.
 */
export function LibraryBriefSuggestionsSetting(props: {
  readonly authorityId: EnvironmentId | null;
  readonly mode: LibraryBriefSuggestionMode | undefined;
  readonly onChange: (mode: LibraryBriefSuggestionMode | undefined) => void;
  readonly disabled: boolean;
}) {
  const keeps = useLoomFeature(props.authorityId, LIBRARY_BRIEF_SUGGESTIONS_FEATURE);
  if (!keeps) return null;
  const selected = libraryBriefSuggestionChoice(props.mode);
  return (
    <SettingsSection
      title="Suggest brief updates when a conversation settles"
      footer="Runs with the conversation's model on the computer where it settled."
    >
      {LIBRARY_BRIEF_SUGGESTION_CHOICES.map((choice, index) => (
        <ListChoiceRow
          key={choice.value}
          label={choice.label}
          description={choice.description}
          selected={selected === choice.value}
          separated={index > 0}
          disabled={props.disabled}
          onPress={() => props.onChange(libraryBriefSuggestionDraftValue(choice.value))}
        />
      ))}
    </SettingsSection>
  );
}

/**
 * The brief suggestion a project's setting made when this conversation settled. Asked first, it
 * waits here for a person to start it. The conversation's computer keeps and runs it, so this
 * renders only when that computer is connected and advertises `library-brief-suggestions`.
 */
export function LibraryBriefSuggestionOffer(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly connected: boolean;
}) {
  const { environmentId, threadId } = props;
  const supported = useLoomFeature(environmentId, LIBRARY_BRIEF_SUGGESTIONS_FEATURE);
  const live = props.connected && supported;
  const query = useEnvironmentQuery(
    live ? library.briefSuggestion({ environmentId, input: { threadId } }) : null,
  );
  const start = useAtomCommand(library.startBriefSuggestion, { reportFailure: false });
  const decline = useAtomCommand(library.declineBriefSuggestion, { reportFailure: false });
  const canStart = useAtomValue(library.startBriefSuggestion.permissionAtom(environmentId));
  const [pending, setPending] = useState<"start" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // This screen stays mounted under the conversation it opens, so a run can finish out of sight.
  const refresh = query.refresh;
  useFocusEffect(
    useCallback(() => {
      if (live) refresh();
    }, [live, refresh]),
  );
  const notice = live ? libraryBriefSuggestionNotice(query.data ?? null) : null;
  if (!notice) return null;

  const run = async (
    action: "start" | "decline",
    attempt: () => Promise<AtomCommandResult<unknown, unknown>>,
    fallback: string,
  ) => {
    setPending(action);
    setError(null);
    const result = await attempt();
    setPending(null);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : fallback);
    }
    query.refresh();
  };

  return (
    <View className="gap-3 rounded-2xl bg-subtle p-4">
      <Text
        accessibilityLiveRegion="polite"
        className={error ? "text-sm text-danger-foreground" : "text-sm text-foreground-muted"}
      >
        {error ?? notice.text}
      </Text>
      {notice.kind === "offer" && canStart ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Suggest updates"
            tone="primary"
            loading={pending === "start"}
            disabled={pending !== null}
            onPress={() =>
              void run(
                "start",
                () => start({ environmentId, input: { threadId } }),
                "Could not start the suggestion.",
              )
            }
          />
          <Button
            label="Not now"
            tone="text"
            loading={pending === "decline"}
            disabled={pending !== null}
            onPress={() =>
              void run(
                "decline",
                () => decline({ environmentId, input: { threadId } }),
                "Could not dismiss this offer.",
              )
            }
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Asks a settled conversation's agent to look back and propose brief changes. The agent can only
 * propose; the suggestion waits on the project page for a person to accept or dismiss.
 */
export function LibrarySuggestBriefUpdates(props: {
  readonly summary: LibraryThreadSummary;
  readonly authorityId: EnvironmentId;
  readonly hostLabel: string;
  readonly hostConnected: boolean;
}) {
  const { summary } = props;
  const libraryKeepsProposals = useLoomFeature(props.authorityId, LIBRARY_BRIEF_PROPOSALS_FEATURE);
  const hostProposes = useLoomFeature(summary.environmentId, LIBRARY_BRIEF_PROPOSALS_FEATURE);
  const project = useEnvironmentQuery(
    libraryKeepsProposals
      ? library.project({
          environmentId: props.authorityId,
          input: { projectId: summary.projectId },
        })
      : null,
  );
  const shell = useThreadShell(
    props.hostConnected ? scopeThreadRef(summary.environmentId, summary.threadId) : null,
  );
  const canSend = useEnvironmentScope(summary.environmentId, AuthOrchestrationOperateScope);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  // The live conversation is the freshest word on whether it is settled; the saved copy stands in.
  const settled = shell ? shell.settledOverride === "settled" : summary.settled === true;
  // Asking unsettles the conversation; once it settles again, the earlier ask is done.
  const [wasSettled, setWasSettled] = useState(settled);
  if (settled !== wasSettled) {
    setWasSettled(settled);
    if (settled) setAsked(false);
  }
  const availability = libraryBriefSuggestionAvailability({
    libraryKeepsProposals,
    settled,
    archived:
      (project.data?.archived ?? false) || (shell ? shell.archivedAt !== null : summary.archived),
    hostLabel: props.hostLabel,
    hostConnected: props.hostConnected,
    hostProposes,
    canSend,
  });
  if (availability.kind === "hidden")
    // The ask hides the action, so the confirmation stands in for it until the next settle.
    return asked ? (
      <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
        {ASKED_MESSAGE}
      </Text>
    ) : null;
  const reason =
    availability.kind === "disabled"
      ? availability.reason
      : shell
        ? null
        : "Loading the live conversation…";
  const send = async () => {
    if (!shell) return;
    setSending(true);
    setError(null);
    setAsked(false);
    const result = await startTurn({
      environmentId: summary.environmentId,
      input: {
        threadId: summary.threadId,
        message: {
          messageId: MessageId.make(uuidv4()),
          role: "user",
          text: libraryBriefSuggestionPrompt(summary.projectId),
          attachments: [],
        },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        dispatchMode: "queue",
      },
    });
    setSending(false);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not ask the agent.");
      return;
    }
    setAsked(true);
  };
  const message = error ?? (asked ? ASKED_MESSAGE : reason);
  return (
    <View className="gap-1">
      <Button
        label="Suggest brief updates"
        tone="secondary"
        loading={sending}
        disabled={reason !== null}
        onPress={() => void send()}
      />
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          className={error ? "text-xs text-danger-foreground" : "text-xs text-foreground-muted"}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}
