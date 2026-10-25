import type { ThreadId } from "@t3tools/contracts";
import {
  VaultConnectionError,
  VaultConnectionPin,
  VaultConnectionRequest,
  VaultSshTarget,
  VaultGitCommand,
  VaultGitHubRepository,
  VAULT_GITHUB_OWNER_REPOSITORY_LIMIT,
  vaultGitDestination,
  vaultGitHubDestination,
  vaultSshDestination,
  type VaultConnectionChoice,
  type VaultConnectionReport,
  type VaultConnectionRepair,
  type VaultConnectionState,
  VaultError,
  type VaultItemSummary,
  type VaultItemPage,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as VaultAccess from "./VaultAccess.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { Registry, Pin, encodeRunKey } from "./profile-records.ts";
import * as VaultCore from "./VaultCore.ts";

export class VaultConnections extends Context.Service<
  VaultConnections,
  {
    readonly resolve: (
      input: VaultConnectionRequest,
      threadId: ThreadId,
    ) => Effect.Effect<VaultConnectionReport>;
    readonly require: (
      input: VaultConnectionRequest,
      threadId: ThreadId,
    ) => Effect.Effect<VaultConnectionPin, VaultConnectionError>;
    readonly revalidate: (
      pin: VaultConnectionPin,
      threadId: ThreadId,
    ) => Effect.Effect<void, VaultConnectionError>;
  }
>()("t3/fork/vault/VaultConnections") {}

// Decode only adapter metadata. Credential material never enters a selection or report.
const SshMetadata = Schema.fromJsonString(
  Schema.Struct({ protocol: Schema.Literal(1), target: VaultSshTarget }),
);
const GitHubMetadata = Schema.fromJsonString(
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    provider: Schema.Literal("github.com"),
    account: Schema.String.check(Schema.isMaxLength(200)),
    repositories: Schema.Array(VaultGitHubRepository).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(VAULT_GITHUB_OWNER_REPOSITORY_LIMIT),
    ),
  }),
);
const decodeRegistry = Schema.decodeUnknownOption(Registry),
  decodeRunPin = Schema.decodeUnknownOption(Pin),
  decodeSsh = Schema.decodeUnknownOption(SshMetadata),
  decodeGitHub = Schema.decodeUnknownOption(GitHubMetadata),
  isRequest = Schema.is(VaultConnectionRequest),
  isPin = Schema.is(VaultConnectionPin),
  isGitRepository = Schema.is(VaultGitCommand.fields.repository),
  isGitHubRepository = Schema.is(VaultGitHubRepository);
const repair = {
  ready: null,
  ambiguous: "select-connection",
  missing: "create-connection",
  inactive: "restore-connection",
  revoked: "renew-access",
  expired: "renew-access",
  "policy-denied": "repair-policy",
  "backend-unavailable": "check-backend",
  "backend-locked": "unlock-backend",
  "backend-unconfigured": "configure-backend",
  "backend-denied": "repair-policy",
  "untrusted-host": "trust-host",
  "broker-unavailable": "configure-broker",
  "version-conflict": "refresh-connection",
  incompatible: "check-request",
  "invalid-input": "check-request",
  "inventory-limit": "select-connection",
} as const satisfies Record<VaultConnectionState, VaultConnectionRepair>;
const report = (
  state: VaultConnectionState,
  choices: ReadonlyArray<VaultConnectionChoice> = [],
  selected: VaultConnectionPin | null = null,
): VaultConnectionReport => ({ state, selected, choices, repair: repair[state] });
const backendFailure = (error: VaultError): VaultConnectionReport =>
  report(
    (
      {
        configuration: "backend-unconfigured",
        locked: "backend-locked",
        denied: "backend-denied",
        unavailable: "backend-unavailable",
        "invalid-response": "backend-unavailable",
        "not-found": "missing",
        conflict: "version-conflict",
        "invalid-input": "invalid-input",
        archived: "inactive",
      } as const
    )[error.reason],
  );
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
const policyState = (reason: string): VaultConnectionState =>
  reason === "expired" ? "expired" : reason === "not-active" ? "revoked" : "policy-denied";
