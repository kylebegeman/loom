import { useState } from "react";
import { ScrollView, View } from "react-native";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";
import {
  createVaultGitHubAtoms,
  supportsLoomFeature,
  makeVaultGitHubSave,
  type VaultGitHubDraft,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
const atoms = createVaultGitHubAtoms(connectionAtomRuntime),
  id = () => uuidv4().replaceAll("-", "");
export function VaultGitHubSettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId),
    canRead = useEnvironmentScope(environmentId, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-github")) return null;
  return (
    <SettingsSection title="Vault GitHub connections">
      {canRead ? (
        <Manager
          key={`${environmentId}:${canWrite}`}
          environmentId={environmentId}
          connected={connected}
          canWrite={canWrite}
        />
      ) : (
        <Text>Your connection does not include Vault inspection.</Text>
      )}
    </SettingsSection>
  );
}
function Manager({
  environmentId,
  connected,
  canWrite,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  canWrite: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [draft, setDraft] = useState<VaultGitHubDraft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const page = useEnvironmentQuery(
      connected ? atoms.list({ environmentId, input: { cursor } }) : null,
    ),
    save = useAtomCommand(atoms.save, { reportFailure: false }),
    test = useAtomCommand(atoms.test, { reportFailure: false }),
    change = useAtomCommand(atoms.change, { reportFailure: false });
  const locked = busy || !connected || !canWrite || page.isPending || !!page.error;
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The GitHub operation failed. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const edit = (info?: VaultGitHubInfo) => {
    setError(null);
    setDraft({
      id: info?.item.id ?? id(),
      expectedVersion: info?.item.version ?? 0,
      label: info?.item.label ?? "",
      repositories: info?.repositories.join(", ") ?? "",
      type: info?.mechanism ?? "app",
      appId: "",
      installationId: "",
      secret: "",
    });
  };
  return (
    <View className="gap-3">
      <Text>
        Dedicated GitHub identities for Loom agents. App installations mint short-lived tokens;
        dedicated fine-grained tokens are also supported. Personal logins and SSH agents stay
        separate.
      </Text>
      <Text>
        Use is limited to named github.com repositories and exact active-run grants. API testing
        does not prove Git HTTPS or GH CLI installation. Only the documented mediated GH operations
        are supported.
      </Text>
      <Button
        label="Refresh GitHub connections"
        disabled={busy || !connected}
        onPress={page.refresh}
      />
      <Button label="Connect GitHub" disabled={locked || !!draft} onPress={() => edit()} />
      {page.isPending ? <Text>Loading GitHub connections…</Text> : null}
      {error || page.error ? (
        <Text accessibilityRole="alert">
          {error ?? "Could not load connections. Check Vault access and refresh."}
        </Text>
      ) : null}
      {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
      {page.data?.items.length === 0 ? <Text>No GitHub connections in this page.</Text> : null}
      {page.data?.items.map((info) => (
        <Connection
          key={`${info.item.id}:${info.item.version}`}
          info={info}
          disabled={locked || !!draft}
          onEdit={() => edit(info)}
          onTest={(repository) =>
            void act(async () => {
              const result = await test({
                environmentId,
                input: { id: info.item.id, expectedVersion: info.item.version, repository },
              });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              setNotice(
                `API access verified for ${result.value.account} at ${repository}.${result.value.tokenExpiresAt ? " Loom attempts to release short-lived installation tokens after use." : " Token expiration is managed on GitHub."}`,
              );
            })
          }
          onChange={(action) =>
            void act(async () => {
              const result = await change({
                environmentId,
                input: {
                  id: info.item.id,
                  operationId: id(),
                  expectedVersion: info.item.version,
                  action,
                },
              });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              setNotice(
                action === "archive"
                  ? "Disconnected locally. Revoke credentials on GitHub separately; issued tokens may still work."
                  : "Restored locally. Test its current permissions before use.",
              );
            })
          }
        />
      ))}
      <Button
        label="First GitHub connections"
        disabled={busy || !cursor}
        onPress={() => setCursor(null)}
      />
      <Button
        label="More GitHub connections"
        disabled={busy || !page.data?.nextCursor}
        onPress={() => setCursor(page.data?.nextCursor ?? null)}
      />
      {draft ? (
        <Sheet title="GitHub connection" dismissible={!busy} onClose={() => setDraft(null)}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-3 p-4"
          >
            <Text>Connection label</Text>
            <TextInput
              accessibilityLabel="GitHub connection label"
              value={draft.label}
              maxLength={200}
              editable={!locked}
              onChangeText={(label) => setDraft({ ...draft, label })}
            />
            <Button
              label={`Authentication: ${draft.type === "app" ? "GitHub App installation" : "Dedicated token"}`}
              disabled={locked}
              onPress={() =>
                setDraft({ ...draft, type: draft.type === "app" ? "token" : "app", secret: "" })
              }
            />
            {draft.type === "app" ? (
              <>
                <Text>App ID</Text>
                <TextInput
                  accessibilityLabel="GitHub App ID"
                  value={draft.appId}
                  maxLength={20}
                  keyboardType="number-pad"
                  editable={!locked}
                  onChangeText={(appId) => setDraft({ ...draft, appId })}
                />
                <Text>Installation ID</Text>
                <TextInput
                  accessibilityLabel="GitHub installation ID"
                  value={draft.installationId}
                  maxLength={20}
                  keyboardType="number-pad"
                  editable={!locked}
                  onChangeText={(installationId) => setDraft({ ...draft, installationId })}
                />
              </>
            ) : null}
            <Text>
              {draft.type === "app"
                ? "App private key, RSA PEM. Escaped newlines are accepted."
                : "Dedicated GitHub token"}
            </Text>
            <TextInput
              accessibilityLabel="Private GitHub credential"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              value={draft.secret}
              maxLength={16384}
              editable={!locked}
              onChangeText={(secret) => setDraft({ ...draft, secret })}
            />
            <Text>Allowed repositories</Text>
            <TextInput
              accessibilityLabel="Allowed GitHub repositories"
              placeholder="owner/repo, owner/other"
              autoCapitalize="none"
              autoCorrect={false}
              value={draft.repositories}
              maxLength={4500}
              editable={!locked}
              onChangeText={(repositories) => setDraft({ ...draft, repositories })}
            />
            <Text>
              Loom tests the identity and API access to every repository before saving credentials
              in OpenBao. Replacing creates a new item version. Existing operations may already have
              authenticated.
            </Text>
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            <Button
              label="Test and save GitHub connection"
              disabled={locked}
              onPress={() =>
                void act(async () => {
                  const input = makeVaultGitHubSave(draft, id());
                  if (!input)
                    throw new Error(
                      "Enter a label, valid credentials and 1 to 32 owner/repository names.",
                    );
                  const result = await save({ environmentId, input });
                  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                  setDraft(null);
                  setNotice("Identity and repository API access verified. Connection saved.");
                })
              }
            />
            <Button
              label="Cancel GitHub connection"
              disabled={busy}
              onPress={() => setDraft(null)}
            />
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}
function Connection({
  info,
  disabled,
  onEdit,
  onTest,
  onChange,
}: {
  info: VaultGitHubInfo;
  disabled: boolean;
  onEdit: () => void;
  onTest: (repo: string) => void;
  onChange: (action: "archive" | "restore") => void;
}) {
  const [index, setIndex] = useState(0),
    [confirm, setConfirm] = useState(false);
  const repo = info.repositories[index]!;
  return (
    <View className="gap-2 rounded-lg bg-subtle p-3">
      <Text className="font-t3-medium">
        {info.item.label} · {info.item.state}
      </Text>
      <Text>
        {info.account} · {info.mechanism === "app" ? "App installation" : "Dedicated token"} ·
        Version {info.item.version}
      </Text>
      <Text selectable>Connection {info.item.id}</Text>
      <Text selectable>Use-grant destination: https://github.com/{repo}</Text>
      {info.repositories.length > 1 ? (
        <Button
          label={`Repository: ${repo}. Choose next repository`}
          disabled={disabled}
          onPress={() => setIndex((index + 1) % info.repositories.length)}
        />
      ) : null}
      <Button
        label="Test GitHub API access"
        disabled={disabled || info.item.state !== "active"}
        onPress={() => onTest(repo)}
      />
      <Button
        label={`Replace credentials for ${info.item.label}`}
        disabled={disabled || info.item.state !== "active"}
        onPress={onEdit}
      />
      <Button
        label={`${info.item.state === "archived" ? "Restore" : "Disconnect"} ${info.item.label}`}
        disabled={disabled}
        onPress={() => (info.item.state === "archived" ? onChange("restore") : setConfirm(true))}
      />
      {confirm ? (
        <>
          <Text>Disconnect locally? Provider revocation is separate.</Text>
          <Button
            label="Confirm local disconnect"
            disabled={disabled}
            onPress={() => {
              setConfirm(false);
              onChange("archive");
            }}
          />
          <Button label="Keep connected" disabled={disabled} onPress={() => setConfirm(false)} />
        </>
      ) : null}
    </View>
  );
}
