// @effect-diagnostics nodeBuiltinImport:off - page addresses need the CSPRNG, the same source ticket.ts uses.
import * as NodeCrypto from "node:crypto";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_REPLY_WAIT_MAX_MS,
  PREVIEW_PAGE_LIFETIME_MS,
  PREVIEW_PAGE_MAX_BYTES,
  PREVIEW_PAGE_REPLY_MAX,
  PREVIEW_PAGE_RESTORE_WINDOW_MS,
  PREVIEW_PAGE_TITLE_MAX,
  PreviewPagesError,
  type LibraryPagePublishRequest,
  type LibraryPageReply,
  type LibraryPageReplyAckRequest,
  type PreviewPage,
  type PreviewPageUpdateInput,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import type { SqlError } from "effect/sql/SqlError";
import { forkParked } from "../../serverActivation.ts";
import { isoAt } from "../preview-links/policy.ts";
import { makeLibraryStore, type PageRecord } from "./libraryStore.ts";

/** The computer behind a bearer session: its subject owns every page it publishes. */
export interface PageComputer {
  readonly subject: string;
  readonly environmentId: EnvironmentId;
}

export interface PageView {
  readonly page: PreviewPage;
  readonly html: string;
}

export class PageLibraryService extends Context.Service<
  PageLibraryService,
  {
    /** https origin without port from LOOM_PAGES_ORIGIN; null unless authority and valid. */
    readonly pagesOrigin: string | null;
    readonly publish: (
      computer: PageComputer,
      request: LibraryPagePublishRequest,
    ) => Effect.Effect<PreviewPage, PreviewPagesError>;
    readonly list: (
      computer: PageComputer,
    ) => Effect.Effect<ReadonlyArray<PreviewPage>, PreviewPagesError>;
    readonly update: (
      computer: PageComputer,
      input: PreviewPageUpdateInput,
    ) => Effect.Effect<PreviewPage, PreviewPagesError>;
    /** For the pages host: null unless the page exists and is open. */
    readonly view: (pageId: string) => Effect.Effect<PageView | null, PreviewPagesError>;
    readonly addReply: (input: {
      readonly pageId: string;
      readonly replyId: string;
      readonly text: string;
      readonly viewer: string;
    }) => Effect.Effect<void, PreviewPagesError>;
    readonly nextReplies: (
      computer: PageComputer,
      waitMs: number,
    ) => Effect.Effect<ReadonlyArray<LibraryPageReply>, PreviewPagesError>;
    readonly ackReply: (
      computer: PageComputer,
      ack: LibraryPageReplyAckRequest,
    ) => Effect.Effect<void, PreviewPagesError>;
    /** Ends every pages browser sign-in made up to now, whoever made it. */
    readonly signOutReaders: (computer: PageComputer) => Effect.Effect<void, PreviewPagesError>;
    /**
     * For the pages host, on every request: Unix milliseconds of the latest sign-out, 0 when there
     * was none. A cookie issued at or before it no longer signs anyone in.
     */
    readonly readersSignedOutAt: Effect.Effect<number, PreviewPagesError>;
  }
>()("t3/fork/preview-pages/PageLibraryService") {}

const PAGE_ID_BYTES = 16;
/** Bounds what one computer can park in the Library's database. */
const MAX_OPEN_PAGES = 500;
// Closed pages stay restorable for a week. Past this many rows a new page makes room by dropping
// the longest closed ones, so ending pages to publish more cannot grow storage without bound.
const MAX_STORED_PAGES = 1000;
const MAX_LISTED_PAGES = 500;
const MAX_WAITING_REPLIES = 1000;
const REPLY_BATCH = 20;
/** Long enough to deliver a batch; a computer that dies mid-delivery gets the batch again. */
const REPLY_LEASE_MS = 2 * 60 * 1000;
const ACKED_REPLY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL = "1 hour";
const REPLY_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const PAGE_NOT_FOUND = "This page does not exist.";
const PAGE_CLOSED = "This page has ended or expired.";

const httpsUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

type Lifecycle =
  | { readonly state: "open"; readonly restorableUntil: null }
  | { readonly state: "ended" | "expired"; readonly restorableUntil: number };

const lifecycleOf = (page: PageRecord, now: number): Lifecycle => {
  if (page.endedAt !== null)
    return {
      state: "ended",
      restorableUntil: Date.parse(page.endedAt) + PREVIEW_PAGE_RESTORE_WINDOW_MS,
    };
  if (!page.kept && page.expiresAt !== null) {
    const expiresAt = Date.parse(page.expiresAt);
    if (expiresAt <= now)
      return { state: "expired", restorableUntil: expiresAt + PREVIEW_PAGE_RESTORE_WINDOW_MS };
  }
  return { state: "open", restorableUntil: null };
};

