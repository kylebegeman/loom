import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import {
  CheckpointId,
  CheckpointScopeId,
  CheckpointRef,
  ThreadId,
  RunId,
  NodeId,
  type OrchestrationV2Checkpoint,
} from "@t3tools/contracts";
import { contentKey, historyCandidates, isLfsPointer, parseLsTree } from "./helpers.ts";
const threadId = ThreadId.make("thread");
const scopeId = CheckpointScopeId.make("root");
const scope = { id: scopeId, threadId, kind: "root_run" as const };
const cp = (
  turn: number,
  paths: ReadonlyArray<string> = [],
  captured = turn,
): OrchestrationV2Checkpoint => ({
  id: CheckpointId.make(`checkpoint-${turn}-${captured}`),
  threadId,
  scopeId,
  runId: turn === 0 ? null : RunId.make(`run-${turn}`),
  nodeId: NodeId.make("node"),
  parentCheckpointId: null,
  ordinalWithinScope: turn,
  appRunOrdinal: turn || null,
  ref: CheckpointRef.make(`refs/checkpoint/${turn}`),
  status: "ready",
  files: paths.map((path) => ({ path, kind: "modified", additions: 1, deletions: 0 })),
  capturedAt: DateTime.makeUnsafe(captured * 1000),
});
describe("history candidates", () => {
  it("keeps only touching root turns, the ordinal-zero start, and the newest reused turn", () => {
    const records = [
      cp(0),
      cp(1, ["part.scad"], 1),
      cp(1, ["part.scad"], 2),
      cp(2, ["other.ts"]),
      { ...cp(3, ["part.scad"]), scopeId: CheckpointScopeId.make("child") },
      { ...cp(4, ["part.scad"]), status: "stale" as const },
      { ...cp(0), ordinalWithinScope: 9 },
    ];
    const result = historyCandidates(
      records,
      [scope, { id: CheckpointScopeId.make("child"), threadId, kind: "subagent" }],
      new Set(["part.scad"]),
      null,
      30,
    );
    expect(result.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([
      cp(1, [], 2).id,
      cp(0).id,
    ]);
    expect(result.latestTurn).toBe(2);
  });
  it("paginates without exceeding the wire page size when Start needs another page", () => {
    const records = [cp(0), cp(1, ["part.stl"]), cp(3, ["part.stl"])];
    const first = historyCandidates(records, [scope], new Set(["part.stl"]), null, 2);
    expect(first.checkpoints.map((entry) => entry.appRunOrdinal)).toEqual([3, 1]);
    expect(first.nextCursor).toBe(1);
    const last = historyCandidates(records, [scope], new Set(["part.stl"]), 1, 2);
    expect(last.checkpoints.map((entry) => entry.appRunOrdinal)).toEqual([null]);
    expect(last.nextCursor).toBeNull();
  });
  it("ignores a scope belonging to another thread", () =>
    expect(
      historyCandidates(
        [cp(1, ["part.scad"])],
        [{ ...scope, threadId: ThreadId.make("another") }],
        new Set(["part.scad"]),
        null,
        30,
      ).checkpoints,
    ).toEqual([]));
});
it("parses NUL ls-tree records containing spaces and tabs, dropping symlinks, submodules and unsafe paths", () => {
  const oid = "a".repeat(40);
  const output =
    [
      `100644 blob ${oid}    12\tmodels/a b\tc.stl`,
      `120000 blob ${oid} 5\tlink`,
      `160000 commit ${oid} -\tsubmodule`,
      `100755 blob ${oid} 4\t../bad.stl`,
    ].join("\0") + "\0";
  expect(parseLsTree(output)).toEqual([
    { mode: "100644", oid, size: 12, path: "models/a b\tc.stl" },
  ]);
});
it("content keys are stable across ordering and change for a dependency blob", () => {
  const entries = [
    { path: "part.scad", oid: "a" },
    { path: "shape.scad", oid: "b" },
  ];
  expect(contentKey(entries)).toBe(contentKey(entries.toReversed()));
  expect(contentKey(entries)).not.toBe(
    contentKey([{ ...entries[0]! }, { ...entries[1]!, oid: "c" }]),
  );
});
it("detects bounded Git LFS pointers without classifying an arbitrary large source", () => {
  const pointer = new TextEncoder().encode(
    "version https://git-lfs.github.com/spec/v1\noid sha256:abc\n",
  );
  expect(isLfsPointer(pointer)).toBe(true);
  expect(isLfsPointer(new Uint8Array(1024))).toBe(false);
});
