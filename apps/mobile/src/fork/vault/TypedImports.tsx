import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  VaultTypedMigrationCredential,
  VaultTypedMigrationDetails,
  VaultTypedMigrationResult,
} from "@t3tools/contracts/fork";
import { createVaultMigrationAtoms } from "@t3tools/client-runtime/fork";
import * as Redacted from "effect/Redacted";
import { useVaultTime } from "./useVaultTime";
import { View, Switch } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
const atoms = createVaultMigrationAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const unwrap = <A, E>(r: AtomCommandResult<A, E>) => {
  if (r._tag === "Failure") throw squashAtomCommandFailure(r);
  return r.value;
};
type Mode = "ssh" | "token" | "app";
const reenter = (
  details: VaultTypedMigrationDetails,
  value: string,
): VaultTypedMigrationCredential =>
  details.type === "ssh"
    ? { type: "ssh", target: details.target, privateKey: Redacted.make(value) }
    : {
        type: "github",
        account: details.account,
        repositories: details.repositories,
        credential:
          details.mechanism === "token"
            ? { type: "token", token: Redacted.make(value) }
            : {
                type: "app",
                appId: details.appId!,
                installationId: details.installationId!,
                privateKey: Redacted.make(value),
              },
      };
export function TypedImports({
  environmentId,
  connected = true,
}: {
  environmentId: EnvironmentId;
  connected?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [id, setId] = useState(newId),
    [mode, setMode] = useState<Mode>("ssh"),
    [label, setLabel] = useState(""),
    [hostname, setHostname] = useState(""),
    [username, setUsername] = useState("git"),
    [port, setPort] = useState("22"),
    [hostKey, setHostKey] = useState(""),
    [account, setAccount] = useState(""),
    [repositories, setRepositories] = useState(""),
    [appId, setAppId] = useState(""),
    [installationId, setInstallationId] = useState(""),
    [value, setValue] = useState(""),
    [dedicated, setDedicated] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [entering, setEntering] = useState(false),
    [result, setResult] = useState<VaultTypedMigrationResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const canWrite = useAtomValue(atoms.typedPrepare.permissionAtom(environmentId)),
    locked = busy || !connected || !canWrite;
  const now = useVaultTime([result?.plan.expiresAt ?? null]);
  const query = useEnvironmentQuery(
    connected ? atoms.typedList({ environmentId, input: { cursor } }) : null,
  );
  const page = query.isSuccess && !query.isPending ? query.data : null;
  const prepare = useAtomCommand(atoms.typedPrepare, { reportFailure: false }),
    apply = useAtomCommand(atoms.typedApply, { reportFailure: false }),
    inspect = useAtomCommand(atoms.typedInspect, { reportFailure: false }),
    cancel = useAtomCommand(atoms.typedCancel, { reportFailure: false }),
    archive = useAtomCommand(atoms.typedArchive, { reportFailure: false });
  const refresh = () => query.refresh();
  const reset = () => {
    setResult(null);
    setId(newId());
    setValue("");
    setLabel("");
    setDedicated(false);
    setReviewed(false);
    setEntering(false);
    setError(null);
  };
  const act = async (work: () => Promise<VaultTypedMigrationResult>) => {
    if (busy || !connected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      setResult(next);
      if (!["prepared", "applying"].includes(next.plan.state)) setValue("");
      refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Import response was lost. Refresh its receipt before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  const credential = (): VaultTypedMigrationCredential =>
    result
      ? reenter(result.plan.details, value)
      : mode === "ssh"
        ? {
            type: "ssh",
            privateKey: Redacted.make(value),
            target: {
              hostname: hostname.trim().toLowerCase(),
              username: username.trim(),
              port: Number(port),
              hostKey: hostKey.trim() || null,
            },
          }
        : {
            type: "github",
            account: account.trim(),
            repositories: repositories.split(/[\s,]+/).filter(Boolean),
            credential:
              mode === "token"
                ? { type: "token", token: Redacted.make(value) }
                : {
                    type: "app",
                    appId: appId.trim(),
                    installationId: installationId.trim(),
                    privateKey: Redacted.make(value),
                  },
          };
  const pending = result && ["prepared", "applying"].includes(result.plan.state);
  return (
    <View className="gap-3 rounded-lg border border-border p-3">
      <Text className="font-semibold">Typed development imports</Text>
      <Text>
        Import one dedicated SSH key or GitHub identity into a new development record on this
        computer. Personal stores and Git configuration are not read or changed. Nothing is
        contacted or granted access.
      </Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {!result ? (
        <>
          <Field
            label="Typed development label"
            value={label}
            change={setLabel}
            disabled={locked}
          />
          <Text>Import type: {mode}</Text>
          <Button
            label="SSH key"
            onPress={() => {
              setMode("ssh");
              setValue("");
            }}
            disabled={locked}
          />
          <Button
            label="GitHub token"
            onPress={() => {
              setMode("token");
              setValue("");
            }}
            disabled={locked}
          />
          <Button
            label="GitHub App"
            onPress={() => {
              setMode("app");
              setValue("");
            }}
            disabled={locked}
          />
          {mode === "ssh" ? (
            <>
              <Field label="SSH hostname" value={hostname} change={setHostname} disabled={locked} />
              <Field label="SSH username" value={username} change={setUsername} disabled={locked} />
              <Field label="SSH port" value={port} change={setPort} disabled={locked} />
              <Field
                label="Independently verified host Ed25519 key (optional)"
                value={hostKey}
                change={setHostKey}
                disabled={locked}
              />
            </>
          ) : (
            <>
              <Field
                label="Expected GitHub account"
                value={account}
                change={setAccount}
                disabled={locked}
              />
              <Field
                label="GitHub repositories (owner/repo, separated by spaces)"
                value={repositories}
                change={setRepositories}
                disabled={locked}
              />
              {mode === "app" ? (
                <>
                  <Field label="GitHub App ID" value={appId} change={setAppId} disabled={locked} />
                  <Field
                    label="GitHub installation ID"
                    value={installationId}
                    change={setInstallationId}
                    disabled={locked}
                  />
                </>
              ) : null}
            </>
          )}
          <Field
            label="Typed development private material"
            value={value}
            change={setValue}
            disabled={locked}
            secret={mode === "token"}
            multiline={mode !== "token"}
          />
          <Text>
            Use an unencrypted Ed25519 PEM/OpenSSH key, dedicated GitHub token, or unencrypted App
            RSA PEM key of at least 2048 bits. Paste only the selected development credential.
          </Text>
          <Confirm
            label="This typed credential is dedicated to development, separate from personal and production credentials."
            value={dedicated}
            change={setDedicated}
            disabled={locked}
          />
          <Button
            label="Review typed development import"
            onPress={() =>
              void act(async () =>
                unwrap(
                  await prepare({
                    environmentId,
                    input: {
                      id,
                      label: label.trim(),
                      developmentOnly: true,
                      credential: credential(),
                    },
                  }),
                ),
              )
            }
            disabled={locked || !dedicated || !label.trim() || !value}
          />
          <Button label="Clear typed private input" onPress={reset} disabled={busy} />
        </>
      ) : (
        <>
          <Text>
            {result.plan.label} · {result.plan.kind} · {result.plan.state}
          </Text>
          <Text>
            Record reference: {result.plan.itemId}. Review expires{" "}
            {new Date(result.plan.expiresAt).toLocaleString()}.
          </Text>
          {result.plan.details.type === "ssh" ? (
            <>
              <Text>
                {result.plan.details.target.username}@{result.plan.details.target.hostname}:
                {result.plan.details.target.port} · {result.plan.details.fingerprint}
              </Text>
              <Text>
                Host pin:{" "}
                {result.plan.details.target.hostKey ??
                  "Missing; independently verify and pin before use"}
              </Text>
            </>
          ) : (
            <>
              <Text>
                {result.plan.details.account} · {result.plan.details.mechanism} ·{" "}
                {result.plan.details.repositories.join(", ")}
              </Text>
              {result.plan.details.mechanism === "app" ? (
                <Text>
                  App {result.plan.details.appId} · installation{" "}
                  {result.plan.details.installationId}
                </Text>
              ) : null}
            </>
          )}
          <Text>
            Credential format is checked locally. Account ownership, host identity and provider
            access are unverified. GitHub API evidence cannot authorize Git transport. Workload
            grants need separate review. Cutover, rollback and configuration writes remain
            unavailable.
          </Text>
          {result.item ? (
            <Text>
              Stored version {result.item.version} · {result.item.state}
            </Text>
          ) : null}
          {pending ? (
            <>
              {entering ? (
                <Field
                  label="Reenter typed private material"
                  value={value}
                  change={setValue}
                  disabled={locked}
                  secret={
                    result.plan.details.type === "github" &&
                    result.plan.details.mechanism === "token"
                  }
                  multiline={
                    result.plan.details.type === "ssh" || result.plan.details.mechanism === "app"
                  }
                />
              ) : (
                <Text>Private material stays hidden during review.</Text>
              )}
              <Confirm
                label="I reviewed this new development record, destination, account scope and selected computer."
                value={reviewed}
                change={setReviewed}
                disabled={locked}
              />
              <Button
                label="Import reviewed typed development record"
                onPress={() =>
                  void act(async () =>
                    unwrap(
                      await apply({
                        environmentId,
                        input: {
                          id: result.plan.id,
                          reviewed: true,
                          developmentOnly: true,
                          credential: credential(),
                        },
                      }),
                    ),
                  )
                }
                disabled={
                  locked ||
                  !reviewed ||
                  !value ||
                  (result.plan.state === "prepared" && now >= result.plan.expiresAt)
                }
              />
              {now >= result.plan.expiresAt && result.plan.state === "prepared" ? (
                <Text>This review expired. Cancel it and prepare a new review.</Text>
              ) : null}
            </>
          ) : null}
          <Button
            label="Refresh typed import status"
            onPress={() =>
              void act(async () =>
                unwrap(await inspect({ environmentId, input: { id: result.plan.id } })),
              )
            }
            disabled={busy || !connected}
          />
          {["prepared", "expired"].includes(result.plan.state) ? (
            <Button
              label="Cancel typed review"
              onPress={() =>
                void act(async () =>
                  unwrap(await cancel({ environmentId, input: { id: result.plan.id } })),
                )
              }
              disabled={locked}
            />
          ) : null}
          {result.canArchive ? (
            <Button
              label="Archive unchanged typed import"
              onPress={() =>
                void act(async () =>
                  unwrap(await archive({ environmentId, input: { id: result.plan.id } })),
                )
              }
              disabled={locked}
            />
          ) : null}
          <Button label="Close typed review" onPress={reset} disabled={busy} />
        </>
      )}
      {query.isPending ? <Text>Loading typed reviews…</Text> : null}
      {query.error ? (
        <Text accessibilityRole="alert">Could not load typed reviews. Refresh and retry.</Text>
      ) : null}
      <Button label="Refresh typed reviews" onPress={refresh} disabled={busy || !connected} />
      {page?.items.length === 0 ? <Text>No typed reviews on this page.</Text> : null}
      {page?.items.map((entry) => (
        <View key={entry.plan.id}>
          <Text>
            {entry.plan.label} · {entry.plan.kind} · {entry.plan.state}
          </Text>
          <Button
            label="Open typed review"
            onPress={() => {
              setValue("");
              setReviewed(false);
              setEntering(true);
              void act(async () =>
                unwrap(await inspect({ environmentId, input: { id: entry.plan.id } })),
              );
            }}
            disabled={busy || !connected}
          />
        </View>
      ))}
      <Button
        label="First typed reviews"
        onPress={() => setCursor(null)}
        disabled={busy || !cursor}
      />
      <Button
        label="More typed reviews"
        onPress={() => setCursor(page?.nextCursor ?? null)}
        disabled={busy || !page?.nextCursor}
      />
    </View>
  );
}
function Field({
  label,
  value,
  change,
  disabled,
  secret = false,
  multiline = false,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  disabled: boolean;
  secret?: boolean;
  multiline?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        editable={!disabled}
        secureTextEntry={secret}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        className="rounded-md border border-border px-3 py-2 text-foreground"
      />
    </View>
  );
}
function Confirm({
  label,
  value,
  change,
  disabled,
}: {
  label: string;
  value: boolean;
  change: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <View>
      <Text>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={change} disabled={disabled} />
    </View>
  );
}
