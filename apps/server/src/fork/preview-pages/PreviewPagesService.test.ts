import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  PREVIEW_PAGE_MAX_BYTES,
  PreviewPagesError,
  type LibraryPagePublishRequest,
  type LibraryPageReply,
  type LibraryPageReplyAckRequest,
  type PreviewPage,
  type PreviewPageUpdateInput,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { createAttachmentId } from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { OrchestratorCommandPreviouslyRejectedError } from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import {
  ThreadManagementProjectionLoadError,
  ThreadManagementService,
  ThreadManagementThreadArchivedError,
  ThreadManagementThreadNotFoundError,
  type ThreadManagementSendInput,
  type ThreadManagementSendResult,
} from "../../orchestration-v2/ThreadManagementService.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { PreviewPagesService, layer, replyRetryDelay } from "./PreviewPagesService.ts";

const thread = ThreadId.make("pages-thread");
const other = ThreadId.make("pages-other");
// The project every live test shell belongs to.
const projectId = liveThreadShell(thread).projectId;

const pageFor = (
  input: Pick<LibraryPagePublishRequest, "threadId" | "title" | "kind"> & { readonly id?: string },
): PreviewPage => ({
  id: input.id ?? "page-1",
  url: `https://pages.bagels.top/p/${input.id ?? "page-1"}`,
  title: input.title,
  kind: input.kind,
  projectId,
  threadId: input.threadId,
  state: "open",
  kept: false,
  sizeBytes: 9,
  createdAt: "2026-10-19T00:00:00.000Z",
  expiresAt: "2026-11-18T00:00:00.000Z",
  endedAt: null,
  restorableUntil: null,
});

const replyFor = (replyId: string, threadId: ThreadId, project = projectId): LibraryPageReply => ({
  replyId,
  pageId: "page-1",
  pageTitle: "Release plan",
  projectId: project,
  threadId,
  text: "Ship it, but rename the button first.",
  createdAt: "2026-10-19T01:00:00.000Z",
});

const harness = Effect.fnUntraced(function* (
  options: {
    readonly publisher?: Partial<LibraryPublisher["Service"]>;
    readonly threads?: Partial<ThreadManagementService["Service"]>;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* fs.makeTempDirectoryScoped();
  const config = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
  const workspace = path.join(baseDir, "workspace");
  const outside = path.join(baseDir, "outside");
  yield* fs.makeDirectory(workspace, { recursive: true });
  yield* fs.makeDirectory(outside, { recursive: true });
  const published: Array<LibraryPagePublishRequest> = [];
  const updated: Array<PreviewPageUpdateInput> = [];
  const context = yield* Layer.build(
    layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ServerConfig.ServerConfig, config),
          Layer.mock(LibraryPublisher)({
            enabled: true,
            publishPage: (input) =>
              Effect.sync(() => {
                published.push(input);
                return pageFor(input);
              }),
            updatePage: (input) =>
              Effect.sync(() => {
                updated.push(input);
                return { ...pageFor({ threadId: thread, title: "Release plan", kind: "html" }) };
              }),
            // Keeps the replies worker idle unless a test feeds it.
            nextReplies: () => Effect.never,
            ...options.publisher,
          }),
          Layer.mock(ThreadManagementService)({
            getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
            ...options.threads,
          }),
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: (id) =>
              Effect.succeedSome({
                projectId: id,
                title: "Pages",
                workspaceRoot: workspace,
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                autoPull: false,
                faviconPath: null,
                projectIcon: null,
                scripts: [],
                createdAt: "2026-10-19T00:00:00.000Z",
                updatedAt: "2026-10-19T00:00:00.000Z",
                deletedAt: null,
              }),
          }),
        ),
      ),
    ),
  );
  const writeAttachment = (attachmentId: string, extension: string, content: string) =>
    fs.writeFileString(path.join(config.attachmentsDir, `${attachmentId}.${extension}`), content);
  return {
    service: Context.get(context, PreviewPagesService),
    attachmentsDir: config.attachmentsDir,
    workspace,
    outside,
    published,
    updated,
    writeAttachment,
    fs,
    path,
  };
});

