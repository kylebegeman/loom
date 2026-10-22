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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import {
  LoomSettingsActions,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsNotice,
} from "../settings/parts";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
const github = createVaultGitHubAtoms(connectionAtomRuntime),
  access = createVaultAccessAtoms(connectionAtomRuntime);
const readinessErrorMessage = (cause: unknown, cancelled: boolean) =>
  cancelled
    ? "Readiness check cancelled. Run again for a fresh result."
    : cause instanceof Error
      ? cause.message
      : "Could not check GitHub readiness.";
export function GitHubReadiness({
  environmentId,
  info,
  repository,
  disabled,
}: {
  environmentId: EnvironmentId;
  info: VaultGitHubInfo;
  repository: string;
  disabled: boolean;
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
    <LoomSettingsDetails title="Terminal and run readiness">
      <Checks
        key={`${info.item.version}:${repository}`}
        environmentId={environmentId}
        info={info}
        repository={repository}
        disabled={disabled}
      />
    </LoomSettingsDetails>
  );
}
function Checks({
  environmentId,
  info,
  repository,
  disabled,
}: {
  environmentId: EnvironmentId;
  info: VaultGitHubInfo;
  repository: string;
  disabled: boolean;
}) {
  const catalogAtom = access.catalog({ environmentId, input: {} });
  const catalog = useAtomValue(catalogAtom);
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
      if (result._tag === "Failure")
        setError(
          readinessErrorMessage(squashAtomCommandFailure(result), cancellation.signal.aborted),
        );
      else setReport(result.value);
    } catch (cause) {
      setError(readinessErrorMessage(cause, cancellation.signal.aborted));
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
    <section
      aria-label={`GitHub readiness for ${info.item.label}`}
      className="flex min-w-0 flex-col gap-4"
    >
      <div className="space-y-1">
        <h4 className="text-sm font-medium">GitHub readiness</h4>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Check GitHub API, GH CLI and Git HTTPS access through this identity on this computer.
          Results expire after 60 seconds.
        </p>
      </div>
      <LoomSettingsField
        label="Readiness context"
        description="A thread also needs an active full-access run and its repository use grant."
      >
        <Select
          disabled={disabled || !!controller}
          value={thread}
          onValueChange={(value) => {
            if (value === null) return;
            setThread(value);
            setReport(null);
            setError(null);
          }}
        >
          <SelectTrigger aria-label={`Readiness thread for ${info.item.label}`}>
            <SelectValue>
              {threads.find((s) => s.principal.id === thread)?.label ??
                (thread ? `Unavailable thread (${thread})` : "Loom server tools only")}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">Loom server tools only</SelectItem>
            {threads.map((s) => (
              <SelectItem key={s.principal.id} value={s.principal.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LoomSettingsField>
      {catalog.waiting ? (
        <LoomSettingsNotice role="status">Loading readiness contexts…</LoomSettingsNotice>
      ) : null}
      {catalog._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          <div className="flex flex-col gap-3">
            <p>Could not load readiness threads. You can still check Loom server tools.</p>
            <LoomSettingsActions>
              <Button
                size="sm-multiline"
                variant="outline"
                disabled={disabled || !!controller}
                onClick={() => appAtomRegistry.refresh(catalogAtom)}
              >
                Retry readiness contexts
              </Button>
            </LoomSettingsActions>
          </div>
        </LoomSettingsNotice>
      ) : null}
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={disabled || !allowed || !!controller || info.item.state !== "active"}
          onClick={() => void check()}
        >
          {controller ? "Checking GitHub readiness…" : "Check GitHub readiness"}
        </Button>
        {controller ? (
          <Button size="sm-multiline" variant="outline" onClick={() => controller.abort()}>
            Cancel readiness check
          </Button>
        ) : null}
      </LoomSettingsActions>
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {report ? (
        <div
          role="status"
          className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted/40 p-5 sm:p-6"
        >
          <p className="text-sm font-medium">
            {expired ? "Report expired. Run the check again." : "Current readiness result"}
          </p>
          <dl className="grid min-w-0 gap-3 text-sm grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
            <div className="space-y-1">
              <dt className="text-muted-foreground">Execution</dt>
              <dd>Loom server</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Run access</dt>
              <dd>{report.grant === "unchecked" ? "Not checked" : report.grant}</dd>
            </div>
            {report.providerInstanceId ? (
              <div className="min-w-0 space-y-1 col-span-full">
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="wrap-anywhere">{report.providerInstanceId}</dd>
              </div>
            ) : null}
          </dl>
          <ul className="divide-y divide-border">
            {report.checks.map((c) => (
              <li key={c.kind} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {c.kind === "api" ? "GitHub API" : c.kind === "gh" ? "GH CLI" : "Git HTTPS"}
                  </span>
                  <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                    {c.state}
                  </span>
                </div>
                {c.reason ? (
                  <p className="wrap-anywhere text-sm leading-relaxed text-muted-foreground">
                    {vaultGitHubReadinessReason(c.reason)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Checked {new Date(report.checkedAt).toLocaleString()}. Valid until{" "}
            {new Date(report.expiresAt).toLocaleString()}.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Run the check again after credentials, policy or tools change.
          </p>
        </div>
      ) : null}
      <LoomSettingsDetails title="Terminal command">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Explicit terminal routing uses the authenticated agent run. Each command selects a
          connection and repository; this does not sign in the surrounding shell.
        </p>
        <pre className="max-w-full whitespace-pre-wrap wrap-anywhere rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
          {example}
        </pre>
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(example).then(
                () => setCopied(true),
                () =>
                  setError(
                    "Could not copy the command. Select and copy the example in Terminal command.",
                  ),
              );
            }}
          >
            Copy terminal command
          </Button>
        </LoomSettingsActions>
      </LoomSettingsDetails>
      {copied ? (
        <LoomSettingsNotice role="status">
          Command copied. It contains references only.
        </LoomSettingsNotice>
      ) : null}
    </section>
  );
}
