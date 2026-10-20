import { migrationInventory as atoms } from "./migrationState";
import { ReplacementVerification } from "./ReplacementVerification";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Switch, View } from "react-native";
import { AuthAccessReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import type {
  VaultMigrationDependency,
  VaultMigrationInventoryPage,
  VaultReplacementResult,
  VaultItemSummary,
} from "@t3tools/contracts/fork";
import { createVaultCoreAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { connectionAtomRuntime } from "../../connection/runtime";
import { uuidv4 } from "../../lib/uuid";
import { useVaultTime } from "./useVaultTime";
const vault = createVaultCoreAtoms(connectionAtomRuntime);
const newId = () => uuidv4().replaceAll("-", "");
const unwrap = <A, E>(result: AtomCommandResult<A, E>) => {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
};
type Choice = { projectId: ProjectId; title: string; dependency: VaultMigrationDependency };
export function VaultMigrationInventorySettingsSection({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useEnvironmentServerConfig(environmentId),
    canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-migration-inventory"))
    return null;
  return (
    <SettingsSection title="Vault migration plans">
      {canRead ? (
        <Inventory
          key={`${environmentId}:${connected}`}
          environmentId={environmentId}
          connected={connected}
          previewsSupported={supportsLoomFeature(
            config?.environment.capabilities,
            "vault-migration-previews",
          )}
          verificationSupported={supportsLoomFeature(
            config?.environment.capabilities,
            "vault-migration-verification",
          )}
        />
      ) : (
        <Text>Your connection does not include credential inspection.</Text>
      )}
    </SettingsSection>
  );
}
function Inventory({
  environmentId,
  connected,
  verificationSupported,
  previewsSupported,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  verificationSupported: boolean;
  previewsSupported: boolean;
}) {
  const [inventory, setInventory] = useState<VaultMigrationInventoryPage | null>(null),
    [choice, setChoice] = useState<Choice | null>(null),
    [result, setResult] = useState<VaultReplacementResult | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const list = useEnvironmentQuery(
      connected ? atoms.list({ environmentId, input: { cursor } }) : null,
    ),
    page = list.isSuccess && !list.isPending ? list.data : null;
  const scan = useAtomCommand(atoms.inventory, { reportFailure: false }),
    prepare = useAtomCommand(atoms.prepare, { reportFailure: false }),
    inspect = useAtomCommand(atoms.inspect, { reportFailure: false }),
    review = useAtomCommand(atoms.review, { reportFailure: false }),
    cancel = useAtomCommand(atoms.cancel, { reportFailure: false });
  const canWrite = useAtomValue(atoms.prepare.permissionAtom(environmentId)),
    locked = busy || !connected || !canWrite;
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
      setResult(await work());
      setConfirmed(false);
      list.refresh();
    });
  const inspectInventory = (cursor: ProjectId | null) => {
    setInventory(null);
    setChoice(null);
    void act(async () => setInventory(unwrap(await scan({ environmentId, input: { cursor } }))));
  };
  return (
    <View className="gap-3">
      <Text>Inspect this computer's registered projects before replacing development access.</Text>
      <Text>
        Only selected local Git configuration is inspected. Personal stores, global configuration,
        included files, SSH aliases, environment overrides, account identity and external consumers
        are not inspected. Endpoints are hints; access has not been verified.
      </Text>
      <Text>
        Reviewing a plan never changes repository settings or grants access. Verification is
        required before any cutover.
      </Text>
      {!connected ? <Text>Reconnect to inspect project dependencies.</Text> : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <Button
        label="Inspect project dependencies"
        disabled={busy || !connected}
        onPress={() => inspectInventory(null)}
      />
      {inventory?.nextCursor ? (
        <Button
          label="Next projects"
          disabled={busy || !connected}
          onPress={() => inspectInventory(inventory.nextCursor)}
        />
      ) : null}
      {busy ? <Text>Updating migration planning…</Text> : null}
      {inventory ? (
        <>
          <Text>
            Inspected {inventory.projects.length} projects on this page at{" "}
            {new Date(inventory.checkedAt).toLocaleString()}.{" "}
            {inventory.nextCursor
              ? "More projects remain."
              : "End of registered project inventory."}
          </Text>
          {inventory.projects.length === 0 ? (
            <Text>No registered projects on this page.</Text>
          ) : null}
          {inventory.projects.map((project) => (
            <View key={project.projectId} className="gap-3 rounded-lg border border-border p-3">
              <Text className="font-semibold">{project.title}</Text>
              {project.state === "unavailable" ? (
                <Text>
                  Local Git metadata is unavailable. The project may be missing, inaccessible or not
                  a Git checkout. Refresh after correcting it.
                </Text>
              ) : (
                <>
                  <Text>
                    Local SSH command: {project.localSshCommand ? "configured" : "not found"}.
                    Credential helper: {project.localCredentialHelper ? "configured" : "not found"}.
                    URL rewrite:{" "}
                    {project.localUrlRewrite
                      ? "configured; replacement needs separate review"
                      : "not found"}
                    .
                  </Text>
                  {project.dependencies.length === 0 ? (
                    <Text>
                      No remote URLs in the inspected local configuration. Included and global
                      settings may add others.
                    </Text>
                  ) : null}
                  {project.dependencies.map((dep) => (
                    <View key={`${dep.remote}:${dep.direction}:${dep.position}`} className="gap-2">
                      <Text>
                        {dep.remote} · {dep.direction} URL {dep.position + 1} · {dep.transport} ·{" "}
                        {dep.hostname ?? "unrecognized endpoint"}
                        {dep.port ? `:${dep.port}` : ""} ·{" "}
                        {dep.repository ?? "repository path not reported"}
                      </Text>
                      {dep.embeddedAuthentication ? (
                        <Text>
                          Embedded authentication or URL parameters were omitted. Review them
                          separately before cutover.
                        </Text>
                      ) : null}
                      <Button
                        label={`Plan replacement for ${dep.remote} ${dep.direction} ${dep.position + 1}`}
                        disabled={
                          locked ||
                          project.localUrlRewrite ||
                          dep.transport === "other" ||
                          !dep.repository
                        }
                        onPress={() => {
                          setChoice({
                            projectId: project.projectId,
                            title: project.title,
                            dependency: dep,
                          });
                          setResult(null);
                          setConfirmed(false);
                          setError(null);
                        }}
                      />
                    </View>
                  ))}
                  {project.omittedDependencies > 0 ? (
                    <Text>
                      {project.omittedDependencies} additional or unsupported entries were omitted.
                      This inventory is incomplete.
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          ))}
        </>
      ) : null}
      {choice && !result ? (
        <ReplacementDraft
          key={`${choice.projectId}:${choice.dependency.remote}:${choice.dependency.direction}:${choice.dependency.position}`}
          environmentId={environmentId}
          connected={connected}
          choice={choice}
          locked={locked}
          onCancel={() => setChoice(null)}
          onPrepare={(item, adapter, id) =>
            void planAct(() =>
              prepare({
                environmentId,
                input: {
                  id,
                  projectId: choice.projectId,
                  dependency: choice.dependency,
                  replacement: { adapter, itemId: item.id, expectedVersion: item.version },
                  developmentOnly: true,
                },
              }).then(unwrap),
            )
          }
        />
      ) : null}
      {result ? (
        <View className="gap-3 rounded-lg border border-border p-3">
          <Text className="font-semibold">
            {result.plan.projectTitle} · {result.plan.state}
          </Text>
          <Text>
            {result.plan.dependency.remote} · {result.plan.dependency.direction} ·{" "}
            {result.plan.dependency.hostname}/{result.plan.dependency.repository}
          </Text>
          {result.plan.dependency.gitPath ? (
            <Text>Original Git path: {result.plan.dependency.gitPath}</Text>
          ) : null}
          <Text>
            Replacement: {result.plan.replacement.label} · version{" "}
            {result.plan.replacement.expectedVersion} · {result.plan.replacement.destination}
          </Text>
          <Text>
            {result.plan.replacement.scope === "github-api-and-gh-only"
              ? "GitHub API and gh operations only. This does not replace Git SSH or HTTPS transport authentication."
              : "Vault-mediated SSH Git operations. This does not change ordinary terminal Git authentication."}
          </Text>
          <Text>
            Host trust: {result.plan.replacement.hostTrust}. Source and item check:{" "}
            {result.validation}.
          </Text>
          <Text>
            Review expires {new Date(result.plan.expiresAt).toLocaleString()}.{" "}
            {now >= result.plan.expiresAt ? "This review expired." : ""}
          </Text>
          <Text>
            Access verification is required before cutover. Cutover is unavailable in this release.
            Existing grants, profiles and repository settings are preserved.
          </Text>
          {result.plan.state === "prepared" ? (
            <>
              <Text>I reviewed this development replacement, scope and selected computer.</Text>
              <Switch
                accessibilityLabel="Confirm development replacement review"
                value={confirmed}
                onValueChange={setConfirmed}
                disabled={locked}
              />
              <Button
                label="Record reviewed replacement plan"
                disabled={
                  locked ||
                  !confirmed ||
                  !!error ||
                  result.validation !== "current" ||
                  now >= result.plan.expiresAt
                }
                onPress={() =>
                  void planAct(() =>
                    review({ environmentId, input: { id: result.plan.id, reviewed: true } }).then(
                      unwrap,
                    ),
                  )
                }
              />
            </>
          ) : null}
          {verificationSupported ? (
            <ReplacementVerification
              previewsSupported={previewsSupported}
              key={result.plan.id}
              environmentId={environmentId}
              connected={connected}
              plan={result.plan}
            />
          ) : (
            <Text>Verification needs a newer Vault server.</Text>
          )}
          <Button
            label="Refresh replacement status"
            disabled={busy || !connected}
            onPress={() =>
              void planAct(() =>
                inspect({ environmentId, input: { id: result.plan.id } }).then(unwrap),
              )
            }
          />
          {result.plan.state !== "cancelled" ? (
            <Button
              label="Cancel replacement plan"
              disabled={locked}
              onPress={() =>
                void planAct(() =>
                  cancel({ environmentId, input: { id: result.plan.id } }).then(unwrap),
                )
              }
            />
          ) : null}
          <Button
            label="Close replacement review"
            disabled={busy}
            onPress={() => {
              setResult(null);
              setChoice(null);
              setConfirmed(false);
              setError(null);
            }}
          />
        </View>
      ) : null}
      <Text className="font-semibold">Recent replacement plans</Text>
      <Button
        label="Refresh replacement plans"
        disabled={busy || !connected}
        onPress={list.refresh}
      />
      <Text>
        Listing plans does not recheck source or item freshness. Open a plan to check them.
      </Text>
      {list.isPending ? <Text>Loading replacement plans…</Text> : null}
      {list.error ? (
        <Text accessibilityRole="alert">
          Could not load replacement plans. Check Vault access and refresh.
        </Text>
      ) : null}
      {page?.items.length === 0 ? <Text>No replacement plans on this page.</Text> : null}
      {page?.items.map((entry) => (
        <View key={entry.plan.id} className="gap-2">
          <Text>
            {entry.plan.projectTitle} · {entry.plan.replacement.label} · {entry.plan.state}
          </Text>
          <Button
            label="Open replacement plan"
            disabled={busy || !connected}
            onPress={() => {
              setChoice(null);
              setResult(null);
              void planAct(() =>
                inspect({ environmentId, input: { id: entry.plan.id } }).then(unwrap),
              );
            }}
          />
        </View>
      ))}
      <Button
        label="First replacement plans"
        disabled={busy || !connected || list.isPending || !cursor}
        onPress={() => setCursor(null)}
      />
      <Button
        label="More replacement plans"
        disabled={busy || !connected || list.isPending || !page?.nextCursor}
        onPress={() => setCursor(page?.nextCursor ?? null)}
      />
    </View>
  );
}
function ReplacementDraft({
  environmentId,
  connected,
  choice,
  locked,
  onCancel,
  onPrepare,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  choice: Choice;
  locked: boolean;
  onCancel: () => void;
  onPrepare: (item: VaultItemSummary, adapter: "ssh" | "github", id: string) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState(""),
    [dedicated, setDedicated] = useState(false),
    [id] = useState(newId);
  const list = useEnvironmentQuery(
      connected ? vault.list({ environmentId, input: { cursor, includeArchived: false } }) : null,
    ),
    page = list.isSuccess && !list.isPending ? list.data : null;
  const items =
      page?.items.filter((item) =>
        item.kind === "ssh-key"
          ? choice.dependency.transport === "ssh"
          : item.kind === "service-connection" && choice.dependency.hostname === "github.com",
      ) ?? [],
    item = items.find((item) => item.id === selected);
  return (
    <View className="gap-3 rounded-lg border border-border p-3">
      <Text className="font-semibold">
        Replacement for {choice.title} · {choice.dependency.remote}
      </Text>
      <Text>
        Prefer a fresh key created in Vault or a dedicated GitHub App/token connection. The server
        checks the selected adapter and endpoint; usable access requires separate verification.
      </Text>
      {items.map((item) => (
        <Button
          key={item.id}
          label={`${selected === item.id ? "Selected: " : "Choose: "}${item.label} · ${item.kind} · version ${item.version}`}
          disabled={locked}
          onPress={() => setSelected(item.id)}
        />
      ))}
      {list.error ? (
        <Text accessibilityRole="alert">
          Could not load replacement records. Refresh and retry.
        </Text>
      ) : null}
      {list.isPending ? <Text>Loading replacement records…</Text> : null}
      {page && items.length === 0 ? (
        <Text>
          No compatible record on this page. Create a fresh SSH key in Vault or a dedicated GitHub
          connection, then refresh.
        </Text>
      ) : null}
      <Text>This replacement is dedicated to development and separate from personal accounts.</Text>
      <Switch
        accessibilityLabel="Dedicated development replacement"
        value={dedicated}
        onValueChange={setDedicated}
        disabled={locked}
      />
      <Button
        label="Prepare replacement review"
        disabled={locked || !dedicated || !item}
        onPress={() => {
          if (item) onPrepare(item, item.kind === "ssh-key" ? "ssh" : "github", id);
        }}
      />
      <Button label="Refresh replacement records" disabled={locked} onPress={list.refresh} />
      <Button
        label="First records"
        disabled={locked || list.isPending || !cursor}
        onPress={() => {
          setCursor(null);
          setSelected("");
        }}
      />
      <Button
        label="More records"
        disabled={locked || list.isPending || !page?.nextCursor}
        onPress={() => {
          setCursor(page?.nextCursor ?? null);
          setSelected("");
        }}
      />
      <Button label="Cancel replacement selection" disabled={locked} onPress={onCancel} />
    </View>
  );
}
