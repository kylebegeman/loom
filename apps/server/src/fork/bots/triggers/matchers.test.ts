import { ProjectId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { branchMatches, eventPasses, matchPullRequestLink, type TriggerEvent } from "./matchers.ts";

const projectId = ProjectId.make("project-a");
const thread = { threadId: ThreadId.make("thread-1"), projectId };
const AT = "2026-10-20T12:00:00.000Z";

const link = (
  checksState: "failing" | "passing" | "pending",
  headSha: string,
  state: "open" | "merged" = "open",
): ThreadPullRequestLink => ({
  host: "github.com",
  repository: "acme/app",
  number: 12,
  url: "https://github.com/acme/app/pull/12",
  source: "agent",
  linkedAt: "2026-10-20T09:00:00.000Z",
  stack: null,
  snapshot: {
    state,
    title: "Fix it",
    headBranch: "fix/it",
    baseBranch: "main",
    isDraft: false,
    updatedAt: null,
    syncedAt: AT,
    checksState,
  },
  watch: {
    startedAt: AT,
    headSha,
    failedChecks: checksState === "failing" ? ["test"] : [],
    passed: false,
    passedChecks: [],
    remarksThrough: AT,
    remarkIds: [],
    conflicting: false,
    wakes: 0,
  },
});

const kinds = (events: ReadonlyArray<TriggerEvent>) => events.map((event) => event.kind);

describe("pull request matching", () => {
  it("fires opened once and checks failing on each change to failing or new failing head", () => {
    const first = matchPullRequestLink(link("pending", "a"), thread, null, AT);
    expect(kinds(first.events)).toEqual(["pull-request-opened"]);
    expect(first.events[0]).toMatchObject({
      key: "github.com/acme/app#12",
      firstSeenSince: "2026-10-20T09:00:00.000Z",
      fields: { url: "https://github.com/acme/app/pull/12", headBranch: "fix/it" },
    });

    const failing = matchPullRequestLink(link("failing", "a"), thread, first.next, AT);
    expect(failing.events).toMatchObject([
      {
        kind: "pull-request-checks-failing",
        key: "github.com/acme/app#12@a",
        fields: { failedChecks: "test" },
      },
    ]);
    expect(failing.events[0]!.firstSeenSince).toBeUndefined();
    expect(matchPullRequestLink(link("failing", "a"), thread, failing.next, AT).events).toEqual([]);
    expect(
      kinds(matchPullRequestLink(link("failing", "b"), thread, failing.next, AT).events),
    ).toEqual(["pull-request-checks-failing"]);
    expect(
      matchPullRequestLink(link("failing", "c", "merged"), thread, failing.next, AT).events,
    ).toEqual([]);
  });

  it("ignores pull requests linked to bot runs", () => {
    const run = { threadId: ThreadId.make("bot-run-r1"), projectId };
    expect(matchPullRequestLink(link("failing", "a"), run, null, AT)).toEqual({
      next: null,
      events: [],
    });
  });
});

describe("trigger filters", () => {
  const event: TriggerEvent = {
    kind: "pull-request-opened",
    key: "k",
    summary: "s",
    fields: {},
    projectId,
    repository: "Acme/App",
    headBranch: "release/1.2",
    occurredAt: AT,
  };
  const created = (filter: Record<string, string>, createdAt = "2026-10-20T10:00:00.000Z") => ({
    event: { kind: "pull-request-opened" as const, ...filter },
    createdAt,
  });

  it("matches project, repository case-insensitively and branch globs", () => {
    expect(
      eventPasses(created({ repository: "acme/app", branchPattern: "release/*" }), event),
    ).toBe(true);
    expect(eventPasses(created({ branchPattern: "main" }), event)).toBe(false);
    expect(eventPasses(created({ projectId: "other" }), event)).toBe(false);
    expect(branchMatches("feat/*.x", "feat/a.x")).toBe(true);
    expect(branchMatches("feat/*.x", "feat/a-x")).toBe(false);
  });

  it("ignores events and pull requests from before the trigger existed", () => {
    expect(eventPasses(created({}, "2026-10-20T13:00:00.000Z"), event)).toBe(false);
    expect(eventPasses(created({}), { ...event, firstSeenSince: "2026-10-20T09:00:00.000Z" })).toBe(
      false,
    );
    expect(eventPasses(created({}), { ...event, kind: "pull-request-checks-failing" })).toBe(false);
  });
});
