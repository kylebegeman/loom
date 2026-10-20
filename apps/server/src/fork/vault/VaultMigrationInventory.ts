import { ProjectId } from "@t3tools/contracts";
import {
  VaultError,
  VaultSshError,
  VaultReplacementError,
  VaultMigrationInventoryInput,
  VaultReplacementPrepare,
  VaultReplacementReview,
  VaultReplacementList,
  VaultReplacementPlan,
  VaultReplacementVerify,
  VaultOriginalVerify,
  VaultRecoverySnapshotInput,
  type VaultOriginalVerificationStatus,
  type VaultRecoverySnapshotPreview,
  VaultItemId,
  VaultReplacementPreviewInput,
  type VaultReplacementPreview,
  VaultReplacementVerificationReceipt,
  type VaultReplacementVerificationStatus,
  type VaultVerificationFailure,
  type VaultMigrationInventoryPage,
  type VaultMigrationProject,
  type VaultMigrationDependency,
  type VaultReplacementResult,
  type VaultReplacementPage,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as MigrationGitMetadata from "./MigrationGitMetadata.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultSsh from "./VaultSsh.ts";
import * as VaultGitHub from "./VaultGitHub.ts";

type Failure = VaultError | VaultReplacementError;
export class VaultMigrationInventory extends Context.Service<
  VaultMigrationInventory,
  {
    readonly originalVerify: (
      input: VaultOriginalVerify,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultOriginalVerificationStatus, Failure>;
    readonly originalVerification: (
      id: string,
    ) => Effect.Effect<VaultOriginalVerificationStatus, Failure>;
    readonly recoveryPreview: (
      input: VaultRecoverySnapshotInput,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultRecoverySnapshotPreview, Failure>;
    readonly preview: (
      input: VaultReplacementPreviewInput,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultReplacementPreview, Failure>;
    readonly verify: (
      input: VaultReplacementVerify,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultReplacementVerificationStatus, Failure>;
    readonly verification: (
      id: string,
    ) => Effect.Effect<VaultReplacementVerificationStatus, Failure>;
    readonly inventory: (
      input: VaultMigrationInventoryInput,
    ) => Effect.Effect<VaultMigrationInventoryPage, VaultError>;
    readonly prepare: (
      input: VaultReplacementPrepare,
      actor: string,
    ) => Effect.Effect<VaultReplacementResult, Failure>;
    readonly inspect: (id: string) => Effect.Effect<VaultReplacementResult, Failure>;
    readonly list: (input: VaultReplacementList) => Effect.Effect<VaultReplacementPage, Failure>;
    readonly review: (
      input: VaultReplacementReview,
      actor: string,
    ) => Effect.Effect<VaultReplacementResult, Failure>;
    readonly cancel: (id: string) => Effect.Effect<VaultReplacementResult, Failure>;
  }
>()("t3/fork/vault/VaultMigrationInventory") {}
const Stored = Schema.Struct({
  protocol: Schema.Literal(1),
  plan: VaultReplacementPlan,
  sourceFingerprint: Schema.String,
  requestFingerprint: Schema.String,
  preparedBy: Schema.String,
  reviewedBy: Schema.NullOr(Schema.String),
  verification: Schema.optionalKey(
    Schema.Struct({
      receipt: VaultReplacementVerificationReceipt,
      requestedBy: Schema.String,
      expectedOperationId: Schema.NullOr(VaultReplacementVerify.fields.operationId),
    }),
  ),
  originalVerification: Schema.optionalKey(
    Schema.Struct({
      receipt: VaultReplacementVerificationReceipt.check(
        Schema.makeFilter((receipt) => receipt.scope === "ssh-git-transport"),
      ),
      requestedBy: Schema.String,
      expectedOperationId: Schema.NullOr(VaultItemId),
    }),
  ),
});
type Stored = typeof Stored.Type;
const decode = Schema.decodeUnknownOption(Stored),
  encode = Schema.encodeEffect(Stored);
const isVerify = Schema.is(VaultReplacementVerify);
const isOriginalVerify = Schema.is(VaultOriginalVerify),
  isRecoveryInput = Schema.is(VaultRecoverySnapshotInput);
const encodeRecoveryBasis = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      environment: Schema.String,
      source: Schema.String,
      plan: VaultItemId,
      original: VaultReplacementVerificationReceipt,
      replacement: VaultReplacementVerificationReceipt,
    }),
  ),
);
const isPreview = Schema.is(VaultReplacementPreviewInput);
const isInventory = Schema.is(VaultMigrationInventoryInput),
  isPrepare = Schema.is(VaultReplacementPrepare),
  isReview = Schema.is(VaultReplacementReview),
  isList = Schema.is(VaultReplacementList);
const invalid = () => new VaultError({ reason: "invalid-input" });
const fail = (reason: VaultReplacementError["reason"]) => new VaultReplacementError({ reason });
const sameDependency = (a: VaultMigrationDependency, b: VaultMigrationDependency) =>
  a.remote === b.remote &&
  a.direction === b.direction &&
  a.position === b.position &&
  a.transport === b.transport &&
  a.hostname === b.hostname &&
  a.port === b.port &&
  a.repository === b.repository &&
  a.gitPath === b.gitPath &&
  a.embeddedAuthentication === b.embeddedAuthentication;
const encodeSource = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      projectId: ProjectId,
      workspaceRoot: Schema.String,
      raw: Schema.RedactedFromValue(Schema.String),
    }),
  ),
);
const encodeRequest = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      projectId: VaultReplacementPrepare.fields.projectId,
      dependency: VaultReplacementPrepare.fields.dependency,
      replacement: VaultReplacementPrepare.fields.replacement,
    }),
  ),
);
const encodePreviewBasis = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      environment: Schema.String,
      source: Schema.String,
      plan: VaultItemId,
      receipt: VaultReplacementVerificationReceipt,
      kind: VaultReplacementPreviewInput.fields.kind,
      from: Schema.Literals(["existing-project-git", "vault-mediated-git-read"]),
      to: Schema.Literals(["existing-project-git", "vault-mediated-git-read"]),
    }),
  ),
);
const VERIFICATION_TIMEOUT_MS = 30_000;
const VERIFICATION_TTL_MS = 60_000;
const verificationFailure = (error: {
  readonly _tag: string;
  readonly reason?: string;
}): VaultVerificationFailure => {
  const reason = error.reason;
  if (
    error._tag === "TimeoutException" ||
    reason === "verification-timeout" ||
    reason === "timeout"
  )
    return "timeout";
  if (
    reason === "source-changed" ||
    reason === "source-unavailable" ||
    reason === "item-changed" ||
    reason === "replacement-unavailable" ||
    reason === "cancelled" ||
    reason === "expired" ||
    reason === "untrusted-host" ||
    reason === "unsupported" ||
    reason === "unavailable"
  )
    return reason;
  if (reason === "denied" || reason === "unauthorized" || reason === "repository-denied")
    return "denied";
  if (reason === "conflict" || reason === "archived" || reason === "not-found")
    return "item-changed";
  return "failed";
};
const REVIEW_TTL_MS = 10 * 60_000;
const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore,
    core = yield* VaultCore.VaultCore,
    projects = yield* ProjectStoreV2,
    git = yield* MigrationGitMetadata.MigrationGitMetadata,
    ssh = yield* VaultSsh.VaultSsh,
    github = yield* VaultGitHub.VaultGitHub,
    identity = yield* ServerEnvironmentIdentity,
    crypto = yield* Crypto.Crypto;
  const hash = (value: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  const prefix = `environments/${yield* hash(yield* identity.getEnvironmentId)}/migration-replacements`;
  const lock = yield* Semaphore.make(1);
  const source = Effect.fnUntraced(function* (projectId: ProjectId) {
    const found = yield* projects
      .getShell(projectId)
      .pipe(Effect.mapError(() => fail("source-unavailable")));
    if (Option.isNone(found)) return yield* fail("source-unavailable");
    const project = found.value;
    const snapshot = yield* git
      .read(project.workspaceRoot)
      .pipe(Effect.mapError(() => fail("source-unavailable")));
    return {
      project,
      metadata: snapshot.metadata,
      raw: snapshot.raw,
      fingerprint: yield* hash(
        yield* encodeSource({
          projectId: project.id,
          workspaceRoot: project.workspaceRoot,
          raw: snapshot.raw,
        }).pipe(Effect.mapError(invalid)),
      ),
    };
  });
  const replacement = Effect.fnUntraced(function* (input: VaultReplacementPrepare) {
    const selection = input.replacement,
      dependency = input.dependency;
    const item = yield* core.inspect(selection.itemId);
    if (!item || item.state !== "active" || item.version !== selection.expectedVersion)
      return yield* fail("item-changed");
    if (selection.adapter === "ssh") {
      if (dependency.transport !== "ssh" || item.kind !== "ssh-key" || !dependency.gitPath)
        return yield* fail("unsupported-source");
      const info = yield* ssh
        .info(item.id)
        .pipe(Effect.mapError(() => fail("replacement-unavailable")));
      if (info.item.version !== item.version || info.item.state !== "active")
        return yield* fail("item-changed");
      if (info.target.hostname !== dependency.hostname || info.target.port !== dependency.port)
        return yield* fail("unsupported-source");
      return {
        ...selection,
        label: item.label,
        destination: info.destination,
        hostTrust: info.hostFingerprint === null ? ("missing" as const) : ("pinned" as const),
        scope: "ssh-git-transport" as const,
      };
    }
    if (
      dependency.hostname !== "github.com" ||
      dependency.port !== (dependency.transport === "ssh" ? 22 : 443) ||
      !dependency.repository ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(dependency.repository) ||
      item.kind !== "service-connection"
    )
      return yield* fail("unsupported-source");
    const info = yield* github
      .info(item.id)
      .pipe(Effect.mapError(() => fail("replacement-unavailable")));
    if (info.item.version !== item.version || info.item.state !== "active")
      return yield* fail("item-changed");
    if (!info.repositories.includes(dependency.repository.toLowerCase()))
      return yield* fail("unsupported-source");
    return {
      ...selection,
      label: item.label,
      destination: `github.com/${dependency.repository.toLowerCase()}`,
      hostTrust: "not-applicable" as const,
      scope: "github-api-and-gh-only" as const,
    };
  });
  const load = Effect.fnUntraced(function* (id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) return yield* invalid();
    const stored = yield* store.read(`${prefix}/${id}`);
    if (!stored) return yield* new VaultError({ reason: "not-found" });
    const record = decode(Redacted.value(stored.value));
    if (Option.isNone(record) || record.value.plan.id !== id)
      return yield* new VaultError({ reason: "invalid-response" });
    return { record: record.value, version: stored.version };
  });
  const save = (record: Stored, version: number) =>
    encode(record).pipe(
      Effect.mapError(invalid),
      Effect.flatMap((value) =>
        store.write(`${prefix}/${record.plan.id}`, Redacted.make(value), version),
      ),
    );
  const check = Effect.fnUntraced(function* (record: Stored) {
    const current = yield* source(record.plan.projectId);
    if (current.fingerprint !== record.sourceFingerprint) return yield* fail("source-changed");
    yield* replacement({
      id: record.plan.id,
      projectId: record.plan.projectId,
      dependency: record.plan.dependency,
      replacement: record.plan.replacement,
      developmentOnly: true,
    });
  });
  const checkOriginal = Effect.fnUntraced(function* (
    record: Stored,
    selection: { itemId: string; expectedVersion: number },
  ) {
    const dep = record.plan.dependency;
    if (
      record.plan.replacement.adapter !== "ssh" ||
      record.plan.replacement.scope !== "ssh-git-transport"
    )
      return yield* fail("verification-scope");
    if (dep.direction !== "fetch") return yield* fail("unsupported-operation");
    if (
      dep.transport !== "ssh" ||
      !dep.gitPath ||
      selection.itemId === record.plan.replacement.itemId
    )
      return yield* fail("original-identity-required");
    const current = yield* source(record.plan.projectId);
    if (current.fingerprint !== record.sourceFingerprint) return yield* fail("source-changed");
    if (
      dep.embeddedAuthentication ||
      current.metadata.localUrlRewrite ||
      current.metadata.localSshCommand ||
      current.metadata.omittedDependencies > 0
    )
      return yield* fail("unsafe-source");
    const username = MigrationGitMetadata.migrationOriginalSshUsername(current.raw, dep);
    if (!username) return yield* fail("original-identity-required");
    const item = yield* core.inspect(selection.itemId);
    if (
      !item ||
      item.state !== "active" ||
      item.version !== selection.expectedVersion ||
      item.kind !== "ssh-key"
    )
      return yield* fail("item-changed");
    const info = yield* ssh
      .info(item.id)
      .pipe(Effect.mapError(() => fail("replacement-unavailable")));
    if (
      info.item.id !== item.id ||
      info.item.version !== item.version ||
      info.item.state !== "active"
    )
      return yield* fail("item-changed");
    if (
      info.target.username !== username ||
      info.target.hostname !== dep.hostname ||
      info.target.port !== dep.port
    )
      return yield* fail("original-identity-required");
    return info;
  });
  const view = Effect.fnUntraced(function* (
    record: Stored,
    validate: boolean,
  ): Effect.fn.Return<VaultReplacementResult, VaultError> {
    const expired =
      record.plan.state !== "cancelled" &&
      (yield* Clock.currentTimeMillis) >= record.plan.expiresAt;
    let validation: VaultReplacementResult["validation"] = "not-checked";
    if (validate) {
      validation = yield* check(record).pipe(
        Effect.as("current" as const),
        Effect.catchTags({
          VaultReplacementError: (error) =>
            Effect.succeed(
              error.reason === "source-changed" ||
                error.reason === "source-unavailable" ||
                error.reason === "item-changed"
                ? error.reason
                : ("replacement-unavailable" as const),
            ),
        }),
      );
    }
    return {
      plan: { ...record.plan, state: expired ? "expired" : record.plan.state },
      validation,
      verification: "required",
      canCutover: false,
    };
  });

  const verificationView = Effect.fnUntraced(function* (
    record: Stored,
    original = false,
  ): Effect.fn.Return<VaultReplacementVerificationStatus, VaultError> {
    const now = yield* Clock.currentTimeMillis;
    const planState =
      record.plan.state !== "cancelled" && now >= record.plan.expiresAt
        ? "expired"
        : record.plan.state;
    const receipt = record[original ? "originalVerification" : "verification"]?.receipt ?? null;
    const result = {
      planId: record.plan.id,
      planState,
      receipt,
      workloadAuthorization: "not-evaluated" as const,
      canCutover: false as const,
    };
    if (!receipt) return { ...result, freshness: "not-run", invalidatedBy: null };
    if (
      receipt.planId !== record.plan.id ||
      (receipt.scope === "ssh-git-transport" &&
        receipt.gitPath !== record.plan.dependency.gitPath) ||
      (!original &&
        (receipt.itemId !== record.plan.replacement.itemId ||
          receipt.itemVersion !== record.plan.replacement.expectedVersion ||
          receipt.destination !== record.plan.replacement.destination))
    )
      return yield* new VaultError({ reason: "invalid-response" });
    if (planState === "cancelled" || planState === "expired")
      return { ...result, freshness: "invalidated", invalidatedBy: planState };
    if (receipt.state === "running")
      return {
        ...result,
        freshness: now >= receipt.deadlineAt ? "interrupted" : "running",
        invalidatedBy: null,
      };
    if (receipt.state === "failed")
      return { ...result, freshness: "failed", invalidatedBy: receipt.failure };
    if (receipt.validUntil === null || now >= receipt.validUntil)
      return { ...result, freshness: "expired", invalidatedBy: null };
    const current = yield* Effect.result(
      original
        ? receipt.scope !== "ssh-git-transport"
          ? Effect.fail(fail("verification-scope"))
          : checkOriginal(record, {
              itemId: receipt.itemId,
              expectedVersion: receipt.itemVersion,
            }).pipe(
              Effect.flatMap((info) =>
                info.hostFingerprint === receipt.hostFingerprint &&
                info.destination === receipt.destination
                  ? Effect.void
                  : Effect.fail(fail("item-changed")),
              ),
            )
        : check(record),
    );
    if (current._tag === "Failure")
      return {
        ...result,
        freshness: "invalidated",
        invalidatedBy: verificationFailure(current.failure),
      };
    return { ...result, freshness: "current", invalidatedBy: null };
  });
  const verify = Effect.fn("VaultMigrationInventory.verify")(function* (
    input: VaultReplacementVerify,
    actor: string,
    authorize: Effect.Effect<void, VaultError>,
    originalSelection?: { itemId: string; expectedVersion: number },
  ) {
    if (!isVerify(input) || !actor.trim() || actor.length > 512) return yield* invalid();
    const original = originalSelection !== undefined;
    const slot = original ? "originalVerification" : "verification";
    yield* authorize;
    const accepted = yield* lock.withPermit(
      Effect.gen(function* () {
        const { record, version } = yield* load(input.id);
        const prior = record[slot];
        if (prior?.receipt.operationId === input.operationId) {
          if (
            (originalSelection !== undefined &&
              (prior.receipt.itemId !== originalSelection.itemId ||
                prior.receipt.itemVersion !== originalSelection.expectedVersion)) ||
            prior.requestedBy !== actor ||
            prior.expectedOperationId !== input.expectedOperationId
          )
            return yield* fail("receipt-changed");
          return { record, duplicate: true };
        }
        if ((prior?.receipt.operationId ?? null) !== input.expectedOperationId)
          return yield* fail("receipt-changed");
        const now = yield* Clock.currentTimeMillis;
        if (record.plan.state === "cancelled") return yield* fail("cancelled");
        if (record.plan.state !== "reviewed") return yield* fail("invalid-state");
        if (now >= record.plan.expiresAt) return yield* fail("expired");
        if (prior?.receipt.state === "running" && now < prior.receipt.deadlineAt)
          return yield* fail("verification-busy");
        const originalInfo = originalSelection
          ? yield* checkOriginal(record, originalSelection)
          : null;
        if (!original) yield* check(record);
        const startedAt = yield* Clock.currentTimeMillis;
        if (startedAt >= record.plan.expiresAt) return yield* fail("expired");
        const next: Stored = {
          ...record,
          [slot]: {
            requestedBy: actor,
            expectedOperationId: input.expectedOperationId,
            receipt: {
              operationId: input.operationId,
              planId: input.id,
              itemId: originalSelection?.itemId ?? record.plan.replacement.itemId,
              itemVersion:
                originalSelection?.expectedVersion ?? record.plan.replacement.expectedVersion,
              scope: original ? ("ssh-git-transport" as const) : record.plan.replacement.scope,
              destination: originalInfo?.destination ?? record.plan.replacement.destination,
              gitPath:
                record.plan.replacement.adapter === "ssh" ? record.plan.dependency.gitPath : null,
              state: "running",
              startedAt,
              deadlineAt: startedAt + VERIFICATION_TIMEOUT_MS,
              completedAt: null,
              validUntil: null,
              failure: null,
              hostFingerprint: null,
            },
          },
        };
        yield* save(next, version);
        return { record: next, duplicate: false };
      }),
    );
    if (accepted.duplicate) return yield* verificationView(accepted.record, original);
    const record = accepted.record,
      plan = record.plan,
      initial = record[slot]!;
    const guard = Effect.gen(function* () {
      yield* authorize;
      const latest = yield* load(input.id);
      if (latest.record.plan.state === "cancelled") return yield* fail("cancelled");
      if (
        latest.record.plan.state !== "reviewed" ||
        latest.record[slot]?.receipt.operationId !== input.operationId
      )
        return yield* fail("receipt-changed");
      const now = yield* Clock.currentTimeMillis;
      if (now >= plan.expiresAt) return yield* fail("expired");
      if (now >= initial.receipt.deadlineAt) return yield* fail("verification-timeout");
      const current = yield* core.inspect(initial.receipt.itemId);
      if (!current || current.state !== "active" || current.version !== initial.receipt.itemVersion)
        return yield* fail("item-changed");
      if (originalSelection) yield* checkOriginal(record, originalSelection);
    });
    const credentialGuard = guard.pipe(
      Effect.mapError(
        (error) =>
          new VaultError({
            reason: verificationFailure(error) === "denied" ? "denied" : "conflict",
          }),
      ),
    );
    const outcome = yield* Effect.gen(function* () {
      yield* guard;
      if (originalSelection) yield* checkOriginal(record, originalSelection);
      else yield* check(record);
      let hostFingerprint: string | null = null,
        upstreamExpiry: number | null = null;
      if (original || plan.replacement.adapter === "ssh") {
        if (
          originalSelection
            ? (yield* checkOriginal(record, originalSelection)).hostFingerprint === null
            : plan.replacement.hostTrust !== "pinned"
        )
          return yield* new VaultSshError({ reason: "untrusted-host" });
        if (!plan.dependency.gitPath) return yield* fail("replacement-unavailable");
        const checked = yield* ssh.verifyGit(
          {
            id: initial.receipt.itemId,
            expectedVersion: initial.receipt.itemVersion,
            repository: plan.dependency.gitPath,
          },
          credentialGuard,
        );
        if (
          checked.destination !== initial.receipt.destination ||
          checked.repository !== plan.dependency.gitPath ||
          checked.version !== initial.receipt.itemVersion ||
          checked.id !== initial.receipt.itemId
        )
          return yield* fail("item-changed");
        hostFingerprint = checked.hostFingerprint;
      } else {
        const checked = yield* github.test(
          {
            id: plan.replacement.itemId,
            expectedVersion: plan.replacement.expectedVersion,
            repository: plan.dependency.repository!.toLowerCase(),
          },
          credentialGuard,
        );
        if (checked.repository !== plan.dependency.repository!.toLowerCase())
          return yield* fail("replacement-unavailable");
        if (checked.tokenExpiresAt !== null) {
          upstreamExpiry = Date.parse(checked.tokenExpiresAt);
          if (!Number.isFinite(upstreamExpiry)) return yield* fail("replacement-unavailable");
        }
      }
      yield* guard;
      if (originalSelection) yield* checkOriginal(record, originalSelection);
      else yield* check(record);
      const now = yield* Clock.currentTimeMillis;
      return {
        hostFingerprint,
        validUntil: Math.min(now + VERIFICATION_TTL_MS, plan.expiresAt, upstreamExpiry ?? Infinity),
      };
    }).pipe(Effect.timeout(VERIFICATION_TIMEOUT_MS), Effect.result);
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const latest = yield* load(input.id);
        if (latest.record[slot]?.receipt.operationId !== input.operationId)
          return yield* fail("receipt-changed");
        const ending = yield* Effect.result(guard);
        const completedAt = yield* Clock.currentTimeMillis;
        const failure =
          ending._tag === "Failure"
            ? verificationFailure(ending.failure)
            : outcome._tag === "Failure"
              ? verificationFailure(outcome.failure)
              : null;
        const next: Stored = {
          ...latest.record,
          [slot]: {
            ...initial,
            receipt: {
              ...initial.receipt,
              state: failure === null ? "passed" : "failed",
              completedAt,
              failure,
              validUntil:
                failure === null && outcome._tag === "Success" ? outcome.success.validUntil : null,
              hostFingerprint: outcome._tag === "Success" ? outcome.success.hostFingerprint : null,
            },
          },
        };
        yield* save(next, latest.version);
        return yield* verificationView(next, original);
      }),
    );
  });
  const preview = (
    input: VaultReplacementPreviewInput,
    authorize: Effect.Effect<void, VaultError>,
  ) =>
    lock.withPermit(
      Effect.gen(function* () {
        if (!isPreview(input)) return yield* invalid();
        yield* authorize;
        const { record } = yield* load(input.id);
        const plan = record.plan;
        if (plan.state === "cancelled") return yield* fail("cancelled");
        if (plan.state !== "reviewed") return yield* fail("invalid-state");
        if (plan.replacement.adapter !== "ssh" || plan.replacement.scope !== "ssh-git-transport")
          return yield* fail("verification-scope");
        if (plan.dependency.direction !== "fetch") return yield* fail("unsupported-operation");
        const current = yield* source(plan.projectId);
        if (current.fingerprint !== record.sourceFingerprint) return yield* fail("source-changed");
        if (
          plan.dependency.embeddedAuthentication ||
          current.metadata.localUrlRewrite ||
          current.metadata.omittedDependencies > 0
        )
          return yield* fail("unsafe-source");
        yield* check(record);
        const receipt = record.verification?.receipt;
        if (!receipt || receipt.state !== "passed") return yield* fail("verification-required");
        if (receipt.operationId !== input.expectedOperationId)
          return yield* fail("receipt-changed");
        if (receipt.scope !== "ssh-git-transport") return yield* fail("verification-scope");
        if (
          receipt.planId !== plan.id ||
          receipt.itemId !== plan.replacement.itemId ||
          receipt.itemVersion !== plan.replacement.expectedVersion ||
          receipt.destination !== plan.replacement.destination ||
          receipt.gitPath !== plan.dependency.gitPath ||
          !receipt.hostFingerprint
        )
          return yield* fail("receipt-changed");
        const info = yield* ssh
          .info(plan.replacement.itemId)
          .pipe(Effect.mapError(() => fail("replacement-unavailable")));
        if (
          info.hostFingerprint !== receipt.hostFingerprint ||
          info.destination !== receipt.destination
        )
          return yield* fail("item-changed");
        // This is a routing inverse, not a captured configuration backup or proof of the old identity.
        const from =
          input.kind === "cutover"
            ? ("existing-project-git" as const)
            : ("vault-mediated-git-read" as const);
        const to =
          input.kind === "cutover"
            ? ("vault-mediated-git-read" as const)
            : ("existing-project-git" as const);
        const previewId = yield* hash(
          yield* encodePreviewBasis({
            environment: prefix,
            source: record.sourceFingerprint,
            plan: plan.id,
            receipt,
            kind: input.kind,
            from,
            to,
          }).pipe(Effect.mapError(invalid)),
        );
        yield* check(record);
        const latest = yield* load(input.id);
        if (latest.record.plan.state === "cancelled") return yield* fail("cancelled");
        if (
          latest.record.verification?.receipt.operationId !== receipt.operationId ||
          latest.record.sourceFingerprint !== record.sourceFingerprint
        )
          return yield* fail("receipt-changed");
        yield* authorize;
        const checkedAt = yield* Clock.currentTimeMillis;
        if (checkedAt >= plan.expiresAt) return yield* fail("expired");
        if (receipt.validUntil === null || checkedAt >= receipt.validUntil)
          return yield* fail("verification-required");
        return {
          kind: input.kind,
          planId: plan.id,
          projectId: plan.projectId,
          previewId,
          checkedAt,
          validUntil: Math.min(plan.expiresAt, receipt.validUntil),
          verificationOperationId: receipt.operationId,
          verifiedOperation: "ssh-repository-read" as const,
          hostFingerprint: receipt.hostFingerprint,
          source: plan.dependency,
          replacement: {
            itemId: plan.replacement.itemId,
            expectedVersion: plan.replacement.expectedVersion,
            destination: receipt.destination,
            repository: receipt.gitPath!,
          },
          from,
          to,
          rollbackBasis: "hypothetical-forward-route" as const,
          originalAccess: "not-verified" as const,
          conflictGuard: "exact-source-and-forward-route-required" as const,
          configurationSnapshot: "not-captured" as const,
          workloadAuthorization: "not-evaluated" as const,
          providerRevocation: "unknown-after-verification" as const,
          configurationWrites: false as const,
          canCutover: false as const,
          canRollback: false as const,
        };
      }),
    );
  const asOriginalStatus = (status: VaultReplacementVerificationStatus) => ({
    ...status,
    role: "original-development-route" as const,
    identityBinding: "explicit-development-selection" as const,
    ambientAuthentication: "not-evaluated" as const,
    canRollback: false as const,
    configurationWrites: false as const,
  });
  const originalView = (record: Stored) =>
    verificationView(record, true).pipe(Effect.map(asOriginalStatus));
  return VaultMigrationInventory.of({
    originalVerify: (input, actor, authorize) =>
      Effect.gen(function* () {
        if (!isOriginalVerify(input)) return yield* invalid();
        return asOriginalStatus(yield* verify(input, actor, authorize, input.original));
      }),
    originalVerification: (id) => Effect.flatMap(load(id), ({ record }) => originalView(record)),
    recoveryPreview: (input, authorize) =>
      Effect.gen(function* () {
        if (!isRecoveryInput(input)) return yield* invalid();
        yield* preview(
          {
            id: input.id,
            kind: "rollback",
            expectedOperationId: input.expectedReplacementOperationId,
          },
          authorize,
        );
        return yield* lock.withPermit(
          Effect.gen(function* () {
            yield* authorize;
            const { record } = yield* load(input.id),
              plan = record.plan;
            if (plan.state === "cancelled") return yield* fail("cancelled");
            const original = record.originalVerification?.receipt,
              replacement = record.verification?.receipt;
            if (
              !original ||
              !replacement ||
              original.state !== "passed" ||
              replacement.state !== "passed"
            )
              return yield* fail("verification-required");
            if (
              original.operationId !== input.expectedOriginalOperationId ||
              replacement.operationId !== input.expectedReplacementOperationId
            )
              return yield* fail("receipt-changed");
            if (original.scope !== "ssh-git-transport" || replacement.scope !== "ssh-git-transport")
              return yield* fail("verification-scope");
            const info = yield* checkOriginal(record, {
              itemId: original.itemId,
              expectedVersion: original.itemVersion,
            });
            if (
              original.planId !== plan.id ||
              original.gitPath !== plan.dependency.gitPath ||
              original.destination !== info.destination ||
              original.hostFingerprint !== info.hostFingerprint
            )
              return yield* fail("receipt-changed");
            yield* check(record);
            const replacementInfo = yield* ssh
              .info(replacement.itemId)
              .pipe(Effect.mapError(() => fail("replacement-unavailable")));
            if (
              replacement.itemId !== plan.replacement.itemId ||
              replacement.itemVersion !== plan.replacement.expectedVersion ||
              replacement.hostFingerprint !== replacementInfo.hostFingerprint
            )
              return yield* fail("item-changed");
            const designId = yield* hash(
              yield* encodeRecoveryBasis({
                environment: prefix,
                source: record.sourceFingerprint,
                plan: plan.id,
                original,
                replacement,
              }).pipe(Effect.mapError(invalid)),
            );
            yield* authorize;
            const checkedAt = yield* Clock.currentTimeMillis,
              validUntil = Math.min(
                plan.expiresAt,
                original.validUntil ?? 0,
                replacement.validUntil ?? 0,
              );
            if (checkedAt >= validUntil) return yield* fail("verification-required");
            return {
              planId: plan.id,
              projectId: plan.projectId,
              designId,
              checkedAt,
              validUntil,
              source: plan.dependency,
              original,
              replacement,
              originalAccess: "selected-development-key-read-verified" as const,
              ambientAuthentication: "not-evaluated" as const,
              workloadAuthorization: "not-evaluated" as const,
              snapshotState: "design-only" as const,
              configurationSnapshot: "not-captured" as const,
              proposedStorage: "existing-replacement-ledger" as const,
              proposedCapture: "selected-nonsecret-fetch-entry-and-route-manifest" as const,
              proposedRecovery: "journal-with-preimage-and-postimage-reconciliation" as const,
              captureEngine: "unimplemented" as const,
              concurrentWriterStrategy: "unresolved" as const,
              privateMaterial: "references-only" as const,
              globalSshConfiguration: "excluded" as const,
              canCutover: false as const,
              canRollback: false as const,
              configurationWrites: false as const,
            };
          }),
        );
      }),
    preview,
    verify,
    verification: (id) => Effect.flatMap(load(id), ({ record }) => verificationView(record)),
    inventory: Effect.fn("VaultMigrationInventory.inventory")(function* (input) {
      if (!isInventory(input)) return yield* invalid();
      const all = yield* projects
        .listShells()
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
      const remaining = all
        .toSorted((a, b) => a.id.localeCompare(b.id))
        .filter((p) => input.cursor === null || p.id.localeCompare(input.cursor) > 0);
      const page = remaining.slice(0, 10);
      const entries = yield* Effect.forEach(
        page,
        (project) =>
          git.read(project.workspaceRoot).pipe(
            Effect.map(({ metadata }): VaultMigrationProject => ({
              projectId: project.id,
              title: project.title,
              state: "inspected",
              ...metadata,
            })),
            Effect.catch(() =>
              Effect.succeed<VaultMigrationProject>({
                projectId: project.id,
                title: project.title,
                state: "unavailable",
                dependencies: [],
                omittedDependencies: 0,
                localSshCommand: false,
                localCredentialHelper: false,
                localUrlRewrite: false,
              }),
            ),
          ),
        { concurrency: 2 },
      );
      return {
        checkedAt: yield* Clock.currentTimeMillis,
        projects: entries,
        nextCursor: remaining.length > 10 ? page.at(-1)!.id : null,
        coverage: "registered-project-local-config-only",
        credentialIdentity: "unknown",
        externalConsumers: "not-discovered",
        accessVerification: "not-performed",
      };
    }),
    prepare: (input, actor) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (!isPrepare(input) || !actor.trim() || actor.length > 512) return yield* invalid();
          const requestFingerprint = yield* hash(
            yield* encodeRequest(input).pipe(Effect.mapError(invalid)),
          );
          if (yield* store.read(`${prefix}/${input.id}`)) {
            const { record } = yield* load(input.id);
            if (record.preparedBy !== actor || record.requestFingerprint !== requestFingerprint)
              return yield* new VaultError({ reason: "conflict" });
            return yield* view(record, true);
          }
          const current = yield* source(input.projectId);
          if (!current.metadata.dependencies.some((dep) => sameDependency(dep, input.dependency)))
            return yield* fail("source-changed");
          if (current.metadata.localUrlRewrite) return yield* fail("unsupported-source");
          const selected = yield* replacement(input),
            now = yield* Clock.currentTimeMillis;
          const record: Stored = {
            protocol: 1,
            plan: {
              id: input.id,
              projectId: input.projectId,
              projectTitle: current.project.title,
              dependency: input.dependency,
              replacement: selected,
              developmentOnly: true,
              state: "prepared",
              createdAt: now,
              expiresAt: now + REVIEW_TTL_MS,
            },
            sourceFingerprint: current.fingerprint,
            requestFingerprint,
            preparedBy: actor,
            reviewedBy: null,
          };
          yield* save(record, 0);
          return yield* view(record, true);
        }),
      ),
    inspect: (id) => Effect.flatMap(load(id), ({ record }) => view(record, true)),
    list: Effect.fn("VaultMigrationInventory.list")(function* (input) {
      if (!isList(input)) return yield* invalid();
      const keys = [...(yield* store.keys(prefix))].sort();
      if (keys.some((key) => !/^[a-f0-9]{32}$/.test(key)))
        return yield* new VaultError({ reason: "invalid-response" });
      const remaining = keys.filter((id) => input.cursor === null || id > input.cursor),
        page = remaining.slice(0, 25);
      return {
        items: yield* Effect.forEach(page, (id) =>
          Effect.flatMap(load(id), ({ record }) => view(record, false)),
        ),
        nextCursor: remaining.length > 25 ? page.at(-1)! : null,
      };
    }),
    review: (input, actor) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (!isReview(input) || !actor.trim() || actor.length > 512) return yield* invalid();
          const { record, version } = yield* load(input.id);
          if (record.plan.state !== "prepared" && record.plan.state !== "reviewed")
            return yield* fail("invalid-state");
          if ((yield* Clock.currentTimeMillis) >= record.plan.expiresAt)
            return yield* fail("expired");
          yield* check(record);
          if (record.plan.state === "reviewed") return yield* view(record, true);
          const updated = {
            ...record,
            reviewedBy: actor,
            plan: { ...record.plan, state: "reviewed" as const },
          };
          yield* save(updated, version);
          return yield* view(updated, true);
        }),
      ),
    cancel: (id) =>
      lock.withPermit(
        Effect.gen(function* () {
          const { record, version } = yield* load(id);
          if (record.plan.state === "cancelled") return yield* view(record, false);
          const updated = { ...record, plan: { ...record.plan, state: "cancelled" as const } };
          yield* save(updated, version);
          return yield* view(updated, false);
        }),
      ),
  });
});
export const layer = Layer.effect(VaultMigrationInventory, make);
