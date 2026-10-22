import { GitHubReadiness } from "./GitHubReadiness";
import { GitHubProjectAccess } from "./GitHubProjectAccess";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
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
  ownerMode = false,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  ownerMode?: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId),
    canRead = useEnvironmentScope(environmentId, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-github")) return null;
  return (
    <SettingsSection title="GitHub access">
      {canRead ? (
        <Manager
          key={`${environmentId}:${canWrite}:${ownerMode}:${connected}`}
          environmentId={environmentId}
          connected={connected}
          ownerMode={ownerMode}
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
  ownerMode,
  canWrite,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  ownerMode: boolean;
  canWrite: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [draft, setDraft] = useState<VaultGitHubDraft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [advanced, setAdvanced] = useState(false);
  const canSave = useAtomValue(atoms.save.permissionAtom(environmentId)),
    canTest = useAtomValue(atoms.test.permissionAtom(environmentId)),
    canChange = useAtomValue(atoms.change.permissionAtom(environmentId));
  const page = useEnvironmentQuery(
      connected ? atoms.list({ environmentId, input: { cursor } }) : null,
    ),
    save = useAtomCommand(atoms.save, { reportFailure: false }),
    test = useAtomCommand(atoms.test, { reportFailure: false }),
    change = useAtomCommand(atoms.change, { reportFailure: false });
  const locked = busy || !connected || page.isPending || !!page.error;
  const cannotSave = locked || !canWrite || !canSave;
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
    setAdvanced(info?.mechanism === "app");
    setDraft({
      id: info?.item.id ?? id(),
      expectedVersion: info?.item.version ?? 0,
      label: info?.item.label ?? "GitHub",
      repositories: info?.repositories.join(", ") ?? "",
      type: info?.mechanism ?? "token",
      appId: "",
      installationId: "",
      secret: "",
    });
  };
  return (
    <View className="gap-3">
      <Text>
        {ownerMode
          ? "Connect GitHub once. Agents in this owner's environment can use the saved connection for its listed repositories. GitHub permissions still apply."
          : "Save a GitHub connection, then choose the projects and repositories it can use. Approve recurring project access once; it lasts until you revoke it."}
      </Text>
      {!connected ? <Text>Reconnect this computer to manage GitHub connections.</Text> : null}
      <Button
        label="Connect GitHub"
        tone="primary"
        disabled={cannotSave || !!draft}
        onPress={() => edit()}
      />
      <Button
        label="Refresh GitHub connections"
        tone="text"
        disabled={busy || !connected}
        onPress={page.refresh}
      />
      {page.isPending ? <Text>Loading GitHub connections…</Text> : null}
      {error || page.error ? (
        <Text accessibilityRole="alert">
          {error ?? "Could not load connections. Check Vault access and refresh."}
        </Text>
      ) : null}
      {notice ? <Text accessibilityRole="summary">{notice}</Text> : null}
      {page.data?.items.length === 0 ? (
        <Text>No saved GitHub connections on this page. Connect GitHub to get started.</Text>
      ) : null}
      {page.data?.items.map((info) => (
        <Connection
          key={`${info.item.id}:${info.item.version}`}
          info={info}
          environmentId={environmentId}
          connected={connected}
          ownerMode={ownerMode}
          canWrite={canWrite}
          canTest={canTest}
          canChange={canChange}
          canSave={canSave}
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
            <Text>
              {draft.expectedVersion === 0
                ? "Use a dedicated fine-grained GitHub token. Your saved connections can be reused without entering credentials again."
                : ownerMode
                  ? "Replace this connection's credential. Agents can use the repositories allowed by the replacement."
                  : "Replace this connection's credential. Existing project access stays in place; review it after changing the repository allowlist."}
            </Text>
            {draft.type === "token" ? (
              <View className="gap-2 rounded-2xl bg-subtle p-3">
                <Text className="font-t3-semibold">GitHub token permissions</Text>
                <Text>
                  Sign in to GitHub to create or renew a dedicated fine-grained token. Select only
                  the repositories you want Loom to use.
                </Text>
                <Text>Metadata: read access. Contents: read and write for Git pushes.</Text>
                <Text>
                  Pull requests and Issues: read and write when agents should create or update them.
                  GitHub permissions remain the upper limit of what agents can do.
                </Text>
                <Button
                  label="Create a fine-grained token on GitHub"
                  tone="text"
                  disabled={busy}
                  onPress={() => {
                    void Linking.openURL(
                      "https://github.com/settings/personal-access-tokens/new",
                    ).catch(() =>
                      setError(
                        "Could not open GitHub. Visit GitHub Settings, Developer settings, Personal access tokens, Fine-grained tokens.",
                      ),
                    );
                  }}
                />
              </View>
            ) : null}
            <Button
              label={
                advanced
                  ? "Hide advanced connection settings"
                  : "Advanced: GitHub App or connection name"
              }
              tone="text"
              disabled={busy}
              onPress={() => setAdvanced(!advanced)}
            />
            {advanced ? (
              <View className="gap-3">
                <Text>Connection name</Text>
                <TextInput
                  accessibilityLabel="GitHub connection name"
                  value={draft.label}
                  maxLength={200}
                  editable={!cannotSave}
                  onChangeText={(label) => setDraft({ ...draft, label })}
                />
                <Button
                  label={`Authentication: ${draft.type === "app" ? "GitHub App installation" : "Dedicated token"}`}
                  disabled={cannotSave}
                  onPress={() =>
                    setDraft({ ...draft, type: draft.type === "app" ? "token" : "app", secret: "" })
                  }
                />
              </View>
            ) : null}
            {draft.type === "app" ? (
              <>
                <Text>App ID</Text>
                <TextInput
                  accessibilityLabel="GitHub App ID"
                  value={draft.appId}
                  maxLength={20}
                  keyboardType="number-pad"
                  editable={!cannotSave}
                  onChangeText={(appId) => setDraft({ ...draft, appId })}
                />
                <Text>Installation ID</Text>
                <TextInput
                  accessibilityLabel="GitHub installation ID"
                  value={draft.installationId}
                  maxLength={20}
                  keyboardType="number-pad"
                  editable={!cannotSave}
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
              editable={!cannotSave}
              onChangeText={(secret) => setDraft({ ...draft, secret })}
            />
            <Text>Repositories this connection may access</Text>
            <TextInput
              accessibilityLabel="Allowed GitHub repositories"
              placeholder="https://github.com/owner/repo"
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              value={draft.repositories}
              maxLength={8192}
              editable={!cannotSave}
              onChangeText={(repositories) => setDraft({ ...draft, repositories })}
            />
            <Text>
              Paste GitHub repository URLs or owner/repository names, separated by commas or
              newlines. Select up to 32 repositories allowed by the token or App. Loom verifies API
              access before saving.{" "}
              {ownerMode
                ? "Owner access allows agents to use this saved connection without separate project approvals."
                : "Saving this connection does not authorize any project."}
            </Text>
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            <Button
              label="Test and save GitHub connection"
              disabled={cannotSave}
              onPress={() =>
                void act(async () => {
                  const input = makeVaultGitHubSave(draft, id());
                  if (!input)
                    throw new Error(
                      "Enter valid credentials and 1 to 32 owner/repository names. Check the connection name in advanced settings if needed.",
                    );
                  const result = await save({ environmentId, input });
                  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                  setDraft(null);
                  setNotice(
                    ownerMode
                      ? "GitHub connected. Agents can use this connection for its allowed repositories."
                      : "Identity and repository API access verified. Connection saved. Choose projects below to authorize access.",
                  );
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
  environmentId,
  info,
  connected,
  ownerMode,
  canWrite,
  canTest,
  canChange,
  canSave,
  disabled,
  onEdit,
  onTest,
  onChange,
}: {
  environmentId: EnvironmentId;
  info: VaultGitHubInfo;
  connected: boolean;
  ownerMode: boolean;
  canWrite: boolean;
  canTest: boolean;
  canChange: boolean;
  canSave: boolean;
  disabled: boolean;
  onEdit: () => void;
  onTest: (repo: string) => void;
  onChange: (action: "archive" | "restore") => void;
}) {
  const [index, setIndex] = useState(0),
    [confirm, setConfirm] = useState(false),
    [details, setDetails] = useState(false),
    [restricted, setRestricted] = useState(false);
  const repo = info.repositories[index]!;
  return (
    <View className="gap-3 rounded-2xl bg-subtle p-3">
      <Text accessibilityRole="header" className="font-t3-semibold">
        {info.item.label}
      </Text>
      <Text>
        {info.account} · {info.item.state === "active" ? "Connection saved" : "Disconnected"}
      </Text>
      <Text>{info.repositories.join(", ")}</Text>
      {info.item.state === "active" ? (
        ownerMode ? (
          <>
            <Text>
              Agents can use this connection through owner access. Test GitHub to verify its current
              login and repository permissions.
            </Text>
            <Button
              label="Test GitHub connection"
              disabled={disabled || !canWrite || !canTest}
              onPress={() => onTest(repo)}
            />
            <Button
              label={`Repair login for ${info.item.label}`}
              tone="text"
              disabled={disabled || !canWrite || !canSave}
              onPress={onEdit}
            />
          </>
        ) : (
          <GitHubProjectAccess
            environmentId={environmentId}
            connected={connected}
            connection={info}
            disabled={disabled || !canWrite}
          />
        )
      ) : (
        <Button
          label={`Restore ${info.item.label}`}
          disabled={disabled || !canWrite || !canChange}
          onPress={() => onChange("restore")}
        />
      )}
      <Button
        label={details ? "Hide connection details and tools" : "Connection details and tools"}
        tone="text"
        disabled={disabled}
        onPress={() => setDetails(!details)}
      />
      {details ? (
        <View className="gap-2">
          <Text>
            {info.mechanism === "app" ? "GitHub App installation" : "Dedicated token"}
            {!ownerMode ? ` · Version ${info.item.version}` : ""}
          </Text>
          {!ownerMode ? <Text selectable>Connection {info.item.id}</Text> : null}
          <Text>
            {ownerMode
              ? "GitHub API, GH CLI and Git HTTPS are checked separately. A saved connection does not prove the execution computer has every required tool."
              : "Saving a connection, authorizing projects and checking an active run's tools are separate steps. Project access does not prove the current run can reach GitHub."}
          </Text>
          {info.repositories.length > 1 ? (
            <Button
              label={`Test repository: ${repo}. Choose next repository`}
              disabled={disabled}
              onPress={() => setIndex((index + 1) % info.repositories.length)}
            />
          ) : null}
          <Button
            label="Test GitHub API access"
            disabled={disabled || !canWrite || !canTest || info.item.state !== "active"}
            onPress={() => onTest(repo)}
          />
          <Button
            label={`Replace credentials for ${info.item.label}`}
            disabled={disabled || !canWrite || !canSave || info.item.state !== "active"}
            onPress={onEdit}
          />
          <GitHubReadiness
            environmentId={environmentId}
            info={info}
            repository={repo}
            disabled={disabled || !canWrite || info.item.state !== "active"}
            ownerMode={ownerMode}
          />
          {ownerMode && info.item.state === "active" ? (
            <>
              <Button
                label={
                  restricted
                    ? "Hide restricted project access"
                    : "Advanced: restricted project access"
                }
                tone="text"
                disabled={disabled}
                onPress={() => setRestricted(!restricted)}
              />
              {restricted ? (
                <>
                  <Text>These rules apply again when you switch back to restricted access.</Text>
                  <GitHubProjectAccess
                    environmentId={environmentId}
                    connected={connected}
                    connection={info}
                    disabled={disabled || !canWrite}
                  />
                </>
              ) : null}
            </>
          ) : null}
          <Text>
            App installations mint short-lived tokens. Dedicated tokens follow their GitHub expiry.
            Local disconnect does not revoke credentials on GitHub, and authenticated operations may
            still finish.
          </Text>
          {info.item.state === "active" ? (
            <Button
              label={`Disconnect ${info.item.label}`}
              tone="text"
              disabled={disabled || !canWrite || !canChange}
              onPress={() => setConfirm(true)}
            />
          ) : null}
        </View>
      ) : null}
      {confirm ? (
        <>
          <Text>
            {ownerMode
              ? "Disconnect this GitHub connection? Agents cannot start new operations with it until you restore it. Revoke or rotate the credential on GitHub to end upstream access."
              : "Disconnect locally? Project grants remain saved. Revoke project access first if you do not want it restored when reconnecting. Provider revocation is separate."}
          </Text>
          <Button
            label="Confirm local disconnect"
            tone="danger"
            disabled={disabled || !canWrite || !canChange}
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
