import {
  LoomSettingsActions,
  LoomSettingsNotice,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
import { TypedImports } from "./TypedImports";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import type { VaultMigrationResult } from "@t3tools/contracts/fork";
import { createVaultMigrationAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import * as Redacted from "effect/Redacted";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "~/components/ui/select";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault } from "./state";
import { useVaultTime } from "./useVaultTime";
const atoms = createVaultMigrationAtoms(connectionAtomRuntime);
const newId = () => randomUUID().replaceAll("-", "");
export function VaultMigrationSettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-migration-imports",
    )
  )
    return <p>Development import reviews need a newer Vault server.</p>;
  if (!canRead) return <p>Your connection does not include Vault inspection.</p>;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Imports key={environment.environmentId} environmentId={environment.environmentId} />
      {supportsLoomFeature(
        configs.get(environment.environmentId)?.environment.capabilities,
        "vault-migration-typed-imports",
      ) ? (
        <LoomSettingsPanel title="SSH and GitHub imports">
          <TypedImports
            key={`typed:${environment.environmentId}`}
            environmentId={environment.environmentId}
          />
        </LoomSettingsPanel>
      ) : null}
    </div>
  );
}
function Imports({ environmentId }: { environmentId: EnvironmentId }) {
  const [enteringValue, setEnteringValue] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null),
    [id, setId] = useState(newId),
    [label, setLabel] = useState(""),
    [kind, setKind] = useState<"secret" | "secure-note">("secret"),
    [value, setValue] = useState(""),
    [dedicated, setDedicated] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [result, setResult] = useState<VaultMigrationResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const listAtom = atoms.list({ environmentId, input: { cursor } }),
    list = useAtomValue(listAtom);
  const page = list._tag === "Success" && !list.waiting ? list.value : null;
  const canWrite = useAtomValue(atoms.prepare.permissionAtom(environmentId));
  const now = useVaultTime([result?.plan.expiresAt ?? null]);
  const pending = result && ["prepared", "applying"].includes(result.plan.state);
  const locked = busy || !canWrite;
  const act = async (work: () => Promise<VaultMigrationResult>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      setResult(next);
      if (!["prepared", "applying"].includes(next.plan.state)) setValue("");
      appAtomRegistry.refresh(listAtom);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Import failed. Refresh its status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setResult(null);
    setEnteringValue(false);
    setId(newId());
    setLabel("");
    setValue("");
    setDedicated(false);
    setReviewed(false);
    setError(null);
  };
  return (
    <div className="flex min-w-0 flex-col gap-6 text-sm leading-relaxed wrap-anywhere">
      <p>
        Use a dedicated development identity. For SSH, create a fresh key in Vault. For GitHub,
        connect a dedicated App or token under Vault GitHub connections.
      </p>
      <LoomSettingsDetails title="What this import changes">
        <p>
          This form imports one development secret or secure note into a new record. It does not
          read 1Password, exports or local credential files, change repository settings, grant
          workload access or verify a provider login.
        </p>
      </LoomSettingsDetails>
      <LoomSettingsNotice>Selected computer: {environmentId}</LoomSettingsNotice>
      {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
      {!result ? (
        <LoomSettingsPanel title="Import a development secret or note">
          <form
            className="flex min-w-0 flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (locked || !dedicated || !label.trim() || !value) return;
              void act(() =>
                runVault(atoms.prepare, {
                  environmentId,
                  input: {
                    id,
                    label: label.trim(),
                    kind,
                    developmentOnly: true,
                    value: Redacted.make(value),
                  },
                }),
              );
            }}
          >
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <LoomSettingsField label="Development item label">
                <Input
                  aria-label="Development import label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={200}
                  disabled={locked}
                />
              </LoomSettingsField>
              <LoomSettingsField label="Record type">
                <Select
                  value={kind}
                  disabled={locked}
                  onValueChange={(nextValue) => {
                    if (nextValue !== null) {
                      setKind(nextValue === "secure-note" ? "secure-note" : "secret");
                    }
                  }}
                >
                  <SelectTrigger aria-label="Development import kind">
                    <SelectValue>
                      {kind === "secure-note" ? "Development secure note" : "Development secret"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="secret">Development secret</SelectItem>
                    <SelectItem value="secure-note">Development secure note</SelectItem>
                  </SelectPopup>
                </Select>
              </LoomSettingsField>
            </div>
            <LoomSettingsField label="Private value">
              {kind === "secret" ? (
                <Input
                  type="password"
                  aria-label="Development import value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  maxLength={65536}
                  autoComplete="off"
                  disabled={locked}
                />
              ) : (
                <Textarea
                  aria-label="Development import value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  maxLength={65536}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={locked}
                />
              )}
            </LoomSettingsField>
            <label className="flex items-start gap-2 text-sm leading-6">
              <input
                className="mt-1 shrink-0"
                type="checkbox"
                checked={dedicated}
                disabled={locked}
                onChange={(e) => setDedicated(e.target.checked)}
              />{" "}
              This credential is dedicated to development and is not shared with my personal
              accounts.
            </label>
            <LoomSettingsActions>
              <Button type="submit" disabled={locked || !dedicated || !label.trim() || !value}>
                Review development import
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={reset}>
                Clear private input
              </Button>
            </LoomSettingsActions>
          </form>
        </LoomSettingsPanel>
      ) : (
        <section
          aria-label="Development import review"
          className="flex min-w-0 flex-col gap-5 rounded-lg border border-border/60 p-3 sm:p-4"
        >
          <div className="space-y-1">
            <h3 className="font-medium">{result.plan.label}</h3>
            <p className="text-muted-foreground">
              {result.plan.kind} · {result.plan.state}
            </p>
          </div>
          <p>
            New Vault record: {result.plan.itemId}. Existing records, personal stores and project
            configuration are preserved.
          </p>
          <p>Review expires {new Date(result.plan.expiresAt).toLocaleString()}.</p>
          {result.item ? (
            <p>
              Stored record version {result.item.version} · {result.item.state}
            </p>
          ) : null}
          {pending ? (
            <>
              {enteringValue ? (
                <LoomSettingsField label="Reenter the same private value to retry this review">
                  {result.plan.kind === "secret" ? (
                    <Input
                      type="password"
                      aria-label="Development import value"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      maxLength={65536}
                      autoComplete="off"
                      disabled={locked}
                    />
                  ) : (
                    <Textarea
                      aria-label="Development import value"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      maxLength={65536}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={locked}
                    />
                  )}
                </LoomSettingsField>
              ) : (
                <p>Private value is held only for this review and is hidden here.</p>
              )}
              <label className="flex items-start gap-2 text-sm leading-6">
                <input
                  className="mt-1 shrink-0"
                  type="checkbox"
                  checked={reviewed}
                  disabled={locked}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed this new development record and selected computer.
              </label>
              {result.plan.state === "prepared" && now >= result.plan.expiresAt ? (
                <LoomSettingsNotice role="status">
                  This review expired. Cancel it and prepare a new review.
                </LoomSettingsNotice>
              ) : null}
              <Button
                disabled={
                  locked ||
                  !reviewed ||
                  !value ||
                  (result.plan.state === "prepared" && now >= result.plan.expiresAt)
                }
                onClick={() =>
                  void act(() =>
                    runVault(atoms.apply, {
                      environmentId,
                      input: { id: result.plan.id, reviewed: true, value: Redacted.make(value) },
                    }),
                  )
                }
              >
                {result.plan.state === "applying"
                  ? "Retry accepted import"
                  : "Import reviewed development record"}
              </Button>
            </>
          ) : null}
          <LoomSettingsActions>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  runVault(atoms.inspect, { environmentId, input: { id: result.plan.id } }),
                )
              }
            >
              Refresh import status
            </Button>
            {["prepared", "expired"].includes(result.plan.state) ? (
              <Button
                variant="outline"
                disabled={locked}
                onClick={() =>
                  void act(() =>
                    runVault(atoms.cancel, { environmentId, input: { id: result.plan.id } }),
                  )
                }
              >
                Cancel review
              </Button>
            ) : null}
            {result.canArchive ? (
              <Button
                variant="outline"
                disabled={locked}
                onClick={() =>
                  void act(() =>
                    runVault(atoms.archive, { environmentId, input: { id: result.plan.id } }),
                  )
                }
              >
                Archive unchanged imported record
              </Button>
            ) : null}
            {!pending ? (
              <Button variant="outline" disabled={busy} onClick={reset}>
                Start another review
              </Button>
            ) : null}
          </LoomSettingsActions>
          {result.plan.state === "imported" ? (
            <p>
              The record is stored. Configure and verify its dedicated adapter before any repository
              cutover. Archiving preserves encrypted history; restore through Vault management.
            </p>
          ) : null}
        </section>
      )}
      {busy ? <LoomSettingsNotice role="status">Updating import review…</LoomSettingsNotice> : null}
      <LoomSettingsPanel title="Recent import reviews">
        <LoomSettingsActions>
          <Button
            size="sm"
            variant="outline"
            onClick={() => appAtomRegistry.refresh(listAtom)}
            disabled={busy}
          >
            Refresh import reviews
          </Button>
        </LoomSettingsActions>
        {list.waiting ? (
          <LoomSettingsNotice role="status">Loading import reviews…</LoomSettingsNotice>
        ) : null}
        {list._tag === "Failure" ? (
          <LoomSettingsNotice role="alert">
            Could not load import reviews. Check Vault access and refresh.
          </LoomSettingsNotice>
        ) : null}
        {page?.items.length === 0 ? <p>No import reviews on this page.</p> : null}
        {page?.items.map((entry) => (
          <div
            key={entry.plan.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3 last:border-0"
          >
            <span>
              {entry.plan.label} · {entry.plan.state}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setValue("");
                setEnteringValue(true);
                setReviewed(false);
                void act(() =>
                  runVault(atoms.inspect, { environmentId, input: { id: entry.plan.id } }),
                );
              }}
            >
              Open import review
            </Button>
          </div>
        ))}
        <LoomSettingsActions>
          <Button
            size="sm"
            variant="outline"
            disabled={!cursor || list.waiting || busy}
            onClick={() => setCursor(null)}
          >
            First import reviews
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!page?.nextCursor || list.waiting || busy}
            onClick={() => setCursor(page?.nextCursor ?? null)}
          >
            More import reviews
          </Button>
        </LoomSettingsActions>
      </LoomSettingsPanel>
    </div>
  );
}
