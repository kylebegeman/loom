import { ProjectId } from "@t3tools/contracts";
import {
  VaultError,
  VaultReplacementError,
  VaultMigrationInventoryInput,
  VaultReplacementPrepare,
  VaultReplacementReview,
  VaultReplacementList,
  VaultReplacementPlan,
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
});
type Stored = typeof Stored.Type;
const decode = Schema.decodeUnknownOption(Stored),
  encode = Schema.encodeEffect(Stored);
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
  return VaultMigrationInventory.of({
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
