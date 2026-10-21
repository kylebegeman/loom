import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryThreadBinding,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { conversationLibraryContext, conversationWorkingCopy } from "./threadConversationContext";

const environmentId = EnvironmentId.make("computer");
const projectId = ProjectId.make("local-project");
const threadId = ThreadId.make("current-conversation");
const thread = { environmentId, projectId, id: threadId };
const binding: LibraryThreadBinding = {
  projectId: "library-project",
  projectRevision: 1,
  workingCopyId: "files",
  environmentId,
  resourceIds: ["repo"],
};
const summary: LibraryThreadSummary = {
  id: "archive",
  projectId: binding.projectId,
  environmentId,
  threadId,
  localProjectId: projectId,
  workingCopyId: "files",
  resourceIds: ["repo"],
  title: "Conversation",
  status: "idle",
  archived: false,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  syncedAt: "2026-10-21T00:00:00.000Z",
  sequence: 1,
};
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: binding.projectId,
  projectRevision: 1,
  environmentId,
  rootPath: "/project",
  rootLocalProjectId: projectId,
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: summary.createdAt,
  updatedAt: summary.updatedAt,
};

describe("conversation context identity", () => {
  it("keeps continuation anchored to the current conversation, not its source", () => {
    const context = conversationLibraryContext(
      thread,
      {
        ...binding,
        continuationOf: {
          environmentId: EnvironmentId.make("previous-computer"),
          threadId: ThreadId.make("source"),
          sequence: 10,
        },
      },
      summary,
    );
    expect(context).toEqual({
      projectId: binding.projectId,
      workingCopyId: copy.id,
      archiveId: summary.id,
    });
    expect(
      conversationLibraryContext(thread, null, { ...summary, threadId: ThreadId.make("source") }),
    ).toBeNull();
    expect(
      conversationLibraryContext(thread, null, {
        ...summary,
        environmentId: EnvironmentId.make("other"),
      }),
    ).toBeNull();
    expect(
      conversationLibraryContext(thread, null, {
        ...summary,
        localProjectId: ProjectId.make("other"),
      }),
    ).toBeNull();
  });
  it("does not offer a stale archive for a different binding", () => {
    expect(
      conversationLibraryContext(thread, binding, { ...summary, workingCopyId: "older-files" })
        ?.archiveId,
    ).toBeNull();
    expect(
      conversationLibraryContext(
        thread,
        { ...binding, environmentId: EnvironmentId.make("other") },
        null,
      ),
    ).toBeNull();
  });
  it("only exposes file controls for the exact copy, computer, project and conversation folder", () => {
    const context = conversationLibraryContext(thread, binding, summary)!;
    expect(conversationWorkingCopy(thread, "/project", context, [copy])).toBe(copy);
    for (const changed of [
      { ...copy, id: "different-copy" },
      { ...copy, environmentId: EnvironmentId.make("other") },
      { ...copy, projectId: "different-project" },
      { ...copy, rootLocalProjectId: ProjectId.make("other") },
    ])
      expect(conversationWorkingCopy(thread, "/project", context, [changed])).toBeNull();
    expect(conversationWorkingCopy(thread, "/project-worktree", context, [copy])).toBeNull();
    expect(conversationWorkingCopy(thread, null, context, [copy])).toBeNull();
  });
  it("matches a component by both local project and exact folder", () => {
    const component = {
      ...copy,
      rootLocalProjectId: ProjectId.make("root"),
      repositories: [
        {
          resourceId: "repo",
          path: "/project/repo",
          localProjectId: projectId,
          head: null,
          branch: null,
        },
      ],
    };
    const context = conversationLibraryContext(thread, binding, summary)!;
    expect(conversationWorkingCopy(thread, "/project/repo", context, [component])).toBe(component);
    expect(conversationWorkingCopy(thread, "/project", context, [component])).toBeNull();
  });
});
