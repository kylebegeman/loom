import { useAtomValue } from "@effect/atom-react";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BotSuggestion } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotNotice, BotSection, BotToggle } from "./BotControls";
import { bots, useBotsCapabilities, useBotsReconnect } from "./state";

export function BotSuggestions({
  environmentId,
  changes,
}: {
  readonly environmentId: EnvironmentId;
  readonly changes: unknown;
}) {
  const navigation = useNavigation();
  const host = useBotsCapabilities(environmentId);
  const canCreate = useAtomValue(bots.save.permissionAtom(environmentId));
  const canDismiss = useAtomValue(bots.dismissSuggestion.permissionAtom(environmentId));
  const [showDismissed, setShowDismissed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useEnvironmentQuery(bots.suggestions({ environmentId, input: {} }));
  const dismissed = useEnvironmentQuery(
    showDismissed ? bots.suggestions({ environmentId, input: { dismissed: true } }) : null,
  );
  const dismiss = useAtomCommand(bots.dismissSuggestion, { reportFailure: false });
  const refresh = open.refresh;
  const refreshDismissed = dismissed.refresh;
  const focused = useIsFocused();
  const seen = useRef({ changes, focused });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches suggestions from the server when bot changes arrive or the screen regains navigation focus
  useEffect(() => {
    const changed = seen.current.changes !== changes || (!seen.current.focused && focused);
    seen.current = { changes, focused };
    if (!changed || !focused) return;
    refresh();
    refreshDismissed();
  }, [changes, focused, refresh, refreshDismissed]);
  useBotsReconnect(host.connected, refresh);
  useBotsReconnect(host.connected, dismissed.refresh);
  const setDismissed = async (suggestion: BotSuggestion, value: boolean) => {
    if (!host.connected || !canDismiss || pending) return;
    setPending(suggestion.id);
    setError(null);
    const result = await dismiss({
      environmentId,
      input: { suggestionId: suggestion.id, dismissed: value },
    });
    setPending(null);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not update this suggestion.");
    } else {
      open.refresh();
      dismissed.refresh();
    }
  };
  const row = (suggestion: BotSuggestion, isDismissed: boolean) => (
    <View key={suggestion.id} className="gap-3 rounded-xl border border-border-subtle p-3">
      <Text className="text-sm text-foreground-muted">
        {suggestion.startedBy === "agent" ? "Agents started" : "You started"} {suggestion.count}{" "}
        similar threads in the last two weeks.
      </Text>
      <Text numberOfLines={4}>{suggestion.shape}</Text>
      <View className="flex-row flex-wrap gap-2">
        {!isDismissed ? (
          <Button
            label="Create from suggestion"
            disabled={!canCreate || !host.connected || !suggestion.threadIds.length}
            onPress={() =>
              navigation.navigate("BotsCreate", {
                environmentId,
                sourceThreadId: suggestion.threadIds[0]!,
                suggestionId: suggestion.id,
              })
            }
          />
        ) : null}
        <Button
          label={isDismissed ? "Restore suggestion" : "Dismiss suggestion"}
          loading={pending === suggestion.id}
          disabled={!canDismiss || !host.connected || pending !== null}
          onPress={() => void setDismissed(suggestion, !isDismissed)}
        />
      </View>
    </View>
  );
  return (
    <BotSection title="Suggested bots" description="Turn repeated work into a reusable job.">
      <BotNotice
        error={error ?? open.error ?? dismissed.error}
        onRetry={open.error ? open.refresh : dismissed.error ? dismissed.refresh : undefined}
      />
      {open.data?.suggestions.map((suggestion) => row(suggestion, false))}
      <BotToggle
        label="Show dismissed suggestions"
        value={showDismissed}
        onChange={setShowDismissed}
      />
      {showDismissed ? (
        dismissed.data?.suggestions.length === 0 ? (
          <Text className="text-sm text-foreground-muted">No dismissed suggestions.</Text>
        ) : (
          dismissed.data?.suggestions.map((suggestion) => row(suggestion, true))
        )
      ) : null}
    </BotSection>
  );
}
