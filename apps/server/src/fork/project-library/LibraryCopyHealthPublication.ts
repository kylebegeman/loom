import type { EnvironmentId } from "@t3tools/contracts";
import { LibraryError, LibraryWorkingCopy, type LibraryCopyHealth } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import { makeCopyHealthReader } from "./LibraryCopyHealth.ts";
import type { LibraryPublisher } from "./LibraryPublisher.ts";
import type { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";

/** How often a computer rereads its copies' health. Only a change is published. */
export const HEALTH_REPORT_INTERVAL = Duration.minutes(5);
/** Quiet time after a status change in a copy folder before its health is read again. */
export const HEALTH_CHANGE_DEBOUNCE = Duration.seconds(30);

/** Reads copy health and watches copy folders, so replication tests need no Git. */
export class LibraryCopyHealthSource extends Context.Service<
  LibraryCopyHealthSource,
  {
    readonly read: (copy: LibraryWorkingCopy) => Effect.Effect<LibraryCopyHealth>;
    /** Emits whenever the local VCS status of one of these folders changes. */
    readonly changes: (paths: ReadonlyArray<string>) => Stream.Stream<void>;
  }
>()("t3/fork/project-library/LibraryCopyHealthPublication/LibraryCopyHealthSource") {}

export const layerSource = Layer.effect(
  LibraryCopyHealthSource,
  Effect.gen(function* () {
    const read = yield* makeCopyHealthReader;
    const broadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
    return LibraryCopyHealthSource.of({
      read: (copy) => read(copy),
      changes: (paths) =>
        Stream.mergeAll(
          paths.map((cwd) =>
            // A passive watch: it never starts remote polling, so watching copies never fetches.
            // The first event is the current snapshot, not a change.
            broadcaster
              .streamStatus({ cwd, includeRemote: false })
              .pipe(Stream.drop(1), Stream.ignore),
          ),
          { concurrency: "unbounded" },
        ).pipe(Stream.as(undefined)),
    });
  }),
);

/** Copies whose health is worth publishing: still registered and not prepared or removed. */
export const publishesHealth = (copy: LibraryWorkingCopy) =>
  copy.registered !== false && (copy.state === "ready" || copy.state === "missing");

/** What a health report says, without the read times that change on every check. */
export const copyHealthFingerprint = (health: LibraryCopyHealth) =>
  JSON.stringify(
    health.repositories.map(
      ({ checkedAt: _checkedAt, fetchedAt: _fetchedAt, ...repository }) => repository,
    ),
  );

/** Whether a health report describes this copy and only its repositories. */
export const healthBelongsTo = (health: LibraryCopyHealth, copy: LibraryWorkingCopy) => {
  const resources = new Set(copy.repositories.map((repository) => repository.resourceId));
  const reported = health.repositories.map((repository) => repository.resourceId);
  return (
    health.copyId === copy.id &&
    health.environmentId === copy.environmentId &&
    new Set(reported).size === reported.length &&
    reported.every((resourceId) => resources.has(resourceId))
  );
};

/**
 * The health the Library keeps when a computer saves a copy. A save without health, from history
 * publishing or an older computer, keeps the last report, and a report never replaces a newer one.
 */
export const latestCopyHealth = (
  previous: LibraryCopyHealth | undefined,
  incoming: LibraryCopyHealth | undefined,
) =>
  incoming === undefined ||
  (previous !== undefined && Date.parse(incoming.checkedAt) < Date.parse(previous.checkedAt))
    ? previous
    : incoming;

/**
 * The part of a health report's request id that names its copy. Each report has its own request
 * id, so the Library keeps only the newest receipt per marker instead of one per report.
 */
export const copyHealthRequestMarker = (crypto: Crypto.Crypto, copyId: string) =>
  crypto.digest("SHA-256", new TextEncoder().encode(copyId)).pipe(
    Effect.map((bytes) => `:health:${Hex.encode(bytes).slice(0, 16)}:`),
    Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
  );

export const withCopyHealth = (
  copy: LibraryWorkingCopy,
  health: LibraryCopyHealth | undefined,
): LibraryWorkingCopy => {
  const { health: _health, ...rest } = copy;
  return health === undefined ? rest : { ...rest, health };
};

const encodeCopy = Schema.encodeEffect(Schema.fromJsonString(LibraryWorkingCopy));

/**
 * Publishes the health of this computer's copies to the Library through `registerCopy`: on an
 * interval and after a debounced status change in a copy folder, and only when it changed since
 * the last successful report. A restart reports each copy once more.
 */
export const makeCopyHealthPublication = Effect.fnUntraced(function* (input: {
  readonly environmentId: EnvironmentId;
  readonly publisher: LibraryPublisher["Service"];
  readonly workspaces: LibraryWorkspaceStore["Service"];
  readonly source: LibraryCopyHealthSource["Service"];
  /** The fence for each report, established first when the journal is new. */
  readonly authority: Effect.Effect<
    { readonly journalId: string; readonly authorityId: string; readonly authorityEpoch: number },
    LibraryError
  >;
}) {
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);
  const published = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const watched = yield* SubscriptionRef.make<ReadonlyArray<string>>([]);

  const publish = Effect.fnUntraced(function* (
    authority: Effect.Success<typeof input.authority>,
    copy: LibraryWorkingCopy,
    health: LibraryCopyHealth,
  ) {
    const reported = withCopyHealth(copy, health);
    const body = yield* encodeCopy(reported).pipe(
      Effect.mapError(() => new LibraryError({ reason: "invalid" })),
    );
    const digest = Hex.encode(
      yield* crypto
        .digest("SHA-256", new TextEncoder().encode(body))
        .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause }))),
    );
    yield* input.publisher.registerCopy({
      requestId: `${authority.journalId}${yield* copyHealthRequestMarker(crypto, copy.id)}${digest}`,
      authorityId: authority.authorityId,
      authorityEpoch: authority.authorityEpoch,
      copy: reported,
    });
  });

  /** Reads every copy and publishes what changed. Fails with the first failed publish. */
  const report = lock.withPermit(
    Effect.gen(function* () {
      const copies = (yield* input.workspaces.receipts)
        .map((receipt) => receipt.copy)
        .filter((copy) => copy.environmentId === input.environmentId && publishesHealth(copy));
      yield* SubscriptionRef.set(
        watched,
        copies.flatMap((copy) => copy.repositories.map((repository) => repository.path)).toSorted(),
      );
      const last = yield* Ref.get(published);
      const next = new Map<string, string>();
      let failure: LibraryError | null = null;
      if (copies.length > 0) {
        const authority = yield* input.authority;
        for (const copy of copies) {
          const health = yield* input.source.read(copy);
          const fingerprint = copyHealthFingerprint(health);
          if (last.get(copy.id) === fingerprint) {
            next.set(copy.id, fingerprint);
            continue;
          }
          // An unacknowledged report stays out of the map, so the next trigger retries it.
          const result = yield* publish(authority, copy, health).pipe(Effect.result);
          if (result._tag === "Success") next.set(copy.id, fingerprint);
          else failure ??= result.failure;
        }
      }
      yield* Ref.set(published, next);
      if (failure !== null) return yield* failure;
    }),
  );

  const samePaths = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
    a.length === b.length && a.every((path, index) => path === b[index]);
  /** The interval and the status watch. Each report refreshes the folders being watched. */
  const run = Effect.all(
    [
      report.pipe(Effect.ignore, Effect.repeat(Schedule.spaced(HEALTH_REPORT_INTERVAL))),
      SubscriptionRef.changes(watched).pipe(
        Stream.changesWith(samePaths),
        Stream.switchMap((paths) => input.source.changes(paths)),
        Stream.debounce(HEALTH_CHANGE_DEBOUNCE),
        Stream.runForEach(() => report.pipe(Effect.ignore)),
      ),
    ],
    { concurrency: "unbounded", discard: true },
  );
  return { report, run };
});
