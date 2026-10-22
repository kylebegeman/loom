import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";
import { createVaultGitHubAtoms } from "@t3tools/client-runtime/fork";
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
  LoomSettingsField,
  LoomSettingsNotice,
  LoomSettingsPanel,
} from "../settings/parts";
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
    <div className="flex min-w-0 flex-col gap-4">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Choose a dedicated GitHub connection and an allowed repository. Manage connections in Vault
        GitHub connections.
      </p>
      <LoomSettingsActions>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label="Refresh available GitHub connections"
          onClick={() => appAtomRegistry.refresh(atom)}
        >
          Refresh connections
        </Button>
      </LoomSettingsActions>
      {result.waiting ? (
        <LoomSettingsNotice role="status">Loading GitHub connections…</LoomSettingsNotice>
      ) : null}
      {result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          Could not load GitHub connections. Check Vault access and refresh.
        </LoomSettingsNotice>
      ) : null}
      {page?.items.length === 0 ? (
        <LoomSettingsNotice>
          No GitHub connections on this page. Continue if more pages are available.
        </LoomSettingsNotice>
      ) : null}
      {page?.items.map((info) => (
        <Choice
          key={`${info.item.id}:${info.item.version}`}
          info={info}
          disabled={disabled || result.waiting || result._tag === "Failure"}
          onSelect={onSelect}
        />
      ))}
      <LoomSettingsActions>
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
      </LoomSettingsActions>
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
    <LoomSettingsPanel>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h4 className="wrap-anywhere text-sm font-medium">{info.item.label}</h4>
          <p className="wrap-anywhere text-sm text-muted-foreground">{info.account}</p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">{info.item.state}</span>
      </div>
      <LoomSettingsField label="Allowed repository">
        <Select
          value={repository}
          disabled={disabled || info.item.state !== "active"}
          onValueChange={(value) => {
            if (value !== null) setRepository(value);
          }}
        >
          <SelectTrigger aria-label={`Allowed repository for ${info.item.label}`}>
            <SelectValue>{repository || "Choose a repository"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {info.repositories.map((repo) => (
              <SelectItem key={repo} value={repo}>
                {repo}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LoomSettingsField>
      <p className="wrap-anywhere text-sm text-muted-foreground">https://github.com/{repository}</p>
      <LoomSettingsActions>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Bind GitHub connection ${info.item.label}`}
          disabled={disabled || info.item.state !== "active"}
          onClick={() => onSelect(info.item.id, repository)}
        >
          Bind connection
        </Button>
      </LoomSettingsActions>
    </LoomSettingsPanel>
  );
}
