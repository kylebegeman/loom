import type { ThreadId } from "@t3tools/contracts";
import {
  VaultApprovalRetryInput,
  VaultError,
  type VaultSshError,
  type VaultConnectionError,
  type VaultWorkloadError,
  type VaultGitHubError,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as OperationJournal from "./OperationJournal.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import * as VaultGitHub from "./VaultGitHub.ts";

type Acquisition = Parameters<OperationJournal.OperationJournal["Service"]["checkAcquisition"]>[0];
type Failure =
  | VaultError
  | VaultSshError
  | VaultWorkloadError
  | VaultGitHubError
  | VaultConnectionError;
type Observation = {
  readonly adapter: VaultApprovalRetryInput["operation"]["kind"];
  readonly operationDigest: string;
  readonly checkedAt: number;
  readonly adapterValidation: "local-metadata-only";
  readonly liveValidation: "required";
  readonly canExecute: false;
  readonly automaticResumption: false;
  readonly allowOnceConsumption: false;
};
const decode = Schema.decodeUnknownEffect(VaultApprovalRetryInput);
export class OperationAdmission extends Context.Service<
  OperationAdmission,
  {
    readonly admit: (
      input: VaultApprovalRetryInput,
      acquisition: Acquisition,
      requester: ThreadId,
    ) => Effect.Effect<Observation, Failure>;
  }
>()("t3/fork/vault/OperationAdmission") {}

const make = Effect.gen(function* () {
  const journal = yield* OperationJournal.OperationJournal;
  const access = yield* VaultAccess.VaultAccess;
  const launch = yield* VaultLaunch.VaultLaunch;
  const github = yield* VaultGitHub.VaultGitHub;
  return OperationAdmission.of({
    admit: Effect.fn("OperationAdmission.admit")(function* (raw, acquisition, requester) {
      // Burn the local identity even when the new proposal is malformed or mismatched.
      const held = yield* journal.checkAcquisition(acquisition, requester);
      return yield* Effect.gen(function* (): Effect.fn.Return<Observation, Failure> {
        const input = structuredClone(
          yield* decode(raw).pipe(
            Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
          ),
        );
        const recheck = Effect.gen(function* () {
          const report = yield* access.approvalPrepareRetry(input, requester);
          if (
            report.retryState !== "policy-valid-recheck-adapter" ||
            report.operationDigest !== held.entry.digest ||
            input.id !== held.entry.requestId
          )
            return yield* new VaultError({ reason: "denied" });
          const current = yield* journal.status(input.id, requester);
          if (
            current.status.operationState !== "retry-requires-explicit-operation" ||
            current.status.request.revision !== held.entry.requestRevision ||
            current.journal?.state !== "reserved" ||
            current.journal.revision !== held.entry.revision ||
            current.journal.operationDigest !== held.entry.digest
          )
            return yield* new VaultError({ reason: "conflict" });
        });
        yield* recheck;
        const metadata =
          input.operation.kind === "github-api"
            ? github.admission(input.operation.input, requester)
            : launch.admission(input.operation, requester);
        const initial = yield* metadata;
        if ((yield* metadata) !== initial) return yield* new VaultError({ reason: "conflict" });
        yield* recheck;
        return {
          adapter: input.operation.kind,
          operationDigest: held.entry.digest,
          checkedAt: yield* Clock.currentTimeMillis,
          adapterValidation: "local-metadata-only",
          liveValidation: "required",
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        };
      }).pipe(
        Effect.onError(() =>
          journal.reconcile(held.entry.requestId, requester).pipe(Effect.ignore),
        ),
      );
    }),
  });
});
export const layer = Layer.effect(OperationAdmission, make);
