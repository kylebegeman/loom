import type { EnvironmentId } from "@t3tools/contracts";
import {
  SWITCHBOARD_MAX_COMPUTERS,
  SWITCHBOARD_MEMBERS_ROUTE,
  SWITCHBOARD_REDEEM_ROUTE,
  SwitchboardMembers,
  SwitchboardMembership,
  SwitchboardRedemption,
  type SwitchboardComputer,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClientRequest, HttpIncomingMessage } from "effect/http";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { SwitchboardAccountError } from "./SwitchboardAccountError.ts";

const STORE = "switchboard-account-computers";
const CHECK_INTERVAL = "15 minutes";
const Stored = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    computers: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        device: Schema.String,
        credentialHash: Schema.String,
        membership: SwitchboardMembership,
        issuedAt: Schema.Number,
      }),
    ),
  }),
);
type StoredComputer = (typeof Stored.Type)["computers"][number];
const decodeStored = Schema.decodeUnknownEffect(Stored);
const encodeStored = Schema.encodeEffect(Stored);
const decodeRedemption = Schema.decodeUnknownEffect(SwitchboardRedemption);
const decodeMembers = Schema.decodeUnknownEffect(SwitchboardMembers);
const unavailable = () => new SwitchboardAccountError({ reason: "unavailable" });

/** Switchboard's ledger names a request's computer with this, `^[a-z0-9][a-z0-9-]{0,62}$`. */
export const switchboardDevice = (label: string, environmentId: string) => {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .slice(0, 63)
    .replace(/^-+|-+$/gu, "");
  return (
    slug ||
    `computer-${environmentId
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, "")
      .slice(0, 12)}`
  );
};

/**
 * On the hub: the credential issued to each account computer. Only a SHA-256 of each is kept, in
 * the server secret store. A computer's new enrollment replaces its old credential, and one whose
 * membership the Library no longer confirms loses it. An unreachable Library changes nothing.
 */
export class SwitchboardClients extends Context.Service<
  SwitchboardClients,
  {
    readonly enroll: (
      ticket: string,
    ) => Effect.Effect<Redacted.Redacted<string>, SwitchboardAccountError>;
    /** The computer a gateway credential belongs to, if any. */
    readonly authenticate: (
      credential: string,
    ) => Effect.Effect<Option.Option<{ readonly device: string }>>;
    readonly list: Effect.Effect<ReadonlyArray<SwitchboardComputer>>;
    readonly revoke: (environmentId: EnvironmentId) => Effect.Effect<void, SwitchboardAccountError>;
    /** Drops computers the Library no longer confirms as members. */
    readonly check: Effect.Effect<void, SwitchboardAccountError>;
  }
>()("t3/fork/switchboard/SwitchboardClients") {}

