import { OriginalRouteReview } from "./OriginalRouteReview";
import { migrationInventory as atoms } from "./migrationState";
import { ReplacementVerification } from "./ReplacementVerification";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import type {
  VaultMigrationDependency,
  VaultMigrationInventoryPage,
  VaultReplacementResult,
  VaultItemSummary,
} from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useEnvironmentScope } from "~/state/session";
import { useServerConfigs } from "~/state/entities";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { randomUUID } from "~/lib/utils";
import { runVault, vault } from "./state";
import { useVaultTime } from "./useVaultTime";
const newId = () => randomUUID().replaceAll("-", "");
type Choice = { projectId: ProjectId; title: string; dependency: VaultMigrationDependency };
export function VaultMigrationInventorySettingsSection() {
  const { environment } = useSettingsScope(),
    configs = useServerConfigs();
  const canRead = useEnvironmentScope(environment?.environmentId ?? null, AuthAccessReadScope);
  if (
    !environment ||
    !supportsLoomFeature(
      configs.get(environment.environmentId)?.environment.capabilities,
      "vault-migration-inventory",
    )
  )
    return <p>Dependency inventory needs a newer Vault server.</p>;
  if (!canRead) return <p>Your connection does not include credential inspection.</p>;
  return (
    <Inventory
      key={environment.environmentId}
      environmentId={environment.environmentId}
      computer={environment.label}
      recoverySupported={supportsLoomFeature(
        configs.get(environment.environmentId)?.environment.capabilities,
        "vault-migration-recovery-design",
      )}
      previewsSupported={supportsLoomFeature(
        configs.get(environment.environmentId)?.environment.capabilities,
        "vault-migration-previews",
      )}
      verificationSupported={supportsLoomFeature(
        configs.get(environment.environmentId)?.environment.capabilities,
        "vault-migration-verification",
      )}
    />
  );
}
function Inventory({
  environmentId,
  computer,
  verificationSupported,
  previewsSupported,
  recoverySupported,
}: {
  environmentId: EnvironmentId;
  computer: string;
  verificationSupported: boolean;
  previewsSupported: boolean;
  recoverySupported: boolean;
}) {
  const [inventory, setInventory] = useState<VaultMigrationInventoryPage | null>(null),
    [choice, setChoice] = useState<Choice | null>(null),
    [result, setResult] = useState<VaultReplacementResult | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const listAtom = atoms.list({ environmentId, input: { cursor } }),
    list = useAtomValue(listAtom);
  const page = list._tag === "Success" && !list.waiting ? list.value : null;
  const canWrite = useAtomValue(atoms.prepare.permissionAtom(environmentId));
  const now = useVaultTime([result?.plan.expiresAt ?? null]);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update migration planning. Refresh and retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  const planAct = (work: () => Promise<VaultReplacementResult>) =>
    act(async () => {
      const next = await work();
      setResult(next);
      setConfirmed(false);
      appAtomRegistry.refresh(listAtom);
    });
  const inspectInventory = (cursor: ProjectId | null) => {
    setInventory(null);
    setChoice(null);
    void act(async () =>
      setInventory(await runVault(atoms.inventory, { environmentId, input: { cursor } })),
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <p>
        Selected computer: {computer}. Inspect registered projects before replacing development
        access.
      </p>
      <p>
        Only selected local Git configuration is inspected. Personal stores, global configuration,
        included files, SSH aliases, environment overrides, account identity and external consumers
        are not inspected. Endpoints are hints; access has not been verified.
      </p>
      <p>
        Reviewing a plan never changes repository settings or grants access. Verification is
        required before any cutover.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => inspectInventory(null)}>
          Inspect project dependencies
        </Button>
        {inventory?.nextCursor ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => inspectInventory(inventory.nextCursor)}
          >
            Next projects
          </Button>
        ) : null}
      </div>
      {busy ? <p role="status">Updating migration planning…</p> : null}
      {inventory ? (
        <>
          <p>
            Inspected {inventory.projects.length} projects on this page at{" "}
            {new Date(inventory.checkedAt).toLocaleString()}.{" "}
            {inventory.nextCursor
              ? "More projects remain."
              : "End of registered project inventory."}
          </p>
          {inventory.projects.length === 0 ? <p>No registered projects on this page.</p> : null}
          {inventory.projects.map((project) => (
            <section
              key={project.projectId}
              aria-label={`Dependencies for ${project.title}`}
              className="flex flex-col gap-3 rounded-md border p-3"
            >
              <h3 className="font-medium">{project.title}</h3>
              {project.state === "unavailable" ? (
                <p>
                  Local Git metadata is unavailable. The project may be missing, inaccessible or not
                  a Git checkout. Refresh after correcting it.
                </p>
              ) : (
                <>
                  <p>
                    Local SSH command: {project.localSshCommand ? "configured" : "not found"}.
                    Credential helper: {project.localCredentialHelper ? "configured" : "not found"}.
                    URL rewrite:{" "}
                    {project.localUrlRewrite
                      ? "configured; replacement needs separate review"
                      : "not found"}
                    .
                  </p>
                  {project.dependencies.length === 0 ? (
                    <p>
                      No remote URLs in the inspected local configuration. Included and global
                      settings may add others.
                    </p>
                  ) : null}
                  {project.dependencies.map((dep) => (
                    <div
                      key={`${dep.remote}:${dep.direction}:${dep.position}`}
                      className="flex flex-col gap-2"
                    >
                      <p>
                        {dep.remote} · {dep.direction} URL {dep.position + 1} · {dep.transport} ·{" "}
                        {dep.hostname ?? "unrecognized endpoint"}
                        {dep.port ? `:${dep.port}` : ""} ·{" "}
                        {dep.repository ?? "repository path not reported"}
                      </p>
                      {dep.embeddedAuthentication ? (
                        <p>
                          Embedded authentication or URL parameters were omitted. Review them
                          separately before cutover.
                        </p>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          busy ||
                          !canWrite ||
                          project.localUrlRewrite ||
                          dep.transport === "other" ||
                          !dep.repository
                        }
                        onClick={() => {
                          setChoice({
                            projectId: project.projectId,
                            title: project.title,
                            dependency: dep,
                          });
                          setResult(null);
                          setConfirmed(false);
                          setError(null);
                        }}
                      >
                        Plan replacement for {dep.remote} {dep.direction} {dep.position + 1}
                      </Button>
                    </div>
                  ))}
                  {project.omittedDependencies > 0 ? (
                    <p role="status">
                      {project.omittedDependencies} additional or unsupported entries were omitted.
                      This inventory is incomplete.
                    </p>
                  ) : null}
                </>
              )}
            </section>
          ))}
        </>
      ) : null}
      {choice && !result ? (
        <ReplacementDraft
          key={`${choice.projectId}:${choice.dependency.remote}:${choice.dependency.direction}:${choice.dependency.position}`}
          environmentId={environmentId}
          choice={choice}
          locked={busy || !canWrite}
          onCancel={() => setChoice(null)}
          onPrepare={(item, adapter, id) =>
            void planAct(() =>
              runVault(atoms.prepare, {
                environmentId,
                input: {
                  id,
                  projectId: choice.projectId,
                  dependency: choice.dependency,
                  replacement: { adapter, itemId: item.id, expectedVersion: item.version },
                  developmentOnly: true,
                },
              }),
            )
          }
        />
      ) : null}
      {result ? (
        <section
          aria-label="Replacement plan review"
          className="flex flex-col gap-3 rounded-md border p-3"
        >
          <h3 className="font-medium">
            {result.plan.projectTitle} · {result.plan.state}
          </h3>
          <p>
            {result.plan.dependency.remote} · {result.plan.dependency.direction} ·{" "}
            {result.plan.dependency.hostname}/{result.plan.dependency.repository}
          </p>
          {result.plan.dependency.gitPath ? (
            <p>Original Git path: {result.plan.dependency.gitPath}</p>
          ) : null}
          <p>
            Replacement: {result.plan.replacement.label} · version{" "}
            {result.plan.replacement.expectedVersion} · {result.plan.replacement.destination}
          </p>
          <p>
            {result.plan.replacement.scope === "github-api-and-gh-only"
              ? "GitHub API and gh operations only. This does not replace Git SSH or HTTPS transport authentication."
              : "Vault-mediated SSH Git operations. This does not change ordinary terminal Git authentication."}
          </p>
          <p>
            Host trust: {result.plan.replacement.hostTrust}. Source and item check:{" "}
            {result.validation}.
          </p>
          <p>
            Review expires {new Date(result.plan.expiresAt).toLocaleString()}.{" "}
            {now >= result.plan.expiresAt ? "This review expired." : ""}
          </p>
          <p>
            Access verification is required before cutover. Cutover is unavailable in this release.
            Existing grants, profiles and repository settings are preserved.
          </p>
          {result.plan.state === "prepared" ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || !canWrite}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                I reviewed this development replacement, scope and selected computer.
              </label>
              <Button
                disabled={
                  busy ||
                  !canWrite ||
                  !confirmed ||
                  !!error ||
                  result.validation !== "current" ||
                  now >= result.plan.expiresAt
                }
                onClick={() =>
                  void planAct(() =>
                    runVault(atoms.review, {
                      environmentId,
                      input: { id: result.plan.id, reviewed: true },
                    }),
                  )
                }
              >
                Record reviewed replacement plan
              </Button>
            </>
          ) : null}
          {verificationSupported ? (
            <ReplacementVerification
              previewsSupported={previewsSupported}
              key={result.plan.id}
              environmentId={environmentId}
              plan={result.plan}
            />
          ) : (
            <p>Verification needs a newer Vault server.</p>
          )}
          {recoverySupported ? (
            <OriginalRouteReview
              key={`original:${result.plan.id}`}
              environmentId={environmentId}
              plan={result.plan}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void planAct(() =>
                  runVault(atoms.inspect, { environmentId, input: { id: result.plan.id } }),
                )
              }
            >
              Refresh replacement status
            </Button>
            {result.plan.state !== "cancelled" ? (
              <Button
                variant="outline"
                disabled={busy || !canWrite}
                onClick={() =>
                  void planAct(() =>
                    runVault(atoms.cancel, { environmentId, input: { id: result.plan.id } }),
                  )
                }
              >
                Cancel replacement plan
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setResult(null);
                setChoice(null);
                setConfirmed(false);
                setError(null);
              }}
            >
              Close replacement review
            </Button>
          </div>
        </section>
      ) : null}
      <h3 className="font-medium">Recent replacement plans</h3>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => appAtomRegistry.refresh(listAtom)}
      >
        Refresh replacement plans
      </Button>
      <p>Listing plans does not recheck source or item freshness. Open a plan to check them.</p>
      {list.waiting ? <p role="status">Loading replacement plans…</p> : null}
      {list._tag === "Failure" ? (
        <p role="alert">Could not load replacement plans. Check Vault access and refresh.</p>
      ) : null}
      {page?.items.length === 0 ? <p>No replacement plans on this page.</p> : null}
      {page?.items.map((entry) => (
        <div key={entry.plan.id} className="flex flex-wrap items-center gap-2">
          <span>
            {entry.plan.projectTitle} · {entry.plan.replacement.label} · {entry.plan.state}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setChoice(null);
              setResult(null);
              void planAct(() =>
                runVault(atoms.inspect, { environmentId, input: { id: entry.plan.id } }),
              );
            }}
          >
            Open replacement plan
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || list.waiting || !cursor}
          onClick={() => setCursor(null)}
        >
          First replacement plans
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || list.waiting || !page?.nextCursor}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          More replacement plans
        </Button>
      </div>
    </div>
  );
}
function ReplacementDraft({
  environmentId,
  choice,
  locked,
  onCancel,
  onPrepare,
}: {
  environmentId: EnvironmentId;
  choice: Choice;
  locked: boolean;
  onCancel: () => void;
  onPrepare: (item: VaultItemSummary, adapter: "ssh" | "github", id: string) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState(""),
    [dedicated, setDedicated] = useState(false),
    [id] = useState(newId);
  const listAtom = vault.list({ environmentId, input: { cursor, includeArchived: false } }),
    list = useAtomValue(listAtom);
  const page = list._tag === "Success" && !list.waiting ? list.value : null;
  const items =
    page?.items.filter((item) =>
      item.kind === "ssh-key"
        ? choice.dependency.transport === "ssh"
        : item.kind === "service-connection" && choice.dependency.hostname === "github.com",
    ) ?? [];
  const item = items.find((item) => item.id === selected);
  return (
    <section
      aria-label="Choose development replacement"
      className="flex flex-col gap-3 rounded-md border p-3"
    >
      <h3 className="font-medium">
        Replacement for {choice.title} · {choice.dependency.remote}
      </h3>
      <p>
        Prefer a fresh key created in Vault or a dedicated GitHub App/token connection. The server
        checks the selected adapter and endpoint; usable access requires separate verification.
      </p>
      <label>
        Development replacement record
        <select
          aria-label="Development replacement record"
          value={selected}
          disabled={locked || list.waiting}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a record</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} · {item.kind} · version {item.version}
            </option>
          ))}
        </select>
      </label>
      {list._tag === "Failure" ? (
        <p role="alert">Could not load replacement records. Refresh and retry.</p>
      ) : null}
      {list.waiting ? <p role="status">Loading replacement records…</p> : null}
      {page && items.length === 0 ? (
        <p>
          No compatible record on this page. Create a fresh SSH key in Vault or a dedicated GitHub
          connection, then refresh.
        </p>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={dedicated}
          disabled={locked}
          onChange={(e) => setDedicated(e.target.checked)}
        />{" "}
        This replacement is dedicated to development and separate from personal accounts.
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={locked || !dedicated || !item}
          onClick={() => {
            if (item) onPrepare(item, item.kind === "ssh-key" ? "ssh" : "github", id);
          }}
        >
          Prepare replacement review
        </Button>
        <Button
          variant="outline"
          disabled={locked}
          onClick={() => appAtomRegistry.refresh(listAtom)}
        >
          Refresh replacement records
        </Button>
        <Button
          variant="outline"
          disabled={locked || !cursor || list.waiting}
          onClick={() => {
            setCursor(null);
            setSelected("");
          }}
        >
          First records
        </Button>
        <Button
          variant="outline"
          disabled={locked || !page?.nextCursor || list.waiting}
          onClick={() => {
            setCursor(page?.nextCursor ?? null);
            setSelected("");
          }}
        >
          More records
        </Button>
        <Button variant="outline" disabled={locked} onClick={onCancel}>
          Cancel replacement selection
        </Button>
      </div>
    </section>
  );
}
