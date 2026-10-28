import { openVaultAdd } from "./add-navigation";
import { VaultEditor } from "./VaultEditor";
import { vaultProfileTarget } from "./profile-navigation";
import { readVaultFile } from "./file-draft";
import {
  LoomSettingsActions,
  LoomSettingsNotice,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import { VaultFold } from "./VaultFold";
import { VaultQueryFeedback } from "./SettingsFeedback";
import { Checkbox } from "~/components/ui/checkbox";
import { VaultOwnerSettings } from "./OwnerSettingsSection";
import { VaultSshDialog } from "./SshDialog";
import { openVaultAccess } from "./access-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { forkSettingsTarget } from "../settings/navigation";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import {
  VaultFileContent,
  type VaultItemKind,
  type VaultItemSummary,
  type VaultItemPage,
  type VaultError,
  VAULT_ITEM_SEARCH_FEATURE,
  vaultReferenceText,
} from "@t3tools/contracts/fork";
import {
  loomFeaturesOf,
  vaultStatusMessage,
  VAULT_KIND_LABELS,
  VAULT_REVEAL_DURATION_MS,
  vaultItemActions,
  vaultItemChanges,
  VAULT_SEARCH_DEBOUNCE_MS,
} from "@t3tools/client-runtime/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Atom, AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { vault, runVault } from "./state";

const EMPTY_PAGE = Atom.make(AsyncResult.initial<VaultItemPage, VaultError>(false));
const EMPTY_ARCHIVE_PAGE = Atom.make(
  AsyncResult.initial<
    { items: ReadonlyArray<VaultItemSummary>; nextCursor: string | null; total: number },
    VaultError
  >(false),
);
const newId = () => randomUUID().replaceAll("-", "");
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(VaultFileContent));
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The Vault operation failed. Try again.";
const failure = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  result._tag === "Failure" ? message(Cause.squash(result.cause)) : null;

