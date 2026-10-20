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
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border  p-3">
      <h3 className="font-medium">Typed development imports</h3>
      <p>
        Import one dedicated SSH key or GitHub identity into a new development record on this
        computer. Personal stores and Git configuration are not read or changed. Nothing is
        contacted or granted access.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!result ? (
        <>
          <Field
            label="Typed development label"
            value={label}
            change={setLabel}
            disabled={locked}
          />
          <label>
            Import type
            <select
              aria-label="Typed import type"
              value={mode}
              disabled={locked}
              onChange={(e) => {
                setMode(e.target.value as Mode);
                setValue("");
              }}
            >
              <option value="ssh">SSH key</option>
              <option value="token">GitHub token</option>
              <option value="app">GitHub App</option>
            </select>
          </label>
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
          <p>
            Use an unencrypted Ed25519 PEM/OpenSSH key, dedicated GitHub token, or unencrypted App
            RSA PEM key of at least 2048 bits. Paste only the selected development credential.
          </p>
          <Confirm
            label="This typed credential is dedicated to development, separate from personal and production credentials."
            value={dedicated}
            change={setDedicated}
            disabled={locked}
          />
          <Button
            variant="outline"
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
          <Button variant="outline" onClick={reset} disabled={busy}>
            Clear typed private input
          </Button>
        </>
      ) : (
        <>
          <p>
            {result.plan.label} · {result.plan.kind} · {result.plan.state}
          </p>
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
                variant="outline"
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
                <p>This review expired. Cancel it and prepare a new review.</p>
              ) : null}
            </>
          ) : null}
          <Button
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
          <Button variant="outline" onClick={reset} disabled={busy}>
            Close typed review
          </Button>
        </>
      )}
      {query.waiting ? <p role="status">Loading typed reviews…</p> : null}
      {query._tag === "Failure" ? (
        <p role="alert">Could not load typed reviews. Refresh and retry.</p>
      ) : null}
      <Button variant="outline" onClick={refresh} disabled={busy || !connected}>
        Refresh typed reviews
      </Button>
      {page?.items.length === 0 ? <p>No typed reviews on this page.</p> : null}
      {page?.items.map((entry) => (
        <div key={entry.plan.id}>
          <p>
            {entry.plan.label} · {entry.plan.kind} · {entry.plan.state}
          </p>
          <Button
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
      <Button variant="outline" onClick={() => setCursor(null)} disabled={busy || !cursor}>
        First typed reviews
      </Button>
      <Button
        variant="outline"
        onClick={() => setCursor(page?.nextCursor ?? null)}
        disabled={busy || !page?.nextCursor}
      >
        More typed reviews
      </Button>
    </div>
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
    <label>
      {label}
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
    </label>
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
    <label>
      <input
        aria-label={label}
        type="checkbox"
        checked={value}
        onChange={(e) => change(e.target.checked)}
        disabled={disabled}
      />
      {label}
    </label>
  );
}
