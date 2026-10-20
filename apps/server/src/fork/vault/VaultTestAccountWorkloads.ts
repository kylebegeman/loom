import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultTestAccountAgentMutation,
  vaultTestAccountDestination,
  type VaultTestAccount,
  type VaultTestAccountDiscovery,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultTestAccounts from "./VaultTestAccounts.ts";

const Caller = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
});
type Caller = typeof Caller.Type;
const Binding = Schema.Struct({ ...Caller.fields, projectId: ProjectId, runId: RunId });
const decodeBinding = Schema.decodeUnknownOption(Schema.fromJsonString(Binding));
const decodeMutation = Schema.decodeUnknownEffect(VaultTestAccountAgentMutation, {
  onExcessProperty: "error",
});
const ownerPrefix = "run-v1:";
const ownerOf = (binding: typeof Binding.Type) => ownerPrefix + JSON.stringify(binding);
const denied = () => new VaultError({ reason: "denied" });

export class VaultTestAccountWorkloads extends Context.Service<
  VaultTestAccountWorkloads,
  {
    readonly discover: (caller: Caller) => Effect.Effect<VaultTestAccountDiscovery, VaultError>;
    readonly apply: (
      input: VaultTestAccountAgentMutation,
      caller: Caller,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultTestAccountDiscovery, VaultError>;
    readonly reconcile: Effect.Effect<void, VaultError>;
  }
>()("t3/fork/vault/VaultTestAccountWorkloads") {}

const make = Effect.gen(function* () {
  const accounts = yield* VaultTestAccounts.VaultTestAccounts,
    core = yield* VaultCore.VaultCore,
    access = yield* VaultAccess.VaultAccess,
    threads = yield* ThreadManagementService,
    projects = yield* ProjectStoreV2;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const bind = Effect.fn("VaultTestAccountWorkloads.bind")(function* (caller: Caller) {
    if (caller.environmentId !== environmentId) return yield* denied();
    const thread = yield* threads
      .getThreadShell(caller.threadId)
      .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
    if (
      !thread ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.status !== "running" ||
      thread.activeRunId === null ||
      thread.runtimeMode !== "full-access" ||
      thread.interactionMode !== "default" ||
      thread.providerInstanceId !== caller.providerInstanceId
    )
      return yield* denied();
    const project = yield* projects
      .get(thread.projectId)
      .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
    if (Option.isNone(project)) return yield* denied();
    const binding = {
      environmentId,
      threadId: caller.threadId,
      providerInstanceId: caller.providerInstanceId,
      projectId: thread.projectId,
      runId: thread.activeRunId,
    };
    if (ownerOf(binding).length > 512) return yield* denied();
    return binding;
  });
  const current = Effect.fn("VaultTestAccountWorkloads.current")(function* (
    binding: typeof Binding.Type,
  ) {
    if (ownerOf(yield* bind(binding)) !== ownerOf(binding)) return yield* denied();
  });
  const visible = Effect.fn("VaultTestAccountWorkloads.visible")(function* (
    account: VaultTestAccount,
    binding: typeof Binding.Type,
  ) {
    const item = yield* core.inspect(account.itemId);
    if (
      !item ||
      item.kind !== "account" ||
      item.state !== "active" ||
      item.version !== account.itemVersion
    )
      return false;
    for (const action of ["inspect", "use"] as const) {
      const report = yield* access.explain(
        {
          threadId: binding.threadId,
          itemId: account.itemId,
          action,
          destination: vaultTestAccountDestination(account.collectionId),
        },
        true,
      );
      if (!report.decision.allowed) return false;
    }
    return true;
  });
  const discoverBound = Effect.fn("VaultTestAccountWorkloads.discoverBound")(function* (
    binding: typeof Binding.Type,
  ) {
    const snapshot = yield* accounts.snapshot(ownerOf(binding));
    const selected = yield* Effect.filter(snapshot.accounts, (account) =>
      Effect.gen(function* () {
        if (
          !snapshot.collections.some((c) => c.id === account.collectionId && !c.archived) ||
          (account.state !== "available" && account.lease?.owner !== ownerOf(binding))
        )
          return false;
        return yield* visible(account, binding);
      }),
    );
    yield* current(binding);
    return {
      revision: snapshot.revision,
      checkedAt: snapshot.checkedAt,
      accounts: selected,
      collections: snapshot.collections.filter((c) =>
        selected.some((a) => a.collectionId === c.id),
      ),
      loginDelivery: "unsupported" as const,
    };
  });
  return VaultTestAccountWorkloads.of({
    discover: Effect.fn("VaultTestAccountWorkloads.discover")(function* (caller) {
      return yield* discoverBound(yield* bind(caller));
    }),
    apply: Effect.fn("VaultTestAccountWorkloads.apply")(function* (raw, caller, authorize) {
      const input = yield* decodeMutation(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      yield* authorize;
      const binding = yield* bind(caller),
        actor = ownerOf(binding);
      const snapshot = yield* accounts.snapshot(actor);
      const account = snapshot.accounts.find((a) => a.id === input.change.id);
      // Unknown and hidden references are indistinguishable. Agents cannot select another owner.
      if (!account || (account.lease && account.lease.owner !== actor)) return yield* denied();
      const recheck = Effect.gen(function* () {
        yield* authorize;
        yield* current(binding);
        if (input.change.type !== "release") {
          for (const action of ["inspect", "use"] as const)
            yield* access.require(
              binding.threadId,
              account.itemId,
              action,
              vaultTestAccountDestination(account.collectionId),
            );
          if (!(yield* visible(account, binding))) return yield* denied();
          yield* current(binding);
        }
      });
      // The generic manager's result is never exposed through the requester boundary.
      yield* accounts.apply(input, actor, recheck);
      return yield* discoverBound(binding);
    }),
    reconcile: accounts.quarantineLeases((account) =>
      Effect.gen(function* () {
        const owner = account.lease!.owner;
        if (!owner.startsWith(ownerPrefix)) return false;
        const decoded = decodeBinding(owner.slice(ownerPrefix.length));
        if (Option.isNone(decoded)) return true;
        const binding = decoded.value;
        const valid = yield* current(binding).pipe(Effect.result);
        if (valid._tag === "Failure") {
          if (valid.failure.reason === "denied") return true;
          return yield* valid.failure;
        }
        return !(yield* visible(account, binding));
      }),
    ),
  });
});
export const layer = Layer.effect(VaultTestAccountWorkloads, make);
export const reactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const service = yield* VaultTestAccountWorkloads;
    yield* service.reconcile.pipe(
      Effect.catch(() => Effect.void),
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkScoped,
    );
  }),
);
