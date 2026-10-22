import { useContext, useEffect, useState } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo, VaultGitHubReadiness } from "@t3tools/contracts/fork";
import {
  createVaultGitHubAtoms,
  createVaultAccessAtoms,
  supportsLoomFeature,
  vaultGitHubReadinessReason,
} from "@t3tools/client-runtime/fork";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
const github = createVaultGitHubAtoms(connectionAtomRuntime),
  access = createVaultAccessAtoms(connectionAtomRuntime);
export function GitHubReadiness({
  environmentId,
  info,
  repository,
  disabled,
  ownerMode = false,
}: {
  environmentId: EnvironmentId;
  info: VaultGitHubInfo;
  repository: string;
  disabled: boolean;
  ownerMode?: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-github-terminal")) return null;
  return (
    <Checks
      key={`${info.item.version}:${repository}`}
      environmentId={environmentId}
      info={info}
      repository={repository}
      disabled={disabled}
      ownerMode={ownerMode}
    />
  );
}
function Checks({
  environmentId,
  info,
  repository,
  disabled,
  ownerMode,
}: {
  environmentId: EnvironmentId;
  info: VaultGitHubInfo;
  repository: string;
  disabled: boolean;
  ownerMode: boolean;
}) {
  const registry = useContext(RegistryContext),
    catalog = useEnvironmentQuery(access.catalog({ environmentId, input: {} }));
  const threads = catalog.data?.subjects.filter((s) => s.principal.kind === "thread") ?? [];
  const allowed = useAtomValue(github.readiness.permissionAtom(environmentId));
  const [thread, setThread] = useState<string | null>(null),
    [choosing, setChoosing] = useState(false),
    [filter, setFilter] = useState(""),
    [report, setReport] = useState<VaultGitHubReadiness | null>(null),
    [error, setError] = useState<string | null>(null),
    [controller, setController] = useState<AbortController | null>(null),
    [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!report) return;
    const timeout = setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(report.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [report]);
  useEffect(() => () => controller?.abort(), [controller]);
  const select = (value: string | null) => {
    setThread(value);
    setChoosing(false);
    setReport(null);
    setError(null);
  };
  const check = async () => {
    if (controller) return;
    const cancellation = new AbortController();
    setController(cancellation);
    setReport(null);
    setExpired(false);
    setError(null);
    try {
      const result = await executeAtomQuery(
        registry,
        github.readiness.resultAtom({
          environmentId,
          input: {
            id: info.item.id,
            expectedVersion: info.item.version,
            repository,
            threadId: thread ? ThreadId.make(thread) : null,
          },
        }),
        { signal: cancellation.signal, refresh: true, reportFailure: false, reportDefect: false },
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setReport(result.value);
    } catch (cause) {
      setError(
        cancellation.signal.aborted
          ? "Readiness check cancelled. Run again for a fresh result."
          : cause instanceof Error
            ? cause.message
            : "Could not check GitHub readiness.",
      );
    } finally {
      setController(null);
    }
  };
  const example = `loom vault github-exec '${JSON.stringify({ id: info.item.id, expectedVersion: info.item.version, repository, command: { tool: "gh", argv: ["pr", "list"] } })}'`;
  return (
    <View className="gap-2">
      <Text>GitHub readiness</Text>
      <Text>
        {ownerMode
          ? "Checks use this GitHub connection on the Loom server. Choose an active full-access thread to check agent tools too. Results expire after 60 seconds."
          : "Checks use the selected identity on the Loom server. A thread also needs an active full-access run and its repository use grant. Results expire after 60 seconds."}
      </Text>
      <Button
        label={
          choosing
            ? "Cancel readiness context selection"
            : thread
              ? `Readiness: ${threads.find((s) => s.principal.id === thread)?.label ?? thread}`
              : "Readiness: Loom server tools only"
        }
        disabled={disabled || !!controller}
        onPress={() => setChoosing(!choosing)}
      />
      {choosing ? (
        <View className="gap-2">
          <TextInput
            accessibilityLabel="Find readiness thread"
            placeholder="Find a thread"
            value={filter}
            onChangeText={setFilter}
          />
          <Button label="Loom server tools only" onPress={() => select(null)} />
          {threads
            .filter((s) => s.label.toLowerCase().includes(filter.toLowerCase()))
            .map((s) => (
              <Button
                key={s.principal.id}
                label={`Check thread ${s.label}`}
                onPress={() => select(s.principal.id)}
              />
            ))}
        </View>
      ) : null}
      <Button
        label={controller ? "Checking GitHub readiness…" : "Check GitHub readiness"}
        disabled={disabled || !allowed || !!controller || info.item.state !== "active"}
        onPress={() => void check()}
      />
      {controller ? (
        <Button label="Cancel readiness check" onPress={() => controller.abort()} />
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {report ? (
        <View className="gap-1" accessibilityLiveRegion="polite">
          <Text>
            {expired ? "Report expired. Run the check again." : "Current readiness result"}
          </Text>
          <Text>
            Execution: Loom server · Agent access:{" "}
            {report.grant === "unchecked" ? "not checked" : report.grant}
            {report.providerInstanceId ? ` · Provider: ${report.providerInstanceId}` : ""}
          </Text>
          {report.checks.map((c) => (
            <Text key={c.kind}>
              {c.kind === "api" ? "GitHub API" : c.kind === "gh" ? "GH CLI" : "Git HTTPS"}:{" "}
              {c.state}
              {c.reason ? ` · ${vaultGitHubReadinessReason(c.reason)}` : ""}
            </Text>
          ))}
          <Text>
            Checked {new Date(report.checkedAt).toLocaleString()}. Valid until{" "}
            {new Date(report.expiresAt).toLocaleString()}.
          </Text>
          <Text>Check again after credentials, policy or tools change.</Text>
        </View>
      ) : null}
      {!ownerMode ? (
        <>
          <Text>
            Explicit terminal routing uses the authenticated agent run. Each command selects a
            connection and repository; the surrounding shell is unchanged.
          </Text>
          <Text selectable className="text-xs">
            {example}
          </Text>
          <Button
            label="Copy terminal command"
            onPress={() => {
              void Clipboard.setStringAsync(example).then(
                () => setCopied(true),
                () => setError("Could not copy the command."),
              );
            }}
          />
          {copied ? (
            <Text accessibilityRole="summary">Command copied. It contains references only.</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
