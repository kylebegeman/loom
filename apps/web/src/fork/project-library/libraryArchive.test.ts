import {
  ChatAttachmentId,
  MessageId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadProjectionFixture } from "~/test-fixtures";
import { libraryArchiveMessages, libraryArchiveTimeline } from "./libraryArchive";

const now = DateTime.makeUnsafe("2026-10-15T12:00:00Z");
const parentId = ThreadId.make("parent");
const childId = ThreadId.make("child");
const attachment = {
  id: ChatAttachmentId.make("inherited-attachment"),
  type: "file" as const,
  name: "brief.txt",
  mimeType: "text/plain",
  sizeBytes: 10,
};
function item(
  id: string,
  threadId = childId,
): Extract<OrchestrationV2TurnItem, { type: "assistant_message" }> {
  return {
    id: TurnItemId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "assistant_message",
    messageId: MessageId.make(id),
    text: id,
    attachments: [attachment],
    streaming: false,
  };
}
function visible(
  value: OrchestrationV2TurnItem,
  position: number,
  visibility: OrchestrationV2ProjectedTurnItem["visibility"] = "local",
): OrchestrationV2ProjectedTurnItem {
  return {
    position,
    visibility,
    sourceThreadId: value.threadId,
    sourceItemId: value.id,
    item: value,
  };
}
function message(id: string) {
  return {
    id: MessageId.make(id),
    threadId: childId,
    runId: null,
    nodeId: null,
    role: "assistant" as const,
    text: id,
    attachments: [attachment],
    streaming: false,
    createdAt: now,
    updatedAt: now,
    createdBy: "agent" as const,
    creationSource: "provider" as const,
  };
}

describe("saved Library conversation messages", () => {
  it("preserves inherited history and attachments before the child conversation", () => {
    const inherited = item("parent-message", parentId);
    const own = item("child-message");
    const result = libraryArchiveMessages({
      ...makeThreadProjectionFixture(),
      messages: [message("child-message")],
      turnItems: [own],
      visibleTurnItems: [visible(inherited, 0, "inherited"), visible(own, 1)],
    });
    expect(result.map((value) => value.id)).toEqual(["parent-message", "child-message"]);
    expect(result[0]?.attachments).toEqual([attachment]);
  });

  it("uses the visible history and captured detail without reviving hidden messages", () => {
    const own = { ...item("visible"), text: "Full captured message" };
    const result = libraryArchiveMessages({
      ...makeThreadProjectionFixture(),
      messages: [message("hidden"), message("visible")],
      turnItems: [own],
      visibleTurnItems: [visible({ ...own, text: "Summary" }, 0)],
    });
    expect(result.map((value) => value.text)).toEqual(["Full captured message"]);
  });

  it("keeps activity-only history pages visible in their captured order", () => {
    const activity: OrchestrationV2TurnItem = {
      ...item("reasoning"),
      type: "reasoning",
      text: "Captured reasoning",
    };
    const result = libraryArchiveTimeline({
      ...makeThreadProjectionFixture(),
      turnItems: [activity],
      visibleTurnItems: [visible(activity, 0)],
    });
    expect(result.map((entry) => entry.kind)).toEqual(["work"]);
    expect(result[0]?.kind === "work" && result[0].entry.projectedItem?.item).toMatchObject({
      type: "reasoning",
      text: "Captured reasoning",
    });
  });
  it("reads message-only legacy archives when visible turn items are unavailable", () => {
    const result = libraryArchiveMessages({
      ...makeThreadProjectionFixture(),
      messages: [message("legacy")],
    });
    expect(result[0]).toMatchObject({
      id: "legacy",
      text: "legacy",
      attachments: [attachment],
      createdAt: DateTime.formatIso(now),
    });
  });
});
