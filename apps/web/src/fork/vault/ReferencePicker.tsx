import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultReference, VaultItemKind } from "@t3tools/contracts/fork";
import { createVaultReferenceAtoms, VAULT_KIND_LABELS } from "@t3tools/client-runtime/fork";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { LoomSettingsActions, LoomSettingsField, LoomSettingsNotice } from "../settings/parts";
const references = createVaultReferenceAtoms(connectionAtomRuntime);
export function VaultReferencePicker({
  environmentId,
  kind = null,
  onSelect,
  disabled = false,
}: {
  environmentId: EnvironmentId;
  kind?: VaultItemKind | null;
  onSelect?: (reference: VaultReference) => void;
  disabled?: boolean;
}) {
  const field = useId();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [cursor, setCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const atom = references.search({
      environmentId,
      input: { query: search, kind, includeArchived: archived, cursor },
    }),
    result = useAtomValue(atom),
    page = Option.getOrNull(AsyncResult.value(result));
  const error = result._tag === "Failure" ? Cause.squash(result.cause) : null;
  const copy = useCopyToClipboard({
    target: "Vault reference",
    onError: () => setNotice("The reference could not be copied. Try again."),
  });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form
        className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
          setCursor(null);
          setNotice(null);
        }}
      >
        <LoomSettingsField label={<label htmlFor={field}>Search Vault references</label>}>
          <Input
            id={field}
            value={query}
            maxLength={100}
            disabled={disabled}
            placeholder="Name or item ID"
            onChange={(event) => setQuery(event.target.value)}
          />
        </LoomSettingsField>
        <LoomSettingsActions>
          <Button type="submit" variant="outline" disabled={disabled || result.waiting}>
            Search
          </Button>
        </LoomSettingsActions>
      </form>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={archived}
          disabled={disabled}
          onCheckedChange={(checked) => {
            setArchived(checked === true);
            setCursor(null);
          }}
        />
        Include archived references
      </label>
      {result.waiting ? (
        <LoomSettingsNotice role="status">Searching references…</LoomSettingsNotice>
      ) : null}
      {result._tag === "Failure" ? (
        <LoomSettingsNotice role="alert">
          <div className="flex flex-col gap-3">
            <p>{error instanceof Error ? error.message : "Vault search failed."}</p>
            <LoomSettingsActions>
              <Button variant="outline" onClick={() => appAtomRegistry.refresh(atom)}>
                Retry search
              </Button>
            </LoomSettingsActions>
          </div>
        </LoomSettingsNotice>
      ) : null}
      {page && !page.items.length && !result.waiting ? (
        <LoomSettingsNotice>
          {page.nextCursor
            ? "No matches on this page. Continue searching or narrow the name."
            : "No matching Vault references."}
        </LoomSettingsNotice>
      ) : null}
      <ul className="flex min-w-0 flex-col gap-3">
        {page?.items.map((reference) => (
          <li
            key={reference.item.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
          >
            <div className="min-w-0 space-y-1">
              <p className="wrap-anywhere text-sm font-medium">{reference.item.label}</p>
              <p className="text-xs text-muted-foreground">
                {VAULT_KIND_LABELS[reference.item.kind]} · Version {reference.item.version}
                {reference.item.state === "archived" ? " · Archived" : ""}
              </p>
            </div>
            <LoomSettingsActions>
              {onSelect ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    disabled ||
                    result.waiting ||
                    result._tag === "Failure" ||
                    reference.item.state !== "active"
                  }
                  aria-label={`Use reference ${reference.item.label}`}
                  onClick={() => onSelect(reference)}
                >
                  Use reference
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || result.waiting || result._tag === "Failure"}
                  onClick={async () => {
                    await copy.copyToClipboard(reference.reference, undefined);
                  }}
                >
                  Copy reference
                </Button>
              )}
            </LoomSettingsActions>
          </li>
        ))}
      </ul>
      {copy.isCopied ? (
        <LoomSettingsNotice role="status">
          Reference copied. It contains no credential value.
        </LoomSettingsNotice>
      ) : null}
      {notice ? <LoomSettingsNotice role="alert">{notice}</LoomSettingsNotice> : null}
      <LoomSettingsActions>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || result.waiting || cursor === null}
          onClick={() => setCursor(null)}
        >
          First references
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || result.waiting || !page?.nextCursor}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More references
        </Button>
      </LoomSettingsActions>
    </div>
  );
}
export function VaultBoundReference({
  environmentId,
  id,
}: {
  environmentId: EnvironmentId;
  id: string;
}) {
  const result = useAtomValue(references.describe({ environmentId, input: { id } }));
  const item = Option.getOrNull(AsyncResult.value(result));
  return (
    <span className="wrap-anywhere">
      {result._tag === "Failure"
        ? "Reference unavailable; refresh to retry"
        : item
          ? `${item.item.label}${item.item.state === "archived" ? " (archived)" : ""}`
          : result.waiting
            ? "Loading selected key…"
            : "Unavailable reference"}
    </span>
  );
}