export function VaultSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  const profileTarget = useAtomValue(vaultProfileTarget);
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  const canWrite = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessWriteScope);
  if (
    !environment ||
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "vault-core",
    )
  ) {
    return <LoomSettingsNotice>Vault is unavailable on this server.</LoomSettingsNotice>;
  }
  if (!canRead)
    return (
      <LoomSettingsNotice>
        Your access to this environment does not include Vault inspection.
      </LoomSettingsNotice>
    );
  return (
    <div className="flex flex-col gap-5">
      <VaultOwnerSettings
        key={environment.environmentId}
        environmentId={environment.environmentId}
      />
      <VaultItems
        key={`${environment.environmentId}:${canWrite}`}
        environmentId={environment.environmentId}
        collapsible={
          loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
            "vault-owner-trusted",
          ) &&
          !loomFeaturesOf(
            configs.get(environment.environmentId)?.environment.capabilities,
          ).includes(VAULT_ITEM_SEARCH_FEATURE)
        }
        focusSearch={
          profileTarget?.section === "references" &&
          (!profileTarget.environmentId ||
            profileTarget.environmentId === environment.environmentId)
        }
      />
    </div>
  );
}
function VaultItems({
  environmentId,
  collapsible,
  focusSearch,
}: {
  environmentId: EnvironmentId;
  collapsible: boolean;
  focusSearch: boolean;
}) {
  const configs = useServerConfigs();
  const sshEnabled = loomFeaturesOf(configs.get(environmentId)?.environment.capabilities).includes(
    "vault-ssh-management",
  );
  const githubEnabled = loomFeaturesOf(
    configs.get(environmentId)?.environment.capabilities,
  ).includes("vault-github");
  const [sshItem, setSshItem] = useState<string | null | undefined>(undefined);
  const statusAtom = vault.status({ environmentId, input: {} });
  const statusResult = useAtomValue(statusAtom);
  const status = Option.getOrNull(AsyncResult.value(statusResult));
  const searchEnabled = loomFeaturesOf(
    configs.get(environmentId)?.environment.capabilities,
  ).includes(VAULT_ITEM_SEARCH_FEATURE);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<{
    query: string;
    kind?: VaultItemKind;
    sort: "label" | "updated";
  }>({ query: "", sort: "label" });
  const searchRef = useRef<HTMLInputElement>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveCursors, setArchiveCursors] = useState<ReadonlyArray<string | null>>([null]);
  const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
  const pageAtom = vault.list({
    environmentId,
    input: {
      cursor: cursors[cursors.length - 1] ?? null,
      includeArchived: searchEnabled ? false : includeArchived,
      ...(searchEnabled ? filters : {}),
    },
  });
  const pageResult = useAtomValue(status?.state === "ready" ? pageAtom : EMPTY_PAGE);
  const page = Option.getOrNull(AsyncResult.value(pageResult));
  const archiveAtom =
    searchEnabled && archiveOpen && status?.state === "ready"
      ? vault.archivedPage({
          environmentId,
          input: {
            ...filters,
            includeArchived: true,
            cursor: archiveCursors[archiveCursors.length - 1] ?? null,
          },
        })
      : EMPTY_ARCHIVE_PAGE;
  const archiveResult = useAtomValue(archiveAtom);
  const archivePage = Option.getOrNull(AsyncResult.value(archiveResult));
  const canSave = useAtomValue(vault.save.permissionAtom(environmentId));
  const canChange = useAtomValue(vault.change.permissionAtom(environmentId));
  const canReveal = useAtomValue(vault.reveal.permissionAtom(environmentId));
  const [editing, setEditing] = useState<VaultItemSummary | "new" | null>(null);
  const [fileDraft, setFileDraft] = useState<{ name: string; value: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const closeEditor = () => {
    setEditing(null);
    setFileDraft(null);
  };
  const [deleting, setDeleting] = useState<VaultItemSummary | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const revealGeneration = useRef(0);
  const clearRevealed = useCallback(() => {
    revealGeneration.current++;
    setRevealed(null);
  }, []);
  const [copiedReference, setCopiedReference] = useState<string | null>(null);
  const referenceCopy = useCopyToClipboard<string>({
    onCopy: setCopiedReference,
    target: "Vault reference",
    onError: () => setError("The reference could not be copied. Try again."),
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "Vault value",
    onError: () => setError("The value could not be copied. Try again."),
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears revealed values and invalidates pending reveals when the window leaves the foreground
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) clearRevealed();
    };
    window.addEventListener("blur", clearRevealed);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      revealGeneration.current++;
      window.removeEventListener("blur", clearRevealed);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [clearRevealed]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- limits each revealed value's lifetime with a timer that is cleared on replacement and unmount
  useEffect(() => {
    if (revealed === null) return;
    const timer = window.setTimeout(clearRevealed, VAULT_REVEAL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [revealed, clearRevealed]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces the server-side metadata query and resets its cursors when the search changes
  useEffect(() => {
    if (!searchEnabled || query.trim() === filters.query) return;
    const timer = window.setTimeout(() => {
      setFilters((previous) => ({ ...previous, query: query.trim() }));
      setCursors([null]);
      setArchiveCursors([null]);
      clearRevealed();
    }, VAULT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, filters.query, searchEnabled, clearRevealed]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the search field for a palette navigation request after the settings page mounts
  useEffect(() => {
    if (!focusSearch || !searchEnabled) return;
    searchRef.current?.focus();
    appAtomRegistry.set(vaultProfileTarget, null);
  }, [focusSearch, searchEnabled]);
  const refresh = () => {
    clearRevealed();
    setCursors([null]);
    setArchiveCursors([null]);
    const changed = vaultItemChanges(environmentId);
    appAtomRegistry.set(changed, appAtomRegistry.get(changed) + 1);
    appAtomRegistry.refresh(statusAtom);
    appAtomRegistry.refresh(pageAtom);
  };
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    }
    setBusy(false);
  };
  const change = (item: VaultItemSummary, action: "archive" | "restore" | "delete") =>
    act(async () => {
      await runVault(vault.change, {
        environmentId,
        input: { id: item.id, operationId: newId(), expectedVersion: item.version, action },
      });
      setDeleting(null);
      refresh();
    });
  const reveal = (item: VaultItemSummary) =>
    act(async () => {
      if (revealed?.id === item.id) {
        setRevealed(null);
        return;
      }
      const generation = ++revealGeneration.current;
      const result = await runVault(vault.reveal, {
        environmentId,
        input: { id: item.id, expectedVersion: item.version },
      });
      if (generation !== revealGeneration.current || document.hidden) return;
      const value = Redacted.value(result.value);
      if (item.kind === "secure-file") {
        const decoded = decodeFile(value);
        if (Option.isNone(decoded))
          throw new Error("This record does not contain a supported file.");
        const data = Uint8Array.from(atob(decoded.value.base64), (character) =>
          character.charCodeAt(0),
        );
        const url = URL.createObjectURL(
          new Blob([data], { type: decoded.value.mediaType || "application/octet-stream" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = decoded.value.name;
        anchor.click();
        URL.revokeObjectURL(url);
      } else setRevealed({ id: item.id, value });
    });
  const renderItems = (items: ReadonlyArray<VaultItemSummary>) => (
    <div className="flex flex-col divide-y divide-border/60">
      {items.map((item) => (
        <div key={item.id} className="flex min-w-0 flex-col gap-4 py-4 first:pt-0 last:pb-0">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">
                {VAULT_KIND_LABELS[item.kind]} · Version {item.version}
                {item.state === "archived" ? " · Archived" : ""}
              </p>
            </div>
            <LoomSettingsActions>
              {searchEnabled ? (
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    referenceCopy.copyToClipboard(
                      vaultReferenceText(environmentId, item.id),
                      item.id,
                    )
                  }
                >
                  {referenceCopy.isCopied && copiedReference === item.id
                    ? "Reference copied"
                    : "Copy reference"}
                </Button>
              ) : null}
              {item.state === "archived" ? (
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={!canChange || busy}
                  onClick={() => void change(item, "restore")}
                >
                  Restore
                </Button>
              ) : null}
              {sshEnabled && item.kind === "ssh-key" ? (
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRevealed(null);
                    setSshItem(item.id);
                  }}
                >
                  Manage SSH key
                </Button>
              ) : null}
              {githubEnabled && item.kind === "service-connection" ? (
                <Link
                  {...forkSettingsTarget("vault-github")}
                  search={{
                    machine: environmentId,
                    project: undefined,
                    checkout: undefined,
                  }}
                  hashScrollIntoView={false}
                  className="text-primary underline underline-offset-4"
                >
                  GitHub for agents
                </Link>
              ) : null}
              {vaultItemActions(item.kind).revealValue ? (
                <Button
                  size="sm-multiline"
                  variant="ghost"
                  disabled={!canReveal || busy}
                  onClick={() => void reveal(item)}
                >
                  {item.kind === "secure-file"
                    ? "Download"
                    : revealed?.id === item.id
                      ? "Hide value"
                      : "Reveal value"}
                </Button>
              ) : null}
              {item.state === "active" && (
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={!canSave || busy}
                  onClick={() => {
                    setRevealed(null);
                    setEditing(item);
                  }}
                >
                  Edit
                </Button>
              )}
            </LoomSettingsActions>
            <LoomSettingsDetails title="Item details and maintenance">
              <dl className="grid min-w-0 gap-3 text-sm grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                <div className="min-w-0 space-y-1">
                  <dt className="text-xs text-muted-foreground">Item ID</dt>
                  <dd className="wrap-anywhere">{item.id}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">Version</dt>
                  <dd>{item.version}</dd>
                </div>
              </dl>
              <LoomSettingsActions>
                <Button
                  size="sm-multiline"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setRevealed(null);
                    openVaultAccess({ environmentId, itemId: item.id });
                  }}
                >
                  Why this access?
                </Button>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={!canChange || busy}
                  onClick={() => void change(item, item.state === "active" ? "archive" : "restore")}
                >
                  {item.state === "active" ? "Archive" : "Restore"}
                </Button>
              </LoomSettingsActions>
              <p className="max-w-prose text-sm text-muted-foreground">
                Deleting removes the current value after confirmation. Encrypted history follows the
                backend retention policy.
              </p>
              <LoomSettingsActions>
                <Button
                  size="sm-multiline"
                  variant="destructive-outline"
                  disabled={!canChange || busy}
                  onClick={() => setDeleting(item)}
                >
                  Delete
                </Button>
              </LoomSettingsActions>
            </LoomSettingsDetails>
          </div>
          {revealed?.id === item.id && (
            <div className="flex min-w-0 flex-col gap-2">
              <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-sm">
                {revealed.value}
              </pre>
              <LoomSettingsActions>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(revealed.value, undefined)}
                >
                  {isCopied ? "Copied" : "Copy value"}
                </Button>
              </LoomSettingsActions>
            </div>
          )}
        </div>
      ))}
    </div>
  );
  const records = (
    <LoomSettingsPanel
      title="Vault items"
      description="Store and manage development access for this environment."
    >
      <LoomSettingsActions>
        {sshEnabled ? (
          <Button
            size="sm-multiline"
            variant="outline"
            disabled={!canSave || busy || status?.state !== "ready"}
            onClick={() => setSshItem(null)}
          >
            Create SSH key
          </Button>
        ) : null}
        <Button
          size="sm-multiline"
          disabled={!canSave || status?.state !== "ready" || busy}
          onClick={() => openVaultAdd({ environmentId })}
        >
          Add item
        </Button>
        <Button
          size="sm-multiline"
          variant="ghost"
          disabled={busy || statusResult.waiting}
          onClick={refresh}
        >
          Refresh records
        </Button>
      </LoomSettingsActions>
      <VaultQueryFeedback
        result={statusResult}
        loading="Checking Vault connection…"
        error={failure(statusResult)}
        onRetry={refresh}
      />
      {status && statusResult._tag !== "Failure" && !statusResult.waiting ? (
        <LoomSettingsNotice role="status">{vaultStatusMessage(status)}</LoomSettingsNotice>
      ) : null}
      {error && <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>}
      {status?.state === "ready" && (
        <>
          {searchEnabled ? (
            <div className="flex min-w-0 flex-col gap-3">
              <LoomSettingsField
                label={<label htmlFor="loom-vault-item-search">Search Vault items</label>}
              >
                <Input
                  ref={searchRef}
                  id="loom-vault-item-search"
                  value={query}
                  maxLength={100}
                  placeholder="Name, kind, item ID or reference"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </LoomSettingsField>
              <LoomSettingsActions>
                {[undefined, ...(Object.keys(VAULT_KIND_LABELS) as VaultItemKind[])].map((kind) => (
                  <Button
                    key={kind ?? "all"}
                    size="sm-multiline"
                    variant={filters.kind === kind ? "secondary" : "outline"}
                    aria-pressed={filters.kind === kind}
                    onClick={() => {
                      setFilters(({ kind: _kind, ...previous }) =>
                        kind ? { ...previous, kind } : previous,
                      );
                      setCursors([null]);
                      setArchiveCursors([null]);
                      clearRevealed();
                    }}
                  >
                    {kind ? VAULT_KIND_LABELS[kind] : "All kinds"}
                  </Button>
                ))}
              </LoomSettingsActions>
              <LoomSettingsField label="Sort items">
                <Select
                  value={filters.sort}
                  onValueChange={(sort) => {
                    if (sort !== "label" && sort !== "updated") return;
                    setFilters((previous) => ({ ...previous, sort }));
                    setCursors([null]);
                    setArchiveCursors([null]);
                    clearRevealed();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="label">Name</SelectItem>
                    <SelectItem value="updated">Recently updated</SelectItem>
                  </SelectPopup>
                </Select>
              </LoomSettingsField>
            </div>
          ) : (
            <label className="flex items-start gap-2 text-sm leading-6">
              <Checkbox
                checked={includeArchived}
                onCheckedChange={(checked) => {
                  setIncludeArchived(checked);
                  setCursors([null]);
                  setRevealed(null);
                }}
              />
              Include archived items
            </label>
          )}
          <VaultQueryFeedback
            result={pageResult}
            loading="Loading Vault items…"
            error={failure(pageResult)}
            onRetry={() => appAtomRegistry.refresh(pageAtom)}
          />
          {page ? (
            <>
              {page.items.length === 0 && (
                <LoomSettingsNotice>
                  {searchEnabled && (filters.query || filters.kind)
                    ? "No matching Vault items. Try a different name or kind."
                    : "No development records yet. Add an item or create a dedicated SSH key to get started."}
                </LoomSettingsNotice>
              )}
              {renderItems(page.items)}
              <LoomSettingsActions>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={cursors.length <= 1 || busy}
                  onClick={() => {
                    setCursors((previous) => previous.slice(0, -1));
                    setRevealed(null);
                  }}
                >
                  Previous
                </Button>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={!page.nextCursor || busy}
                  onClick={() => {
                    setCursors((previous) => [...previous, page.nextCursor]);
                    setRevealed(null);
                  }}
                >
                  Next page
                </Button>
              </LoomSettingsActions>
            </>
          ) : null}
        </>
      )}
      {searchEnabled && status?.state === "ready" ? (
        <VaultFold
          title={`Archived (${page?.archivedCount ?? 0})`}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
        >
          <VaultQueryFeedback
            result={archiveResult}
            loading="Loading archived items…"
            error={failure(archiveResult)}
            onRetry={refresh}
          />
          {archivePage ? (
            <>
              {archivePage.items.length === 0 && !archiveResult.waiting ? (
                <LoomSettingsNotice>
                  {archivePage.nextCursor
                    ? "No archived matches in these pages. Continue to find more."
                    : "No matching archived items."}
                </LoomSettingsNotice>
              ) : null}
              {renderItems(archivePage.items)}
              <LoomSettingsActions>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={archiveCursors.length <= 1 || busy}
                  onClick={() => setArchiveCursors((previous) => previous.slice(0, -1))}
                >
                  Previous archived items
                </Button>
                <Button
                  size="sm-multiline"
                  variant="outline"
                  disabled={!archivePage.nextCursor || busy}
                  onClick={() =>
                    setArchiveCursors((previous) => [...previous, archivePage.nextCursor])
                  }
                >
                  More archived items
                </Button>
              </LoomSettingsActions>
            </>
          ) : null}
        </VaultFold>
      ) : null}
    </LoomSettingsPanel>
  );
  return (
    <div className="flex min-w-0 flex-col gap-6 text-sm leading-relaxed wrap-anywhere">
      <div
        className="rounded-lg border border-dashed border-border/70 px-4 py-3 text-muted-foreground"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!canSave || busy || editing !== null || status?.state !== "ready") return;
          const files = event.dataTransfer.files;
          if (files.length !== 1) {
            setError("Drop one file at a time.");
            return;
          }
          const file = files[0];
          if (!file) return;
          void act(async () => {
            const draft = await readVaultFile(file);
            setFileDraft(draft);
            setEditing("new");
            setExpanded(true);
          });
        }}
      >
        Drop a file here to add it to Vault, or choose Add item. Files stay on this device until you
        save.
      </div>
      {collapsible ? (
        <VaultFold
          title="Vault records and advanced controls"
          open={
            expanded ||
            error !== null ||
            editing !== null ||
            (cursors.length === 1 && page?.items.length === 0)
          }
          onOpenChange={setExpanded}
        >
          {records}
        </VaultFold>
      ) : (
        records
      )}
      {sshItem !== undefined ? (
        <VaultSshDialog
          key={`${environmentId}:${sshItem ?? "new"}`}
          environmentId={environmentId}
          itemId={sshItem}
          onClose={() => setSshItem(undefined)}
        />
      ) : null}
      {editing !== null && (
        <VaultEditor
          key={typeof editing === "string" ? editing : editing.id}
          environmentId={environmentId}
          item={editing === "new" ? null : editing}
          initialFile={fileDraft}
          onCreateSsh={
            sshEnabled
              ? () => {
                  closeEditor();
                  setSshItem(null);
                }
              : undefined
          }
          githubEnabled={githubEnabled}
          onClose={closeEditor}
          onSaved={() => {
            closeEditor();
            refresh();
          }}
        />
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.label}?</DialogTitle>
            <DialogDescription>
              The current value will be removed. Encrypted prior versions remain subject to your
              backend’s retention policy.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="px-6 pb-4">
              <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm-multiline"
              variant="destructive"
              disabled={busy || !deleting || !canChange}
              onClick={() => {
                if (deleting) void change(deleting, "delete");
              }}
            >
              {busy ? "Deleting…" : "Delete item"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
