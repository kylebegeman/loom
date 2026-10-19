import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";
import { createVaultGitHubAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { makeVaultGitHubSave, type VaultGitHubDraft } from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
const atoms = createVaultGitHubAtoms(connectionAtomRuntime),
  id = () => randomUUID().replaceAll("-", "");
const message = (e: unknown) =>
  e instanceof Error ? e.message : "The GitHub operation failed. Refresh and try again.";
export function VaultGitHubSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs(),
    canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope),
    canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-github",
    )
  )
    return <p>Choose a computer with Vault GitHub connector support.</p>;
  if (!canRead) return <p>Your connection does not include Vault inspection.</p>;
  return (
    <Manager
      key={`${environment.environmentId}:${canWrite}`}
      environmentId={environment.environmentId}
      canWrite={canWrite}
    />
  );
}
function Manager({ environmentId, canWrite }: { environmentId: EnvironmentId; canWrite: boolean }) {
  const [cursor, setCursor] = useState<string | null>(null),
    [draft, setDraft] = useState<VaultGitHubDraft | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const atom = atoms.list({ environmentId, input: { cursor } }),
    result = useAtomValue(atom),
    page = Option.getOrNull(AsyncResult.value(result));
  const locked = busy || !canWrite || result.waiting || result._tag === "Failure";
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const edit = (info?: VaultGitHubInfo) => {
    setError(null);
    setNotice(null);
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
    <div className="flex flex-col gap-4">
      <p>
        Dedicated GitHub identities for Loom agents. Use an App installation for short-lived tokens,
        or a dedicated fine-grained token. Personal GitHub logins and SSH agents stay separate.
      </p>
      <p className="text-sm">
        Connections are limited to named github.com repositories and still need an exact use grant
        for the active run. API testing does not prove Git HTTPS or GH CLI availability. This
        connector supplies only the documented mediated GH operations.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => appAtomRegistry.refresh(atom)}
        >
          Refresh GitHub connections
        </Button>
        <Button size="sm" disabled={locked || !!draft} onClick={() => edit()}>
          Connect GitHub
        </Button>
      </div>
      {result.waiting ? <p role="status">Loading GitHub connections…</p> : null}
      {error || result._tag === "Failure" ? (
        <p role="alert">{error ?? "Could not load connections. Check Vault access and refresh."}</p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {page?.items.length === 0 ? <p>No GitHub connections in this page.</p> : null}
      {draft ? (
        <section
          aria-label="GitHub connection editor"
          className="flex flex-col gap-3 rounded-md border p-4"
        >
          <label>
            Connection label
            <Input
              aria-label="GitHub connection label"
              value={draft.label}
              maxLength={200}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <label>
            Authentication
            <select
              aria-label="GitHub authentication type"
              disabled={locked}
              value={draft.type}
              onChange={(e) =>
                setDraft({ ...draft, type: e.target.value === "app" ? "app" : "token", secret: "" })
              }
            >
              <option value="app">GitHub App installation</option>
              <option value="token">Dedicated token</option>
            </select>
          </label>
          {draft.type === "app" ? (
            <>
              <label>
                App ID
                <Input
                  aria-label="GitHub App ID"
                  value={draft.appId}
                  maxLength={20}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, appId: e.target.value })}
                />
              </label>
              <label>
                Installation ID
                <Input
                  aria-label="GitHub installation ID"
                  value={draft.installationId}
                  maxLength={20}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, installationId: e.target.value })}
                />
              </label>
            </>
          ) : null}
          <label>
            {draft.type === "app"
              ? "App private key (RSA PEM; escaped newlines accepted)"
              : "Dedicated GitHub token"}
            <Input
              aria-label="Private GitHub credential"
              type="password"
              autoComplete="off"
              value={draft.secret}
              maxLength={16384}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
            />
          </label>
          <label>
            Allowed repositories
            <Input
              aria-label="Allowed GitHub repositories"
              placeholder="owner/repo, owner/other"
              value={draft.repositories}
              maxLength={4500}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, repositories: e.target.value })}
            />
          </label>
          <p className="text-sm">
            Loom checks the identity and API access to every listed repository before saving. App
            keys and tokens are stored in OpenBao. Replacing credentials uses a new item version;
            existing operations may already have authenticated.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={locked}
              onClick={() =>
                void act(async () => {
                  const input = makeVaultGitHubSave(draft, id());
                  if (!input)
                    throw new Error(
                      "Enter a label, valid credential fields and 1 to 32 owner/repository names.",
                    );
                  await runVault(atoms.save, { environmentId, input });
                  setDraft(null);
                  setNotice(
                    "GitHub identity and repository API access verified. Connection saved.",
                  );
                })
              }
            >
              Test and save GitHub connection
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>
              Cancel GitHub connection
            </Button>
          </div>
        </section>
      ) : null}
      {page?.items.map((info) => (
        <Connection
          key={`${info.item.id}:${info.item.version}`}
          info={info}
          disabled={locked || !!draft}
          onEdit={() => edit(info)}
          onTest={(repository) =>
            void act(async () => {
              const checked = await runVault(atoms.test, {
                environmentId,
                input: { id: info.item.id, expectedVersion: info.item.version, repository },
              });
              setNotice(
                `API access verified for ${checked.account} at ${checked.repository}.${checked.tokenExpiresAt ? " Loom attempts to release short-lived installation tokens after use." : " Token expiration is managed on GitHub."}`,
              );
            })
          }
          onChange={(action) =>
            void act(async () => {
              await runVault(atoms.change, {
                environmentId,
                input: {
                  id: info.item.id,
                  operationId: id(),
                  expectedVersion: info.item.version,
                  action,
                },
              });
              setNotice(
                action === "archive"
                  ? "Disconnected locally. Revoke the App installation or token on GitHub separately; issued tokens may still work."
                  : action === "restore"
                    ? "Connection restored locally. Test its current provider permissions before use."
                    : "Connection deleted locally. OpenBao version history may remain.",
              );
            })
          }
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !cursor}
          onClick={() => setCursor(null)}
        >
          First GitHub connections
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !page?.nextCursor}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More GitHub connections
        </Button>
      </div>
    </div>
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
  onChange: (action: "archive" | "restore" | "delete") => void;
}) {
  const [repo, setRepo] = useState(info.repositories[0]!),
    [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="break-words font-medium">
        {info.item.label} · {info.item.state}
      </p>
      <p>
        {info.account} · {info.mechanism === "app" ? "App installation" : "Dedicated token"} ·
        Version {info.item.version}
      </p>
      <p className="break-all text-sm">Connection {info.item.id}</p>
      <label>
        Repository
        <select
          aria-label={`Test repository for ${info.item.label}`}
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        >
          {info.repositories.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <p className="break-all text-sm">Use-grant destination: https://github.com/{repo}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || info.item.state !== "active"}
          onClick={() => onTest(repo)}
        >
          Test GitHub API access
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || info.item.state !== "active"}
          aria-label={`Replace credentials for ${info.item.label}`}
          onClick={onEdit}
        >
          Replace credentials
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={`${info.item.state === "archived" ? "Restore" : "Disconnect"} ${info.item.label}`}
          onClick={() => (info.item.state === "archived" ? onChange("restore") : setConfirm(true))}
        >
          {info.item.state === "archived" ? "Restore" : "Disconnect"}
        </Button>
      </div>
      {confirm ? (
        <>
          <p>Disconnect this connection locally? Provider-side revocation is separate.</p>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              setConfirm(false);
              onChange("archive");
            }}
          >
            Confirm local disconnect
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setConfirm(false)}>
            Keep connected
          </Button>
        </>
      ) : null}
    </div>
  );
}
