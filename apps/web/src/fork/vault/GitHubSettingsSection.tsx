import {
  LoomSettingsActions,
  LoomSettingsNotice,
  LoomSettingsDetails,
  LoomSettingsPanel,
} from "../settings/parts";
import { VaultQueryFeedback } from "./SettingsFeedback";
import { useId, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";
import {
  createVaultGitHubAtoms,
  createVaultAccessAtoms,
  makeVaultGitHubSave,
  supportsLoomFeature,
  type VaultGitHubDraft,
} from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { GitHubProjectAccess } from "./GitHubProjectAccess";
import { GitHubReadiness } from "./GitHubReadiness";
import { runVault } from "./state";

const atoms = createVaultGitHubAtoms(connectionAtomRuntime);
const access = createVaultAccessAtoms(connectionAtomRuntime);
const id = () => randomUUID().replaceAll("-", "");
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The GitHub operation failed. Refresh and try again.";
async function perform(work: () => Promise<void>) {
  try {
    await work();
    return null;
  } catch (error) {
    return message(error);
  }
}

export function VaultGitHubSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-github",
    )
  )
    return (
      <LoomSettingsNotice>
        Choose a computer with Vault GitHub connection support.
      </LoomSettingsNotice>
    );
  if (!canRead)
    return (
      <LoomSettingsNotice>Your connection does not include Vault inspection.</LoomSettingsNotice>
    );
  return (
    <GitHubManager
      key={`${environment.environmentId}:${canWrite}`}
      environmentId={environment.environmentId}
      canWrite={canWrite}
      supportsOwner={supportsLoomFeature(
        configs.get(environment.environmentId)?.environment.capabilities,
        "vault-owner-trusted",
      )}
    />
  );
}

