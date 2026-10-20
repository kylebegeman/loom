import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, type EnvironmentId } from "@t3tools/contracts";
import type { VaultMigrationResult } from "@t3tools/contracts/fork";
import { createVaultMigrationAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import * as Redacted from "effect/Redacted";
import { Button } from "~/components/ui/button";
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
  return <Imports key={environment.environmentId} environmentId={environment.environmentId} />;
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
    <div className="flex flex-col gap-4">
      <p>
        Use a dedicated development identity. For SSH, create a fresh key in Vault. For GitHub,
        connect a dedicated App or token under Vault GitHub connections.
      </p>
      <p>
        This form imports one development secret or secure note into a new record. It does not read
        1Password, exports or local credential files, change repository settings, grant workload
        access or verify a provider login.
      </p>
      <p>Selected computer: {environmentId}</p>
      {error ? <p role="alert">{error}</p> : null}
      {!result ? (
        <form
          className="flex flex-col gap-3 rounded-md border p-3"
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
          <label>
            Development item label
            <Input
              aria-label="Development import label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={200}
              disabled={locked}
            />
          </label>
          <label>
            Record type
            <select
              aria-label="Development import kind"
              value={kind}
              disabled={locked}
              onChange={(e) => setKind(e.target.value === "secure-note" ? "secure-note" : "secret")}
            >
              <option value="secret">Development secret</option>
              <option value="secure-note">Development secure note</option>
            </select>
          </label>
          <label>
            Private value
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
          </label>
          <label>
            <input
              type="checkbox"
              checked={dedicated}
              disabled={locked}
              onChange={(e) => setDedicated(e.target.checked)}
            />{" "}
            This credential is dedicated to development and is not shared with my personal accounts.
          </label>
          <Button type="submit" disabled={locked || !dedicated || !label.trim() || !value}>
            Review development import
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={reset}>
            Clear private input
          </Button>
        </form>
      ) : (
        <section
          aria-label="Development import review"
          className="flex flex-col gap-3 rounded-md border p-3"
        >
          <p className="font-medium">
            {result.plan.label} · {result.plan.kind} · {result.plan.state}
          </p>
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
                <label>
                  Reenter the same private value to retry this review
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
                </label>
              ) : (
                <p>Private value is held only for this review and is hidden here.</p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={locked}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed this new development record and selected computer.
              </label>
              {result.plan.state === "prepared" && now >= result.plan.expiresAt ? (
                <p role="status">This review expired. Cancel it and prepare a new review.</p>
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
          <div className="flex flex-wrap gap-2">
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
          </div>
          {result.plan.state === "imported" ? (
            <p>
              The record is stored. Configure and verify its dedicated adapter before any repository
              cutover. Archiving preserves encrypted history; restore through Vault management.
            </p>
          ) : null}
        </section>
      )}
      {busy ? <p role="status">Updating import review…</p> : null}
      <h3 className="font-medium">Recent import reviews</h3>
      <Button
        size="sm"
        variant="outline"
        onClick={() => appAtomRegistry.refresh(listAtom)}
        disabled={busy}
      >
        Refresh import reviews
      </Button>
      {list.waiting ? <p role="status">Loading import reviews…</p> : null}
      {list._tag === "Failure" ? (
        <p role="alert">Could not load import reviews. Check Vault access and refresh.</p>
      ) : null}
      {page?.items.length === 0 ? <p>No import reviews on this page.</p> : null}
      {page?.items.map((entry) => (
        <div key={entry.plan.id} className="flex flex-wrap items-center gap-2">
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
      <div className="flex flex-wrap gap-2">
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
      </div>
    </div>
  );
}
