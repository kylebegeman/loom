import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";
import { createVaultGitHubAtoms } from "@t3tools/client-runtime/fork";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { connectionAtomRuntime } from "~/connection/runtime";
const atoms = createVaultGitHubAtoms(connectionAtomRuntime);
export function VaultGitHubConnectionPicker({
  environmentId,
  disabled,
  onSelect,
}: {
  environmentId: EnvironmentId;
  disabled: boolean;
  onSelect: (itemId: string, repository: string) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const atom = atoms.list({ environmentId, input: { cursor } }),
    result = useAtomValue(atom),
    page = Option.getOrNull(AsyncResult.value(result));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        Choose a dedicated GitHub connection and an allowed repository. Manage connections in Vault
        GitHub connections.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-label="Refresh available GitHub connections"
        onClick={() => appAtomRegistry.refresh(atom)}
      >
        Refresh connections
      </Button>
      {result.waiting ? <p role="status">Loading GitHub connections…</p> : null}
      {result._tag === "Failure" ? (
        <p role="alert">Could not load GitHub connections. Check Vault access and refresh.</p>
      ) : null}
      {page?.items.length === 0 ? (
        <p>No GitHub connections in this page. Continue if more pages are available.</p>
      ) : null}
      {page?.items.map((info) => (
        <Choice
          key={`${info.item.id}:${info.item.version}`}
          info={info}
          disabled={disabled || result.waiting || result._tag === "Failure"}
          onSelect={onSelect}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !cursor}
          aria-label="First available GitHub connections"
          onClick={() => setCursor(null)}
        >
          First connections
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !page?.nextCursor}
          aria-label="More available GitHub connections"
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More connections
        </Button>
      </div>
    </div>
  );
}
function Choice({
  info,
  disabled,
  onSelect,
}: {
  info: VaultGitHubInfo;
  disabled: boolean;
  onSelect: (id: string, repo: string) => void;
}) {
  const [repository, setRepository] = useState(info.repositories[0]!);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="break-words">
        {info.item.label} · {info.account} · {info.item.state}
      </p>
      <select
        className="min-w-0 max-w-full"
        aria-label={`Allowed repository for ${info.item.label}`}
        value={repository}
        disabled={disabled || info.item.state !== "active"}
        onChange={(e) => setRepository(e.target.value)}
      >
        {info.repositories.map((repo) => (
          <option key={repo} value={repo}>
            {repo}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        aria-label={`Bind GitHub connection ${info.item.label}`}
        disabled={disabled || info.item.state !== "active"}
        onClick={() => onSelect(info.item.id, repository)}
      >
        Bind connection
      </Button>
    </div>
  );
}
