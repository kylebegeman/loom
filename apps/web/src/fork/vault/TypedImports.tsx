import { VaultQueryFeedback } from "./SettingsFeedback";
import { Checkbox } from "~/components/ui/checkbox";
import {
  LoomSettingsActions,
  LoomSettingsField,
  LoomSettingsDetails,
  LoomSettingsNotice,
} from "../settings/parts";
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
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
const atoms = createVaultMigrationAtoms(connectionAtomRuntime);
const newId = () => randomUUID().replaceAll("-", "");
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
  const listAtom = atoms.typedList({ environmentId, input: { cursor } }),
    query = useAtomValue(listAtom);
  const page = query._tag === "Success" && !query.waiting ? query.value : null;
  const refresh = () => appAtomRegistry.refresh(listAtom);
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
    }
    setBusy(false);
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
    <div className="flex min-w-0 flex-col gap-5 text-sm leading-relaxed wrap-anywhere">
      <p className="max-w-prose text-muted-foreground">
        Import one dedicated SSH key or GitHub identity into a new development record on this
        computer. Personal stores and Git configuration are not read or changed. Nothing is
        contacted or granted access.
      </p>
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {!result ? (
        <div className="flex min-w-0 flex-col gap-5">
          <p role="status" className="text-sm text-muted-foreground">
            Draft import. Review the record and destination before storing it.
          </p>
          <div className="grid min-w-0 gap-5 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
            <Field
              label="Typed development label"
              value={label}
              change={setLabel}
              disabled={locked}
            />
            <LoomSettingsField label="Import type">
              <Select<Mode>
                value={mode}
                disabled={locked}
                onValueChange={(nextValue) => {
                  if (nextValue === null) return;
                  setMode(nextValue);
                  setValue("");
                }}
              >
                <SelectTrigger aria-label="Typed import type">
                  <SelectValue>
                    {mode === "ssh" ? "SSH key" : mode === "token" ? "GitHub token" : "GitHub App"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="ssh">SSH key</SelectItem>
                  <SelectItem value="token">GitHub token</SelectItem>
                  <SelectItem value="app">GitHub App</SelectItem>
                </SelectPopup>
              </Select>
            </LoomSettingsField>
          </div>
          {mode === "ssh" ? (
            <>
              <Field label="SSH hostname" value={hostname} change={setHostname} disabled={locked} />
              <div className="grid min-w-0 gap-5 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                <Field
                  label="SSH username"
                  value={username}
                  change={setUsername}
                  disabled={locked}
                />
                <Field label="SSH port" value={port} change={setPort} disabled={locked} />
              </div>
              <Field
                label="Independently verified host Ed25519 key (optional)"
                description="Without a verified host key, SSH access stays blocked until trust is configured."
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
                label="GitHub repositories"
                description="Enter exact owner/repository names, separated by spaces or commas."
                value={repositories}
                change={setRepositories}
                disabled={locked}
              />
              {mode === "app" ? (
                <div className="grid min-w-0 gap-5 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                  <Field label="GitHub App ID" value={appId} change={setAppId} disabled={locked} />
                  <Field
                    label="GitHub installation ID"
                    value={installationId}
                    change={setInstallationId}
                    disabled={locked}
                  />
                </div>
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
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            Use an unencrypted Ed25519 PEM/OpenSSH key, dedicated GitHub token, or unencrypted App
            RSA PEM key of at least 2048 bits. Paste only the selected development credential.
          </p>
          <Confirm
            label="This typed credential is dedicated to development, separate from personal and production credentials."
            value={dedicated}
            change={setDedicated}
            disabled={locked}
          />
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
              onClick={() =>
                void act(() =>
                  runVault(atoms.typedPrepare, {
                    environmentId,
                    input: {
                      id,
                      label: label.trim(),
                      developmentOnly: true,
                      credential: credential(),
                    },
                  }),
                )
              }
              disabled={locked || !dedicated || !label.trim() || !value}
            >
              Review typed development import
            </Button>
            <Button size="sm-multiline" variant="outline" onClick={reset} disabled={busy}>
              Clear typed private input
            </Button>
          </LoomSettingsActions>
        </div>
      ) : (
        <section
          aria-label="Typed development import review"
          className="flex min-w-0 flex-col gap-4"
        >
          <div className="space-y-1">
            <h4 className="font-medium">{result.plan.label}</h4>
            <p className="text-muted-foreground">
              {result.plan.kind} · {result.plan.state}
            </p>
          </div>
          <p>
            Record reference: {result.plan.itemId}. Review expires{" "}
            {new Date(result.plan.expiresAt).toLocaleString()}.
          </p>
          {result.plan.details.type === "ssh" ? (
            <>
              <p>
                {result.plan.details.target.username}@{result.plan.details.target.hostname}:
                {result.plan.details.target.port} · {result.plan.details.fingerprint}
              </p>
              <p>
                Host pin:{" "}
                {result.plan.details.target.hostKey ??
                  "Missing; independently verify and pin before use"}
              </p>
            </>
          ) : (
            <>
              <p>
                {result.plan.details.account} · {result.plan.details.mechanism} ·{" "}
                {result.plan.details.repositories.join(", ")}
              </p>
              {result.plan.details.mechanism === "app" ? (
                <p>
                  App {result.plan.details.appId} · installation{" "}
                  {result.plan.details.installationId}
                </p>
              ) : null}
            </>
          )}
          <p>
            Credential format is checked locally. Account ownership, host identity and provider
            access are unverified. GitHub API evidence cannot authorize Git transport. Workload
            grants need separate review. Cutover, rollback and configuration writes remain
            unavailable.
          </p>
          {result.item ? (
            <p>
              Stored version {result.item.version} · {result.item.state}
            </p>
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
                <p>Private material stays hidden during review.</p>
              )}
              <Confirm
                label="I reviewed this new development record, destination, account scope and selected computer."
                value={reviewed}
                change={setReviewed}
                disabled={locked}
              />
              <Button
                size="sm-multiline"
                onClick={() =>
                  void act(() =>
                    runVault(atoms.typedApply, {
                      environmentId,
                      input: {
                        id: result.plan.id,
                        reviewed: true,
                        developmentOnly: true,
                        credential: credential(),
                      },
                    }),
                  )
                }
                disabled={
                  locked ||
                  !reviewed ||
                  !value ||
                  (result.plan.state === "prepared" && now >= result.plan.expiresAt)
                }
              >
                Import reviewed typed development record
              </Button>
              {now >= result.plan.expiresAt && result.plan.state === "prepared" ? (
                <LoomSettingsNotice role="status">
                  This review expired. Cancel it and prepare a new review.
                </LoomSettingsNotice>
              ) : null}
            </>
          ) : null}
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
              variant="outline"
              onClick={() =>
                void act(() =>
                  runVault(atoms.typedInspect, { environmentId, input: { id: result.plan.id } }),
                )
              }
              disabled={busy || !connected}
            >
              Refresh typed import status
            </Button>
            {["prepared", "expired"].includes(result.plan.state) ? (
              <Button
                size="sm-multiline"
                variant="outline"
                onClick={() =>
                  void act(() =>
                    runVault(atoms.typedCancel, { environmentId, input: { id: result.plan.id } }),
                  )
                }
                disabled={locked}
              >
                Cancel typed review
              </Button>
            ) : null}
            {result.canArchive ? (
              <Button
                size="sm-multiline"
                variant="outline"
                onClick={() =>
                  void act(() =>
                    runVault(atoms.typedArchive, { environmentId, input: { id: result.plan.id } }),
                  )
                }
                disabled={locked}
              >
                Archive unchanged typed import
              </Button>
            ) : null}
            <Button size="sm-multiline" variant="outline" onClick={reset} disabled={busy}>
              Close typed review
            </Button>
          </LoomSettingsActions>
        </section>
      )}
      <LoomSettingsDetails title="Recent SSH and GitHub import reviews">
        <VaultQueryFeedback
          result={query}
          loading="Loading import reviews…"
          error="Could not load SSH and GitHub import reviews."
          onRetry={refresh}
        />
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={refresh}
            disabled={busy || !connected}
          >
            Refresh typed reviews
          </Button>
        </LoomSettingsActions>
        {page?.items.length === 0 ? <p>No typed reviews on this page.</p> : null}
        {page?.items.map((entry) => (
          <div
            key={entry.plan.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3"
          >
            <div className="min-w-0 space-y-1">
              <h4 className="wrap-anywhere text-sm font-medium">{entry.plan.label}</h4>
              <p className="text-xs text-muted-foreground">
                {entry.plan.kind}. {entry.plan.state}
              </p>
            </div>
            <Button
              size="sm-multiline"
              variant="outline"
              onClick={() => {
                setValue("");
                setReviewed(false);
                setEntering(true);
                void act(() =>
                  runVault(atoms.typedInspect, { environmentId, input: { id: entry.plan.id } }),
                );
              }}
              disabled={busy || !connected}
            >
              Open typed review
            </Button>
          </div>
        ))}
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() => setCursor(null)}
            disabled={busy || !cursor}
          >
            First typed reviews
          </Button>
          <Button
            size="sm-multiline"
            variant="outline"
            onClick={() => setCursor(page?.nextCursor ?? null)}
            disabled={busy || !page?.nextCursor}
          >
            More typed reviews
          </Button>
        </LoomSettingsActions>
      </LoomSettingsDetails>
    </div>
  );
}
function Field({
  label,
  description,
  value,
  change,
  disabled,
  secret = false,
  multiline = false,
}: {
  label: string;
  description?: string;
  value: string;
  change: (value: string) => void;
  disabled: boolean;
  secret?: boolean;
  multiline?: boolean;
}) {
  return (
    <LoomSettingsField label={label} description={description}>
      {multiline ? (
        <Textarea
          aria-label={label}
          value={value}
          onChange={(e) => change(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          maxLength={65536}
        />
      ) : (
        <Input
          aria-label={label}
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => change(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          maxLength={65536}
        />
      )}
    </LoomSettingsField>
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
    <label className="flex items-start gap-2 text-sm leading-6">
      <Checkbox
        aria-label={label}

        checked={value}
        onCheckedChange={(checked) => change(checked)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  );
}
