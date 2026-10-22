import { VaultQueryFeedback } from "./SettingsFeedback";
import { GitHubReadiness } from "./GitHubReadiness";
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
  LoomSettingsPanel,
} from "~/fork/settings/parts";
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
    return (
      <LoomSettingsNotice>
        Choose a computer with Vault GitHub connector support.
      </LoomSettingsNotice>
    );
  if (!canRead)
    return (
      <LoomSettingsNotice>Your connection does not include Vault inspection.</LoomSettingsNotice>
    );
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
    }
    setBusy(false);
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
    <div className="flex min-w-0 flex-col gap-5">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Connect a dedicated GitHub identity for Loom agents. Use a GitHub App installation for
        short-lived tokens or a dedicated fine-grained token.
      </p>
      <LoomSettingsActions>
        <Button size="sm-multiline" disabled={locked || !!draft} onClick={() => edit()}>
          Connect GitHub
        </Button>
        <Button
          size="sm-multiline"
          variant="ghost"
          disabled={busy}
          onClick={() => appAtomRegistry.refresh(atom)}
        >
          Refresh GitHub connections
        </Button>
      </LoomSettingsActions>
      {!canWrite ? (
        <LoomSettingsNotice>
          Your connection can inspect GitHub connections but cannot change them.
        </LoomSettingsNotice>
      ) : null}
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Each connection is limited to named github.com repositories. Agents still need an exact use
        grant for the active run. Personal GitHub logins and SSH agents stay separate.
      </p>
      <VaultQueryFeedback
        result={result}
        loading="Loading GitHub connections…"
        error="Could not load connections. Check Vault access and retry."
        onRetry={() => appAtomRegistry.refresh(atom)}
      />
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {notice ? <LoomSettingsNotice role="status">{notice}</LoomSettingsNotice> : null}
      {page?.items.length === 0 ? (
        <LoomSettingsNotice>
          No GitHub connections on this page. Connect an identity to get started.
        </LoomSettingsNotice>
      ) : null}
      {draft ? (
        <LoomSettingsPanel
          title={draft.expectedVersion ? "Replace GitHub credentials" : "New GitHub connection"}
          description="Loom verifies the identity and API access to every allowed repository before saving."
        >
          <p role="status" className="text-sm text-muted-foreground">
            Draft connection. Credentials and repository access are verified when you save.
          </p>
          <fieldset
            disabled={locked}
            className="grid min-w-0 gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]"
          >
            <legend className="sr-only">GitHub connection</legend>
            <LoomSettingsField
              label="Connection label"
              description="A name you will recognize when selecting a connection."
            >
              <Input
                aria-label="GitHub connection label"
                value={draft.label}
                maxLength={200}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </LoomSettingsField>
            <LoomSettingsField label="Authentication">
              <Select
                disabled={locked}
                value={draft.type}
                onValueChange={(value) => {
                  if (value)
                    setDraft({ ...draft, type: value === "app" ? "app" : "token", secret: "" });
                }}
              >
                <SelectTrigger aria-label="GitHub authentication type">
                  <SelectValue>
                    {draft.type === "app" ? "GitHub App installation" : "Dedicated token"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="app">GitHub App installation</SelectItem>
                  <SelectItem value="token">Dedicated token</SelectItem>
                </SelectPopup>
              </Select>
            </LoomSettingsField>
            {draft.type === "app" ? (
              <>
                <LoomSettingsField
                  label="App ID"
                  description="The numeric ID from your GitHub App settings."
                >
                  <Input
                    aria-label="GitHub App ID"
                    value={draft.appId}
                    maxLength={20}
                    disabled={locked}
                    onChange={(e) => setDraft({ ...draft, appId: e.target.value })}
                  />
                </LoomSettingsField>
                <LoomSettingsField
                  label="Installation ID"
                  description="The numeric ID for this App installation."
                >
                  <Input
                    aria-label="GitHub installation ID"
                    value={draft.installationId}
                    maxLength={20}
                    disabled={locked}
                    onChange={(e) => setDraft({ ...draft, installationId: e.target.value })}
                  />
                </LoomSettingsField>
              </>
            ) : null}
          </fieldset>
          <LoomSettingsField
            label={draft.type === "app" ? "App private key" : "Dedicated GitHub token"}
            description={
              draft.type === "app"
                ? "Use an RSA PEM key. Escaped newlines are accepted."
                : "Use a dedicated fine-grained token with access to the repositories below."
            }
          >
            <Input
              aria-label="Private GitHub credential"
              type="password"
              autoComplete="off"
              value={draft.secret}
              maxLength={16384}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
            />
          </LoomSettingsField>
          <LoomSettingsField
            label="Allowed repositories"
            description="Enter 1 to 32 owner/repository names, separated by commas."
          >
            <Input
              aria-label="Allowed GitHub repositories"
              placeholder="owner/repo, owner/other"
              value={draft.repositories}
              maxLength={4500}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, repositories: e.target.value })}
            />
          </LoomSettingsField>
          <LoomSettingsDetails title="Credential storage and replacement">
            <p className="text-sm leading-relaxed text-muted-foreground">
              App keys and tokens are stored in OpenBao. Replacing credentials creates a new item
              version. Existing operations may already have authenticated.
            </p>
          </LoomSettingsDetails>
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
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
              {busy ? "Testing and saving…" : "Test and save GitHub connection"}
            </Button>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel GitHub connection
            </Button>
          </LoomSettingsActions>
        </LoomSettingsPanel>
      ) : null}
      {page && page.items.length > 0 ? (
        <h3 className="text-base font-medium">Saved GitHub connections</h3>
      ) : null}
      {page?.items.map((info) => (
        <Connection
          key={`${info.item.id}:${info.item.version}`}
          info={info}
          environmentId={environmentId}
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
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={busy || !cursor}
          onClick={() => setCursor(null)}
        >
          First GitHub connections
        </Button>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={busy || !page?.nextCursor}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More GitHub connections
        </Button>
      </LoomSettingsActions>
    </div>
  );
}
function Connection({
  environmentId,
  info,
  disabled,
  onEdit,
  onTest,
  onChange,
}: {
  environmentId: EnvironmentId;
  info: VaultGitHubInfo;
  disabled: boolean;
  onEdit: () => void;
  onTest: (repo: string) => void;
  onChange: (action: "archive" | "restore" | "delete") => void;
}) {
  const [repo, setRepo] = useState(info.repositories[0]!),
    [confirm, setConfirm] = useState(false);
  return (
    <LoomSettingsPanel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="wrap-anywhere text-sm font-medium">{info.item.label}</h3>
          <p className="wrap-anywhere text-sm text-muted-foreground">
            {info.account} · {info.mechanism === "app" ? "App installation" : "Dedicated token"}
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">{info.item.state}</span>
      </div>
      <LoomSettingsField
        label="Repository"
        description="Choose an allowed repository to test its access and readiness."
      >
        <Select
          value={repo}
          onValueChange={(value) => {
            if (value) setRepo(value);
          }}
        >
          <SelectTrigger aria-label={`Test repository for ${info.item.label}`}>
            <SelectValue>{repo || "Choose a repository"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {info.repositories.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LoomSettingsField>
      <div className="min-w-0 space-y-1 text-sm">
        <p className="text-muted-foreground">Use-grant destination</p>
        <p className="wrap-anywhere">https://github.com/{repo}</p>
      </div>
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={disabled || info.item.state !== "active"}
          onClick={() => onTest(repo)}
        >
          Test GitHub API access
        </Button>
      </LoomSettingsActions>
      <LoomSettingsDetails title="Connection details and maintenance">
        <dl className="grid min-w-0 gap-3 text-sm grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
          <div className="min-w-0 space-y-1">
            <dt className="text-muted-foreground">Connection ID</dt>
            <dd className="wrap-anywhere">{info.item.id}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">Version</dt>
            <dd>{info.item.version}</dd>
          </div>
        </dl>
        <p className="text-sm leading-relaxed text-muted-foreground">
          API testing does not prove Git HTTPS or GH CLI availability. Use the explicit Vault
          terminal command for supported gh and Git HTTPS operations.
        </p>
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={disabled || info.item.state !== "active"}
            aria-label={`Replace credentials for ${info.item.label}`}
            onClick={onEdit}
          >
            Replace credentials
          </Button>
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={disabled}
            aria-label={`${info.item.state === "archived" ? "Restore" : "Disconnect"} ${info.item.label}`}
            onClick={() =>
              info.item.state === "archived" ? onChange("restore") : setConfirm(true)
            }
          >
            {info.item.state === "archived" ? "Restore" : "Disconnect"}
          </Button>
        </LoomSettingsActions>
      </LoomSettingsDetails>
      <GitHubReadiness
        environmentId={environmentId}
        info={info}
        repository={repo}
        disabled={disabled}
      />
      {confirm ? (
        <LoomSettingsNotice>
          <p>Disconnect this connection locally? Provider-side revocation is separate.</p>
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                setConfirm(false);
                onChange("archive");
              }}
            >
              Confirm local disconnect
            </Button>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={disabled}
              onClick={() => setConfirm(false)}
            >
              Keep connected
            </Button>
          </LoomSettingsActions>
        </LoomSettingsNotice>
      ) : null}
    </LoomSettingsPanel>
  );
}
