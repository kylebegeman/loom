import { useAtomValue } from "@effect/atom-react";
import {
  accountJoinCode,
  joinPasskey,
  squashLibraryCommandFailure,
} from "@t3tools/client-runtime/fork";
import {
  ACCOUNT_JOIN_FEATURE,
  ACCOUNT_JOIN_PROMPTS_FEATURE,
  type AccountJoinApproval,
  type AccountJoinReview,
} from "@t3tools/contracts/fork";
import { useState } from "react";
import { Keyboard, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLibraryAuthority } from "../library/libraryState";
import { approvalRefused, approveJoin, JOIN_APPROVAL_TEXT } from "./joinApproval";

export function ApproveComputer() {
  const authority = useLibraryAuthority();
  const canDecide = useAtomValue(library.decideJoin.permissionAtom(authority.environmentId));
  const lookup = useAtomCommand(library.lookupJoin, { reportFailure: false });
  const decide = useAtomCommand(library.decideJoin, { reportFailure: false });
  const [code, setCode] = useState("");
  const [reviewed, setReviewed] = useState<{
    authorityId: string;
    review: AccountJoinReview;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!authority.ready || !authority.info.data?.features?.includes(ACCOUNT_JOIN_FEATURE))
    return null;
  const review =
    reviewed?.authorityId === authority.environmentId &&
    reviewed.review.code === accountJoinCode(code)
      ? reviewed.review
      : null;
  const passkey =
    authority.environmentId === null
      ? null
      : joinPasskey({
          authorityId: authority.environmentId,
          features: authority.info.data.features,
          entry: authority.entry,
          surface: "native",
        });
  const run = async (approve?: boolean) => {
    const environmentId = authority.environmentId;
    if (busy || !canDecide || !environmentId) return;
    const normalized = accountJoinCode(code);
    if (normalized === null) {
      setError("Enter the code shown on the computer you are adding.");
      return;
    }
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    // An approved request stays approved without a new check, so only a pending one asks.
    let approval: AccountJoinApproval | null = null;
    if (approve === true && review?.state === "pending" && passkey !== null) {
      try {
        approval = await approveJoin({ passkey, authorityId: environmentId, label: review.label });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The computer was not approved.");
      }
      if (approval === null) {
        setBusy(false);
        return;
      }
    }
    const result =
      approve === undefined
        ? await lookup({ environmentId, input: { code: normalized } })
        : await decide({
            environmentId,
            input: { code: normalized, approve, ...(approval ? { approval } : {}) },
          });
    if (result._tag === "Success")
      setReviewed({ authorityId: environmentId, review: result.value });
    else {
      if (approval) approvalRefused(environmentId, approval);
      const cause = squashLibraryCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "The request could not be checked. Try again.",
      );
    }
    setBusy(false);
  };
  return (
    <SettingsSection title="Add computer">
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          {authority.info.data.features.includes(ACCOUNT_JOIN_PROMPTS_FEATURE)
            ? "Run loom join on the computer you are adding. It then shows up at the top of this screen to approve with one tap. No request showing? Enter the code from its terminal here."
            : "Enter the code shown on the computer you are adding. Review its name and matching code before approving."}
        </Text>
        <TextInput
          accessibilityLabel="Computer code"
          value={code}
          maxLength={20}
          placeholder="A1B2C-D3E4F"
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={(value) => {
            setCode(value);
            setReviewed(null);
            setError(null);
          }}
          onSubmitEditing={() => void run()}
          className="min-h-12 rounded-xl border border-input-border bg-input px-3 text-base text-foreground"
        />
        <Button
          label={busy ? "Checking..." : "Review computer"}
          disabled={busy || !canDecide}
          size="compact"
          onPress={() => void run()}
        />
        {!canDecide ? (
          <Text className="text-sm text-foreground-muted">
            Your account connection needs full settings access to approve a computer.
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        {review ? (
          <View className="gap-3 pt-3">
            <Text className="text-base font-semibold text-foreground">{review.label}</Text>
            <Text className="font-mono text-base text-foreground">{review.code}</Text>
            <Text className="text-sm text-foreground-muted">
              Approve only if both match the computer’s terminal. Loom will save its conversations
              and connect it to your other devices.
              {passkey !== null && review.state === "pending" ? ` ${JOIN_APPROVAL_TEXT}` : ""}
            </Text>
            <Text selectable className="text-xs text-foreground-muted">
              Computer identity: {review.keyFingerprint}
            </Text>
            {review.state === "approved" ? (
              <Text accessibilityLiveRegion="polite" className="text-sm text-foreground">
                Approved. Leave the join command running on the computer to finish setup.
              </Text>
            ) : review.state === "denied" ? (
              <Text accessibilityLiveRegion="polite" className="text-sm text-foreground">
                Declined. Start a new request on the computer if you want to add it.
              </Text>
            ) : null}
            {review.state !== "denied" ? (
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label={review.state === "approved" ? "Refresh approval" : "Approve computer"}
                  tone="primary"
                  disabled={busy || !canDecide}
                  size="compact"
                  onPress={() => void run(true)}
                />
                {review.state === "pending" ? (
                  <Button
                    label="Decline"
                    disabled={busy || !canDecide}
                    size="compact"
                    onPress={() => void run(false)}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}