const reasonOf = <A>(effect: Effect.Effect<A, PreviewPagesError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

it.layer(NodeServices.layer)("PreviewPagesService", (it) => {
  it.effect("publishes only this thread's html_render pages", () =>
    Effect.gen(function* () {
      const f = yield* harness();
      const own = createAttachmentId(thread, "html")!;
      yield* f.writeAttachment(own, "html", "<p>Release plan</p>");
      const page = yield* f.service.publish({
        threadId: thread,
        source: { attachmentId: own },
        title: "  Release plan  ",
      });
      expect(page.threadId).toBe(thread);
      expect(f.published).toEqual([
        {
          projectId,
          threadId: thread,
          title: "Release plan",
          kind: "html",
          html: "<p>Release plan</p>",
        },
      ]);

      const theirs = createAttachmentId(other, "html")!;
      yield* f.writeAttachment(theirs, "html", "<p>Not yours</p>");
      const image = createAttachmentId(thread, "png")!;
      yield* f.writeAttachment(image, "png", "png");
      for (const attachmentId of [theirs, image, `../${own}`]) {
        expect(
          yield* reasonOf(
            f.service.publish({ threadId: thread, source: { attachmentId }, title: "Plan" }),
          ),
        ).toBe("not-found");
      }
      const missing = createAttachmentId(thread, "html")!;
      expect(
        yield* reasonOf(
          f.service.publish({ threadId: thread, source: { attachmentId: missing }, title: "Plan" }),
        ),
      ).toBe("not-found");
      // A link planted under a well-formed id of this thread still cannot leave the store.
      const planted = createAttachmentId(thread, "html")!;
      yield* f.fs.writeFileString(f.path.join(f.outside, "secret.html"), "<p>secret</p>");
      yield* f.fs.symlink(
        f.path.join(f.outside, "secret.html"),
        f.path.join(f.attachmentsDir, `${planted}.html`),
      );
      expect(
        yield* reasonOf(
          f.service.publish({ threadId: thread, source: { attachmentId: planted }, title: "Plan" }),
        ),
      ).toBe("not-found");
      expect(f.published).toHaveLength(1);
    }),
  );

  it.effect("publishes workspace HTML files and refuses anything that resolves outside", () =>
    Effect.gen(function* () {
      const f = yield* harness();
      yield* f.fs.makeDirectory(f.path.join(f.workspace, "docs"));
      yield* f.fs.writeFileString(
        f.path.join(f.workspace, "docs", "dossier.html"),
        "<h1>Dossier</h1>",
      );
      yield* f.service.publish({
        threadId: thread,
        source: { path: "docs/dossier.html" },
        title: "Dossier",
        kind: "dossier",
        pageId: "page-1",
      });
      yield* f.service.publish({
        threadId: thread,
        source: { path: f.path.join(f.workspace, "docs", "dossier.html") },
        title: "Dossier",
      });
      expect(f.published.map(({ html, kind, pageId }) => ({ html, kind, pageId }))).toEqual([
        { html: "<h1>Dossier</h1>", kind: "dossier", pageId: "page-1" },
        { html: "<h1>Dossier</h1>", kind: "html", pageId: undefined },
      ]);

      yield* f.fs.writeFileString(f.path.join(f.outside, "secret.html"), "<p>secret</p>");
      yield* f.fs.symlink(
        f.path.join(f.outside, "secret.html"),
        f.path.join(f.workspace, "escape.html"),
      );
      yield* f.fs.writeFileString(f.path.join(f.workspace, "notes.txt"), "<p>not html</p>");
      yield* f.fs.makeDirectory(f.path.join(f.workspace, "folder.html"));
      const refused = (path: string) =>
        reasonOf(f.service.publish({ threadId: thread, source: { path }, title: "Plan" }));
      expect(yield* refused("escape.html")).toBe("invalid");
      expect(yield* refused("../outside/secret.html")).toBe("invalid");
      expect(yield* refused(f.path.join(f.outside, "secret.html"))).toBe("invalid");
      expect(yield* refused("notes.txt")).toBe("invalid");
      expect(yield* refused("folder.html")).toBe("invalid");
      expect(yield* refused("missing.html")).toBe("not-found");
      expect(f.published).toHaveLength(2);
    }),
  );

  it.effect("caps a page at its size limit and requires UTF-8", () =>
    Effect.gen(function* () {
      const f = yield* harness();
      const file = f.path.join(f.workspace, "page.html");
      const publish = f.service.publish({
        threadId: thread,
        source: { path: "page.html" },
        title: "Big",
      });
      yield* f.fs.writeFile(file, new Uint8Array(PREVIEW_PAGE_MAX_BYTES).fill(0x61));
      yield* publish;
      expect(f.published[0]?.html.length).toBe(PREVIEW_PAGE_MAX_BYTES);
      yield* f.fs.writeFile(file, new Uint8Array(PREVIEW_PAGE_MAX_BYTES + 1).fill(0x61));
      expect(yield* reasonOf(publish)).toBe("too-large");
      yield* f.fs.writeFile(file, new Uint8Array([0x3c, 0x70, 0x3e, 0xff, 0xfe]));
      expect(yield* reasonOf(publish)).toBe("invalid");
      expect(f.published).toHaveLength(1);
    }),
  );

  it.effect("reports a computer or Library without pages as unavailable instead of failing", () =>
    Effect.gen(function* () {
      const disabled = yield* harness({ publisher: { enabled: false } });
      expect(yield* disabled.service.list()).toEqual({ available: false, pages: [] });
      const attachmentId = createAttachmentId(thread, "html")!;
      yield* disabled.writeAttachment(attachmentId, "html", "<p>hi</p>");
      expect(
        yield* reasonOf(
          disabled.service.publish({ threadId: thread, source: { attachmentId }, title: "Plan" }),
        ),
      ).toBe("unavailable");

      const unavailable = yield* harness({
        publisher: {
          listPages: () =>
            Effect.fail(new PreviewPagesError({ reason: "unavailable", message: "No pages." })),
        },
      });
      expect(yield* unavailable.service.list({ threadId: thread })).toEqual({
        available: false,
        pages: [],
      });

      const refused = yield* harness({
        publisher: {
          listPages: () =>
            Effect.fail(new PreviewPagesError({ reason: "blocked", message: "Refused." })),
        },
      });
      expect(yield* reasonOf(refused.service.list())).toBe("blocked");

      const mine = pageFor({ threadId: thread, title: "Mine", kind: "html", id: "mine" });
      const theirs = pageFor({ threadId: other, title: "Theirs", kind: "dossier", id: "theirs" });
      const listed = yield* harness({
        publisher: { listPages: () => Effect.succeed([mine, theirs]) },
      });
      expect(yield* listed.service.list()).toEqual({ available: true, pages: [mine, theirs] });
      expect(yield* listed.service.list({ threadId: thread })).toEqual({
        available: true,
        pages: [mine],
      });
    }),
  );

  it.effect("counts every page change it asked the Library for, even a failed one", () =>
    Effect.gen(function* () {
      const f = yield* harness({
        publisher: {
          listPages: () => Effect.succeed([]),
          updatePage: () =>
            Effect.fail(new PreviewPagesError({ reason: "io", message: "Unreachable." })),
        },
      });
      const revision = Stream.runHead(f.service.revisions).pipe(Effect.map(Option.getOrThrow));
      const start = yield* revision;
      const attachmentId = createAttachmentId(thread, "html")!;
      yield* f.writeAttachment(attachmentId, "html", "<p>Plan</p>");
      yield* f.service.publish({ threadId: thread, source: { attachmentId }, title: "Plan" });
      expect(yield* revision).toBe(start + 1);
      // The Library may have applied a change whose answer never came back.
      yield* reasonOf(f.service.update({ pageId: "page-1", action: "keep" }));
      expect(yield* revision).toBe(start + 2);
      // Refused here, so the Library was never asked.
      yield* reasonOf(f.service.update({ pageId: "page-1", action: "end" }, { threadId: thread }));
      yield* reasonOf(
        f.service.publish({ threadId: thread, source: { path: "missing.html" }, title: "Plan" }),
      );
      expect(yield* revision).toBe(start + 2);
    }),
  );

  it.effect("signs pages browsers out without ever failing the caller", () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const answering = (reason: PreviewPagesError["reason"]) => () =>
        Effect.sync(() => void asked.push(reason)).pipe(
          Effect.andThen(Effect.fail(new PreviewPagesError({ reason, message: "No." }))),
        );
      const disabled = yield* harness({
        publisher: { enabled: false, signOutPageReaders: answering("io") },
      });
      yield* disabled.service.signOutReaders;
      for (const reason of ["unavailable", "blocked", "io"] as const) {
        const f = yield* harness({ publisher: { signOutPageReaders: answering(reason) } });
        yield* f.service.signOutReaders;
      }
      expect(asked).toEqual(["unavailable", "blocked", "io"]);

      const signedOut = yield* harness({ publisher: { signOutPageReaders: () => Effect.void } });
      yield* signedOut.service.signOutReaders;
      const hung = yield* harness({ publisher: { signOutPageReaders: () => Effect.never } });
      const waiting = yield* Effect.forkChild(hung.service.signOutReaders);
      yield* TestClock.adjust(Duration.seconds(10));
      yield* Fiber.join(waiting);
    }),
  );

  it.effect("lets a thread change only its own pages, and the owner any", () =>
    Effect.gen(function* () {
      const theirs = pageFor({ threadId: other, title: "Theirs", kind: "html", id: "theirs" });
      const mine = pageFor({ threadId: thread, title: "Mine", kind: "html", id: "mine" });
      const f = yield* harness({ publisher: { listPages: () => Effect.succeed([mine, theirs]) } });
      expect(
        yield* reasonOf(
          f.service.update({ pageId: "theirs", action: "end" }, { threadId: thread }),
        ),
      ).toBe("not-found");
      expect(f.updated).toEqual([]);
      yield* f.service.update({ pageId: "mine", action: "keep" }, { threadId: thread });
      yield* f.service.update({ pageId: "theirs", action: "end" });
      expect(f.updated).toEqual([
        { pageId: "mine", action: "keep" },
        { pageId: "theirs", action: "end" },
      ]);
    }),
  );

  it.effect("delivers replies once as queued messages and settles each with the Library", () =>
    Effect.gen(function* () {
      const archived = ThreadId.make("pages-archived");
      const removed = ThreadId.make("pages-removed");
      const unknown = ThreadId.make("pages-unknown");
      const refused = ThreadId.make("pages-refused");
      const busy = ThreadId.make("pages-busy");
      const replies = [
        replyFor("reply-delivered", thread),
        replyFor("reply-archived", archived),
        replyFor("reply-removed", removed),
        replyFor("reply-elsewhere", thread, ProjectId.make("project:another")),
        replyFor("reply-unknown", unknown),
        replyFor("reply-refused", refused),
        replyFor("reply-busy", busy),
      ];
      const sent: Array<ThreadManagementSendInput> = [];
      const acks: Array<LibraryPageReplyAckRequest> = [];
      const drained = yield* Deferred.make<void>();
      const waits: Array<number> = [];
      yield* harness({
        publisher: {
          nextReplies: (waitMs) =>
            Effect.suspend(() => {
              waits.push(waitMs);
              return waits.length === 1
                ? Effect.succeed(replies)
                : Deferred.succeed(drained, undefined).pipe(Effect.andThen(Effect.never));
            }),
          ackReply: (input) => Effect.sync(() => void acks.push(input)),
        },
        threads: {
          getThreadShell: (threadId) =>
            Effect.succeed(threadId === removed ? null : liveThreadShell(threadId)),
          sendToThread: (input) =>
            Effect.suspend((): ReturnType<ThreadManagementService["Service"]["sendToThread"]> => {
              sent.push(input);
              switch (input.threadId) {
                case archived:
                  return Effect.fail(
                    new ThreadManagementThreadArchivedError({ threadId: archived }),
                  );
                case unknown:
                  return Effect.fail(
                    new ThreadManagementThreadNotFoundError({ projectId, threadId: unknown }),
                  );
                case refused:
                  return Effect.fail(
                    new OrchestratorCommandPreviouslyRejectedError({
                      commandId: input.commandId,
                      commandType: "message.dispatch",
                      detail: "Rejected earlier.",
                    }),
                  );
                case busy:
                  return Effect.fail(
                    new ThreadManagementProjectionLoadError({
                      projectId,
                      threadId: busy,
                      cause: new Error("database is locked"),
                    }),
                  );
                default:
                  // The worker reads nothing from a delivered send's result.
                  return Effect.succeed({} as ThreadManagementSendResult);
              }
            }),
        },
      });
      yield* Deferred.await(drained);

      // The Library holds each poll open as long as it allows.
      expect(waits).toEqual([25_000, 25_000]);

      expect(sent[0]).toEqual({
        projectId,
        threadId: thread,
        commandId: "preview-reply:reply-delivered",
        messageId: "preview-reply-message:reply-delivered",
        text: 'A reply came in on your published page "Release plan":\n\nShip it, but rename the button first.',
        attachments: [],
        mode: "queue",
        createdBy: "system",
        creationSource: "server",
      });
      // A thread that is gone, or belongs elsewhere, is never sent to.
      expect(sent.map((input) => input.threadId)).toEqual([
        thread,
        archived,
        unknown,
        refused,
        busy,
      ]);
      expect(acks.map(({ replyId, outcome }) => [replyId, outcome])).toEqual([
        ["reply-delivered", "delivered"],
        ["reply-archived", "rejected"],
        ["reply-removed", "rejected"],
        ["reply-elsewhere", "rejected"],
        ["reply-unknown", "rejected"],
        ["reply-refused", "rejected"],
      ]);
      for (const ack of acks.slice(1)) {
        expect(ack.detail?.length).toBeGreaterThan(0);
        expect(ack.detail!.length).toBeLessThanOrEqual(200);
      }
    }),
  );

  it.effect("keeps relaying after a reply it cannot use or that breaks its delivery", () =>
    Effect.gen(function* () {
      const broken = ThreadId.make("pages-broken");
      const acks: Array<LibraryPageReplyAckRequest> = [];
      const sent: Array<ThreadId> = [];
      const drained = yield* Deferred.make<void>();
      let polls = 0;
      yield* harness({
        publisher: {
          nextReplies: () =>
            Effect.suspend(() => {
              polls += 1;
              return polls === 1
                ? Effect.succeed([
                    replyFor("reply bad ", thread),
                    replyFor("reply-broken", broken),
                    replyFor("reply-after", thread),
                  ])
                : Deferred.succeed(drained, undefined).pipe(Effect.andThen(Effect.never));
            }),
          ackReply: (input) => Effect.sync(() => void acks.push(input)),
        },
        threads: {
          sendToThread: (input) =>
            Effect.suspend((): ReturnType<ThreadManagementService["Service"]["sendToThread"]> => {
              sent.push(input.threadId);
              return input.threadId === broken
                ? Effect.die(new Error("projection invariant"))
                : Effect.succeed({} as ThreadManagementSendResult);
            }),
        },
      });
      yield* Deferred.await(drained);
      // An id that cannot be a command id is refused before any send; a defect stays unacked.
      expect(sent).toEqual([broken, thread]);
      expect(acks.map(({ replyId, outcome }) => [replyId, outcome])).toEqual([
        ["reply bad ", "rejected"],
        ["reply-after", "delivered"],
      ]);
      expect(polls).toBe(2);
    }),
  );

  it.effect("paces a round that settled nothing, so unacknowledged replies cannot spin it", () =>
    Effect.gen(function* () {
      const busy = ThreadId.make("pages-busy");
      const firstSettled = yield* Deferred.make<void>();
      const drained = yield* Deferred.make<void>();
      let polls = 0;
      yield* harness({
        publisher: {
          // A Library that offers the same reply straight back, ignoring its lease.
          nextReplies: () =>
            Effect.suspend(() => {
              polls += 1;
              return polls === 1
                ? Effect.succeed([replyFor("reply-busy", busy)])
                : Deferred.succeed(drained, undefined).pipe(Effect.andThen(Effect.never));
            }),
          ackReply: () => Effect.die("a failed delivery is never acknowledged"),
        },
        threads: {
          sendToThread: () =>
            Deferred.succeed(firstSettled, undefined).pipe(
              Effect.andThen(
                Effect.fail(
                  new ThreadManagementProjectionLoadError({
                    projectId,
                    threadId: busy,
                    cause: new Error("database is locked"),
                  }),
                ),
              ),
            ),
        },
      });
      yield* Deferred.await(firstSettled);
      yield* TestClock.adjust("999 millis");
      expect(polls).toBe(1);
      yield* TestClock.adjust("1 millis");
      yield* Deferred.await(drained);
      expect(polls).toBe(2);
    }),
  );

  it("waits out a refusing Library and backs off from an unreachable one", () => {
    expect(Duration.toMillis(replyRetryDelay("unavailable", 1))).toBe(30 * 60_000);
    expect(Duration.toMillis(replyRetryDelay("blocked", 9))).toBe(30 * 60_000);
    expect(
      [1, 2, 3, 4, 6, 7, 40].map((attempt) => Duration.toMillis(replyRetryDelay("io", attempt))),
    ).toEqual([5_000, 10_000, 20_000, 40_000, 160_000, 300_000, 300_000]);
  });
});
