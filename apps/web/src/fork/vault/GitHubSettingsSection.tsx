import { useId, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";
import {
  createVaultGitHubAtoms,
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
    return <p>Choose a computer with Vault GitHub connection support.</p>;
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
      setNotice("Connection saved. Choose project access below.");
    });
  };
  const connection = (info: VaultGitHubInfo) => (
    <Connection
      key={`${info.item.id}:${info.item.version}`}
      info={info}
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
            `GitHub API access verified for ${repository}. Project access and terminal readiness are checked separately.`,
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
                ? "Connection restored. Review its project access and test its GitHub permissions."
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
          Save a GitHub connection, then choose which projects can use each repository.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => appAtomRegistry.refresh(atom)}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            disabled={locked || !saveAllowed || draft !== null}
            onClick={() => edit()}
          >
            Connect GitHub
          </Button>
        </div>
      </div>
      {!canWrite ? (
        <p className="text-sm">Project access is read-only on this connection.</p>
      ) : null}
      {result.waiting ? (
        <p role="status" className="text-sm">
          Loading GitHub connections…
        </p>
      ) : null}
      {error || result._tag === "Failure" ? (
        <p role="alert" className="text-sm">
          {error ?? "Could not load connections. Check Vault access, then refresh."}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {draft?.expectedVersion === 0 ? (
        <section aria-label="Connect GitHub" className="flex flex-col gap-4 rounded-lg border p-4">
          <h3 className="font-medium">Connect GitHub</h3>
          <ConnectionEditor
            draft={draft}
            disabled={locked || !saveAllowed}
            busy={busy}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setDraft(null)}
          />
        </section>
      ) : null}
      {page && items.length === 0 && !draft && !result.waiting ? (
        <p className="text-sm text-muted-foreground">
          {cursor
            ? "No connections on this page. Return to the first page."
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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !cursor}
            onClick={() => setCursor(null)}
          >
            First page
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !page?.nextCursor}
            onClick={() => setCursor(page?.nextCursor ?? null)}
          >
            More connections
          </Button>
        </div>
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
                <SelectValue />
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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={disabled}>
          {busy ? "Verifying and saving…" : "Verify and save connection"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
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
    <section
      aria-label={`GitHub connection ${info.item.label}`}
      className="flex min-w-0 flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words font-medium">{info.item.label}</h3>
          <p className="break-words text-sm text-muted-foreground">
            {info.account} · {info.mechanism === "app" ? "GitHub App" : "Fine-grained token"}
          </p>
        </div>
        <span className="text-sm">{active ? "Connection saved" : "Disconnected"}</span>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-muted-foreground">Repositories on this connection</p>
        <ul className="flex flex-col gap-1">
          {info.repositories.map((repository) => (
            <li key={repository} className="break-words">
              {repository}
            </li>
          ))}
        </ul>
      </div>
      <GitHubProjectAccess
        environmentId={environmentId}
        connection={info}
        disabled={disabled || !!editor}
        initiallyOpen={initiallyConfigure}
      />
      <details>
        <summary className="cursor-pointer text-sm">Advanced</summary>
        <div className="mt-4 flex min-w-0 flex-col gap-4">
          <section
            className="flex flex-col gap-3"
            aria-label={`Credentials for ${info.item.label}`}
          >
            <h4 className="text-sm font-medium">Credentials</h4>
            {editor ?? (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || !canEdit || !active}
                  onClick={onEdit}
                >
                  Edit connection
                </Button>
              </div>
            )}
          </section>
          <details>
            <summary className="cursor-pointer text-sm">
              Connection checks and terminal readiness
            </summary>
            <div className="mt-3 flex min-w-0 flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Saving verifies GitHub API access. Project authorization and a thread’s terminal
                access are separate checks.
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
                    <SelectValue />
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
                  size="sm"
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
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
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setConfirm(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || !canChange}
                  onClick={() => (active ? setConfirm("archive") : onChange("restore"))}
                >
                  {active ? "Disconnect connection" : "Restore connection"}
                </Button>
                {!active ? (
                  <Button
                    size="sm"
                    variant="destructive-outline"
                    disabled={disabled || !canChange}
                    onClick={() => setConfirm("delete")}
                  >
                    Delete connection
                  </Button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </details>
    </section>
  );
}
