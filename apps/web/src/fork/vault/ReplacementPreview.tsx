import { LoomSettingsActions, LoomSettingsNotice } from "../settings/parts";
import { migrationInventory as atoms } from "./migrationState";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultReplacementPreviewInput } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { Button } from "~/components/ui/button";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useVaultTime } from "./useVaultTime";
type Kind = VaultReplacementPreviewInput["kind"];
export function ReplacementPreview({
  environmentId,
  planId,
  operationId,
}: {
  environmentId: EnvironmentId;
  planId: string;
  operationId: string;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const open = (kind: Kind) => {
    appAtomRegistry.refresh(
      atoms.preview({
        environmentId,
        input: { id: planId, expectedOperationId: operationId, kind },
      }),
    );
    setKind(kind);
  };
  return (
    <section aria-label="Repository route previews" className="flex min-w-0 flex-col gap-4">
      <h4 className="font-medium">Repository route previews</h4>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Inspect a read route and its conditional inverse. Neither preview can apply changes. Push
        and GitHub API evidence cannot establish Git transport eligibility.
      </p>
      <LoomSettingsActions>
        <Button size="sm-multiline" variant="outline" onClick={() => open("cutover")}>
          Preview read cutover
        </Button>
        <Button size="sm-multiline" variant="outline" onClick={() => open("rollback")}>
          Preview rollback
        </Button>
        {kind ? (
          <Button size="sm-multiline" variant="outline" onClick={() => setKind(null)}>
            Close route preview
          </Button>
        ) : null}
      </LoomSettingsActions>
      {kind ? (
        <Preview
          key={kind}
          environmentId={environmentId}
          input={{ id: planId, kind, expectedOperationId: operationId }}
        />
      ) : null}
    </section>
  );
}
function Preview({
  environmentId,
  input,
}: {
  environmentId: EnvironmentId;
  input: VaultReplacementPreviewInput;
}) {
  const atom = atoms.preview({ environmentId, input }),
    query = useAtomValue(atom);
  const data = query._tag === "Success" && !query.waiting ? query.value : null;
  const now = useVaultTime([data?.validUntil ?? null]);
  const failure = query._tag === "Failure" ? Cause.squash(query.cause) : null;
  return (
    <div
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border/60 p-3 wrap-anywhere"
      aria-label={`${input.kind} route preview`}
    >
      {query.waiting ? (
        <LoomSettingsNotice role="status">Checking route preview…</LoomSettingsNotice>
      ) : null}
      {failure ? (
        <LoomSettingsNotice role="alert">
          {failure instanceof Error
            ? failure.message
            : "Could not check this preview. Refresh the receipt and retry."}
        </LoomSettingsNotice>
      ) : null}
      {data && now >= data.validUntil ? (
        <LoomSettingsNotice role="status">
          This preview expired. Verify access again before previewing.
        </LoomSettingsNotice>
      ) : null}
      {data && now < data.validUntil ? (
        <>
          <h5 className="font-medium">
            {data.kind === "cutover" ? "Read cutover preview" : "Hypothetical rollback preview"}
          </h5>
          <p>
            {data.source.remote} · fetch entry {data.source.position + 1} ·{" "}
            {data.replacement.repository}
          </p>
          <p>
            {data.from === "existing-project-git"
              ? "Existing project Git"
              : "Vault-mediated Git read"}{" "}
            →{" "}
            {data.to === "existing-project-git"
              ? "Existing project Git"
              : "Vault-mediated Git read"}
          </p>
          <p>
            Dedicated record {data.replacement.itemId}, version {data.replacement.expectedVersion},
            at {data.replacement.destination}.
          </p>
          <p>
            Bound to SSH repository-read verification {data.verificationOperationId}. Checked{" "}
            {new Date(data.checkedAt).toLocaleTimeString()}; expires{" "}
            {new Date(data.validUntil).toLocaleTimeString()}.
          </p>
          <p>
            Rollback describes the inverse of this proposed route. No cutover has been applied and
            no restorable configuration backup is captured. Original credential access is
            unverified. A future rollback must verify the original route and match the exact applied
            state before changing anything.
          </p>
          <p>
            Workload grants still need checking. Later provider revocation is unknown. Global Git
            and personal SSH configuration are outside this preview. Execution remains unavailable.
          </p>
        </>
      ) : null}
      <Button
        size="sm-multiline"
        variant="outline"
        disabled={query.waiting}
        onClick={() => appAtomRegistry.refresh(atom)}
      >
        Refresh route preview
      </Button>
    </div>
  );
}
