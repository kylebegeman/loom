import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createProjectStorageRolloutController,
  projectStorageRolloutChoices,
  projectStorageRolloutComputerLabels,
  projectStorageRolloutKey,
  type ProjectStorageRolloutOperations,
  type ProjectStorageRolloutTarget,
} from "./project-storage-rollout.ts";

const target = (
  id = "project",
  overrides: Partial<ProjectStorageRolloutTarget> = {},
): ProjectStorageRolloutTarget => ({
  environmentId: EnvironmentId.make("mac"),
  projectId: ProjectId.make(id),
  workspaceRoot: `/known/${id}`,
  projectName: id,
  environmentLabel: "Mac",
  connected: true,
  supported: true,
  canRead: true,
  canAdopt: true,
  canSetRetention: true,
  ...overrides,
});
const preview = (
  folder: ProjectStorageRolloutTarget,
  overrides: Partial<ProjectCheckoutPreview> = {},
): ProjectCheckoutPreview => ({
  projectId: folder.projectId,
  workspaceRoot: folder.workspaceRoot,
  state: "external",
  ownershipSource: null,
  retention: "inherit",
  head: "a".repeat(40),
  branch: "main",
  repositoryIdentity: null,
  localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
  blockers: [],
  reviewToken: "b".repeat(64),
  ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(overrides: Partial<ProjectStorageRolloutOperations> = {}) {
  const operations = {
    preview: vi.fn(async (folder: ProjectStorageRolloutTarget) => preview(folder)),
    adopt: vi.fn(
      async (
        folder: ProjectStorageRolloutTarget,
        input: Parameters<ProjectStorageRolloutOperations["adopt"]>[1],
      ) =>
        preview(folder, {
          state: "managed",
          ownershipSource: "adopted",
          retention: input.retention,
        }),
    ),
    setRetention: vi.fn(
      async (
        folder: ProjectStorageRolloutTarget,
        input: Parameters<ProjectStorageRolloutOperations["setRetention"]>[1],
      ) =>
        preview(folder, { state: "managed", ownershipSource: "clone", retention: input.retention }),
    ),
    ...overrides,
  };
  const controller = createProjectStorageRolloutController(operations);
  const select = (folders: readonly ProjectStorageRolloutTarget[]) => {
    controller.syncTargets(folders);
    for (const folder of folders) controller.setSelected(projectStorageRolloutKey(folder), true);
  };
  return { controller, operations, select, rows: () => controller.getSnapshot().rows };
}

describe("reviewed project storage rollout", () => {
  it("reads only explicit selections without scanning or saving on queue creation", async () => {
    const { controller, operations, rows } = harness();
    const a = target("a"),
      b = target("b");
    controller.syncTargets([a, b]);
    expect(operations.preview).not.toHaveBeenCalled();
    controller.setSelected(projectStorageRolloutKey(b), true);
    await controller.review();
    expect(operations.preview).toHaveBeenCalledExactlyOnceWith(b);
    expect(rows().map((row) => row.choice)).toEqual([null, null]);
    expect(controller.confirm()).toBeNull();
    expect(operations.adopt).not.toHaveBeenCalled();
  });

  it("bounds reviews to one in flight and prevents overlapping review/save", async () => {
    const first = deferred<ProjectCheckoutPreview>();
    const started = deferred<void>();
    const a = target("a"),
      b = target("b");
    const read = vi.fn(async (folder: ProjectStorageRolloutTarget) => {
      if (folder.projectId === a.projectId) {
        started.resolve();
        return first.promise;
      }
      return preview(folder);
    });
    const { controller, select } = harness({ preview: read });
    select([a, b]);
    const pending = controller.review();
    await started.promise;
    await controller.review();
    expect(read).toHaveBeenCalledTimes(1);
    expect(controller.confirm()).toBeNull();
    first.resolve(preview(a));
    await pending;
    expect(read.mock.calls.map(([folder]) => folder.projectId)).toEqual([a.projectId, b.projectId]);
  });

  it.each(["projectId", "workspaceRoot"] as const)(
    "rejects preview response with different %s",
    async (field) => {
      const folder = target();
      const different =
        field === "projectId"
          ? { projectId: ProjectId.make("other") }
          : { workspaceRoot: "/other" };
      const { controller, select, rows } = harness({
        preview: async () => preview(folder, different),
      });
      select([folder]);
      await controller.review();
      expect(rows()[0]).toMatchObject({ status: "error", preview: null, choice: null });
      controller.choose(projectStorageRolloutKey(folder), "keep");
      expect(controller.confirm()).toBeNull();
    },
  );

  it("permits read-only review, but no decision or save", async () => {
    const folder = target("read-only", { canAdopt: false, canSetRetention: false });
    const { controller, select, rows, operations } = harness();
    select([folder]);
    await controller.review();
    expect(rows()[0]!.status).toBe("reviewed");
    expect(projectStorageRolloutChoices(rows()[0]!)).toEqual([]);
    controller.choose(projectStorageRolloutKey(folder), "keep");
    expect(rows()[0]!.choice).toBeNull();
    expect(controller.confirm()).toBeNull();
    expect(operations.adopt).not.toHaveBeenCalled();
  });

  it("rejects unavailable reviews without issuing a request", async () => {
    const { controller, select, operations, rows } = harness();
    select([
      target("offline", { connected: false }),
      target("old", { supported: false }),
      target("denied", { canRead: false }),
    ]);
    await controller.review();
    expect(operations.preview).not.toHaveBeenCalled();
    expect(rows().map((row) => row.status)).toEqual(["error", "error", "error"]);
  });

  it("offers inherit only for managed/released folders and retains local-file notices", async () => {
    const external = target("external"),
      managed = target("managed"),
      released = target("released");
    const { controller, select, rows, operations } = harness({
      preview: async (folder) =>
        preview(
          folder,
          folder.projectId === external.projectId
            ? { blockers: ["Local changes are preserved."] }
            : {
                state: folder.projectId === released.projectId ? "released" : "managed",
                ownershipSource: "adopted",
              },
        ),
    });
    select([external, managed, released]);
    await controller.review();
    expect(projectStorageRolloutChoices(rows()[0]!)).toEqual(["keep", "release-on-settle"]);
    expect(projectStorageRolloutChoices(rows()[1]!)).toContain("inherit");
    expect(projectStorageRolloutChoices(rows()[2]!)).toContain("keep");
    controller.choose(projectStorageRolloutKey(external), "inherit");
    expect(rows()[0]!.choice).toBeNull();
    controller.choose(projectStorageRolloutKey(external), "release-on-settle");
    controller.choose(projectStorageRolloutKey(managed), "inherit");
    controller.choose(projectStorageRolloutKey(released), "keep");
    const plan = controller.confirm()!;
    expect(plan.entries.map((entry) => entry.operation)).toEqual([
      "adopt",
      "setRetention",
      "setRetention",
    ]);
    await controller.save(plan);
    expect(operations.adopt).toHaveBeenCalledExactlyOnceWith(external, {
      projectId: external.projectId,
      reviewToken: "b".repeat(64),
      retention: "release-on-settle",
    });
    expect(operations.setRetention).toHaveBeenCalledTimes(2);
  });

  it("blocked reviews with a token still cannot be chosen", async () => {
    const folder = target();
    const { controller, select, rows } = harness({
      preview: async () => preview(folder, { state: "blocked" }),
    });
    select([folder]);
    await controller.review();
    expect(projectStorageRolloutChoices(rows()[0]!)).toEqual([]);
  });

  it("requires exact current confirmation and invalidates it when a choice changes", async () => {
    const folder = target();
    const { controller, select, operations } = harness();
    select([folder]);
    await controller.review();
    controller.choose(projectStorageRolloutKey(folder), "keep");
    const plan = controller.confirm()!;
    controller.choose(projectStorageRolloutKey(folder), "release-on-settle");
    await controller.save(plan);
    expect(operations.adopt).not.toHaveBeenCalled();
    const current = controller.confirm()!;
    await controller.save({ entries: current.entries });
    expect(operations.adopt).not.toHaveBeenCalled();
    await controller.save(current);
    expect(operations.adopt).toHaveBeenCalledTimes(1);
  });

  it.each(["connected", "supported", "canRead", "canAdopt", "canSetRetention"] as const)(
    "invalidates review and decisions after transient %s loss/restore",
    async (field) => {
      const folder = target();
      const { controller, select, rows, operations } = harness();
      select([folder]);
      await controller.review();
      controller.choose(projectStorageRolloutKey(folder), "keep");
      const plan = controller.confirm()!;
      controller.syncTargets([{ ...folder, [field]: false }]);
      controller.syncTargets([folder]);
      expect(rows()[0]).toMatchObject({
        status: "idle",
        preview: null,
        choice: null,
        selected: true,
      });
      await controller.save(plan);
      expect(operations.adopt).not.toHaveBeenCalled();
    },
  );

  it("invalidates review when connection/capability/permission context changes despite effective access remaining true", async () => {
    const folder = target("project", { reviewContext: "connection-1/capabilities-1/grants-1" });
    const { controller, select, rows, operations } = harness();
    select([folder]);
    await controller.review();
    controller.choose(projectStorageRolloutKey(folder), "keep");
    const plan = controller.confirm()!;
    controller.syncTargets([{ ...folder, reviewContext: "connection-2/capabilities-2/grants-2" }]);
    expect(rows()[0]).toMatchObject({ status: "idle", preview: null, choice: null });
    await controller.save(plan);
    expect(operations.adopt).not.toHaveBeenCalled();
  });

  it("preserves review through display-name changes but invalidates folder replacement", async () => {
    const folder = target();
    const { controller, select, rows } = harness();
    select([folder]);
    await controller.review();
    controller.choose(projectStorageRolloutKey(folder), "keep");
    const plan = controller.confirm()!;
    controller.syncTargets([{ ...folder, projectName: "Renamed", environmentLabel: "Dorothy" }]);
    expect(controller.getSnapshot().confirmation).toBe(plan);
    expect(rows()[0]!.choice).toBe("keep");
    controller.syncTargets([{ ...folder, workspaceRoot: "/replacement" }]);
    expect(controller.getSnapshot().confirmation).toBeNull();
    expect(rows()[0]).toMatchObject({ selected: false, preview: null, choice: null });
  });

  it("ignores a preview completion after access loss even after reconnect", async () => {
    const folder = target();
    const read = deferred<ProjectCheckoutPreview>(),
      started = deferred<void>();
    const { controller, select, rows } = harness({
      preview: async () => {
        started.resolve();
        return read.promise;
      },
    });
    select([folder]);
    const pending = controller.review();
    await started.promise;
    controller.syncTargets([{ ...folder, connected: false }]);
    controller.syncTargets([folder]);
    read.resolve(preview(folder));
    await pending;
    expect(rows()[0]).toMatchObject({ status: "idle", preview: null, choice: null });
  });

  it("retains partial successes and requires explicit re-review before retrying only unfinished entries", async () => {
    const a = target("a"),
      b = target("b"),
      c = target("c");
    let fail = true;
    const adopt = vi.fn(async (folder: ProjectStorageRolloutTarget) => {
      if (folder.projectId === b.projectId && fail)
        throw new Error("The project changed since your review.");
      return preview(folder, { state: "managed", ownershipSource: "adopted", retention: "keep" });
    });
    const { controller, select, rows, operations } = harness({ adopt });
    select([a, b, c]);
    await controller.review();
    for (const folder of [a, b, c]) controller.choose(projectStorageRolloutKey(folder), "keep");
    await controller.save(controller.confirm()!);
    expect(rows().map((row) => row.status)).toEqual(["saved", "error", "saved"]);
    expect(rows()[1]).toMatchObject({ preview: null, choice: null });
    controller.choose(projectStorageRolloutKey(b), "keep");
    expect(controller.confirm()).toBeNull();
    fail = false;
    await controller.review();
    expect(operations.preview).toHaveBeenCalledTimes(4);
    controller.choose(projectStorageRolloutKey(b), "keep");
    expect(controller.confirm()!.entries.map((entry) => entry.key)).toEqual([
      projectStorageRolloutKey(b),
    ]);
    await controller.save(controller.getSnapshot().confirmation!);
    expect(adopt.mock.calls.map(([folder]) => folder.projectId)).toEqual([
      a.projectId,
      b.projectId,
      c.projectId,
      b.projectId,
    ]);
    expect(rows().every((row) => row.status === "saved")).toBe(true);
    controller.syncTargets([]);
    expect(rows()).toHaveLength(3);
  });

  it("cancels future reviews and discards pending read results without allowing overlap", async () => {
    const a = target("a"),
      b = target("b"),
      read = deferred<ProjectCheckoutPreview>(),
      started = deferred<void>();
    const readFn = vi.fn(async () => {
      started.resolve();
      return read.promise;
    });
    const { controller, select, rows } = harness({ preview: readFn });
    select([a, b]);
    const pending = controller.review();
    await started.promise;
    controller.cancel();
    await controller.review();
    expect(readFn).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().phase).toBe("reviewing");
    read.resolve(preview(a));
    await pending;
    expect(rows().map((row) => row.status)).toEqual(["idle", "idle"]);
  });

  it("cancels unissued saves while reporting an in-flight success truthfully", async () => {
    const a = target("a"),
      b = target("b"),
      mutation = deferred<ProjectCheckoutPreview>(),
      started = deferred<void>();
    const saveFn = vi.fn(async () => {
      started.resolve();
      return mutation.promise;
    });
    const { controller, select, rows } = harness({ adopt: saveFn });
    select([a, b]);
    await controller.review();
    for (const folder of [a, b]) controller.choose(projectStorageRolloutKey(folder), "keep");
    const plan = controller.confirm()!;
    const pending = controller.save(plan);
    await started.promise;
    controller.cancel();
    expect(controller.getSnapshot().phase).toBe("saving");
    await controller.save(plan);
    mutation.resolve(
      preview(a, { state: "managed", ownershipSource: "adopted", retention: "keep" }),
    );
    await pending;
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(rows().map((row) => row.status)).toEqual(["saved", "reviewed"]);
    expect(controller.getSnapshot().phase).toBe("results");
  });

  it("stops unissued saves after access changes and retains a completed replaced-folder result", async () => {
    const a = target("a"),
      b = target("b"),
      mutation = deferred<ProjectCheckoutPreview>(),
      started = deferred<void>();
    const saveFn = vi.fn(async () => {
      started.resolve();
      return mutation.promise;
    });
    const { controller, select, rows } = harness({ adopt: saveFn });
    select([a, b]);
    await controller.review();
    for (const folder of [a, b]) controller.choose(projectStorageRolloutKey(folder), "keep");
    const pending = controller.save(controller.confirm()!);
    await started.promise;
    controller.syncTargets([{ ...a, connected: false }, b]);
    controller.syncTargets([{ ...a, workspaceRoot: "/new-a" }, b]);
    mutation.resolve(
      preview(a, { state: "managed", ownershipSource: "adopted", retention: "keep" }),
    );
    await pending;
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(rows().find((row) => row.key === projectStorageRolloutKey(a))!.status).toBe("saved");
    expect(rows().find((row) => row.target.workspaceRoot === "/new-a")!.selected).toBe(false);
  });

  it("disposes without issuing future requests or notifying detached subscribers", async () => {
    const a = target("a"),
      b = target("b"),
      mutation = deferred<ProjectCheckoutPreview>(),
      started = deferred<void>();
    const saveFn = vi.fn(async () => {
      started.resolve();
      return mutation.promise;
    });
    const { controller, select } = harness({ adopt: saveFn });
    select([a, b]);
    await controller.review();
    for (const folder of [a, b]) controller.choose(projectStorageRolloutKey(folder), "keep");
    const pending = controller.save(controller.confirm()!);
    await started.promise;
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.dispose();
    mutation.resolve(preview(a));
    await pending;
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    await controller.review();
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it("publishes stable immutable snapshots and preserves prior snapshots through updates", async () => {
    const { controller, select, rows } = harness();
    const folder = target();
    const before = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(before);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    select([folder]);
    await controller.review();
    const reviewed = controller.getSnapshot();
    controller.choose(projectStorageRolloutKey(folder), "keep");
    expect(reviewed.rows[0]!.choice).toBeNull();
    expect(rows()[0]!.choice).toBe("keep");
    expect(Object.isFrozen(reviewed.rows[0]!.preview!.localFiles)).toBe(true);
    expect(Object.isFrozen(controller.confirm()!.entries[0]!.input)).toBe(true);
    const calls = listener.mock.calls.length;
    unsubscribe();
    controller.cancelConfirmation();
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});

describe("reviewed storage computer labels", () => {
  it("keeps unique computer names unchanged and preserves the source label map", () => {
    const mac = EnvironmentId.make("abcdefgh-mac"),
      pi = EnvironmentId.make("abcdefgh-pi");
    const labels = new Map([
      [mac, "Dorothy"],
      [pi, "Pi"],
    ]);
    expect(projectStorageRolloutComputerLabels(labels)).toEqual(labels);
    expect([...labels.values()]).toEqual(["Dorothy", "Pi"]);
  });

  it("qualifies duplicate names with the shortest distinct environment prefix of at least eight characters", () => {
    const a = EnvironmentId.make("abcdefgh1-host-a"),
      b = EnvironmentId.make("abcdefgh2-host-b"),
      c = EnvironmentId.make("ijklmnop3-host-c"),
      unique = EnvironmentId.make("standalone");
    const qualified = projectStorageRolloutComputerLabels(
      new Map([
        [a, "Computer"],
        [b, "Computer"],
        [c, "Computer"],
        [unique, "Pi"],
      ]),
    );
    expect([...qualified.values()]).toEqual([
      "Computer (abcdefgh1)",
      "Computer (abcdefgh2)",
      "Computer (ijklmnop)",
      "Pi",
    ]);
    expect([...qualified.keys()]).toEqual([a, b, c, unique]);
    expect(new Set(qualified.values()).size).toBe(4);
  });
});
