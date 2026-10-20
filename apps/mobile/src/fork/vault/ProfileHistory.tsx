import { useEnvironmentServerConfig } from "../../state/entities";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useState } from "react";
import { View } from "react-native";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createVaultProfileAtoms } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
const atoms = createVaultProfileAtoms(connectionAtomRuntime);
function History({
  environmentId,
  projectId,
  canWrite,
  connected,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  canWrite: boolean;
  connected: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [confirm, setConfirm] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const page = useEnvironmentQuery(
      connected ? atoms.pins({ environmentId, input: { projectId, cursor } }) : null,
    ),
    retire = useAtomCommand(atoms.retirePin, { reportFailure: false });
  return (
    <View className="gap-3">
      <Text className="font-t3-medium">Retained run selections</Text>
      <Text>
        Retirement removes a stopped run's current binding snapshot permanently. A resumed run is
        denied. OpenBao version history remains; credentials and grants are unchanged.
      </Text>
      <Button
        label="Refresh run selections"
        disabled={busy || !connected}
        onPress={() => {
          setConfirm(null);
          page.refresh();
        }}
      />
      {page.isPending ? <Text>Loading run selections…</Text> : null}
      {page.error || error ? (
        <Text accessibilityRole="alert">
          {error ?? "Could not load run selections. Refresh after checking Vault access."}
        </Text>
      ) : null}
      {page.data?.items.length === 0 ? <Text>No retained selections in this page.</Text> : null}
      {page.data?.items.map((pin) => (
        <View key={pin.id} className="gap-2 rounded-lg bg-subtle p-3">
          <Text>
            {pin.resolution?.label ?? "Retired selection"} · {pin.runState}
          </Text>
          <Text selectable>
            Thread {pin.threadId} · Run {pin.runId}
          </Text>
          <Text>
            {pin.createdAt
              ? `Selected ${pin.createdAt}`
              : "Selection time unavailable for this older record"}
            {pin.retiredAt ? ` · Retired ${pin.retiredAt}` : ""}
          </Text>
          {pin.resolution ? (
            <>
              <Text>Profile version {pin.resolution.profileVersion}</Text>
              {pin.resolution.bindings.map((b) => (
                <Text key={b.name} selectable>
                  {b.name} · {b.kind === "github" ? "connection" : "key"} {b.itemId} version{" "}
                  {b.version} · {b.destination}
                </Text>
              ))}
            </>
          ) : null}
          {confirm === pin.id ? (
            <>
              <Text>
                Retire this stopped selection permanently? A new run can select a profile.
              </Text>
              <Button
                label="Retire selection permanently"
                disabled={busy || !canWrite || !pin.canRetire || !connected}
                onPress={() => {
                  setBusy(true);
                  setError(null);
                  void retire({
                    environmentId,
                    input: {
                      projectId,
                      id: pin.id,
                      expectedVersion: pin.version,
                      operationId: uuidv4().replaceAll("-", ""),
                    },
                  })
                    .then((result) => {
                      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                      setConfirm(null);
                    })
                    .catch((cause: unknown) =>
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Retirement failed. Refresh the run state.",
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              />
              <Button label="Cancel retirement" disabled={busy} onPress={() => setConfirm(null)} />
            </>
          ) : pin.resolution ? (
            <Button
              label="Retire stopped selection"
              disabled={busy || !canWrite || !pin.canRetire || !connected}
              onPress={() => setConfirm(pin.id)}
            />
          ) : null}
          {!pin.canRetire && pin.resolution ? (
            <Text>
              Only confirmed terminal runs can be retired. Active or unavailable runs are retained.
            </Text>
          ) : null}
        </View>
      ))}
      <Button
        label="First selections"
        disabled={busy || !cursor}
        onPress={() => {
          setCursor(null);
          setConfirm(null);
        }}
      />
      <Button
        label="More selections"
        disabled={busy || !page.data?.nextCursor}
        onPress={() => {
          setCursor(page.data?.nextCursor ?? null);
          setConfirm(null);
        }}
      />
    </View>
  );
}

export function VaultProfileHistory(props: Parameters<typeof History>[0]) {
  const config = useEnvironmentServerConfig(props.environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-profile-history")) return null;
  return <History {...props} />;
}
