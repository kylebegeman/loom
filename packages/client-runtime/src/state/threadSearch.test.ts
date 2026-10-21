import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationSearchThreadsResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import {
  createThreadSearchResultsAtomFamily,
  makeThreadSearchKey,
  threadSearchMatchKey,
} from "./threadSearch.ts";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");

it("creates stable keys regardless of environment order", () => {
  expect(makeThreadSearchKey([envB, envA], "needle")).toBe(
    makeThreadSearchKey([envA, envB], "needle"),
  );
});

it("creates keys without array methods unavailable in Hermes", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
  Reflect.deleteProperty(Array.prototype, "toSorted");

  try {
    expect(makeThreadSearchKey([envB, envA], "needle")).toBe('[["env-a","env-b"],"needle"]');
  } finally {
    if (descriptor !== undefined) {
      Reflect.defineProperty(Array.prototype, "toSorted", descriptor);
    }
  }
});

it("encodes scoped thread keys without delimiter collisions", () => {
  const first = threadSearchMatchKey({
    environmentId: EnvironmentId.make("env\u0000thread"),
    threadId: ThreadId.make("id"),
  });
  const second = threadSearchMatchKey({
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread\u0000id"),
  });

  expect(first).not.toBe(second);
});

it("accepts search keys at the maximum decoded query length", () => {
  const queries: string[] = [];
  const searchAtom = createThreadSearchResultsAtomFamily<Error>({
    getSearchAtom: (_environmentId, query) => {
      queries.push(query);
      return Atom.make(AsyncResult.success({ matches: [] }));
    },
    labelPrefix: "test:thread-search",
  });
  const registry = AtomRegistry.make();
  const query = "a".repeat(200);

  try {
    registry.get(searchAtom(makeThreadSearchKey([envA], query)));
    registry.get(searchAtom(makeThreadSearchKey([envA], ` ${query} `)));

    expect(queries).toEqual([query, query]);
  } finally {
    registry.dispose();
  }
});

it("ignores invalid search keys", () => {
  let searchCount = 0;
  const searchAtom = createThreadSearchResultsAtomFamily<Error>({
    getSearchAtom: () => {
      searchCount += 1;
      return Atom.make(AsyncResult.success({ matches: [] }));
    },
    labelPrefix: "test:thread-search",
  });
  const registry = AtomRegistry.make();

  try {
    const state = registry.get(searchAtom(makeThreadSearchKey([envA], "a".repeat(201))));
    const malformedState = registry.get(searchAtom("not json{{"));

    expect(state).toEqual({ matches: [], isLoading: false, failedEnvironmentIds: [] });
    expect(malformedState).toEqual({ matches: [], isLoading: false, failedEnvironmentIds: [] });
    expect(searchCount).toBe(0);
  } finally {
    registry.dispose();
  }
});

it("preserves successful matches and identifies computers whose search failed", () => {
  const result: OrchestrationSearchThreadsResult = {
    matches: [
      {
        threadId: ThreadId.make("thread-a"),
        projectId: ProjectId.make("project-a"),
        source: "user",
        snippet: "needle",
        messageCreatedAt: "2026-07-30T00:00:00.000Z",
      },
    ],
  };
  const searchAtom = createThreadSearchResultsAtomFamily<Error>({
    getSearchAtom: (environmentId) =>
      environmentId === envA
        ? Atom.make(AsyncResult.success(result))
        : Atom.make(
            AsyncResult.failure<OrchestrationSearchThreadsResult, Error>(
              Cause.fail(new Error("unsupported rpc")),
            ),
          ),
    labelPrefix: "test:thread-search",
  });
  const registry = AtomRegistry.make();

  const state = registry.get(searchAtom(makeThreadSearchKey([envB, envA], "needle")));
  expect(state).toEqual({
    matches: [{ ...result.matches[0], environmentId: envA }],
    isLoading: false,
    failedEnvironmentIds: [envB],
  });
  expect(threadSearchMatchKey(state.matches[0]!)).toBe('["env-a","thread-a"]');

  registry.dispose();
});

it("distinguishes a failed search from no matches and clears the failure after recovery", () => {
  const failed = Atom.make<AsyncResult.AsyncResult<OrchestrationSearchThreadsResult, Error>>(
    AsyncResult.failure<OrchestrationSearchThreadsResult, Error>(
      Cause.fail(new Error("connection lost")),
    ),
  );
  const search = createThreadSearchResultsAtomFamily({
    getSearchAtom: () => failed,
    labelPrefix: "recovery",
  });
  const registry = AtomRegistry.make();
  const atom = search(makeThreadSearchKey([envA], "needle"));
  const release = registry.mount(atom);
  try {
    expect(registry.get(atom)).toEqual({
      matches: [],
      isLoading: false,
      failedEnvironmentIds: [envA],
    });
    registry.set(failed, AsyncResult.success({ matches: [] }));
    expect(registry.get(atom)).toEqual({ matches: [], isLoading: false, failedEnvironmentIds: [] });
  } finally {
    release();
    registry.dispose();
  }
});