function GitHubManager({
  environmentId,
  canWrite,
  supportsOwner,
}: {
  environmentId: EnvironmentId;
  canWrite: boolean;
  supportsOwner: boolean;
}) {
  return supportsOwner ? (
    <PolicyAwareManager environmentId={environmentId} canWrite={canWrite} />
  ) : (
    <Manager environmentId={environmentId} canWrite={canWrite} ownerTrusted={false} />
  );
}
function PolicyAwareManager({
  environmentId,
  canWrite,
}: {
  environmentId: EnvironmentId;
  canWrite: boolean;
}) {
  const result = useAtomValue(access.snapshot({ environmentId, input: {} }));
  const ownerTrusted =
    result._tag === "Success" &&
    !result.waiting &&
    result.value.ownerPolicy?.mode === "owner-trusted";
  return <Manager environmentId={environmentId} canWrite={canWrite} ownerTrusted={ownerTrusted} />;
}
function Manager({
  environmentId,
  canWrite,
  ownerTrusted,
}: {
  environmentId: EnvironmentId;
  canWrite: boolean;
  ownerTrusted: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState<VaultGitHubDraft | null>(null);
  const [saved, setSaved] = useState<VaultGitHubInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const atom = atoms.list({ environmentId, input: { cursor } });
  const result = useAtomValue(atom);
  const saveAllowed = useAtomValue(atoms.save.permissionAtom(environmentId));
  const changeAllowed = useAtomValue(atoms.change.permissionAtom(environmentId));
  const testAllowed = useAtomValue(atoms.test.permissionAtom(environmentId));
  const page = result._tag === "Failure" ? null : Option.getOrNull(AsyncResult.value(result));
  const items =
    saved && page && !page.items.some((info) => info.item.id === saved.item.id)
      ? [saved, ...page.items]
      : (page?.items ?? []);
  const locked = busy || !canWrite || result.waiting || !page;
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setError(await perform(work));
    setBusy(false);
  };
  const edit = (info?: VaultGitHubInfo) => {
    setError(null);
    setNotice(null);
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
  const save = () => {
    if (!draft || locked || !saveAllowed) return;
    const input = makeVaultGitHubSave(draft, id());
    if (!input) {
      setError(
        "Enter a connection name, credential and 1 to 32 GitHub repository URLs or owner/repository names.",
      );
      return;
    }
    void act(async () => {
      const connection = await runVault(atoms.save, { environmentId, input });
      setSaved(connection);
      setDraft(null);
      setCursor(null);
      setNotice(
        ownerTrusted
          ? "Connection saved. Agents in this personal environment can use its repositories."
          : "Connection saved. Choose project access below.",
      );
    });
  };
  const connection = (info: VaultGitHubInfo) => (
    <Connection
      key={`${info.item.id}:${info.item.version}`}
      info={info}
      ownerTrusted={ownerTrusted}
      environmentId={environmentId}
      disabled={locked || (draft !== null && draft.id !== info.item.id)}
      canEdit={saveAllowed}
      canChange={changeAllowed}
      canTest={testAllowed}
      initiallyConfigure={saved?.item.id === info.item.id}
      editor={
        draft?.id === info.item.id ? (
          <ConnectionEditor
            draft={draft}
            disabled={locked || !saveAllowed}
            busy={busy}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setDraft(null)}
          />
        ) : null
      }
      onEdit={() => edit(info)}
      onTest={(repository) =>
        void act(async () => {
          await runVault(atoms.test, {
            environmentId,
            input: { id: info.item.id, expectedVersion: info.item.version, repository },
          });
          setNotice(
            ownerTrusted
              ? `GitHub API access verified for ${repository}. Check an active agent thread to verify terminal readiness.`
              : `GitHub API access verified for ${repository}. Project access and terminal readiness are checked separately.`,
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
          if (saved?.item.id === info.item.id) setSaved(null);
          setDraft(null);
          setNotice(
            action === "archive"
              ? "Disconnected in Loom. Revoke the token or App installation on GitHub to stop credentials already issued."
              : action === "restore"
                ? ownerTrusted
                  ? "Connection restored. Test its GitHub permissions before use."
                  : "Connection restored. Review its project access and test its GitHub permissions."
                : "Connection deleted from Loom. Vault version history may remain.",
          );
        })
      }
    />
  );
  const archived = items.filter((info) => info.item.state === "archived");
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          {ownerTrusted
            ? "Connect GitHub once. Agents in this personal environment can use the repositories on your saved connections."
            : "Save a GitHub connection, then choose which projects can use each repository."}
        </p>
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={busy}
            onClick={() => appAtomRegistry.refresh(atom)}
          >
            Refresh
          </Button>
          <Button
            size="sm-multiline"
            disabled={locked || !saveAllowed || draft !== null}
            onClick={() => edit()}
          >
            Connect GitHub
          </Button>
        </LoomSettingsActions>
      </div>
      {!canWrite ? (
        <p className="text-sm">Project access is read-only on this connection.</p>
      ) : null}
      <VaultQueryFeedback
        result={result}
        loading="Loading GitHub connections…"
        error={
          result._tag === "Failure"
            ? "Could not load connections. Check Vault access, then refresh."
            : null
        }
        onRetry={() => appAtomRegistry.refresh(atom)}
      />
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {notice ? <LoomSettingsNotice role="status">{notice}</LoomSettingsNotice> : null}
      {draft?.expectedVersion === 0 ? (
        <LoomSettingsPanel title="Connect GitHub">
          <ConnectionEditor
            draft={draft}
            disabled={locked || !saveAllowed}
            busy={busy}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setDraft(null)}
          />
        </LoomSettingsPanel>
      ) : null}
      {page && items.length === 0 && !draft && !result.waiting ? (
        <p className="text-sm text-muted-foreground">
          {cursor
            ? "No connections on this page. Return to the first page."
            : ownerTrusted
              ? "No GitHub connections yet. Connect GitHub to give your agents repository access."
              : "No GitHub connections yet. Connect GitHub to start choosing project access."}
        </p>
      ) : null}
      {items.filter((info) => info.item.state === "active").map(connection)}
      {archived.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Disconnected connections ({archived.length})
          </summary>
          <div className="mt-3 flex flex-col gap-4">{archived.map(connection)}</div>
        </details>
      ) : null}
      {cursor || page?.nextCursor ? (
        <LoomSettingsActions>
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={busy || !cursor}
            onClick={() => setCursor(null)}
          >
            First page
          </Button>
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={busy || !page?.nextCursor}
            onClick={() => setCursor(page?.nextCursor ?? null)}
          >
            More connections
          </Button>
        </LoomSettingsActions>
      ) : null}
    </div>
  );
}

