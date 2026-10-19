import { useState } from "react";
import { ScrollView, View } from "react-native";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AuthAccessReadScope } from "@t3tools/contracts";
import {
  attachVaultPrompt,
  readVaultPrompt,
  removeVaultPromptAttachment,
  type VaultProfile,
  type VaultProfilePreview,
} from "@t3tools/contracts/fork";
import {
  createVaultProfileAtoms,
  supportsLoomFeature,
  vaultProfileBindingMessage,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { VaultReferenceSearch } from "./ProfileSettingsSection";
const profiles = createVaultProfileAtoms(connectionAtomRuntime);
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Vault review failed. Refresh and try again.";
type Props = {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  threadId?: ThreadId | null;
  prompt: string;
  onChange: (text: string) => void;
  disabled?: boolean;
};
export function VaultPromptAttachments(props: Props) {
  const config = useEnvironmentServerConfig(props.environmentId),
    canRead = useEnvironmentScope(props.environmentId, AuthAccessReadScope),
    [open, setOpen] = useState(false);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-prompt-attachments"))
    return null;
  const parsed = readVaultPrompt(props.prompt);
  return (
    <View className="gap-2">
      <Button
        label={`Vault attachments${parsed.attachments.length ? ` (${parsed.attachments.length})` : ""}`}
        disabled={props.disabled || !props.projectId || !canRead}
        onPress={() => setOpen(true)}
      />
      {!parsed.valid ? (
        <Text accessibilityRole="alert">Repair invalid Vault links before sending.</Text>
      ) : null}
      {parsed.attachments.some((a) => a.environmentId !== props.environmentId) ? (
        <Text accessibilityRole="alert">Replace Vault links for this computer.</Text>
      ) : null}
      {open && props.projectId ? (
        <PromptSheet
          key={`${props.environmentId}:${props.projectId}`}
          {...props}
          projectId={props.projectId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}
function PromptSheet(props: Props & { projectId: ProjectId; onClose: () => void }) {
  const snapshot = useEnvironmentQuery(
      profiles.list({ environmentId: props.environmentId, input: { projectId: props.projectId } }),
    ),
    previewCommand = useAtomCommand(profiles.preview, { reportFailure: false });
  const [review, setReview] = useState<{
      profile: VaultProfile;
      preview: VaultProfilePreview;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [picking, setPicking] = useState(false);
  const parsed = readVaultPrompt(props.prompt),
    disabled = !!props.disabled || busy,
    stale = snapshot.isPending || !!snapshot.error;
  const preview = async (profile: VaultProfile) => {
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      const result = await previewCommand({
        environmentId: props.environmentId,
        input: { projectId: props.projectId, profile, threadId: props.threadId ?? null },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setReview({ profile, preview: result.value });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Vault launch attachments" dismissible={!busy} onClose={props.onClose}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-3 p-4">
        <Text>
          Attach references without credential values. Links are saved with this prompt and shown in
          the transcript. Profiles require full-access/default agent runs; each run checks current
          access. References alone require inspection and grant no use access.
        </Text>
        <Text>
          Remove a link to detach it. Profile edits require reviewing and attaching the new version.
          New scheduled threads need project grants.
        </Text>
        {!parsed.valid ? (
          <Text accessibilityRole="alert">
            A Vault link is invalid or duplicated. Edit the prompt to repair it.
          </Text>
        ) : null}
        {parsed.attachments.map((a) => (
          <View key={a.start} className="gap-2 rounded-lg bg-subtle p-3">
            <Text>
              {a.kind}: {a.label}
              {a.kind === "profile" ? ` · Version ${a.version}` : ""}
            </Text>
            <Button
              label={`Remove ${a.label}`}
              disabled={disabled}
              onPress={() => props.onChange(removeVaultPromptAttachment(props.prompt, a))}
            />
          </View>
        ))}
        <Button
          label="Refresh launch profiles"
          disabled={disabled}
          onPress={() => {
            setReview(null);
            snapshot.refresh();
          }}
        />
        {snapshot.isPending ? <Text>Loading launch profiles…</Text> : null}
        {snapshot.error ? <Text accessibilityRole="alert">{message(snapshot.error)}</Text> : null}
        {snapshot.data?.profiles
          .filter((p) => p.state === "active")
          .map((p) => (
            <Button
              key={p.id}
              label={`Review ${p.label}${snapshot.data?.activeProfileId === p.id ? " (project default)" : ""}`}
              disabled={disabled || stale}
              onPress={() => void preview(p)}
            />
          ))}
        {snapshot.data?.profiles.every((p) => p.state !== "active") ? (
          <Text>No active project profiles. Create one in Vault project profiles.</Text>
        ) : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        {review ? (
          <View className="gap-2 rounded-lg bg-subtle p-3">
            <Text>
              {review.profile.label} · Version {review.profile.version}
            </Text>
            <Text>
              Review checks saved configuration and use grants. GitHub API health and GH CLI
              availability are checked separately.
            </Text>
            {review.preview.bindings.map((b) => (
              <Text key={b.name}>
                {b.name}: {vaultProfileBindingMessage(b.state)}
                {b.destination ? ` · ${b.destination}` : ""}
              </Text>
            ))}
            {!props.threadId ? (
              <Text>Thread grants will be checked when the run starts.</Text>
            ) : null}
            <Button
              label="Attach reviewed profile"
              disabled={
                disabled ||
                stale ||
                !parsed.valid ||
                !review.preview.bindings.every(
                  (b) => b.state === "ready" || b.state === "unchecked",
                )
              }
              onPress={() => {
                props.onChange(
                  attachVaultPrompt(
                    props.prompt,
                    {
                      kind: "profile",
                      environmentId: props.environmentId,
                      id: review.profile.id,
                      version: review.profile.version,
                    },
                    review.profile.label,
                  ),
                );
                setReview(null);
              }}
            />
          </View>
        ) : null}
        <Button
          label="Attach Vault reference"
          disabled={
            disabled ||
            !parsed.valid ||
            parsed.attachments.filter((a) => a.kind === "reference").length >= 16
          }
          onPress={() => setPicking(true)}
        />
      </ScrollView>
      {picking ? (
        <Sheet title="Attach Vault reference" onClose={() => setPicking(false)}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-3 p-4"
          >
            <VaultReferenceSearch
              environmentId={props.environmentId}
              connected={!disabled}
              onSelect={(r) => {
                props.onChange(
                  attachVaultPrompt(
                    props.prompt,
                    { kind: "reference", environmentId: props.environmentId, id: r.item.id },
                    r.item.label,
                  ),
                );
                setPicking(false);
              }}
            />
          </ScrollView>
        </Sheet>
      ) : null}
    </Sheet>
  );
}
