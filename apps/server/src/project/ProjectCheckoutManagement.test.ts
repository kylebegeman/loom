import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { ProjectCheckoutManagementError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServerConfig from "../config.ts";
import * as StorageCleanup from "../storageCleanup.ts";
import { runCheckoutProcess } from "../workspace/checkoutProcess.ts";
import {
  archiveManagedProjectCheckout,
  readManagedProjectCheckout,
  releaseManagedProjectCheckout,
  resolveManagedProjectRetention,
} from "../workspace/ManagedProjectCheckout.ts";
import * as ProjectCheckoutManagement from "./ProjectCheckoutManagement.ts";
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const projectId = ProjectId.make("existing-project");
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const parent = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
  const cwd = `${parent}/project`;
  yield* fs.makeDirectory(cwd);
  const command = (args: string[]) =>
    runCheckoutProcess({ command: "git", args: ["-C", cwd, ...args] }).pipe(
      Effect.tap((result) => Effect.sync(() => expect(result.code).toBe(0))),
    );
  yield* command(["init", "-b", "main"]);
  yield* command(["config", "user.name", "Adoption test"]);
  yield* command(["config", "user.email", "adoption@example.test"]);
  yield* fs.writeFileString(`${cwd}/proof.txt`, "initial content\n");
  yield* command(["add", "."]);
  yield* command(["commit", "-m", "initial"]);
  yield* command(["remote", "add", "origin", "https://github.com/example/my-fork.git"]);
  yield* command(["remote", "add", "upstream", "https://github.com/upstream/original.git"]);
  const row: ProjectStore.ProjectRow = {
    projectId,
    title: "Existing project",
    workspaceRoot: cwd,
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    faviconPath: null,
    projectIcon: null,
    scripts: [],
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    deletedAt: null,
  };
  let current = row;
  let sweeps = 0;
  const configuration = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(parent, `${parent}/environment`)),
  );
  const realRunner = yield* ProcessRunner.ProcessRunner.pipe(Effect.provide(ProcessRunner.layer));
  let intercept:
    | ((
        input: ProcessRunner.ProcessRunInput,
        output: ProcessRunner.ProcessRunOutput,
      ) => ProcessRunner.ProcessRunOutput)
    | undefined;
  const runner: ProcessRunner.ProcessRunner["Service"] = {
    run: (input) =>
      realRunner.run(input).pipe(Effect.map((output) => intercept?.(input, output) ?? output)),
  };
  const service = yield* ProjectCheckoutManagement.ProjectCheckoutManagement.pipe(
    Effect.provide(
      ProjectCheckoutManagement.layer.pipe(
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: (id) =>
              Effect.succeed(id === current.projectId ? Option.some(current) : Option.none()),
          }),
        ),
        Layer.provide(
          Layer.mock(StorageCleanup.StorageCleanup)({
            requestSweep: Effect.sync(() => {
              sweeps++;
            }),
          }),
        ),
        Layer.provide(Layer.succeed(ServerConfig.ServerConfig, configuration)),
        Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
      ),
    ),
  );
  const preview = () => service.preview({ projectId: current.projectId });
  const adopt = (retention: "keep" | "release-on-settle" = "keep") =>
    Effect.gen(function* () {
      const review = yield* preview();
      expect(review.reviewToken).not.toBeNull();
      return yield* service.adopt({
        projectId: current.projectId,
        reviewToken: review.reviewToken!,
        retention,
      });
    });
  return {
    fs,
    parent,
    cwd,
    command,
    service,
    preview,
    adopt,
    libraryStore: yield* LibraryWorkspaceStore.LibraryWorkspaceStore.pipe(
      Effect.provide(LibraryWorkspaceStore.layer),
      Effect.provideService(ServerConfig.ServerConfig, configuration),
    ),
    sweepCount: () => sweeps,
    setEnvironmentPaths: (input: Partial<ServerConfig.ServerConfig["Service"]>) => {
      Object.assign(configuration, input);
    },
    interceptGit: (hook: typeof intercept) => {
      intercept = hook;
    },
    replaceProject: (input: Partial<ProjectStore.ProjectRow>) => {
      current = { ...current, ...input };
    },
  };
});
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(NodeServices.layer), Effect.scoped);

