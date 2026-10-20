import {
  CommandId,
  MessageId,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import {
  LIBRARY_REPLY_WAIT_MAX_MS,
  PREVIEW_PAGE_MAX_BYTES,
  PREVIEW_PAGE_TITLE_MAX,
  type LibraryPageReply,
  type LibraryPageReplyAckRequest,
  type PreviewPage,
  type PreviewPageKind,
  type PreviewPagesError,
  type PreviewPagesList,
  type PreviewPageUpdateInput,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { openMediaFile, type OpenMediaFile } from "../../assets/MediaFile.ts";
import {
  parseAttachmentFileExtension,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import { isContained } from "../model-preview-3d/signedFiles.ts";
import { LibraryPublisher, libraryPagesError } from "../project-library/LibraryPublisher.ts";

export type PreviewPageSource = { readonly attachmentId: string } | { readonly path: string };

export interface PreviewPagePublishInput {
  readonly threadId: ThreadId;
  /** An html_render attachment of this thread, or an HTML file in its workspace. */
  readonly source: PreviewPageSource;
  readonly title: string;
  readonly kind?: PreviewPageKind;
  /** Republishes that page in place, so its address stays the same. */
  readonly pageId?: string;
}

/** Pages live in the Library; this computer publishes them and carries their replies home. */
export class PreviewPagesService extends Context.Service<
  PreviewPagesService,
  {
    readonly publish: (
      input: PreviewPagePublishInput,
    ) => Effect.Effect<PreviewPage, PreviewPagesError>;
    /** A Library without pages is a state to show, so the list reports it instead of failing. */
    readonly list: (filter?: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<PreviewPagesList, PreviewPagesError>;
    /** With a thread, only that thread's pages can change. */
    readonly update: (
      input: PreviewPageUpdateInput,
      scope?: { readonly threadId: ThreadId },
    ) => Effect.Effect<PreviewPage, PreviewPagesError>;
  }
>()("t3/fork/preview-pages/PreviewPagesService") {}

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const utf8 = new TextDecoder("utf-8", { fatal: true });
const READ_CHUNK_BYTES = 64 * 1024;
/** The Library mints reply ids in this form; one that is not would fail as a command id. */
const REPLY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** An old or page-less Library, or a refused computer, stays that way for a while. */
const REPLY_PAUSE_WHEN_REFUSED = Duration.minutes(30);
const REPLY_RETRY_BASE_MS = 5_000;
const REPLY_RETRY_MAX_MS = 5 * 60_000;
/**
 * The Library holds an empty poll open for its wait, so an empty answer that comes back sooner
 * than this means something between them is not waiting. Pacing it keeps the loop from spinning.
 */
const REPLY_POLL_MIN_INTERVAL_MS = 1_000;

/** How long the replies worker waits after a failed poll, `attempt` counting since a success. */
export const replyRetryDelay = (
  reason: PreviewPagesError["reason"],
  attempt: number,
): Duration.Duration =>
  reason === "unavailable" || reason === "blocked"
    ? REPLY_PAUSE_WHEN_REFUSED
    : Duration.millis(
        Math.min(
          REPLY_RETRY_MAX_MS,
          REPLY_RETRY_BASE_MS * 2 ** Math.min(Math.max(attempt, 1) - 1, 16),
        ),
      );

/** The reply is untrusted text from a browser, so it enters the thread only as message text. */
export const pageReplyMessage = (reply: LibraryPageReply) =>
  `A reply came in on your published page "${reply.pageTitle}":\n\n${reply.text}`;

type ReplyOutcome = Omit<LibraryPageReplyAckRequest, "replyId">;
const rejected = (detail: string): ReplyOutcome => ({ outcome: "rejected", detail });

const fail = (reason: PreviewPagesError["reason"], message: string) =>
  libraryPagesError(reason, message);

const make = Effect.gen(function* () {
  const publisher = yield* LibraryPublisher;
  const threads = yield* ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const threadOnComputer = Effect.fnUntraced(function* (threadId: ThreadId) {
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(
        Effect.mapError(() => fail("io", "Could not read this thread. Try again in a moment.")),
      );
    if (shell === null || shell.deletedAt !== null)
      return yield* fail("not-found", "This thread is not on this computer.");
    return shell;
  });

  const attachmentFile = Effect.fnUntraced(function* (threadId: ThreadId, attachmentId: string) {
    const segment = toSafeThreadAttachmentSegment(threadId);
    // Ids carry the thread they were minted for, so a thread cannot publish another's pages.
    if (
      segment === null ||
      parseAttachmentFileExtension(attachmentId) !== "html" ||
      parseThreadSegmentFromAttachmentId(attachmentId) !== segment
    )
      return yield* fail("not-found", "That attachment is not an HTML page from this thread.");
    const gone = fail("not-found", "That page attachment no longer exists.");
    const file = yield* Effect.sync(() =>
      resolveAttachmentPathById({ attachmentsDir: config.attachmentsDir, attachmentId }),
    );
    if (file === null) return yield* gone;
    // The read refuses any path that is not already canonical, and a link must not leave the store.
    const root = yield* fs.realPath(config.attachmentsDir).pipe(Effect.mapError(() => gone));
    const real = yield* fs.realPath(file).pipe(Effect.mapError(() => gone));
    if (!isContained(root, real)) return yield* gone;
    return real;
  });

  const workspaceFile = Effect.fnUntraced(function* (
    shell: OrchestrationV2ThreadShell,
    requested: string,
  ) {
    const outside = fail("invalid", "Choose an .html file inside this thread's workspace.");
    if (requested.trim() === "" || requested.includes("\0")) return yield* outside;
    const project = yield* projects
      .get(shell.projectId)
      .pipe(Effect.mapError(() => fail("io", "Could not read this thread's project.")));
    if (Option.isNone(project)) return yield* fail("not-found", "This thread has no workspace.");
    const root = yield* fs
      .realPath(shell.worktreePath ?? project.value.workspaceRoot)
      .pipe(
        Effect.mapError(() =>
          fail("not-found", "This thread's workspace is not on this computer."),
        ),
      );
    // Containment is checked on the resolved file, so a symlink cannot reach outside.
    const real = yield* fs
      .realPath(path.resolve(root, requested))
      .pipe(
        Effect.mapError(() => fail("not-found", "That file is not in this thread's workspace.")),
      );
    if (!isContained(root, real) || !HTML_EXTENSIONS.has(path.extname(real).toLowerCase()))
      return yield* outside;
    return real;
  });

  /** Null when the file holds more than a page may; it can grow after it was measured. */
  const readBounded = (file: OpenMediaFile) =>
    Effect.tryPromise({
      try: async () => {
        const chunks: Array<Uint8Array> = [];
        let total = 0;
        for (;;) {
          const chunk = new Uint8Array(READ_CHUNK_BYTES);
          const { bytesRead } = await file.handle.read(chunk, 0, chunk.byteLength, total);
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > PREVIEW_PAGE_MAX_BYTES) return null;
          chunks.push(chunk.subarray(0, bytesRead));
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return bytes;
      },
      catch: () => fail("io", "Could not read that page file."),
    });

  /**
   * Reads through the descriptor that was checked, so a file swapped for a link, a folder or a
   * pipe after the path was resolved is refused instead of followed or waited on.
   */
  const readHtml = Effect.fnUntraced(function* (file: string) {
    const opened = yield* openMediaFile(file).pipe(
      Effect.mapError(() => fail("not-found", "That page file no longer exists.")),
    );
    if (opened === null) return yield* fail("invalid", "Choose a plain HTML file, not a folder.");
    if (Number(opened.info.size) > PREVIEW_PAGE_MAX_BYTES)
      return yield* libraryPagesError("too-large");
    const bytes = yield* readBounded(opened);
    if (bytes === null) return yield* libraryPagesError("too-large");
    return yield* Effect.try({
      try: () => utf8.decode(bytes),
      catch: () => fail("invalid", "That page is not UTF-8 text."),
    });
  }, Effect.scoped);

  const publish = Effect.fn("PreviewPagesService.publish")(function* (
    input: PreviewPagePublishInput,
  ) {
    // Checked first, so a computer without pages never reads the file.
    if (!publisher.enabled) return yield* libraryPagesError("unavailable");
    const title = input.title.trim();
    if (title === "" || title.length > PREVIEW_PAGE_TITLE_MAX)
      return yield* fail(
        "invalid",
        `Give the page a title of at most ${PREVIEW_PAGE_TITLE_MAX} characters.`,
      );
    const shell = yield* threadOnComputer(input.threadId);
    const file =
      "attachmentId" in input.source
        ? yield* attachmentFile(input.threadId, input.source.attachmentId)
        : yield* workspaceFile(shell, input.source.path);
    const html = yield* readHtml(file);
    return yield* publisher.publishPage({
      ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
      projectId: shell.projectId,
      threadId: input.threadId,
      title,
      kind: input.kind ?? "html",
      html,
    });
  });

  const list = Effect.fn("PreviewPagesService.list")(function* (filter?: {
    readonly threadId: ThreadId;
  }) {
    if (!publisher.enabled) return { available: false, pages: [] } satisfies PreviewPagesList;
    const pages = yield* publisher.listPages().pipe(
      Effect.asSome,
      Effect.catchIf(
        (error) => error.reason === "unavailable",
        () => Effect.succeedNone,
      ),
    );
    if (Option.isNone(pages)) return { available: false, pages: [] } satisfies PreviewPagesList;
    return {
      available: true,
      pages:
        filter === undefined
          ? pages.value
          : pages.value.filter((page) => page.threadId === filter.threadId),
    } satisfies PreviewPagesList;
  });

  const update = Effect.fn("PreviewPagesService.update")(function* (
    input: PreviewPageUpdateInput,
    scope?: { readonly threadId: ThreadId },
  ) {
    if (scope !== undefined) {
      const pages = yield* publisher.listPages();
      if (!pages.some((page) => page.id === input.pageId && page.threadId === scope.threadId))
        return yield* fail("not-found", "That page was not found in this thread.");
    }
    return yield* publisher.updatePage(input);
  });

  const deliver = Effect.fnUntraced(function* (reply: LibraryPageReply) {
    if (!REPLY_ID_PATTERN.test(reply.replyId)) return rejected("The reply id is malformed.");
    const shell = yield* threads.getThreadShell(reply.threadId);
    if (shell === null || shell.deletedAt !== null || shell.projectId !== reply.projectId)
      return rejected("The page's thread is not on this computer.");
    // The command id makes a re-leased reply land once, even after a delivery whose ack was lost.
    yield* threads.sendToThread({
      projectId: reply.projectId,
      threadId: reply.threadId,
      commandId: CommandId.make(`preview-reply:${reply.replyId}`),
      messageId: MessageId.make(`preview-reply-message:${reply.replyId}`),
      text: pageReplyMessage(reply),
      attachments: [],
      mode: "queue",
      createdBy: "system",
      creationSource: "server",
    });
    return { outcome: "delivered" } satisfies ReplyOutcome;
  });

  /** Null leaves the reply unacknowledged, so the Library offers it again once its lease ends. */
  const settle = (reply: LibraryPageReply) =>
    deliver(reply).pipe(
      Effect.catchTags({
        ThreadManagementThreadArchivedError: () =>
          Effect.succeed(rejected("The page's thread is archived.")),
        ThreadManagementThreadNotFoundError: () =>
          Effect.succeed(rejected("The page's thread is not on this computer.")),
        OrchestratorCommandPreviouslyRejectedError: () =>
          Effect.succeed(rejected("The page's thread refused this reply.")),
        OrchestratorCommandRejectedError: () =>
          Effect.succeed(rejected("The page's thread refused this reply.")),
        OrchestratorCommandIdConflictError: () =>
          Effect.succeed(rejected("This reply was already used for another thread.")),
        OrchestratorSubagentThreadReadOnlyError: () =>
          Effect.succeed(rejected("The page's thread is a subagent, which takes no messages.")),
      }),
      Effect.catch((error) =>
        Effect.logWarning("Could not deliver a page reply; the Library will offer it again", {
          replyId: reply.replyId,
          error: error._tag,
        }).pipe(Effect.as(null)),
      ),
      // One bad reply must not end the worker, which nothing restarts.
      Effect.catchDefect(() =>
        Effect.logWarning("A page reply could not be delivered; the Library will offer it again", {
          replyId: reply.replyId,
        }).pipe(Effect.as(null)),
      ),
    );

  /** Counts the replies the Library was told about. */
  const handleReplies = (replies: ReadonlyArray<LibraryPageReply>) =>
    Effect.reduce(
      replies,
      () => 0,
      (acked, reply) =>
        settle(reply).pipe(
          Effect.flatMap((outcome) =>
            outcome === null
              ? Effect.succeed(acked)
              : publisher
                  .ackReply({ replyId: reply.replyId, ...outcome })
                  .pipe(Effect.as(acked + 1)),
          ),
        ),
    );

  const relayReplies = Effect.gen(function* () {
    let failures = 0;
    for (;;) {
      const startedAt = yield* Clock.currentTimeMillis;
      const result = yield* publisher
        .nextReplies(LIBRARY_REPLY_WAIT_MAX_MS)
        .pipe(Effect.flatMap(handleReplies), Effect.result);
      if (result._tag === "Success") {
        failures = 0;
        // Unacknowledged replies can come straight back, so a round that settled none is paced too.
        if (result.success === 0) {
          const early = REPLY_POLL_MIN_INTERVAL_MS - ((yield* Clock.currentTimeMillis) - startedAt);
          if (early > 0) yield* Effect.sleep(Duration.millis(early));
        }
        continue;
      }
      if (result.failure.reason !== "unavailable" && result.failure.reason !== "blocked")
        failures += 1;
      yield* Effect.sleep(replyRetryDelay(result.failure.reason, failures));
    }
  });

  if (publisher.enabled) yield* forkParked(relayReplies);

  return PreviewPagesService.of({ publish, list, update });
});

export const layer = Layer.effect(PreviewPagesService, make);
