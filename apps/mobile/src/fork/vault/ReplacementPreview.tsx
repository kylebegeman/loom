import { migrationInventory as atoms } from "./migrationState";
import { useState } from "react";
import { useAtomRefresh } from "@effect/atom-react";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultReplacementPreviewInput } from "@t3tools/contracts/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useVaultTime } from "./useVaultTime";
type Kind = VaultReplacementPreviewInput["kind"];
export function ReplacementPreview({
  environmentId,
  connected,
  planId,
  operationId,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  planId: string;
  operationId: string;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const refreshCutover = useAtomRefresh(
    atoms.preview({
      environmentId,
      input: { id: planId, expectedOperationId: operationId, kind: "cutover" },
    }),
  );
  const refreshRollback = useAtomRefresh(
    atoms.preview({
      environmentId,
      input: { id: planId, expectedOperationId: operationId, kind: "rollback" },
    }),
  );
  const open = (kind: Kind) => {
    (kind === "cutover" ? refreshCutover : refreshRollback)();
    setKind(kind);
  };
  return (
    <View className="gap-3">
      <Text className="font-semibold">Repository route previews</Text>
      <Text>
        Inspect a read route and its conditional inverse. Neither preview can apply changes. Push
        and GitHub API evidence cannot establish Git transport eligibility.
      </Text>
      <Button label="Preview read cutover" disabled={!connected} onPress={() => open("cutover")} />
      <Button label="Preview rollback" disabled={!connected} onPress={() => open("rollback")} />
      {kind ? (
        <>
          <Button label="Close route preview" onPress={() => setKind(null)} />
          <Preview
            key={kind}
            environmentId={environmentId}
            connected={connected}
            input={{ id: planId, kind, expectedOperationId: operationId }}
          />
        </>
      ) : null}
    </View>
  );
}
function Preview({
  environmentId,
  connected,
  input,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  input: VaultReplacementPreviewInput;
}) {
  const query = useEnvironmentQuery(connected ? atoms.preview({ environmentId, input }) : null);
  const data = connected && query.isSuccess && !query.isPending ? query.data : null;
  const now = useVaultTime([data?.validUntil ?? null]);
  return (
    <View className="gap-2 rounded-lg border border-border p-3">
      {query.isPending ? <Text>Checking route preview…</Text> : null}
      {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
      {data && now >= data.validUntil ? (
        <Text>This preview expired. Verify access again before previewing.</Text>
      ) : null}
      {data && now < data.validUntil ? (
        <>
          <Text className="font-semibold">
            {data.kind === "cutover" ? "Read cutover preview" : "Hypothetical rollback preview"}
          </Text>
          <Text>
            {data.source.remote} · fetch entry {data.source.position + 1} ·{" "}
            {data.replacement.repository}
          </Text>
          <Text>
            {data.from === "existing-project-git"
              ? "Existing project Git"
              : "Vault-mediated Git read"}{" "}
            →{" "}
            {data.to === "existing-project-git"
              ? "Existing project Git"
              : "Vault-mediated Git read"}
          </Text>
          <Text>
            Dedicated record {data.replacement.itemId}, version {data.replacement.expectedVersion},
            at {data.replacement.destination}.
          </Text>
          <Text>
            Bound to SSH repository-read verification {data.verificationOperationId}. Checked{" "}
            {new Date(data.checkedAt).toLocaleTimeString()}; expires{" "}
            {new Date(data.validUntil).toLocaleTimeString()}.
          </Text>
          <Text>
            Rollback describes the inverse of this proposed route. No cutover has been applied and
            no restorable configuration backup is captured. Original credential access is
            unverified. A future rollback must verify the original route and match the exact applied
            state before changing anything.
          </Text>
          <Text>
            Workload grants still need checking. Later provider revocation is unknown. Global Git
            and personal SSH configuration are outside this preview. Execution remains unavailable.
          </Text>
        </>
      ) : null}
      <Button
        label="Refresh route preview"
        disabled={!connected || query.isPending}
        onPress={query.refresh}
      />
    </View>
  );
}