function ConnectionEditor({
  draft,
  disabled,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: VaultGitHubDraft;
  disabled: boolean;
  busy: boolean;
  onChange: (draft: VaultGitHubDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const field = useId();
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      {draft.type === "token" ? (
        <div className="flex max-w-prose flex-col gap-2 text-sm">
          <p>
            <a
              className="text-primary underline underline-offset-4"
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              Create a fine-grained GitHub token
            </a>{" "}
            with the repository owner and repositories you want to use.
          </p>
          <p>
            Under Repository permissions, set <strong>Contents</strong> and{" "}
            <strong>Pull requests</strong> to read and write; <strong>Actions</strong> and{" "}
            <strong>Commit statuses</strong> to read-only. Metadata is included automatically.
          </p>
          <p className="text-muted-foreground">
            Choosing “All repositories” only chooses repositories. You must still add the permission
            entries above. An organization may also need to approve the token.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Use the App’s RSA private key and installation details. Its installation must include the
          repositories below.
        </p>
      )}
      <label htmlFor={`${field}-secret`} className="flex min-w-0 flex-col gap-1 text-sm">
        {draft.type === "token" ? "Fine-grained token" : "App private key (RSA PEM)"}
        <Input
          id={`${field}-secret`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft.secret}
          maxLength={16384}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, secret: event.target.value })}
        />
      </label>
      <label htmlFor={`${field}-repos`} className="flex min-w-0 flex-col gap-1 text-sm">
        Repositories this connection may use
        <Input
          id={`${field}-repos`}
          aria-describedby={`${field}-repos-help`}
          placeholder="owner/repository, owner/another-repository"
          autoCapitalize="none"
          spellCheck={false}
          value={draft.repositories}
          maxLength={4500}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, repositories: event.target.value })}
        />
      </label>
      <p id={`${field}-repos-help`} className="text-sm text-muted-foreground">
        Paste GitHub repository URLs or owner/repository names, separated by commas or newlines.
        Loom verifies up to 32 repositories before saving. Project access is chosen next.
      </p>
      <details>
        <summary className="cursor-pointer text-sm">Advanced connection settings</summary>
        <div className="mt-3 flex min-w-0 flex-col gap-3">
          <label htmlFor={`${field}-name`} className="flex flex-col gap-1 text-sm">
            Connection name
            <Input
              id={`${field}-name`}
              value={draft.label}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, label: event.target.value })}
            />
          </label>
          <label htmlFor={`${field}-authentication`} className="flex flex-col gap-1 text-sm">
            Authentication
            <Select
              value={draft.type}
              disabled={disabled}
              onValueChange={(value) => {
                if (value === "app" || value === "token")
                  onChange({ ...draft, type: value, secret: "" });
              }}
            >
              <SelectTrigger id={`${field}-authentication`}>
                <SelectValue>
                  {draft.type === "app" ? "GitHub App installation" : "Fine-grained token"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="token">Fine-grained token</SelectItem>
                <SelectItem value="app">GitHub App installation</SelectItem>
              </SelectPopup>
            </Select>
          </label>
          {draft.type === "app" ? (
            <>
              <label htmlFor={`${field}-app`} className="flex flex-col gap-1 text-sm">
                App ID
                <Input
                  id={`${field}-app`}
                  value={draft.appId}
                  maxLength={20}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...draft, appId: event.target.value })}
                />
              </label>
              <label htmlFor={`${field}-installation`} className="flex flex-col gap-1 text-sm">
                Installation ID
                <Input
                  id={`${field}-installation`}
                  value={draft.installationId}
                  maxLength={20}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...draft, installationId: event.target.value })}
                />
              </label>
            </>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Credentials are stored in Vault. Replacing a credential does not revoke copies already
            issued by GitHub.
          </p>
        </div>
      </details>
      <LoomSettingsActions>
        <Button type="submit" size="sm-multiline" disabled={disabled}>
          {busy ? "Verifying and saving…" : "Verify and save connection"}
        </Button>
        <Button size="sm-multiline" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </LoomSettingsActions>
    </form>
  );
}

