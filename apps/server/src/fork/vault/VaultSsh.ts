import type { ThreadId } from "@t3tools/contracts";
import {
  VaultSshAgentOpen,
  VaultSshAgentFrame,
  type VaultSshAgentSession,
  type VaultWorkloadProof,
  type VaultWorkloadSession,
  VaultError,
  VaultConnectionError,
  VaultSshError,
  VaultWorkloadError,
  VaultSshTarget,
  VaultSshPublicKey,
  VaultSshGenerate,
  VaultGitExecute,
  type VaultGitResult,
  vaultGitCommandMessage,
  vaultGitDestination,
  VaultSshProbe,
  VaultSshGitProbe,
  type VaultSshGitProbeResult,
  type VaultSshProbeResult,
  VaultSshTrust,
  VaultSshExecute,
  type VaultSshInfo,
  type VaultSshResult,
  VaultItemId,
  type VaultItemValue,
  vaultSshDestination,
  vaultSshCommandMessage,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Semaphore from "effect/Semaphore";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as VaultCore from "./VaultCore.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import * as SshCrypto from "./SshCrypto.ts";
import * as SshTransport from "./SshTransport.ts";

type Failure = VaultError | VaultSshError | VaultWorkloadError;
type ConnectionFailure = Failure | VaultConnectionError;
export class VaultSsh extends Context.Service<
  VaultSsh,
  {
    readonly agentOpen: (
      input: VaultSshAgentOpen,
      proof: VaultWorkloadProof,
      threadId: ThreadId,
    ) => Effect.Effect<VaultSshAgentSession, Failure>;
    readonly agentFrame: (
      input: VaultSshAgentFrame,
      threadId: ThreadId,
    ) => Effect.Effect<{ response: string }, Failure>;
    readonly agentClose: (
      sessionId: string,
      threadId: ThreadId,
    ) => Effect.Effect<{ closed: true }, Failure>;
    readonly agents: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<VaultSshAgentSession>, Failure>;
    readonly generate: (
      input: VaultSshGenerate,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultSshInfo, Failure>;
    readonly info: (id: string) => Effect.Effect<VaultSshInfo, Failure>;
    readonly trust: (
      input: VaultSshTrust,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultSshInfo, Failure>;
    readonly verifyGit: (
      input: VaultSshGitProbe,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultSshGitProbeResult, Failure>;
    readonly probe: (
      input: VaultSshProbe,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultSshProbeResult, Failure>;
    readonly git: (
      input: VaultGitExecute,
      guard?: Effect.Effect<void, ConnectionFailure>,
    ) => Effect.Effect<VaultGitResult, ConnectionFailure>;
    readonly execute: (
      input: VaultSshExecute,
      guard?: Effect.Effect<void, ConnectionFailure>,
    ) => Effect.Effect<VaultSshResult, ConnectionFailure>;
  }
>()("t3/fork/vault/VaultSsh") {}
export const StoredKey = Schema.Struct({
  protocol: Schema.Literal(1),
  privateKey: Schema.RedactedFromValue(Schema.String),
  publicKey: VaultSshPublicKey,
  target: VaultSshTarget,
  generationOperationId: VaultItemId,
  trustOperationId: Schema.NullOr(VaultItemId),
});
const decodeKey = Schema.decodeEffect(Schema.fromJsonString(StoredKey));
const encodeKey = Schema.encodeEffect(Schema.fromJsonString(StoredKey));
const isGenerate = Schema.is(VaultSshGenerate),
  isTrust = Schema.is(VaultSshTrust),
  isExecute = Schema.is(VaultSshExecute),
  isProbe = Schema.is(VaultSshProbe),
  isGitProbe = Schema.is(VaultSshGitProbe),
  isGit = Schema.is(VaultGitExecute);
const isAgentOpen = Schema.is(VaultSshAgentOpen),
  isAgentFrame = Schema.is(VaultSshAgentFrame);
const invalid = () => new VaultSshError({ reason: "invalid-key" });
const make = Effect.gen(function* () {
  const core = yield* VaultCore.VaultCore,
    keys = yield* SshCrypto.SshCrypto,
    workloads = yield* VaultWorkloads.VaultWorkloads,
    transport = yield* SshTransport.SshTransport,
    crypto = yield* Crypto.Crypto;
  const active = yield* Ref.make(0);
  type Activation = {
    session: VaultWorkloadSession;
    metadata: VaultSshAgentSession;
    lock: Semaphore.Semaphore;
    channels: Map<
      string,
      { sequence: number; binding: SshCrypto.SshBinding | null; signed: boolean }
    >;
  };
  const agents = yield* Ref.make<ReadonlyMap<string, Activation>>(new Map());

  const decodeRecord = Effect.fnUntraced(function* (value: VaultItemValue) {
    const key = yield* decodeKey(Redacted.value(value.value)).pipe(Effect.mapError(invalid));
    if ((yield* keys.publicKey(key.privateKey)) !== key.publicKey) return yield* invalid();
    if (key.target.hostKey) yield* keys.fingerprint(key.target.hostKey);
    return { item: value.item, key };
  });
  const load = Effect.fnUntraced(function* (id: string) {
    const item = yield* core.inspect(id);
    if (!item) return yield* new VaultError({ reason: "not-found" });
    if (item.kind !== "ssh-key") return yield* invalid();
    const record = yield* decodeRecord(yield* core.reveal({ id, expectedVersion: item.version }));
    return { ...record, item };
  });
  // load() only inspects to learn the version for reveal, which reads the item again and fails
  // with a conflict unless it is still that version. A caller that pins the version skips that
  // first read.
  const loadPinned = Effect.fnUntraced(function* (id: string, version: number) {
    const value = yield* core.reveal({ id, expectedVersion: version });
    if (value.item.kind !== "ssh-key") return yield* invalid();
    return yield* decodeRecord(value);
  });
  const info = Effect.fnUntraced(function* (record: Effect.Success<ReturnType<typeof load>>) {
    return {
      item: record.item,
      target: record.key.target,
      publicKey: record.key.publicKey,
      fingerprint: yield* keys.fingerprint(record.key.publicKey),
      hostFingerprint: record.key.target.hostKey
        ? yield* keys.fingerprint(record.key.target.hostKey)
        : null,
      destination: vaultSshDestination(record.key.target),
    };
  });
  const run = (input: Parameters<SshTransport.SshTransport["Service"]["execute"]>[0]) =>
    Effect.acquireUseRelease(
      Ref.modify(active, (count) =>
        count < 4 ? ([true, count + 1] as const) : ([false, count] as const),
      ).pipe(
        Effect.flatMap((ok) =>
          ok ? Effect.void : Effect.fail(new VaultSshError({ reason: "capacity" })),
        ),
      ),
      () => transport.execute(input),
      () => Ref.update(active, (count) => count - 1),
    );
  const findAgent = Effect.fnUntraced(function* (sessionId: string, threadId: ThreadId) {
    const activation = (yield* Ref.get(agents)).get(sessionId);
    if (!activation || activation.session.threadId !== threadId)
      return yield* new VaultError({ reason: "denied" });
    // No revalidate here: agentFrame's authorize repeats the same check first thing after
    // taking the session lock, with nothing in between that depends on it.
    return activation;
  });
  return VaultSsh.of({
    agentOpen: Effect.fn("VaultSsh.agentOpen")(function* (input, proof, threadId) {
      if (!isAgentOpen(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const { session } = yield* workloads.check(proof);
      if (session.threadId !== threadId || session.itemId !== input.id)
        return yield* new VaultError({ reason: "denied" });
      const record = yield* load(input.id);
      if (
        record.item.state !== "active" ||
        record.item.version !== input.expectedVersion ||
        session.destination !== vaultSshDestination(record.key.target)
      )
        return yield* new VaultSshError({ reason: "invalid-operation" });
      if (!record.key.target.hostKey) return yield* new VaultSshError({ reason: "untrusted-host" });
      yield* workloads.revalidate(session);
      const metadata: VaultSshAgentSession = {
        sessionId: session.id,
        id: input.id,
        version: input.expectedVersion,
        expiresAt: session.expiresAt,
        destination: session.destination,
        target: record.key.target,
        publicKey: record.key.publicKey,
      };
      const activation: Activation = {
        session,
        metadata,
        lock: yield* Semaphore.make(1),
        channels: new Map(),
      };
      const now = yield* Clock.currentTimeMillis;
      const accepted = yield* Ref.modify(agents, (current) => {
        const next = new Map([...current].filter(([, value]) => value.session.expiresAt > now));
        if (next.size >= 64 || next.has(session.id)) return [false, next] as const;
        next.set(session.id, activation);
        return [true, next] as const;
      });
      if (!accepted) return yield* new VaultSshError({ reason: "capacity" });
      return metadata;
    }),
    agents: Effect.fn("VaultSsh.agents")(function* (threadId) {
      const live = new Set((yield* workloads.list(threadId)).map((session) => session.id));
      return [...(yield* Ref.get(agents)).values()]
        .filter((value) => live.has(value.session.id))
        .map((value) => value.metadata);
    }),
    agentClose: Effect.fn("VaultSsh.agentClose")(function* (sessionId, threadId) {
      const held = (yield* Ref.get(agents)).get(sessionId);
      if (held && held.session.threadId !== threadId)
        return yield* new VaultError({ reason: "denied" });
      if (held) yield* workloads.close(sessionId, threadId);
      yield* Ref.update(agents, (current) => {
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });
      return { closed: true as const };
    }),
    agentFrame: Effect.fn("VaultSsh.agentFrame")(function* (input, threadId) {
      if (!isAgentFrame(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const held = yield* findAgent(input.sessionId, threadId);
      return yield* Effect.gen(function* () {
        const authorize = Effect.gen(function* () {
          if ((yield* Ref.get(agents)).get(input.sessionId) !== held)
            return yield* new VaultError({ reason: "denied" });
          yield* workloads.revalidate(held.session);
          const current = yield* core.inspect(held.metadata.id);
          if (!current || current.state !== "active" || current.version !== held.metadata.version)
            return yield* new VaultError({ reason: "conflict" });
        });
        yield* authorize;
        const frame = Buffer.from(input.frame, "base64");
        if (!frame.length || frame.length > 16384 || frame.toString("base64") !== input.frame)
          return yield* new VaultSshError({ reason: "invalid-operation" });
        let channel = held.channels.get(input.channelId);
        if (!channel) {
          if (input.sequence !== 0 || held.channels.size >= 32)
            return yield* new VaultSshError({ reason: "capacity" });
          channel = { sequence: 0, binding: null, signed: false };
          held.channels.set(input.channelId, channel);
        }
        if (input.sequence !== channel.sequence || (channel.signed && frame[0] === 13))
          return yield* new VaultSshError({ reason: "invalid-operation" });
        channel.sequence++;
        const record = yield* loadPinned(held.metadata.id, held.metadata.version);
        if (record.item.state !== "active") return yield* new VaultError({ reason: "conflict" });
        yield* authorize;
        const result = yield* keys.respond({ ...record.key, frame, binding: channel.binding });
        channel.binding = result.binding;
        channel.signed ||= result.signed;
        yield* authorize;
        return { response: result.response.toString("base64") };
      }).pipe(held.lock.withPermits(1));
    }),
    git: Effect.fn("VaultSsh.git")(function* (input, guard = Effect.void) {
      yield* guard;
      if (!isGit(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const digest = yield* crypto
        .digest("SHA-256", new TextEncoder().encode(vaultGitCommandMessage(input.command)))
        .pipe(
          Effect.map(Hex.encode),
          Effect.mapError(() => new VaultSshError({ reason: "failed" })),
        );
      const session = yield* workloads.acceptGit(input.proof, digest);
      const record = yield* load(session.itemId);
      if (
        record.item.state !== "active" ||
        record.item.version !== input.command.expectedVersion ||
        vaultGitDestination(record.key.target, input.command.repository) !== session.destination
      )
        return yield* new VaultSshError({ reason: "invalid-operation" });
      const authorize = Effect.gen(function* () {
        yield* guard;
        yield* workloads.revalidate(session);
        const current = yield* core.inspect(session.itemId);
        if (
          !current ||
          current.state !== "active" ||
          current.version !== input.command.expectedVersion
        )
          return yield* new VaultError({ reason: "conflict" });
      });
      const result = yield* run({ ...record.key, command: input.command, authorize });
      yield* authorize;
      return { sessionId: session.id, requestId: input.proof.challenge.requestId, ...result };
    }),
    verifyGit: Effect.fn("VaultSsh.verifyGit")(function* (input, authorize) {
      if (!isGitProbe(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      yield* authorize;
      const record = yield* load(input.id);
      if (record.item.state !== "active" || record.item.version !== input.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      if (!record.key.target.hostKey) return yield* new VaultSshError({ reason: "untrusted-host" });
      const revalidate = Effect.gen(function* () {
        yield* authorize;
        const item = yield* core.inspect(input.id);
        if (!item || item.state !== "active" || item.version !== input.expectedVersion)
          return yield* new VaultError({ reason: "conflict" });
      });
      yield* revalidate;
      const result = yield* run({
        ...record.key,
        isolatedGit: true,
        command: {
          kind: "git",
          action: "ls-remote",
          expectedVersion: input.expectedVersion,
          repository: input.repository,
          cwd: "/",
          timeoutMs: 8000,
        },
        authorize: revalidate,
      }).pipe(
        Effect.catchTags({
          VaultConnectionError: () => Effect.fail(new VaultError({ reason: "denied" })),
        }),
      );
      if (result.exitCode !== 0) return yield* new VaultSshError({ reason: "failed" });
      yield* revalidate;
      return {
        id: record.item.id,
        version: record.item.version,
        destination: vaultSshDestination(record.key.target),
        repository: input.repository,
        fingerprint: yield* keys.fingerprint(record.key.publicKey),
        hostFingerprint: yield* keys.fingerprint(record.key.target.hostKey),
        checkedAt: yield* Clock.currentTimeMillis,
        authenticated: true as const,
        readable: true as const,
      };
    }),
    probe: Effect.fn("VaultSsh.probe")(function* (input, authorize) {
      if (!isProbe(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      yield* authorize;
      const record = yield* load(input.id);
      if (record.item.state !== "active" || record.item.version !== input.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      const revalidate = Effect.gen(function* () {
        yield* authorize;
        const current = yield* core.inspect(input.id);
        if (!current || current.state !== "active" || current.version !== input.expectedVersion)
          return yield* new VaultError({ reason: "conflict" });
      });
      yield* revalidate;
      if (!record.key.target.hostKey) return yield* new VaultSshError({ reason: "untrusted-host" });
      const result = yield* run({
        ...record.key,
        command: {
          expectedVersion: input.expectedVersion,
          argv: ["/usr/bin/true"],
          timeoutMs: 8000,
        },
        authorize: revalidate,
      }).pipe(
        Effect.catchTags({
          VaultConnectionError: () => Effect.fail(new VaultError({ reason: "denied" })),
        }),
      );
      if (result.exitCode !== 0) return yield* new VaultSshError({ reason: "failed" });
      yield* revalidate;
      return {
        id: record.item.id,
        version: record.item.version,
        destination: vaultSshDestination(record.key.target),
        fingerprint: yield* keys.fingerprint(record.key.publicKey),
        hostFingerprint: yield* keys.fingerprint(record.key.target.hostKey),
        checkedAt: yield* Clock.currentTimeMillis,
        authenticated: true as const,
      };
    }),
    info: Effect.fn("VaultSsh.info")(function* (id) {
      return yield* info(yield* load(id));
    }),
    generate: Effect.fn("VaultSsh.generate")(function* (input, actor, authorize) {
      if (!isGenerate(input)) return yield* invalid();
      yield* authorize;
      if (input.target.hostKey) yield* keys.fingerprint(input.target.hostKey);
      if (yield* core.inspect(input.id)) {
        const record = yield* load(input.id);
        if (
          record.item.state !== "active" ||
          record.key.generationOperationId !== input.operationId ||
          record.item.label !== input.label.trim() ||
          record.key.target.hostname !== input.target.hostname ||
          record.key.target.username !== input.target.username ||
          record.key.target.port !== input.target.port ||
          record.key.target.hostKey !== input.target.hostKey
        )
          return yield* new VaultError({ reason: "conflict" });
        return yield* info(record);
      }
      const key = {
        ...(yield* keys.create),
        protocol: 1 as const,
        target: input.target,
        generationOperationId: input.operationId,
        trustOperationId: null,
      };
      const value = yield* encodeKey(key).pipe(Effect.mapError(invalid));
      const item = yield* core.save(
        {
          id: input.id,
          operationId: input.operationId,
          expectedVersion: 0,
          label: input.label,
          kind: "ssh-key",
          value: Redacted.make(value),
        },
        actor,
        authorize,
      );
      return yield* info({ item, key });
    }),
    trust: Effect.fn("VaultSsh.trust")(function* (input, actor, authorize) {
      if (!isTrust(input)) return yield* invalid();
      yield* authorize;
      if (input.hostKey) yield* keys.fingerprint(input.hostKey);
      const record = yield* load(input.id);
      if (record.item.state !== "active") return yield* new VaultError({ reason: "archived" });
      if (
        record.key.trustOperationId === input.operationId &&
        record.item.version === input.expectedVersion + 1 &&
        record.key.target.hostKey === input.hostKey
      )
        return yield* info(record);
      if (record.item.version !== input.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      const key = {
        ...record.key,
        target: { ...record.key.target, hostKey: input.hostKey },
        trustOperationId: input.operationId,
      };
      const value = yield* encodeKey(key).pipe(Effect.mapError(invalid));
      const item = yield* core.save(
        {
          id: input.id,
          operationId: input.operationId,
          expectedVersion: input.expectedVersion,
          label: record.item.label,
          kind: "ssh-key",
          value: Redacted.make(value),
        },
        actor,
        authorize,
      );
      return yield* info({ item, key });
    }),
    execute: Effect.fn("VaultSsh.execute")(function* (input, guard = Effect.void) {
      yield* guard;
      if (
        !isExecute(input) ||
        new TextEncoder().encode(vaultSshCommandMessage(input.command)).length > 8192
      )
        return yield* new VaultSshError({ reason: "invalid-operation" });
      const digest = yield* crypto
        .digest("SHA-256", new TextEncoder().encode(vaultSshCommandMessage(input.command)))
        .pipe(
          Effect.map(Hex.encode),
          Effect.mapError(() => new VaultSshError({ reason: "failed" })),
        );
      const session = yield* workloads.acceptSsh(input.proof, digest);
      const record = yield* load(session.itemId);
      if (
        record.item.state !== "active" ||
        record.item.version !== input.command.expectedVersion ||
        vaultSshDestination(record.key.target) !== session.destination
      )
        return yield* new VaultSshError({ reason: "invalid-operation" });
      if (!record.key.target.hostKey) return yield* new VaultSshError({ reason: "untrusted-host" });
      const authorize = Effect.gen(function* () {
        yield* guard;
        yield* workloads.revalidate(session);
        const current = yield* core.inspect(session.itemId);
        if (
          !current ||
          current.state !== "active" ||
          current.version !== input.command.expectedVersion
        )
          return yield* new VaultError({ reason: "conflict" });
      });
      const result = yield* run({
        target: record.key.target,
        publicKey: record.key.publicKey,
        privateKey: record.key.privateKey,
        command: input.command,
        authorize,
      });
      return { sessionId: session.id, requestId: input.proof.challenge.requestId, ...result };
    }),
  });
});
export const layer = Layer.effect(VaultSsh, make);