const make = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  const secrets = yield* ServerSecretStore;
  const connection = yield* LibraryConnectionService;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;
  const ownId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const sharing = environment.LOOM_SWITCHBOARD_SHARE_GATEWAY === "true";
  const lock = yield* Semaphore.make(1);
  const lastUsed = new Map<EnvironmentId, number>();
  const stored = yield* secrets.get(STORE).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed([] as ReadonlyArray<StoredComputer>),
        onSome: (bytes) =>
          decodeStored(new TextDecoder().decode(bytes)).pipe(Effect.map((v) => v.computers)),
      }),
    ),
    // Unreadable records only make each computer enroll again.
    Effect.tapError(() => Effect.logWarning("Switchboard account computers could not be read.")),
    Effect.orElseSucceed(() => [] as ReadonlyArray<StoredComputer>),
  );
  let computers = new Map(stored.map((entry) => [entry.membership.environmentId, entry]));
  let byHash = new Map(stored.map((entry) => [entry.credentialHash, entry]));

  const hash = (value: string) =>
    digest
      .digest(Digest.sha256, new TextEncoder().encode(value))
      .pipe(Effect.map(Hex.encode), Effect.orDie);
  const save = Effect.fn("SwitchboardClients.save")(function* (
    next: ReadonlyMap<EnvironmentId, StoredComputer>,
  ) {
    const text = yield* encodeStored({ version: 1, computers: [...next.values()] });
    yield* secrets.set(STORE, new TextEncoder().encode(text));
    computers = new Map(next);
    byHash = new Map([...next.values()].map((entry) => [entry.credentialHash, entry]));
  }, Effect.mapError(unavailable));

  const library = Effect.gen(function* () {
    const current = yield* connection.current;
    if (current.kind !== "remote") return yield* unavailable();
    return current;
  });
  const post = Effect.fn("SwitchboardClients.post")(function* (route: string, body: unknown) {
    const current = yield* library;
    const request = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(current.endpoint(route)),
      body,
    ).pipe(Effect.mapError(unavailable));
    const response = yield* current
      .send(request)
      .pipe(Effect.timeout("15 seconds"), Effect.mapError(unavailable));
    if (response.status === 403) return yield* new SwitchboardAccountError({ reason: "denied" });
    if (response.status !== 200) return yield* unavailable();
    return yield* response.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(256)),
      Effect.timeout("15 seconds"),
      Effect.mapError(unavailable),
    );
  });

  const enroll = Effect.fn("SwitchboardClients.enroll")(function* (ticket: string) {
    if (!sharing) return yield* new SwitchboardAccountError({ reason: "disabled" });
    const redemption = yield* post(SWITCHBOARD_REDEEM_ROUTE, { ticket }).pipe(
      Effect.flatMap((body) => decodeRedemption(body).pipe(Effect.mapError(unavailable))),
    );
    const environmentId = redemption.membership.environmentId;
    if (environmentId === ownId) return yield* new SwitchboardAccountError({ reason: "denied" });
    const credential = Hex.encode(yield* random.randomBytes(32).pipe(Effect.mapError(unavailable)));
    const entry: StoredComputer = {
      label: redemption.label,
      device: switchboardDevice(redemption.label, environmentId),
      credentialHash: yield* hash(credential),
      membership: redemption.membership,
      issuedAt: yield* Clock.currentTimeMillis,
    };
    yield* lock.withPermit(
      Effect.suspend(() => {
        // The membership check sends every computer at once, and the Library refuses more than this.
        if (!computers.has(environmentId) && computers.size >= SWITCHBOARD_MAX_COMPUTERS)
          return Effect.fail(new SwitchboardAccountError({ reason: "denied" }));
        return save(new Map([...computers, [environmentId, entry]]));
      }),
    );
    return Redacted.make(credential);
  });

  const check = Effect.gen(function* () {
    if (!sharing || computers.size === 0) return;
    const asked = [...computers.values()];
    const { active } = yield* post(SWITCHBOARD_MEMBERS_ROUTE, {
      memberships: asked.map((entry) => entry.membership),
    }).pipe(Effect.flatMap((body) => decodeMembers(body).pipe(Effect.mapError(unavailable))));
    const keep = new Set(active);
    const ended = asked.filter(
      (entry) =>
        !keep.has(entry.membership.environmentId) &&
        computers.get(entry.membership.environmentId) === entry,
    );
    if (ended.length === 0) return;
    yield* lock.withPermit(
      Effect.suspend(() => {
        const next = new Map(computers);
        for (const entry of ended)
          if (next.get(entry.membership.environmentId) === entry)
            next.delete(entry.membership.environmentId);
        return save(next);
      }),
    );
    yield* Effect.logInfo("Revoked Switchboard credentials for computers that left the account.", {
      computers: ended.map((entry) => entry.membership.environmentId),
    });
  }).pipe(Effect.withSpan("SwitchboardClients.check"));

  if (sharing)
    yield* check.pipe(
      Effect.ignore,
      Effect.repeat(Schedule.spaced(CHECK_INTERVAL)),
      Effect.forkScoped,
    );

  return SwitchboardClients.of({
    enroll,
    authenticate: Effect.fn("SwitchboardClients.authenticate")(function* (credential) {
      const entry = byHash.get(yield* hash(credential));
      if (entry === undefined) return Option.none();
      lastUsed.set(entry.membership.environmentId, yield* Clock.currentTimeMillis);
      return Option.some({ device: entry.device });
    }),
    list: Effect.sync(() =>
      [...computers.values()].map((entry) => ({
        environmentId: entry.membership.environmentId,
        label: entry.label,
        device: entry.device,
        issuedAt: entry.issuedAt,
        lastUsedAt: lastUsed.get(entry.membership.environmentId) ?? null,
      })),
    ),
    revoke: Effect.fn("SwitchboardClients.revoke")(function* (environmentId) {
      yield* lock.withPermit(
        Effect.suspend(() => {
          if (!computers.has(environmentId)) return Effect.void;
          const next = new Map(computers);
          next.delete(environmentId);
          return save(next);
        }),
      );
    }),
    check,
  });
});

export const layer = Layer.effect(SwitchboardClients, make);
