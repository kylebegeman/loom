import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo, VaultGitHubReadiness } from "@t3tools/contracts/fork";
import {
  createVaultGitHubAtoms,
  createVaultAccessAtoms,
  supportsLoomFeature,
  vaultGitHubReadinessReason,
} from "@t3tools/client-runtime/fork";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
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
  const configs = useServerConfigs();
  if (
    !supportsLoomFeature(
      configs.get(environmentId)?.environment.capabilities,
      "vault-github-terminal",
    )
  )
    return null;
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
  const catalog = useAtomValue(access.catalog({ environmentId, input: {} }));
  const threads =
    Option.getOrNull(AsyncResult.value(catalog))?.subjects.filter(
      (s) => s.principal.kind === "thread",
    ) ?? [];
  const allowed = useAtomValue(github.readiness.permissionAtom(environmentId));
  const [thread, setThread] = useState(""),
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
  const check = async () => {
    if (controller) return;
    const cancellation = new AbortController();
    setController(cancellation);
    setReport(null);
    setExpired(false);
    setError(null);
    try {
      const result = await executeAtomQuery(
        appAtomRegistry,
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
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(
          cancellation.signal.aborted
            ? "Readiness check cancelled. Run again for a fresh result."
            : cause instanceof Error
              ? cause.message
              : "Could not check GitHub readiness.",
        );
      } else setReport(result.value);
    } catch (cause) {
      setError(
        cancellation.signal.aborted
          ? "Readiness check cancelled. Run again for a fresh result."
          : cause instanceof Error
            ? cause.message
            : "Could not check GitHub readiness.",
      );
    }
    setController(null);
  };
  const selection = JSON.stringify({
    id: info.item.id,
    expectedVersion: info.item.version,
    repository,
    command: { tool: "gh", argv: ["pr", "list"] },
  });
  const example = `loom vault github-exec '${selection}'`;
  return (
    <section aria-label={`GitHub readiness for ${info.item.label}`} className="flex flex-col gap-2">
      <label className="flex min-w-0 flex-col gap-1">
        Readiness context
        <select
          className="min-w-0 max-w-full"
          aria-label={`Readiness thread for ${info.item.label}`}
          disabled={disabled || !!controller}
          value={thread}
          onChange={(e) => {
            setThread(e.target.value);
            setReport(null);
            setError(null);
          }}
        >
          <option value="">Loom server tools only</option>
          {threads.map((s) => (
            <option key={s.principal.id} value={s.principal.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm">
        {ownerMode
          ? "Checks use this GitHub connection on the Loom server. Choose an active full-access thread to check agent tools too. Results expire after 60 seconds."
          : "Checks read GitHub through the selected identity on this computer. A thread also needs an active full-access run and its repository use grant. Results expire after 60 seconds."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !allowed || !!controller || info.item.state !== "active"}
          onClick={() => void check()}
        >
          {controller ? "Checking GitHub readiness…" : "Check GitHub readiness"}
        </Button>
        {controller ? (
          <Button size="sm" variant="outline" onClick={() => controller.abort()}>
            Cancel readiness check
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {report ? (
        <div role="status" className="flex flex-col gap-1">
          {expired ? <p>Report expired. Run the check again.</p> : <p>Current readiness result</p>}
          <p>
            Execution: Loom server · Agent access:{" "}
            {report.grant === "unchecked" ? "not checked" : report.grant}
            {report.providerInstanceId ? ` · Provider: ${report.providerInstanceId}` : ""}
          </p>
          {report.checks.map((c) => (
            <p key={c.kind}>
              {c.kind === "api" ? "GitHub API" : c.kind === "gh" ? "GH CLI" : "Git HTTPS"}:{" "}
              {c.state}
              {c.reason ? ` · ${vaultGitHubReadinessReason(c.reason)}` : ""}
            </p>
          ))}
          <p>
            Checked {new Date(report.checkedAt).toLocaleString()}. Valid until{" "}
            {new Date(report.expiresAt).toLocaleString()}.
          </p>
          <p>Run the check again after credentials, policy or tools change.</p>
        </div>
      ) : null}
      <p className="text-sm">
        Explicit terminal routing uses the authenticated agent run. Each command selects a
        connection and repository; this does not sign in the surrounding shell.
      </p>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-xs">
        {example}
      </pre>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(example).then(
              () => setCopied(true),
              () => setError("Could not copy the command. Select the example above."),
            );
          }}
        >
          Copy terminal command
        </Button>
      </div>
      {copied ? <p role="status">Command copied. It contains references only.</p> : null}
    </section>
  );
}
