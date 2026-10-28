import { VaultQueryFeedback } from "./SettingsFeedback";
import { Checkbox } from "~/components/ui/checkbox";
import {
  LoomSettingsActions,
  LoomSettingsNotice,
  LoomSettingsDetails,
  LoomSettingsField,
  LoomSettingsPanel,
} from "~/fork/settings/parts";
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
    return (
      <LoomSettingsNotice>Dependency inventory needs a newer Vault server.</LoomSettingsNotice>
    );
  if (!canRead)
    return (
      <LoomSettingsNotice>
        Your connection does not include credential inspection.
      </LoomSettingsNotice>
    );
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
    }
    setBusy(false);
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
    <div className="flex min-w-0 flex-col gap-6 text-sm leading-relaxed wrap-anywhere">
      <LoomSettingsPanel
        title="Project dependency inventory"
        description="Inspect registered projects before replacing development access."
      >
        <p className="text-xs text-muted-foreground">Inspecting projects on {computer}</p>
        <LoomSettingsDetails title="What the inventory inspects">
          <p>
            Only selected local Git configuration is inspected. Personal stores, global
            configuration, included files, SSH aliases, environment overrides, account identity and
            external consumers are not inspected. Endpoints are hints; access has not been verified.
          </p>
        </LoomSettingsDetails>
        <p className="max-w-prose text-sm text-muted-foreground">
          Reviewing a plan never changes repository settings or grants access. Verification is
          required before any cutover.
        </p>
        {error ? <LoomSettingsNotice role="alert">{error}</LoomSettingsNotice> : null}
        <LoomSettingsActions>
          <Button size="sm-multiline" disabled={busy} onClick={() => inspectInventory(null)}>
            Inspect project dependencies
          </Button>
          {inventory?.nextCursor ? (
            <Button
              size="sm-multiline"
              variant="outline"
              disabled={busy}
              onClick={() => inspectInventory(inventory.nextCursor)}
            >
              Next projects
            </Button>
          ) : null}
        </LoomSettingsActions>
        {busy ? (
          <LoomSettingsNotice role="status">Updating migration planning…</LoomSettingsNotice>
        ) : null}
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
            <div className="flex min-w-0 flex-col divide-y divide-border/60">
              {inventory.projects.map((project) => (
                <section
                  key={project.projectId}
                  aria-label={`Dependencies for ${project.title}`}
                  className="flex min-w-0 flex-col gap-4 py-5 first:pt-0 last:pb-0"
                >
                  <h4 className="text-sm font-medium">{project.title}</h4>
                  {project.state === "unavailable" ? (
                    <p>
                      Local Git metadata is unavailable. The project may be missing, inaccessible or
                      not a Git checkout. Refresh after correcting it.
                    </p>
                  ) : (
                    <>
                      <dl className="grid min-w-0 gap-4 text-sm grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))]">
                        <div className="min-w-0 space-y-1">
                          <dt className="text-xs text-muted-foreground">Local SSH command</dt>
                          <dd>{project.localSshCommand ? "Configured" : "Not found"}</dd>
                        </div>
                        <div className="min-w-0 space-y-1">
                          <dt className="text-xs text-muted-foreground">Credential helper</dt>
                          <dd>{project.localCredentialHelper ? "Configured" : "Not found"}</dd>
                        </div>
                        <div className="min-w-0 space-y-1">
                          <dt className="text-xs text-muted-foreground">URL rewrite</dt>
                          <dd>
                            {project.localUrlRewrite
                              ? "Configured; replacement needs separate review"
                              : "Not found"}
                          </dd>
                        </div>
                      </dl>
                      {project.dependencies.length === 0 ? (
                        <p>
                          No remote URLs in the inspected local configuration. Included and global
                          settings may add others.
                        </p>
                      ) : null}
                      {project.dependencies.map((dep) => (
                        <div
                          key={`${dep.remote}:${dep.direction}:${dep.position}`}
                          className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted/30 p-3"
                        >
                          <h5 className="text-sm font-medium">
                            {dep.remote}: {dep.direction} URL {dep.position + 1}
                          </h5>
                          <dl className="grid min-w-0 gap-3 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                            <div className="min-w-0 space-y-1">
                              <dt className="text-xs text-muted-foreground">Transport and host</dt>
                              <dd>
                                {dep.transport}: {dep.hostname ?? "unrecognized endpoint"}
                                {dep.port ? `:${dep.port}` : ""}
                              </dd>
                            </div>
                            <div className="min-w-0 space-y-1">
                              <dt className="text-xs text-muted-foreground">Repository</dt>
                              <dd>{dep.repository ?? "Repository path not reported"}</dd>
                            </div>
                          </dl>
                          {dep.embeddedAuthentication ? (
                            <p>
                              Embedded authentication or URL parameters were omitted. Review them
                              separately before cutover.
                            </p>
                          ) : null}
                          <LoomSettingsActions>
                            <Button
                              size="sm-multiline"
                              variant="outline"
                              aria-label={`Plan replacement for ${dep.remote} ${dep.direction} ${dep.position + 1}`}
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
                              Plan replacement
                            </Button>
                          </LoomSettingsActions>
                        </div>
                      ))}
                      {project.omittedDependencies > 0 ? (
                        <LoomSettingsNotice role="status">
                          {project.omittedDependencies} additional or unsupported entries were
                          omitted. This inventory is incomplete.
                        </LoomSettingsNotice>
                      ) : null}
                    </>
                  )}
                </section>
              ))}
            </div>
          </>
        ) : null}
      </LoomSettingsPanel>
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
        <LoomSettingsPanel title="Replacement plan review">
          <div className="space-y-1">
            <h4 className="text-sm font-medium">{result.plan.projectTitle}</h4>
            <p className="text-muted-foreground">Replacement plan: {result.plan.state}</p>
          </div>
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
          <LoomSettingsNotice>
            Access verification is required before cutover. Cutover is unavailable in this release.
            Existing grants, profiles and repository settings are preserved.
          </LoomSettingsNotice>
          {result.plan.state === "prepared" ? (
            <>
              <label className="flex items-start gap-2 text-sm leading-6">
                <Checkbox
                  checked={confirmed}
                  disabled={busy || !canWrite}
                  onCheckedChange={(checked) => setConfirmed(checked)}
                />{" "}
                I reviewed this development replacement, scope and selected computer.
              </label>
              <Button
                size="sm-multiline"
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
          <LoomSettingsActions>
            <Button
              size="sm-multiline"
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
                size="sm-multiline"
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
              size="sm-multiline"
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
          </LoomSettingsActions>
        </LoomSettingsPanel>
      ) : null}
      <LoomSettingsDetails title="Recent replacement plans">
        <LoomSettingsActions>
          <Button
            variant="outline"
            size="sm-multiline"
            disabled={busy}
            onClick={() => appAtomRegistry.refresh(listAtom)}
          >
            Refresh replacement plans
          </Button>
        </LoomSettingsActions>
        <p className="text-xs text-muted-foreground">
          Listing plans does not recheck source or item freshness. Open a plan to check them.
        </p>
        <VaultQueryFeedback
          result={list}
          loading="Loading replacement plans…"
          error="Could not load replacement plans. Check Vault access and retry."
          onRetry={() => appAtomRegistry.refresh(listAtom)}
        />
        {page?.items.length === 0 ? <p>No replacement plans on this page.</p> : null}
        {page?.items.map((entry) => (
          <div
            key={entry.plan.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3 last:border-0"
          >
            <div className="min-w-0 space-y-1">
              <h4 className="wrap-anywhere text-sm font-medium">{entry.plan.projectTitle}</h4>
              <p className="wrap-anywhere text-sm text-muted-foreground">
                {entry.plan.replacement.label}
              </p>
              <p className="text-xs text-muted-foreground">{entry.plan.state}</p>
            </div>
            <Button
              variant="outline"
              size="sm-multiline"
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
        <LoomSettingsActions>
          <Button
            variant="outline"
            size="sm-multiline"
            disabled={busy || list.waiting || !cursor}
            onClick={() => setCursor(null)}
          >
            First replacement plans
          </Button>
          <Button
            variant="outline"
            size="sm-multiline"
            disabled={busy || list.waiting || !page?.nextCursor}
            onClick={() => setCursor(page?.nextCursor ?? null)}
          >
            More replacement plans
          </Button>
        </LoomSettingsActions>
      </LoomSettingsDetails>
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
    <LoomSettingsPanel title="Choose development replacement">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">Replacement for {choice.title}</h4>
        <p className="text-sm text-muted-foreground">
          {choice.dependency.remote}. Draft selection, not yet prepared for review.
        </p>
      </div>
      <p>
        Prefer a fresh key created in Vault or a dedicated GitHub App/token connection. The server
        checks the selected adapter and endpoint; usable access requires separate verification.
      </p>
      <LoomSettingsField label="Development replacement record">
        <Select
          value={selected}
          disabled={locked || list.waiting}
          onValueChange={(nextValue) => {
            if (nextValue !== null) {
              setSelected(nextValue);
            }
          }}
        >
          <SelectTrigger aria-label="Development replacement record">
            <SelectValue>
              {items.find((item) => item.id === selected)?.label ?? (selected || "Choose a record")}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">Choose a record</SelectItem>
            {items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label} · {item.kind} · version {item.version}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LoomSettingsField>
      <VaultQueryFeedback
        result={list}
        loading="Loading replacement records…"
        error="Could not load replacement records."
        onRetry={() => appAtomRegistry.refresh(listAtom)}
      />
      {page && items.length === 0 ? (
        <p>
          No compatible record on this page. Create a fresh SSH key in Vault or a dedicated GitHub
          connection, then refresh.
        </p>
      ) : null}
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          variant="outline"
          disabled={locked}
          onClick={() => appAtomRegistry.refresh(listAtom)}
        >
          Refresh replacement records
        </Button>
        <Button
          size="sm-multiline"
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
          size="sm-multiline"
          variant="outline"
          disabled={locked || !page?.nextCursor || list.waiting}
          onClick={() => {
            setCursor(page?.nextCursor ?? null);
            setSelected("");
          }}
        >
          More records
        </Button>
      </LoomSettingsActions>
      <label className="flex items-start gap-2 text-sm leading-6">
        <Checkbox
          checked={dedicated}
          disabled={locked}
          onCheckedChange={(checked) => setDedicated(checked)}
        />{" "}
        This replacement is dedicated to development and separate from personal accounts.
      </label>
      <LoomSettingsActions>
        <Button
          size="sm-multiline"
          disabled={locked || !dedicated || !item}
          onClick={() => {
            if (item) onPrepare(item, item.kind === "ssh-key" ? "ssh" : "github", id);
          }}
        >
          Prepare replacement review
        </Button>
        <Button size="sm-multiline" variant="outline" disabled={locked} onClick={onCancel}>
          Cancel replacement selection
        </Button>
      </LoomSettingsActions>
    </LoomSettingsPanel>
  );
}