const toPreviewPage = (origin: string, page: PageRecord, now: number): PreviewPage => {
  const lifecycle = lifecycleOf(page, now);
  return {
    id: page.id,
    url: `${origin}/p/${page.id}`,
    title: page.title,
    kind: page.kind,
    projectId: page.projectId,
    threadId: page.threadId,
    state: lifecycle.state,
    kept: page.kept,
    sizeBytes: page.sizeBytes,
    createdAt: page.createdAt,
    expiresAt: page.kept ? null : page.expiresAt,
    endedAt: page.endedAt,
    restorableUntil: lifecycle.restorableUntil === null ? null : isoAt(lifecycle.restorableUntil),
  };
};

const storageFailure = (cause: SqlError) =>
  Effect.logWarning("The Library's page storage failed", cause).pipe(
    Effect.andThen(
      Effect.fail(
        new PreviewPagesError({
          reason: "io",
          message: "The Library could not reach its page storage.",
        }),
      ),
    ),
  );

const make = Effect.gen(function* () {
  const authority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(Config.withDefault(false));
  const setting = yield* Config.String("LOOM_PAGES_ORIGIN").pipe(Config.option);
  const store = yield* makeLibraryStore;

  const configured = Option.isSome(setting) ? setting.value.trim() : "";
  const candidate = configured === "" ? null : httpsUrl(configured);
  // Tickets for the pages host land on `https://<host>/__loom/ticket`, which has no room for a port.
  // PreviewAccessService already warns once about a value it cannot use.
  const pagesOrigin = authority && candidate?.port === "" ? candidate.origin : null;

  const requireOrigin =
    pagesOrigin === null
      ? Effect.fail(
          new PreviewPagesError({
            reason: "unavailable",
            message: "This Library does not publish pages.",
          }),
        )
      : Effect.succeed(pagesOrigin);
  // Reads skip it; every write, lease and purge takes it so counts and caps stay exact.
  const lock = yield* Semaphore.make(1);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // One signal per subject. A wait that times out leaves its signal for the next one, so the map
  // holds at most one entry per computer that has ever waited.
  const waiters = new Map<string, Deferred.Deferred<void>>();
  const waiterFor = (subject: string) =>
    Effect.sync(() => {
      const existing = waiters.get(subject);
      if (existing !== undefined) return existing;
      const signal = Deferred.makeUnsafe<void>();
      waiters.set(subject, signal);
      return signal;
    });
  const wake = (subject: string) =>
    Effect.suspend(() => {
      const signal = waiters.get(subject);
      if (signal === undefined) return Effect.void;
      waiters.delete(subject);
      return Deferred.succeed(signal, undefined);
    });

  const requireRoom = (subject: string, now: number, opening: "publish" | "restore") =>
    store.countOpen(subject, isoAt(now)).pipe(
      Effect.flatMap((open) =>
        open >= MAX_OPEN_PAGES
          ? Effect.fail(
              new PreviewPagesError({
                reason: "blocked",
                message: `This computer already has ${MAX_OPEN_PAGES} open pages. ${
                  opening === "publish"
                    ? "End some before publishing more."
                    : "End one before restoring another."
                }`,
              }),
            )
          : Effect.void,
      ),
    );

  const requireStorage = Effect.fnUntraced(function* (subject: string, now: number) {
    const stored = yield* store.countStored(subject);
    if (stored < MAX_STORED_PAGES) return;
    const needed = stored - MAX_STORED_PAGES + 1;
    const dropped = yield* store.dropOldestClosed({ subject, now: isoAt(now), limit: needed });
    if (dropped < needed)
      return yield* new PreviewPagesError({
        reason: "blocked",
        message: `This computer already keeps ${MAX_STORED_PAGES} pages, counting closed ones whose replies have not reached it yet. Try again once those replies arrive.`,
      });
  });

  /** Another computer's page, and a page past restoring, look the same as one that never existed. */
  const ownedPage = Effect.fnUntraced(function* (
    computer: PageComputer,
    pageId: string,
    now: number,
  ) {
    const page = yield* store.findPage(pageId);
    const restorableUntil = page === null ? null : lifecycleOf(page, now).restorableUntil;
    if (
      page === null ||
      page.subject !== computer.subject ||
      (restorableUntil !== null && now > restorableUntil)
    )
      return yield* new PreviewPagesError({ reason: "not-found", message: PAGE_NOT_FOUND });
    return page;
  });

  const publish = Effect.fn("PageLibraryService.publish")(
    function* (computer: PageComputer, request: LibraryPagePublishRequest) {
      const origin = yield* requireOrigin;
      const html = encoder.encode(request.html);
      if (html.byteLength > PREVIEW_PAGE_MAX_BYTES)
        return yield* new PreviewPagesError({
          reason: "too-large",
          message: "This page is larger than 8 MB.",
        });
      const title = request.title.trim();
      if (title === "" || title.length > PREVIEW_PAGE_TITLE_MAX)
        return yield* new PreviewPagesError({
          reason: "invalid",
          message: `A page title needs between 1 and ${PREVIEW_PAGE_TITLE_MAX} characters.`,
        });
      const now = yield* Clock.currentTimeMillis;

      if (request.pageId !== undefined) {
        const existing = yield* ownedPage(computer, request.pageId, now);
        // Republishing is for the thread that owns the page; another thread publishes its own.
        if (existing.threadId !== request.threadId)
          return yield* new PreviewPagesError({ reason: "not-found", message: PAGE_NOT_FOUND });
        if (lifecycleOf(existing, now).state !== "open")
          yield* requireRoom(computer.subject, now, "publish");
        const expiresAt = existing.kept ? null : isoAt(now + PREVIEW_PAGE_LIFETIME_MS);
        yield* store.replaceContent({
          id: existing.id,
          title,
          kind: request.kind,
          html,
          expiresAt,
          updatedAt: isoAt(now),
        });
        return toPreviewPage(
          origin,
          {
            ...existing,
            title,
            kind: request.kind,
            sizeBytes: html.byteLength,
            expiresAt,
            endedAt: null,
          },
          now,
        );
      }

      yield* requireRoom(computer.subject, now, "publish");
      yield* requireStorage(computer.subject, now);
      const page: PageRecord = {
        // Unguessable, so one address never leads to another page.
        id: NodeCrypto.randomBytes(PAGE_ID_BYTES).toString("base64url"),
        subject: computer.subject,
        environmentId: computer.environmentId,
        projectId: request.projectId,
        threadId: request.threadId,
        title,
        kind: request.kind,
        sizeBytes: html.byteLength,
        kept: false,
        createdAt: isoAt(now),
        expiresAt: isoAt(now + PREVIEW_PAGE_LIFETIME_MS),
        endedAt: null,
      };
      yield* store.insertPage(page, html);
      return toPreviewPage(origin, page, now);
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const list = Effect.fn("PageLibraryService.list")(
    function* (computer: PageComputer) {
      const origin = yield* requireOrigin;
      const now = yield* Clock.currentTimeMillis;
      // Open pages come first, so a long tail of closed ones never pushes them past the limit.
      const pages = yield* store.listRestorable({
        subject: computer.subject,
        now: isoAt(now),
        cutoff: isoAt(now - PREVIEW_PAGE_RESTORE_WINDOW_MS),
        limit: MAX_LISTED_PAGES,
      });
      return pages.map((page) => toPreviewPage(origin, page, now));
    },
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const update = Effect.fn("PageLibraryService.update")(
    function* (computer: PageComputer, input: PreviewPageUpdateInput) {
      const origin = yield* requireOrigin;
      const now = yield* Clock.currentTimeMillis;
      const page = yield* ownedPage(computer, input.pageId, now);
      const { state } = lifecycleOf(page, now);
      const wrongState = (message: string) =>
        Effect.fail(new PreviewPagesError({ reason: "invalid", message }));
      let next: Pick<PageRecord, "kept" | "expiresAt" | "endedAt">;
      switch (input.action) {
        case "keep":
          if (state !== "open") return yield* wrongState("Only an open page can be kept.");
          next = { kept: true, expiresAt: null, endedAt: null };
          break;
        case "release":
          if (state !== "open") return yield* wrongState("Only an open page can be released.");
          next = { kept: false, expiresAt: isoAt(now + PREVIEW_PAGE_LIFETIME_MS), endedAt: null };
          break;
        case "end":
          if (state !== "open") return yield* wrongState(PAGE_CLOSED);
          next = { kept: false, expiresAt: null, endedAt: isoAt(now) };
          break;
        case "restore":
          if (state === "open") return yield* wrongState("This page is already open.");
          yield* requireRoom(computer.subject, now, "restore");
          next = { kept: false, expiresAt: isoAt(now + PREVIEW_PAGE_LIFETIME_MS), endedAt: null };
          break;
      }
      yield* store.setLifecycle({
        id: page.id,
        kept: next.kept,
        expiresAt: next.expiresAt,
        endedAt: next.endedAt,
        updatedAt: isoAt(now),
      });
      return toPreviewPage(origin, { ...page, ...next }, now);
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const view = Effect.fn("PageLibraryService.view")(
    function* (pageId: string) {
      const origin = yield* requireOrigin;
      const now = yield* Clock.currentTimeMillis;
      const found = yield* store.findPageWithHtml(pageId);
      if (found === null || lifecycleOf(found.page, now).state !== "open") return null;
      return {
        page: toPreviewPage(origin, found.page, now),
        html: decoder.decode(found.html),
      } satisfies PageView;
    },
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const addReply = Effect.fn("PageLibraryService.addReply")(
    function* (input: {
      readonly pageId: string;
      readonly replyId: string;
      readonly text: string;
      readonly viewer: string;
    }) {
      yield* requireOrigin;
      if (!REPLY_ID_PATTERN.test(input.replyId))
        return yield* new PreviewPagesError({
          reason: "invalid",
          message: "This reply has no usable id.",
        });
      const text = input.text.trim();
      if (text === "" || text.length > PREVIEW_PAGE_REPLY_MAX)
        return yield* new PreviewPagesError({
          reason: "invalid",
          message: `A reply needs between 1 and ${PREVIEW_PAGE_REPLY_MAX} characters.`,
        });
      const now = yield* Clock.currentTimeMillis;
      const page = yield* store.findPage(input.pageId);
      if (page === null || lifecycleOf(page, now).state !== "open")
        return yield* new PreviewPagesError({ reason: "not-found", message: PAGE_CLOSED });
      // A retried send is already counted; answering it as new would trip the cap on a full queue.
      if (yield* store.replyExists(input.replyId)) return;
      if ((yield* store.countWaitingReplies(page.subject)) >= MAX_WAITING_REPLIES)
        return yield* new PreviewPagesError({
          reason: "blocked",
          message: "Too many replies are waiting for this computer. Try again once it catches up.",
        });
      yield* store.insertReply({
        replyId: input.replyId,
        pageId: page.id,
        subject: page.subject,
        text,
        viewer: input.viewer,
        createdAt: isoAt(now),
      });
      yield* wake(page.subject);
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const leaseReplies = (subject: string) =>
    lock.withPermit(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        return yield* store.leaseReplies({
          subject,
          now: isoAt(now),
          leasedUntil: isoAt(now + REPLY_LEASE_MS),
          limit: REPLY_BATCH,
        });
      }),
    );

  const nextReplies = Effect.fn("PageLibraryService.nextReplies")(
    function* (computer: PageComputer, waitMs: number) {
      yield* requireOrigin;
      // Taken before the first look, so a reply that lands between that look and the wait still
      // wakes this request.
      const signal = yield* waiterFor(computer.subject);
      const ready = yield* leaseReplies(computer.subject);
      const wait = Number.isFinite(waitMs)
        ? Math.min(Math.max(Math.trunc(waitMs), 0), LIBRARY_REPLY_WAIT_MAX_MS)
        : 0;
      if (ready.length > 0 || wait === 0) return ready;
      yield* Deferred.await(signal).pipe(Effect.timeoutOption(Duration.millis(wait)));
      return yield* leaseReplies(computer.subject);
    },
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const ackReply = Effect.fn("PageLibraryService.ackReply")(
    function* (computer: PageComputer, ack: LibraryPageReplyAckRequest) {
      yield* requireOrigin;
      const now = yield* Clock.currentTimeMillis;
      yield* store.ackReply(computer.subject, ack, isoAt(now));
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const signOutReaders = Effect.fn("PageLibraryService.signOutReaders")(
    function* (computer: PageComputer) {
      yield* requireOrigin;
      yield* store.signOutReaders(computer.subject, yield* Clock.currentTimeMillis);
    },
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const readersSignedOutAt = store
    .readersSignedOutAt()
    .pipe(Effect.catchTags({ SqlError: storageFailure }));

  if (pagesOrigin !== null) {
    const sweep = lock.withPermit(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* store.purge({
          cutoff: isoAt(now - PREVIEW_PAGE_RESTORE_WINDOW_MS),
          ackedBefore: isoAt(now - ACKED_REPLY_RETENTION_MS),
        });
      }),
    );
    yield* forkParked(
      sweep.pipe(
        Effect.ignore({ log: "Warn", message: "Could not purge old published pages" }),
        Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
      ),
    );
  }

  return PageLibraryService.of({
    pagesOrigin,
    publish,
    list,
    update,
    view,
    addReply,
    nextReplies,
    ackReply,
    signOutReaders,
    readersSignedOutAt,
  });
});

export const layer = Layer.effect(PageLibraryService, make);
