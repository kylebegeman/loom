import { useAtomValue } from "@effect/atom-react";
import { squashLibraryCommandFailure } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { ACCOUNT_JOIN_PROMPTS_FEATURE, type AccountJoinPrompt } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLibraryAuthority } from "../library/libraryState";

const FOOTER =
  "Tap the code the computer's terminal shows. A code it did not show declines the request, so a stray tap cannot add a computer.";

/** Computers that ran `loom join`, each approved with one tap on the code its terminal shows. */
export function JoinRequests() {
  const authority = useLibraryAuthority();
  const allowed = useAtomValue(library.respondJoin.permissionAtom(authority.environmentId));
  if (
    !authority.ready ||
    authority.environmentId === null ||
    !allowed ||
    !authority.info.data?.features?.includes(ACCOUNT_JOIN_PROMPTS_FEATURE)
  )
    return null;
  return <WaitingComputers authorityId={authority.environmentId} />;
}

function WaitingComputers({ authorityId }: { readonly authorityId: EnvironmentId }) {
  const prompts = AsyncResult.getOrElse(
    useAtomValue(library.joinPrompts({ environmentId: authorityId, input: {} })),
    () => [],
  );
  if (prompts.length === 0) return null;
  return (
    <SettingsSection title="Computers asking to join" footer={FOOTER}>
      {prompts.map((prompt) => (
        <JoinRequest key={prompt.requestId} authorityId={authorityId} prompt={prompt} />
      ))}
    </SettingsSection>
  );
}

function JoinRequest({
  authorityId,
  prompt,
}: {
  readonly authorityId: EnvironmentId;
  readonly prompt: AccountJoinPrompt;
}) {
  const respond = useAtomCommand(library.respondJoin, { reportFailure: false });
  const [sending, setSending] = useState<string | "decline" | null>(null);
  const expires = new Date(prompt.expiresAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const answer = async (code: string | null) => {
    if (sending !== null) return;
    setSending(code ?? "decline");
    const result = await respond({
      environmentId: authorityId,
      input: { requestId: prompt.requestId, code },
    });
    setSending(null);
    if (result._tag === "Failure") {
      const cause = squashLibraryCommandFailure(result);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Dialog.alert(
        `Could not answer ${prompt.label}`,
        cause instanceof Error ? cause.message : "Try again.",
      );
      return;
    }
    if (result.value.state === "approved") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Dialog.alert(
        `${prompt.label} is joining your account`,
        "It finishes setup on its own and appears on your devices in about a minute.",
      );
      return;
    }
    if (code !== null) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Dialog.alert(
        "That code did not match",
        `${prompt.label} was not added. Run loom join on it again to start a new request.`,
      );
    }
  };
  return (
    <View className="gap-3 p-4">
      <View className="gap-1">
        <Text className="text-base font-semibold text-foreground">{prompt.label}</Text>
        <Text selectable className="text-xs text-foreground-muted">
          Key {prompt.keyFingerprint}
        </Text>
        <Text className="text-xs text-foreground-muted">Expires at {expires}</Text>
      </View>
      <View className="gap-2">
        {prompt.choices.map((code) => (
          <Button
            key={code}
            label={code}
            accessibilityLabel={`Approve ${prompt.label} with code ${code}`}
            tone="secondary"
            fullWidth
            loading={sending === code}
            disabled={sending !== null}
            onPress={() => void answer(code)}
          />
        ))}
      </View>
      <Button
        label="Decline"
        tone="text"
        size="compact"
        loading={sending === "decline"}
        disabled={sending !== null}
        onPress={() => void answer(null)}
      />
    </View>
  );
}