const libraryReceipt = (rootPath: string): LibraryWorkspaceStore.WorkspaceReceipt => ({
  requestId: "library-copy",
  fingerprint: "copy",
  project: {
    id: "library-project",
    revision: 1,
    title: "Library project",
    brief: "",
    resources: [],
    archived: false,
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
  },
  copy: {
    id: "library-copy",
    projectId: "library-project",
    projectRevision: 1,
    environmentId: EnvironmentId.make("library-computer"),
    rootPath,
    repositories: [],
    ownership: "managed",
    state: "ready",
    keepOnComputer: true,
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
  },
  rootLocalProjectId: projectId,
  rootCheckpointRepository: false,
  legacyThreadIds: [],
  rootIdentity: null,
  releaseRequestId: null,
  releaseReviewToken: null,
  removalPath: null,
  archivePath: null,
  archiveDigest: null,
});

describe("reviewed project checkout management", () => {
  it.live.each([
    "root",
    "component",
    "alias",
    "ancestor",
    "released",
    "detached-component",
  ] as const)("blocks native adoption of a Library-managed %s", (location) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const review = yield* f.preview();
        let receipt = libraryReceipt(location === "component" ? f.parent : f.cwd);
        if (location === "alias") {
          const alias = `${f.parent}/alias`;
          yield* f.fs.symlink(f.cwd, alias);
          receipt = libraryReceipt(alias);
        }
        if (location === "ancestor") receipt = libraryReceipt(`${f.cwd}/nested-copy`);
        if (location === "detached-component") {
          receipt = {
            ...libraryReceipt(`${f.parent}/other-root`),
            copy: {
              ...libraryReceipt(`${f.parent}/other-root`).copy,
              repositories: [
                {
                  resourceId: "repo",
                  path: f.cwd,
                  localProjectId: projectId,
                  head: null,
                  branch: null,
                },
              ],
            },
          };
        }
        if (location === "released") {
          receipt = { ...receipt, copy: { ...receipt.copy, state: "released" } };
        }
        yield* f.libraryStore.put(receipt);
        const blocked = yield* f.preview();
        expect(blocked.state).toBe("blocked");
        expect(blocked.blockers).toContain(
          "The Library manages these files. Use the Library to change their storage policy.",
        );
        const result = yield* f.service
          .adopt({ projectId, reviewToken: review.reviewToken!, retention: "release-on-settle" })
          .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(yield* readManagedProjectCheckout(f.cwd)).toBeNull();
      }),
    ),
  );
  it.live("blocks a conflicting native receipt after Library management takes ownership", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const review = yield* f.adopt("release-on-settle");
        yield* f.libraryStore.put(libraryReceipt(f.cwd));
        expect((yield* f.preview()).state).toBe("blocked");
        expect(
          (yield* f.service
            .setRetention({ projectId, reviewToken: review.reviewToken!, retention: "keep" })
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect((yield* readManagedProjectCheckout(f.cwd))?.retention).toBe("release-on-settle");
      }),
    ),
  );
  it.live("rechecks Library ownership after live authorization", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const review = yield* f.preview();
        const result = yield* f.service
          .adopt(
            { projectId, reviewToken: review.reviewToken!, retention: "release-on-settle" },
            f.libraryStore.put(libraryReceipt(f.cwd)).pipe(Effect.orDie),
          )
          .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(yield* readManagedProjectCheckout(f.cwd)).toBeNull();
      }),
    ),
  );
  it.live("retains reviewed native adoption for a borrowed Library folder", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const receipt = libraryReceipt(f.cwd);
        yield* f.libraryStore.put({ ...receipt, copy: { ...receipt.copy, ownership: "borrowed" } });
        expect((yield* f.adopt("release-on-settle")).ownershipSource).toBe("adopted");
      }),
    ),
  );

  it.live(
    "reads the physical origin instead of cached upstream identity without adopting or restoring",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          const review = yield* f.preview();
          expect(review.state).toBe("external");
          expect(review.repositoryIdentity?.canonicalKey).toBe("github.com/example/my-fork");
          expect(review.repositoryIdentity?.locator.remoteName).toBe("origin");
          expect(review.branch).toBe("main");
          expect(review.reviewToken).toMatch(/^[a-f0-9]{64}$/);
          expect(yield* readManagedProjectCheckout(f.cwd)).toBeNull();
          expect(f.sweepCount()).toBe(0);
        }),
      ),
  );
  it.live(
    "adopts a dirty primary checkout without changing its files, index, branch, or HEAD",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.fs.writeFileString(`${f.cwd}/proof.txt`, "uncommitted content\n");
          yield* f.fs.writeFileString(`${f.cwd}/private-note.txt`, "keep this note\n");
          const head = (yield* f.command(["rev-parse", "HEAD"])).stdout;
          const index = yield* f.fs.readFile(`${f.cwd}/.git/index`);
          const review = yield* f.preview();
          expect(review.localFiles.trackedChanges).toBe(1);
          expect(review.localFiles.untrackedFiles).toBe(1);
          expect(review.state).toBe("external");
          const result = yield* f.adopt("release-on-settle");
          expect(result.state).toBe("managed");
          expect(result.retention).toBe("release-on-settle");
          expect(result.ownershipSource).toBe("adopted");
          expect((yield* readManagedProjectCheckout(f.cwd))?.projectId).toBe(projectId);
          expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("uncommitted content\n");
          expect(yield* f.fs.readFileString(`${f.cwd}/private-note.txt`)).toBe("keep this note\n");
          expect(yield* f.fs.readFile(`${f.cwd}/.git/index`)).toEqual(index);
          expect((yield* f.command(["rev-parse", "HEAD"])).stdout).toBe(head);
          expect(f.sweepCount()).toBe(1);
        }),
      ),
  );
  it.live.each(["status", "head", "path"] as const)(
    "requires another review after %s changes",
    (change) =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          const review = yield* f.preview();
          if (change === "status") yield* f.fs.writeFileString(`${f.cwd}/new-note.txt`, "new");
          if (change === "head") {
            yield* f.fs.writeFileString(`${f.cwd}/proof.txt`, "next");
            yield* f.command(["commit", "-am", "next"]);
          }
          if (change === "path") {
            const moved = `${f.parent}/moved`;
            yield* f.fs.rename(f.cwd, moved);
            f.replaceProject({ workspaceRoot: moved });
          }
          const result = yield* f.service
            .adopt({ projectId, reviewToken: review.reviewToken!, retention: "keep" })
            .pipe(Effect.result);
          expect(result._tag).toBe("Failure");
          if (result._tag === "Failure") expect(result.failure.reason).toBe("stale-review");
          expect(
            yield* readManagedProjectCheckout(change === "path" ? `${f.parent}/moved` : f.cwd),
          ).toBeNull();
          expect(f.sweepCount()).toBe(0);
        }),
      ),
  );
  it.live("serializes simultaneous adoption and rejects the stale second request", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const review = yield* f.preview();
        const request = { projectId, reviewToken: review.reviewToken!, retention: "keep" as const };
        const results = yield* Effect.all(
          [
            f.service.adopt(request).pipe(Effect.result),
            f.service.adopt(request).pipe(Effect.result),
          ],
          { concurrency: "unbounded" },
        );
        expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
        expect(results.filter((result) => result._tag === "Failure")).toHaveLength(1);
        expect(f.sweepCount()).toBe(1);
        expect((yield* f.preview()).ownershipSource).toBe("adopted");
      }),
    ),
  );
  it.live.each(["symlink", "nested", "git-link", "worktree", "environment"] as const)(
    "leaves unsafe %s folders external",
    (kind) =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          if (kind === "symlink") {
            yield* f.fs.symlink(f.cwd, `${f.parent}/link`);
            f.replaceProject({ workspaceRoot: `${f.parent}/link` });
          }
          if (kind === "nested") {
            yield* f.fs.makeDirectory(`${f.cwd}/nested`);
            f.replaceProject({ workspaceRoot: `${f.cwd}/nested` });
          }
          if (kind === "git-link") {
            yield* f.fs.rename(`${f.cwd}/.git`, `${f.parent}/external-git`);
            yield* f.fs.symlink(`${f.parent}/external-git`, `${f.cwd}/.git`);
          }
          if (kind === "worktree") {
            yield* f.command(["worktree", "add", "-b", "feature", `${f.parent}/linked`]);
            f.replaceProject({ workspaceRoot: `${f.parent}/linked` });
          }
          if (kind === "environment")
            f.replaceProject({ workspaceRoot: `${f.parent}/environment` });
          const preview = yield* f.preview();
          expect(preview.state).toBe("blocked");
          expect(preview.reviewToken).toBeNull();
          expect(preview.blockers.length).toBeGreaterThan(0);
          const denied = yield* f.service
            .adopt({ projectId, reviewToken: "0".repeat(64), retention: "keep" })
            .pipe(Effect.result);
          expect(denied._tag).toBe("Failure");
          expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("initial content\n");
          expect(f.sweepCount()).toBe(0);
        }),
      ),
  );
  it.live("keeps ownership policies reversible without dropping the adoption receipt", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        let review = yield* f.adopt();
        for (const retention of ["release-on-settle", "inherit", "keep"] as const) {
          review = yield* f.service.setRetention({
            projectId,
            reviewToken: review.reviewToken!,
            retention,
          });
          expect(review.retention).toBe(retention);
          expect(review.state).toBe("managed");
          expect(review.ownershipSource).toBe("adopted");
        }
        expect(f.sweepCount()).toBe(4);
      }),
    ),
  );
  it.live(
    "reads released receipts passively and restores them only when keep is explicitly saved",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.adopt("release-on-settle");
          const receipt = (yield* readManagedProjectCheckout(f.cwd))!;
          const recovery = yield* archiveManagedProjectCheckout(receipt, projectId);
          yield* releaseManagedProjectCheckout(receipt, projectId, recovery.archive);
          const released = yield* f.preview();
          expect(released.state).toBe("released");
          expect(released.retention).toBe("release-on-settle");
          expect(yield* f.fs.exists(f.cwd)).toBe(false);
          const retained = yield* f.service.setRetention({
            projectId,
            reviewToken: released.reviewToken!,
            retention: "keep",
          });
          expect(retained.state).toBe("managed");
          expect(retained.retention).toBe("keep");
          expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("initial content\n");
          expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(true);
          expect((yield* readManagedProjectCheckout(f.cwd))?.ownershipSource).toBe("adopted");
        }),
      ),
  );
  it.live("does not transfer an adopted receipt to a new project record reusing its path", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.adopt();
        f.replaceProject({ projectId: ProjectId.make("different-project") });
        const review = yield* f.preview();
        expect(review.state).toBe("blocked");
        expect(review.reviewToken).toBeNull();
        expect((yield* readManagedProjectCheckout(f.cwd))?.projectId).toBe(projectId);
      }),
    ),
  );
  it.live("refuses a managed folder replaced after a review", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const review = yield* f.adopt();
        yield* f.fs.rename(f.cwd, `${f.cwd}-original`);
        yield* f.fs.makeDirectory(`${f.cwd}/.git`, { recursive: true });
        yield* f.fs.writeFileString(`${f.cwd}/new-data`, "preserve");
        const result = yield* f.service
          .setRetention({
            projectId,
            reviewToken: review.reviewToken!,
            retention: "release-on-settle",
          })
          .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(yield* f.fs.readFileString(`${f.cwd}/new-data`)).toBe("preserve");
        expect((yield* readManagedProjectCheckout(f.cwd))?.retention).toBe("keep");
      }),
    ),
  );
  it.live("rechecks caller authorization after the review and before ownership persistence", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const review = yield* f.preview();
        const denied = new ProjectCheckoutManagementError({ projectId, reason: "blocked" });
        const result = yield* f.service
          .adopt({ projectId, reviewToken: review.reviewToken!, retention: "keep" }, denied)
          .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(yield* readManagedProjectCheckout(f.cwd)).toBeNull();
        expect(f.sweepCount()).toBe(0);
      }),
    ),
  );
  it.live("reads legacy clone receipts with inherited retention defaults", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.adopt();
        const receipt = (yield* readManagedProjectCheckout(f.cwd))!;
        const legacy = { ...receipt, version: 1, ownershipSource: undefined, retention: undefined };
        yield* f.fs.writeFileString(`${f.cwd}.t3-project-owned.json`, yield* encodeJson(legacy));
        const restored = (yield* readManagedProjectCheckout(f.cwd))!;
        expect(restored.ownershipSource).toBe("clone");
        expect(restored.retention).toBe("inherit");
      }),
    ),
  );
  it.live.each(["projects", "userdata"] as const)(
    "permits home projects while protecting %s",
    (folder) =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          const target = `${f.parent}/environment/${folder}/existing`;
          yield* f.fs.makeDirectory(target.replace(/\/[^/]+$/, ""), { recursive: true });
          yield* f.fs.rename(f.cwd, target);
          f.replaceProject({ workspaceRoot: target });
          const review = yield* f.preview();
          expect(review.state).toBe(folder === "projects" ? "external" : "blocked");
          if (folder === "projects") expect((yield* f.adopt()).state).toBe("managed");
          else expect(review.reviewToken).toBeNull();
        }),
      ),
  );
  it.live("protects the canonical data directory behind a symlinked environment home", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.fs.makeDirectory(`${f.parent}/actual-home/userdata`, { recursive: true });
        yield* f.fs.symlink(`${f.parent}/actual-home`, `${f.parent}/home-link`);
        const target = `${f.parent}/actual-home/userdata/repository`;
        yield* f.fs.rename(f.cwd, target);
        f.replaceProject({ workspaceRoot: target });
        f.setEnvironmentPaths({
          baseDir: `${f.parent}/home-link`,
          stateDir: `${f.parent}/home-link/userdata`,
        });
        expect((yield* f.preview()).state).toBe("blocked");
        expect(yield* f.fs.exists(`${target}.t3-project-owned.json`)).toBe(false);
      }),
    ),
  );
  it.live(
    "does not expose remote credentials or query tokens in previews or durable receipts",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.command([
            "remote",
            "set-url",
            "origin",
            "https://user:private-token@github.com/example/my-fork.git?access_token=secret#secret",
          ]);
          const preview = yield* f.preview();
          expect(preview.repositoryIdentity?.canonicalKey).toBe("github.com/example/my-fork");
          expect(preview.repositoryIdentity?.locator.remoteUrl).toBe(
            "https://github.com/example/my-fork.git",
          );
          yield* f.adopt();
          const receipt = yield* f.fs.readFileString(`${f.cwd}.t3-project-owned.json`);
          expect(receipt).not.toContain("private-token");
          expect(receipt).not.toContain("access_token");
          expect(receipt).not.toContain("secret");
        }),
      ),
  );
  it.live.each([
    "failed-status",
    "timed-out-status",
    "invalid-branch",
    "truncated-status",
  ] as const)("blocks a review with %s", (failure) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.interceptGit((input, output) => {
          if (failure === "invalid-branch" && input.args?.includes("symbolic-ref"))
            return { ...output, code: ChildProcessSpawner.ExitCode(0), stdout: "invalid branch\n" };
          if (!input.args?.includes("status")) return output;
          if (failure === "failed-status")
            return { ...output, code: ChildProcessSpawner.ExitCode(128) };
          if (failure === "timed-out-status") return { ...output, timedOut: true };
          if (failure === "truncated-status") return { ...output, stdoutTruncated: true };
          return output;
        });
        const preview = yield* f.preview();
        expect(preview.state).toBe("blocked");
        expect(preview.reviewToken).toBeNull();
        expect(yield* readManagedProjectCheckout(f.cwd)).toBeNull();
      }),
    ),
  );
  it.live("rechecks the registered root after filesystem review waits before adopting", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const review = yield* f.preview();
        f.interceptGit((input, output) => {
          if (input.args?.includes("ls-files"))
            f.replaceProject({ workspaceRoot: `${f.parent}/different-root` });
          return output;
        });
        const result = yield* f.service
          .adopt({ projectId, reviewToken: review.reviewToken!, retention: "keep" })
          .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(result.failure.reason).toBe("stale-review");
        expect(yield* readManagedProjectCheckout(f.cwd)).toBeNull();
        expect(f.sweepCount()).toBe(0);
      }),
    ),
  );
  it.live("retains a verified original folder after interrupted release before rename", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.adopt("release-on-settle");
        const receipt = (yield* readManagedProjectCheckout(f.cwd))!;
        const recovery = yield* archiveManagedProjectCheckout(receipt, projectId);
        const result = yield* releaseManagedProjectCheckout(
          receipt,
          projectId,
          recovery.archive,
        ).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...f.fs,
            rename: (from, to) =>
              from === f.cwd
                ? PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "rename",
                    pathOrDescriptor: from,
                  })
                : f.fs.rename(from, to),
          }),
          Effect.result,
        );
        expect(result._tag).toBe("Failure");
        const interrupted = yield* f.preview();
        expect(interrupted.state).toBe("released");
        expect(yield* f.fs.exists(f.cwd)).toBe(true);
        const retained = yield* f.service.setRetention({
          projectId,
          reviewToken: interrupted.reviewToken!,
          retention: "keep",
        });
        expect(retained.state).toBe("managed");
        expect(retained.retention).toBe("keep");
        expect((yield* readManagedProjectCheckout(f.cwd))?.released).toBe(false);
        expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("initial content\n");
      }),
    ),
  );
  it.live("writes version 2 ownership so older readers refuse to discard keep protection", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.adopt("keep");
        const json = yield* f.fs.readFileString(`${f.cwd}.t3-project-owned.json`);
        const legacyReader = Schema.decodeEffect(
          Schema.fromJsonString(Schema.Struct({ version: Schema.Literal(1) })),
        );
        expect((yield* legacyReader(json).pipe(Effect.result))._tag).toBe("Failure");
        expect((yield* readManagedProjectCheckout(f.cwd))?.version).toBe(2);
        expect((yield* readManagedProjectCheckout(f.cwd))?.retention).toBe("keep");
      }),
    ),
  );
  it.live.each(["ownershipSource", "retention"] as const)(
    "rejects version 2 receipts missing %s rather than defaulting protection",
    (field) =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.adopt("keep");
          const receipt = (yield* readManagedProjectCheckout(f.cwd))!;
          yield* f.fs.writeFileString(
            `${f.cwd}.t3-project-owned.json`,
            yield* encodeJson({ ...receipt, [field]: undefined }),
          );
          expect((yield* readManagedProjectCheckout(f.cwd).pipe(Effect.result))._tag).toBe(
            "Failure",
          );
          expect((yield* f.preview()).state).toBe("blocked");
          expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("initial content\n");
        }),
      ),
  );
  it("explicit project policies override environment defaults", () => {
    const on = { projectOnSettle: true, projectAfterDays: 2 };
    const off = { projectOnSettle: false, projectAfterDays: null };
    expect(resolveManagedProjectRetention("keep", on)).toEqual(off);
    expect(resolveManagedProjectRetention("release-on-settle", off)).toEqual({
      projectOnSettle: true,
      projectAfterDays: null,
    });
    expect(resolveManagedProjectRetention("inherit", on)).toEqual(on);
  });
});
