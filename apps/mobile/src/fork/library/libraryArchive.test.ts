import {
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import type { LibraryReplicationStatus, LibraryThreadSummary } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryArchiveRows,
  libraryHistoryFreshness,
  shouldRefreshLibraryArchive,
} from "./libraryArchive";
const threadId = ThreadId.make("saved-thread"),
  timestamp = DateTime.makeUnsafe("2026-10-15T00:00:00Z");
const base = (id: string, ordinal: number) => ({
  id: TurnItemId.make(id),
  threadId,
  runId: RunId.make("run"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  status: "completed" as const,
  title: null,
  startedAt: timestamp,
  completedAt: timestamp,
  updatedAt: timestamp,
});
const project = (
  item: OrchestrationV2TurnItem,
  position: number,
): OrchestrationV2ProjectedTurnItem => ({
  item,
  position,
  visibility: "local",
  sourceThreadId: threadId,
  sourceItemId: item.id,
});
const summary: LibraryThreadSummary = {
  id: "saved",
  projectId: "project",
  threadId,
  environmentId: EnvironmentId.make("original-host"),
  localProjectId: "local" as LibraryThreadSummary["localProjectId"],
  workingCopyId: "copy",
  resourceIds: ["component"],
  title: "Saved history",
  status: "idle",
  archived: false,
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
  syncedAt: "2026-10-15T00:00:00Z",
  sequence: 7,
};
const status: LibraryReplicationStatus = {
  enabled: true,
  journalId: "journal",
  acknowledgedSequence: 900,
  pendingEntries: 0,
  lastFailure: null,
  threads: [
    { threadId, queuedSequence: 7, acknowledgedSequence: 7, currentSequence: 7, pending: false },
  ],
};
describe("captured library history", () => {
  it("reloads only a displayed archive whose listed summary has a newer saved sequence", () => {
    const displayed = { id: "displayed", sequence: 10 };
    expect(shouldRefreshLibraryArchive(displayed, { id: "displayed", sequence: 11 })).toBe(true);
    expect(shouldRefreshLibraryArchive(displayed, { id: "other", sequence: 11 })).toBe(false);
    expect(shouldRefreshLibraryArchive(displayed, { id: "displayed", sequence: 10 })).toBe(false);
    expect(shouldRefreshLibraryArchive(displayed, { id: "displayed", sequence: 9 })).toBe(false);
    expect(shouldRefreshLibraryArchive(null, { id: "displayed", sequence: 1 })).toBe(false);
    expect(shouldRefreshLibraryArchive(displayed, undefined)).toBe(false);
  });
  it("preserves the visible timeline and hydrates captured command detail without needing the original host", () => {
    const user: OrchestrationV2TurnItem = {
      ...base("user", 0),
      type: "user_message",
      messageId: MessageId.make("prompt"),
      createdBy: "user",
      creationSource: "mobile",
      inputIntent: "turn_start",
      text: "Run focused tests",
      attachments: [],
    };
    const command: OrchestrationV2TurnItem = {
      ...base("command", 1),
      type: "command_execution",
      input: "vp test run focused",
      output: "2 tests passed",
      exitCode: 0,
    };
    const answer: OrchestrationV2TurnItem = {
      ...base("answer", 2),
      type: "assistant_message",
      messageId: MessageId.make("answer"),
      text: "**Checks passed**",
      streaming: false,
    };
    const rows = libraryArchiveRows({
      turnItems: [user, command, answer],
      visibleTurnItems: [
        project(user, 0),
        project({ ...command, output: undefined, outputOmitted: true }, 1),
        project(answer, 2),
      ],
      attempts: [],
      nodes: [],
      messages: [],
    });
    expect(rows.map((row) => row.type)).toEqual(["message", "activity", "message"]);
    const activity = rows.find((row) => row.type === "activity");
    expect(activity?.activity.projectedItem.item).toMatchObject({ output: "2 tests passed" });
    expect(activity?.activity.fetchesDetail).toBe(false);
  });
  it("uses per-thread receipts and keeps offline and pending uploads distinct", () => {
    expect(libraryHistoryFreshness(summary, false, status).state).toBe("offline");
    expect(libraryHistoryFreshness(summary, true, status).state).toBe("saved");
    expect(
      libraryHistoryFreshness(summary, true, {
        ...status,
        threads: [{ ...status.threads[0]!, currentSequence: 8, pending: true }],
      }).state,
    ).toBe("pending");
    expect(
      libraryHistoryFreshness(summary, true, {
        ...status,
        threads: [{ ...status.threads[0]!, acknowledgedSequence: 8, currentSequence: 8 }],
      }).state,
    ).toBe("reload");
    expect(libraryHistoryFreshness(summary, true, { ...status, enabled: false }).state).toBe(
      "disabled",
    );
  });
  it("retains inherited source messages ahead of a child's own message history", () => {
    const parentThread = ThreadId.make("parent-thread");
    const inherited: OrchestrationV2TurnItem = {
      ...base("parent-answer", 0),
      threadId: parentThread,
      type: "assistant_message",
      messageId: MessageId.make("parent-answer"),
      text: "Prior project decision",
      streaming: false,
    };
    const child: OrchestrationV2TurnItem = {
      ...base("child-question", 0),
      type: "user_message",
      messageId: MessageId.make("child-question"),
      createdBy: "user",
      creationSource: "mobile",
      inputIntent: "turn_start",
      text: "Continue that work",
      attachments: [],
    };
    const rows = libraryArchiveRows({
      turnItems: [child],
      visibleTurnItems: [
        { ...project(inherited, 0), visibility: "inherited", sourceThreadId: parentThread },
        project(child, 1),
      ],
      attempts: [],
      nodes: [],
      messages: [
        {
          id: child.messageId,
          threadId,
          runId: child.runId,
          nodeId: null,
          role: "user",
          createdBy: "user",
          creationSource: "mobile",
          text: child.text,
          attachments: [],
          streaming: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    expect(
      rows
        .filter((row) => row.type === "message")
        .map((row) => ({
          text: row.message.text,
          visibility: row.message.visibility,
          sourceThreadId: row.message.sourceThreadId,
        })),
    ).toEqual([
      { text: "Prior project decision", visibility: "inherited", sourceThreadId: parentThread },
      { text: "Continue that work", visibility: "local", sourceThreadId: threadId },
    ]);
  });
});