function Connection({
  environmentId,
  info,
  disabled,
  canEdit,
  canChange,
  canTest,
  initiallyConfigure,
  ownerTrusted,
  editor,
  onEdit,
  onTest,
  onChange,
}: {
  environmentId: EnvironmentId;
  info: VaultGitHubInfo;
  disabled: boolean;
  canEdit: boolean;
  canChange: boolean;
  canTest: boolean;
  initiallyConfigure: boolean;
  ownerTrusted: boolean;
  editor: ReactNode;
  onEdit: () => void;
  onTest: (repo: string) => void;
  onChange: (action: "archive" | "restore" | "delete") => void;
}) {
  const field = useId();
  const [repo, setRepo] = useState(info.repositories[0] ?? "");
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const active = info.item.state === "active";
  return (
    <LoomSettingsPanel title={info.item.label}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="wrap-anywhere font-medium">{info.item.label}</h3>
          <p className="wrap-anywhere text-sm text-muted-foreground">
            {info.account} · {info.mechanism === "app" ? "GitHub App" : "Fine-grained token"}
          </p>
        </div>
        <span className="text-sm">{active ? "Connection saved" : "Disconnected"}</span>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-muted-foreground">Repositories on this connection</p>
        <ul className="flex flex-col gap-1">
          {info.repositories.map((repository) => (
            <li key={repository} className="wrap-anywhere">
              {repository}
            </li>
          ))}
        </ul>
      </div>
      {ownerTrusted ? (
        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Owner access allows agents in this environment to use these repositories. GitHub's
            permissions still apply.
          </p>
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={disabled || !canEdit || !active}
              onClick={onEdit}
            >
              Edit connection
            </Button>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={disabled || !canTest || !active || !repo}
              onClick={() => onTest(repo)}
            >
              Test connection
            </Button>
          </LoomSettingsActions>
          {editor}
          <LoomSettingsDetails title="Saved restricted access">
            <GitHubProjectAccess
              environmentId={environmentId}
              connection={info}
              disabled={disabled || !!editor}
              initiallyOpen={false}
            />
          </LoomSettingsDetails>
        </div>
      ) : (
        <GitHubProjectAccess
          environmentId={environmentId}
          connection={info}
          disabled={disabled || !!editor}
          initiallyOpen={initiallyConfigure}
        />
      )}
      <LoomSettingsDetails title="Connection details and maintenance">
        <div className="flex min-w-0 flex-col gap-4">
          <section
            className="flex flex-col gap-3"
            aria-label={`Credentials for ${info.item.label}`}
          >
            <h4 className="text-sm font-medium">Credentials</h4>
            {ownerTrusted && editor
              ? null
              : (editor ?? (
                  <div>
                    <Button
                      size="sm-multiline"
                      variant="outline"
                      disabled={disabled || !canEdit || !active}
                      onClick={onEdit}
                    >
                      Edit connection
                    </Button>
                  </div>
                ))}
          </section>
          <details>
            <summary className="cursor-pointer text-sm">
              Connection checks and terminal readiness
            </summary>
            <div className="mt-3 flex min-w-0 flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {ownerTrusted
                  ? "Saving verifies GitHub API access. Check an active agent thread to verify its terminal access."
                  : "Saving verifies GitHub API access. Project authorization and a thread's terminal access are separate checks."}
              </p>
              <label
                htmlFor={`${field}-repository`}
                className="flex min-w-0 flex-col gap-1 text-sm"
              >
                Repository to check
                <Select
                  value={repo}
                  disabled={disabled}
                  onValueChange={(value) => {
                    if (value) setRepo(value);
                  }}
                >
                  <SelectTrigger id={`${field}-repository`}>
                    <SelectValue>{repo || "Choose a repository"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {info.repositories.map((repository) => (
                      <SelectItem key={repository} value={repository}>
                        {repository}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
              <div>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={disabled || !canTest || !active || !repo}
                  onClick={() => onTest(repo)}
                >
                  Test repository API access
                </Button>
              </div>
              <GitHubReadiness
                environmentId={environmentId}
                info={info}
                repository={repo}
                disabled={disabled}
                ownerMode={ownerTrusted}
              />
            </div>
          </details>
          <section
            aria-label={`Connection lifecycle for ${info.item.label}`}
            className="flex flex-col gap-2"
          >
            <p className="text-sm text-muted-foreground">
              Disconnecting stops new use in Loom. Revoke the token or installation on GitHub to
              stop credentials already issued.
            </p>
            {confirm ? (
              <>
                <p className="text-sm">
                  {confirm === "delete"
                    ? "Delete this disconnected connection from Loom? Vault version history may remain."
                    : "Disconnect this GitHub connection in Loom?"}
                </p>
                <LoomSettingsActions>
                  <Button
                    size="sm-multiline"
                    variant="destructive-outline"
                    disabled={disabled || !canChange}
                    onClick={() => {
                      onChange(confirm);
                      setConfirm(null);
                    }}
                  >
                    {confirm === "delete" ? "Delete connection" : "Disconnect connection"}
                  </Button>
                  <Button
                    size="sm-multiline"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setConfirm(null)}
                  >
                    Cancel
                  </Button>
                </LoomSettingsActions>
              </>
            ) : (
              <LoomSettingsActions>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={disabled || !canChange}
                  onClick={() => (active ? setConfirm("archive") : onChange("restore"))}
                >
                  {active ? "Disconnect connection" : "Restore connection"}
                </Button>
                {!active ? (
                  <Button
                    size="sm-multiline"
                    variant="destructive-outline"
                    disabled={disabled || !canChange}
                    onClick={() => setConfirm("delete")}
                  >
                    Delete connection
                  </Button>
                ) : null}
              </LoomSettingsActions>
            )}
          </section>
        </div>
      </LoomSettingsDetails>
    </LoomSettingsPanel>
  );
}
