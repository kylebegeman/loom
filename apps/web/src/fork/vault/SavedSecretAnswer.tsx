import { useVaultEnvironment } from "./useVaultEnvironment";
import type { VaultItemValue } from "@t3tools/contracts/fork";
import { useRef, useState } from "react";
import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  VAULT_SECRET_FEATURE,
  type VaultItemPage,
  type VaultError,
  type VaultItemSummary,
} from "@t3tools/contracts/fork";
import {
  createVaultSecretAtoms,
  secretRequestAcceptsItem,
  secretRequestSavedMatch,
  supportsLoomFeature,
  VAULT_SEARCH_DEBOUNCE_MS,
  VAULT_KIND_LABELS,
} from "@t3tools/client-runtime/fork";
import type { SecretRequestItem } from "@t3tools/client-runtime/secret-request";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useServerConfigs } from "~/state/entities";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { vault } from "./state";

const secret = createVaultSecretAtoms(connectionAtomRuntime);
const EMPTY = Atom.make(AsyncResult.initial<VaultItemPage, VaultError>(false));
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Could not use this saved item. Refresh and try again.";

export function SavedSecretAnswer({
  environmentId,
  request,
  disabled,
  onBusyChange,
  onAnswered,
}: {
  environmentId: EnvironmentId;
  request: SecretRequestItem;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAnswered: () => void;
}) {
  const configs = useServerConfigs();
  const supported = supportsLoomFeature(
    configs.get(environmentId)?.environment.capabilities,
    VAULT_SECRET_FEATURE,
  );
  const { vaultEnvironmentId, resolved } = useVaultEnvironment(environmentId);
  const sourceAllowed = useAtomValue(secret.answerFromItem.permissionAtom(environmentId));
  const canReveal = useAtomValue(vault.reveal.permissionAtom(vaultEnvironmentId));
  const allowed = sourceAllowed && (vaultEnvironmentId === environmentId || canReveal);
  const reveal = useAtomCommand(vault.reveal, { reportFailure: false, reportDefect: false });
  const status = useEnvironmentQuery(
    supported && allowed && resolved
      ? vault.status({ environmentId: vaultEnvironmentId, input: {} })
      : null,
  );
  const ready = status.data?.state === "ready";
  const answer = useAtomCommand(secret.answerFromItem, {
    reportFailure: false,
    reportDefect: false,
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(request.label.slice(0, 100));
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const search = useDebouncedValue(query.trim(), VAULT_SEARCH_DEBOUNCE_MS);
  const listAtom = ready
    ? vault.list({
        environmentId: vaultEnvironmentId,
        input: { cursor, includeArchived: false, query: search, sort: "label" },
      })
    : EMPTY;
  const result = useAtomValue(listAtom);
  const refresh = useAtomRefresh(listAtom);
  const page = Option.getOrNull(AsyncResult.value(result));
  const items =
    page?.items.filter((item) => secretRequestAcceptsItem(item, request.delivery === "file")) ?? [];
  const exact = secretRequestSavedMatch(items, request.label, request.delivery === "file");
  const answerWithItem = async (item: VaultItemSummary) => {
    if (busy.current || disabled || !allowed) return;
    busy.current = true;
    onBusyChange(true);
    setError(null);
    await (async () => {
      let accountItem: VaultItemValue | undefined;
      if (vaultEnvironmentId !== environmentId) {
        const revealed = await reveal({
          environmentId: vaultEnvironmentId,
          input: { id: item.id, expectedVersion: item.version },
        });
        if (revealed._tag === "Failure") {
          setError(message(squashAtomCommandFailure(revealed)));
          return;
        }
        accountItem = revealed.value;
      }
      const response = await answer({
        environmentId,
        input: {
          threadId: request.threadId,
          turnItemId: request.id,
          itemId: item.id,
          expectedVersion: item.version,
          ...(accountItem ? { accountItem } : {}),
        },
      });
      if (response._tag === "Success") onAnswered();
      else setError(message(squashAtomCommandFailure(response)));
    })()
      .catch((cause: unknown) => setError(message(cause)))
      .finally(() => {
        busy.current = false;
        onBusyChange(false);
      });
  };
  if (!supported) return null;
  if (!allowed)
    return (
      <p className="text-xs text-muted-foreground">
        This sign-in cannot use saved Vault items. Type the value instead.
      </p>
    );
  if (!ready) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">Or use a saved item</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm-multiline"
          className="max-w-full"
          disabled={disabled || !allowed || result.waiting}
          onClick={() => (exact && !open ? void answerWithItem(exact) : setOpen(!open))}
        >
          <span className="min-w-0 wrap-anywhere">
            {exact && !open ? `Use saved item: ${exact.label}` : "Use saved item"}
          </span>
        </Button>
        {exact && !open ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            Choose another
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Input
            aria-label="Find saved item"
            value={query}
            maxLength={100}
            disabled={disabled}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(null);
            }}
          />
          {result.waiting || search !== query.trim() ? (
            <p role="status">Finding saved items…</p>
          ) : null}
          {result._tag === "Failure" ? (
            <p role="alert">{message(Cause.squash(result.cause))}</p>
          ) : null}
          {!result.waiting && result._tag === "Success" && items.length === 0 ? (
            <p>No matching saved item.</p>
          ) : null}
          {items.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="outline"
              size="sm-multiline"
              disabled={disabled || !allowed || search !== query.trim()}
              onClick={() => void answerWithItem(item)}
            >
              <span className="min-w-0 wrap-anywhere">
                {item.label} · {VAULT_KIND_LABELS[item.kind]} · Version {item.version} ·{" "}
                {item.id.slice(0, 8)}
              </span>
            </Button>
          ))}
          {page?.nextCursor ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || result.waiting}
              onClick={() => setCursor(page.nextCursor)}
            >
              More items
            </Button>
          ) : null}
        </div>
      ) : null}
      {error || open ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            refresh();
            setError(null);
          }}
        >
          Refresh saved items
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