const make = Effect.gen(function* () {
  const core = yield* VaultCore.VaultCore,
    access = yield* VaultAccess.VaultAccess,
    store = yield* OpenBaoStore.OpenBaoStore,
    identity = yield* ServerEnvironmentIdentity,
    threads = yield* ThreadManagementService,
    crypto = yield* Crypto.Crypto;
  const environmentId = yield* identity.getEnvironmentId;
  const hash = (value: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  const profilesRoot = `environments/${yield* hash(environmentId)}/profiles`;
  const projectPreferences = Effect.fn("VaultConnections.projectPreferences")(function* (
    threadId: ThreadId,
    kind: VaultConnectionRequest["kind"],
  ) {
    const thread = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
    if (!thread || thread.deletedAt || thread.archivedAt) return [];
    const root = `${profilesRoot}/${yield* hash(thread.projectId)}`;
    const stored = yield* store.read(`${root}/registry`);
    if (!stored) return [];
    const registry = decodeRegistry(Redacted.value(stored.value));
    if (Option.isNone(registry)) return yield* new VaultError({ reason: "invalid-response" });
    const selected = registry.value.profiles.find(
      (profile) => profile.id === registry.value.activeProfileId && profile.state === "active",
    );
    let bindings: ReadonlyArray<
      (typeof Registry.Type.profiles)[number]["bindings"][number] & {
        readonly version?: number;
        readonly destination?: string;
        readonly profileActive?: boolean;
      }
    > = selected?.bindings ?? [];
    if (thread.activeRunId) {
      const key = yield* encodeRunKey({ threadId, runId: thread.activeRunId }).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const storedPin = yield* store.read(`${root}/runs/${yield* hash(key)}`);
      if (storedPin) {
        const pin = decodeRunPin(Redacted.value(storedPin.value));
        if (Option.isNone(pin)) return report("policy-denied");
        if (
          pin.value.environmentId !== environmentId ||
          pin.value.threadId !== threadId ||
          pin.value.runId !== thread.activeRunId ||
          pin.value.resolution.projectId !== thread.projectId
        )
          return yield* new VaultError({ reason: "invalid-response" });
        const profile = registry.value.profiles.find(
          (profile) => profile.id === pin.value.resolution.profileId && profile.state === "active",
        );
        bindings = pin.value.resolution.bindings.map((binding) => ({
          ...binding,
          profileActive: profile !== undefined,
        }));
      }
    }
    return bindings.filter(
      (binding) => binding.kind === (kind === "git-ssh" ? "git" : kind) && binding.itemId !== null,
    );
  });
  const metadata = Effect.fn("VaultConnections.metadata")(function* (
    item: VaultItemSummary,
    kind: VaultConnectionRequest["kind"],
    threadId: ThreadId,
  ) {
    yield* access.require(threadId, item.id, "inspect", null);
    const value = yield* core.reveal({ id: item.id, expectedVersion: item.version });
    if (value.item.state !== item.state) return null;
    const text = Redacted.value(value.value);
    if (kind === "github") {
      const stored = decodeGitHub(text);
      if (Option.isNone(stored)) return null;
      const choice: VaultConnectionChoice = {
        item,
        kind,
        hostname: "github.com",
        account: stored.value.account,
        repositories: stored.value.repositories.map((repository) => repository.toLowerCase()),
      };
      return { choice, target: null };
    }
    const stored = decodeSsh(text);
    if (Option.isNone(stored)) return null;
    const choice: VaultConnectionChoice = {
      item,
      kind,
      hostname: stored.value.target.hostname,
      account: stored.value.target.username,
      repositories: [],
    };
    return { choice, target: stored.value.target };
  });
  const evaluate = Effect.fn("VaultConnections.evaluate")(function* (
    record: NonNullable<Effect.Success<ReturnType<typeof metadata>>>,
    input: VaultConnectionRequest,
    threadId: ThreadId,
    pinned?: {
      readonly version?: number;
      readonly destination?: string;
      readonly profileActive?: boolean;
      readonly repository?: string | null;
    },
  ) {
    const { choice, target } = record;
    if ("id" in input.connection && input.connection.expectedVersion !== choice.item.version)
      return report("version-conflict", [choice]);
    if (choice.item.state !== "active") return report("inactive", [choice]);
    if (pinned?.profileActive === false) return report("inactive", [choice]);
    if (pinned?.version !== undefined && pinned.version !== choice.item.version)
      return report("version-conflict", [choice]);
    if (
      input.account &&
      (input.kind === "github"
        ? input.account.toLowerCase() !== choice.account?.toLowerCase()
        : input.account !== choice.account)
    )
      return report("incompatible", [choice]);
    let repository = input.repository ?? null;
    let destination: string;
    if (input.kind === "github") {
      if (repository === null && "resource" in input.connection) {
        const resource = normalize(input.connection.resource);
        repository =
          choice.repositories.find(
            (candidate) =>
              normalize(candidate) === resource ||
              normalize(vaultGitHubDestination(candidate)) === resource,
          ) ?? null;
      }
      if (repository === null && choice.repositories.length === 1)
        repository = choice.repositories[0]!;
      if (
        !repository ||
        !isGitHubRepository(repository) ||
        !choice.repositories.includes(repository.toLowerCase())
      )
        return report("incompatible", [choice]);
      repository = repository.toLowerCase();
      destination = vaultGitHubDestination(repository);
    } else {
      if (!target) return report("incompatible", [choice]);
      if (input.kind === "git-ssh") {
        if (!repository || !isGitRepository(repository)) return report("incompatible", [choice]);
        destination = vaultGitDestination(target, repository);
      } else {
        if (repository !== null) return report("invalid-input", [choice]);
        destination = vaultSshDestination(target);
      }
    }
    const sameRepository =
      pinned?.repository == null ||
      (input.kind === "github"
        ? pinned.repository.toLowerCase() === repository?.toLowerCase()
        : pinned.repository === repository);
    if (pinned?.destination !== undefined && sameRepository && pinned.destination !== destination)
      return report("version-conflict", [choice]);
    const explanation = yield* access.explain({
      threadId,
      itemId: choice.item.id,
      action: "use",
      destination,
    });
    if (!explanation.decision.allowed)
      return report(policyState(explanation.decision.reason), [choice]);
    if (target && !target.hostKey) return report("untrusted-host", [choice]);
    return report("ready", [choice], { ...choice, destination, repository });
  });
  const resolve = Effect.fn("VaultConnections.resolve")(
    function* (input: VaultConnectionRequest, threadId: ThreadId) {
      if (!isRequest(input)) return report("invalid-input");
      const kind = input.kind === "github" ? "service-connection" : "ssh-key";
      if ("id" in input.connection) {
        const inspect = yield* access.explain({
          threadId,
          itemId: input.connection.id,
          action: "inspect",
          destination: null,
        });
        if (!inspect.decision.allowed) {
          if (
            inspect.decision.reason === "item-unavailable" &&
            (yield* access.snapshot).ownerPolicy?.mode === "owner-trusted"
          )
            return report("missing");
          return report(policyState(inspect.decision.reason));
        }
        const item = yield* core.inspect(input.connection.id);
        if (!item) return report("missing");
        if (item.kind !== kind) return report("incompatible");
        if (item.version !== input.connection.expectedVersion) return report("version-conflict");
        if (item.state !== "active")
          return report("inactive", [
            { item, kind: input.kind, hostname: null, account: null, repositories: [] },
          ]);
        const loaded = yield* metadata(item, input.kind, threadId).pipe(Effect.result);
        if (loaded._tag === "Failure") {
          if (loaded.failure.reason === "denied") return report("policy-denied");
          return yield* loaded.failure;
        }
        return loaded.success
          ? yield* evaluate(loaded.success, input, threadId)
          : report("incompatible");
      }
      const selector = input.connection;
      const resource = normalize(selector.resource);
      const preferences = yield* projectPreferences(threadId, input.kind).pipe(
        Effect.catchTags({
          VaultError: (error) =>
            error.reason === "denied" || error.reason === "not-found"
              ? Effect.succeed([])
              : Effect.fail(error),
        }),
      );
      if ("state" in preferences) return preferences;
      const preferredIds =
        selector.preferredItemIds ??
        preferences
          .filter(
            (binding) =>
              !input.repository ||
              !binding.repository ||
              normalize(binding.repository) === normalize(input.repository),
          )
          .map((binding) => binding.itemId!);
      const matches: VaultConnectionReport[] = [];
      let cursor: string | null = null;
      // Bound inventory work; incomplete scans never authorize a seemingly unique match.
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const page: VaultItemPage = yield* access.listForThread(
          { cursor, includeArchived: true },
          threadId,
        );
        for (const item of page.items) {
          if (item.kind !== kind) continue;
          const aliases = preferences
            .filter((binding) => binding.itemId === item.id)
            .flatMap((binding) =>
              binding.repository ? [binding.name, binding.repository] : [binding.name],
            );
          const matchesLabel = [item.label, item.id, ...aliases].some(
            (name) => normalize(name) === resource,
          );
          if (item.state !== "active") {
            if (matchesLabel)
              matches.push(
                report("inactive", [
                  { item, kind: input.kind, hostname: null, account: null, repositories: [] },
                ]),
              );
            continue;
          }
          const loaded = yield* metadata(item, input.kind, threadId).pipe(Effect.result);
          if (loaded._tag === "Failure") {
            if (loaded.failure.reason !== "denied") return yield* loaded.failure;
            if (matchesLabel)
              matches.push(
                report("policy-denied", [
                  { item, kind: input.kind, hostname: null, account: null, repositories: [] },
                ]),
              );
            continue;
          }
          const record = loaded.success;
          if (!record) {
            if (matchesLabel)
              matches.push(
                report("incompatible", [
                  { item, kind: input.kind, hostname: null, account: null, repositories: [] },
                ]),
              );
            continue;
          }
          const names = [
            item.label,
            item.id,
            ...aliases,
            record.choice.hostname ?? "",
            record.choice.account ?? "",
            ...record.choice.repositories,
          ];
          if (
            record.target &&
            input.kind === "git-ssh" &&
            input.repository &&
            isGitRepository(input.repository)
          )
            names.push(vaultGitDestination(record.target, input.repository));
          if (record.target)
            names.push(
              vaultSshDestination(record.target),
              `${record.target.username}@${record.target.hostname}`,
              record.target.hostname.split(".")[0]!,
            );
          else names.push(...record.choice.repositories.map(vaultGitHubDestination));
          if (!names.some((name) => normalize(name) === resource)) continue;
          const pinned = preferences.find(
            (binding) =>
              binding.itemId === item.id &&
              (!input.repository ||
                !binding.repository ||
                normalize(binding.repository) === normalize(input.repository)),
          );
          matches.push(yield* evaluate(record, input, threadId, pinned));
        }
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      if (cursor !== null) return report("inventory-limit");
      const preferred = matches.filter((match) =>
        match.choices.some((choice) => preferredIds.includes(choice.item.id)),
      );
      const candidates = preferred.length > 0 ? preferred : matches;
      const ready = candidates.filter((match) => match.state === "ready");
      if (ready.length === 1) return ready[0]!;
      if (ready.length > 1)
        return report(
          "ambiguous",
          ready.flatMap((match) => match.choices),
        );
      if (candidates.length === 1) return candidates[0]!;
      if (candidates.length > 1) {
        const state = candidates.every((match) => match.state === candidates[0]!.state)
          ? candidates[0]!.state
          : "incompatible";
        return report(
          state,
          candidates.flatMap((match) => match.choices),
        );
      }
      const policy = yield* access.snapshot;
      return report(policy.ownerPolicy?.mode === "owner-trusted" ? "missing" : "policy-denied");
    },
    Effect.catchTags({ VaultError: (error) => Effect.succeed(backendFailure(error)) }),
  );
  const requireConnection = Effect.fn("VaultConnections.require")(function* (
    input: VaultConnectionRequest,
    threadId: ThreadId,
  ) {
    const result = yield* resolve(input, threadId);
    if (result.state !== "ready" || result.selected === null)
      return yield* new VaultConnectionError({
        state: result.state,
        choices: result.choices,
        repair: result.repair,
      });
    return result.selected;
  });
  return VaultConnections.of({
    resolve,
    require: requireConnection,
    revalidate: Effect.fn("VaultConnections.revalidate")(function* (pin, threadId) {
      if (!isPin(pin))
        return yield* new VaultConnectionError({
          state: "invalid-input",
          choices: [],
          repair: repair["invalid-input"],
        });
      const current = yield* requireConnection(
        {
          kind: pin.kind,
          connection: { id: pin.item.id, expectedVersion: pin.item.version },
          ...(pin.repository ? { repository: pin.repository } : {}),
          ...(pin.account ? { account: pin.account } : {}),
        },
        threadId,
      );
      if (current.destination !== pin.destination || current.hostname !== pin.hostname)
        return yield* new VaultConnectionError({
          state: "version-conflict",
          choices: [current],
          repair: repair["version-conflict"],
        });
      yield* access.require(threadId, pin.item.id, "use", pin.destination).pipe(
        Effect.mapError((error) => {
          const state = error.reason === "denied" ? "policy-denied" : backendFailure(error).state;
          return new VaultConnectionError({ state, choices: [], repair: repair[state] });
        }),
      );
    }),
  });
});
export const layer = Layer.effect(VaultConnections, make);
