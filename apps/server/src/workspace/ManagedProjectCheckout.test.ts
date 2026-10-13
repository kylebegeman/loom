// fork: project-lifecycle
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as PlatformError from "effect/PlatformError";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { buildRepositoryIdentity } from "../project/RepositoryIdentityResolver.ts";
import { runCheckoutProcess } from "./checkoutProcess.ts";
import {
  archiveManagedProjectCheckout,
  assertManagedProjectOwned,
  markManagedProjectCheckout,
  readManagedProjectCheckout,
  releaseManagedProjectCheckout,
  restoreManagedProjectCheckout,
} from "./ManagedProjectCheckout.ts";

const projectId = ProjectId.make("managed-project-test");
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const parent = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
  const cwd = `${parent}/clone`;
  yield* fs.makeDirectory(cwd);
  const command = (args: string[]) =>
    runCheckoutProcess({ command: "git", args: ["-C", cwd, ...args] }).pipe(
      Effect.tap((result) => Effect.sync(() => expect(result.code).toBe(0))),
    );
  yield* command(["init", "-b", "main"]);
  yield* command(["config", "user.name", "Lifecycle test"]);
  yield* command(["config", "user.email", "lifecycle@example.test"]);
  yield* fs.writeFileString(`${cwd}/proof.txt`, "published content\n");
  yield* command(["add", "."]);
  yield* command(["commit", "-m", "initial"]);
  const identity = buildRepositoryIdentity({
    rootPath: cwd,
    remoteName: "origin",
    remoteUrl: "https://github.com/example/managed-project.git",
    originUrl: "https://github.com/example/managed-project.git",
  });
  const mark = markManagedProjectCheckout(cwd, identity);
  const release = Effect.gen(function* () {
    const receipt = yield* readManagedProjectCheckout(cwd);
    expect(receipt).not.toBeNull();
    const recovery = yield* archiveManagedProjectCheckout(receipt!, projectId);
    yield* releaseManagedProjectCheckout(receipt!, projectId, recovery.archive);
    return recovery;
  });
  return { fs, parent, cwd, command, identity, mark, release };
});
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | FileSystem.FileSystem
    | import("effect/Path").Path
    | import("effect/Scope").Scope
    | import("effect/process/ChildProcessSpawner").ChildProcessSpawner
  >,
) => effect.pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("Managed primary project checkouts", () => {
  it.live("leaves user-opened repositories unowned and does not create missing folders", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        expect(yield* readManagedProjectCheckout(f.cwd)).toBeNull();
        yield* f.fs.remove(f.cwd, { recursive: true });
        expect(yield* restoreManagedProjectCheckout(f.cwd)).toBe(false);
        expect(yield* f.fs.exists(f.cwd)).toBe(false);
      }),
    ),
  );
  it.live(
    "releases and restores files, checkpoint refs and identity without another remote clone",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.mark;
          const head = (yield* f.command(["rev-parse", "HEAD"])).stdout.trim();
          yield* f.command(["update-ref", "refs/t3/checkpoints/test", head]);
          yield* f.release;
          expect(yield* f.fs.exists(f.cwd)).toBe(false);
          expect((yield* readManagedProjectCheckout(f.cwd))?.repositoryIdentity).toEqual(
            f.identity,
          );
          expect(yield* restoreManagedProjectCheckout(f.cwd)).toBe(true);
          expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("published content\n");
          expect((yield* f.command(["rev-parse", "refs/t3/checkpoints/test"])).stdout.trim()).toBe(
            head,
          );
          expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(true);
          const restoredReceipt = (yield* readManagedProjectCheckout(f.cwd))!;
          expect(restoredReceipt.released).toBe(false);
          yield* assertManagedProjectOwned(restoredReceipt);
          expect(yield* restoreManagedProjectCheckout(f.cwd)).toBe(false);
        }),
      ),
  );
  it.live("archives and restores an owned project beneath a differently owned ancestor", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const path = yield* Path.Path;
        const uid = yield* HostProcess.UserId;
        const ancestor = path.dirname(f.parent);
        const filesystem = {
          ...f.fs,
          stat: (file: string) =>
            f.fs
              .stat(file)
              .pipe(
                Effect.map((info) =>
                  file === ancestor ? { ...info, uid: Option.some((uid ?? 0) + 1) } : info,
                ),
              ),
        };
        yield* f.mark;
        // Linux temp roots are owned by the runner, but /tmp belongs to root.
        yield* f.release.pipe(Effect.provideService(FileSystem.FileSystem, filesystem));
        expect(yield* f.fs.exists(f.cwd)).toBe(false);
        expect(
          yield* restoreManagedProjectCheckout(f.cwd).pipe(
            Effect.provideService(FileSystem.FileSystem, filesystem),
          ),
        ).toBe(true);
        expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("published content\n");
        yield* assertManagedProjectOwned((yield* readManagedProjectCheckout(f.cwd))!);
      }),
    ),
  );
  it.live("serializes simultaneous reopen requests without failing the later caller", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.mark;
        yield* f.release;
        const results = yield* Effect.all(
          [restoreManagedProjectCheckout(f.cwd), restoreManagedProjectCheckout(f.cwd)],
          { concurrency: "unbounded" },
        );
        expect(results.toSorted()).toEqual([false, true]);
      }),
    ),
  );
  it.live("keeps a file written between the last archive check and recursive removal", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.mark;
        const result = yield* f.release.pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...f.fs,
            rename: (from, to) =>
              f.fs
                .rename(from, to)
                .pipe(
                  Effect.andThen(
                    from === f.cwd
                      ? f.fs.writeFileString(`${to}/late-note.txt`, "keep my data")
                      : Effect.void,
                  ),
                ),
          }),
          Effect.result,
        );
        expect(result._tag).toBe("Failure");
        const receipt = (yield* readManagedProjectCheckout(f.cwd))!;
        expect(receipt.removalPath).not.toBeNull();
        expect(yield* f.fs.readFileString(`${receipt.removalPath}/late-note.txt`)).toBe(
          "keep my data",
        );
      }),
    ),
  );
  it.live("recovers after interrupted removal while preserving the remaining original folder", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.mark;
        const result = yield* f.release.pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...f.fs,
            remove: (target, options) =>
              target.startsWith(`${f.cwd}.t3-released-`)
                ? PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "remove",
                    pathOrDescriptor: target,
                  })
                : f.fs.remove(target, options),
          }),
          Effect.result,
        );
        expect(result._tag).toBe("Failure");
        const receipt = (yield* readManagedProjectCheckout(f.cwd))!;
        expect(yield* f.fs.exists(receipt.removalPath!)).toBe(true);
        expect(yield* restoreManagedProjectCheckout(f.cwd)).toBe(true);
        expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("published content\n");
        expect(yield* f.fs.exists(receipt.removalPath!)).toBe(true);
        expect((yield* f.release.pipe(Effect.result))._tag).toBe("Failure");
        expect((yield* readManagedProjectCheckout(f.cwd))?.removalPath).toBe(receipt.removalPath);
        expect(yield* f.fs.readFileString(`${receipt.removalPath}/proof.txt`)).toBe(
          "published content\n",
        );
      }),
    ),
  );
  it.live("preserves discoverable identity without restoring during background reads", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.mark;
        yield* f.release;
        const resolver = yield* RepositoryIdentityResolver.make().pipe(
          Effect.provide(ProcessRunner.layer),
        );
        expect(yield* resolver.resolve(f.cwd)).toEqual(f.identity);
        expect(yield* f.fs.exists(f.cwd)).toBe(false);
        const paths = yield* WorkspacePaths.make;
        expect((yield* paths.normalizeWorkspaceRoot(f.cwd).pipe(Effect.result))._tag).toBe(
          "Failure",
        );
        expect(yield* f.fs.exists(f.cwd)).toBe(false);
      }),
    ),
  );
  it.live.each(["read", "write"] as const)(
    "restores before explicit file %s through the shared service",
    (operation) =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          yield* f.mark;
          yield* f.release;
          const service = yield* WorkspaceFileSystem.make.pipe(
            Effect.provide(
              Layer.mergeAll(
                WorkspacePaths.layer,
                Layer.mock(WorkspaceEntries.WorkspaceEntries)({ refresh: () => Effect.void }),
              ),
            ),
          );
          if (operation === "read") {
            expect(
              (yield* service.readFile({ cwd: f.cwd, relativePath: "proof.txt" })).contents,
            ).toBe("published content\n");
          } else {
            yield* service.writeFile({
              cwd: f.cwd,
              relativePath: "new-note.txt",
              contents: "explicit work",
            });
            expect(yield* f.fs.readFileString(`${f.cwd}/new-note.txt`)).toBe("explicit work");
            expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("published content\n");
          }
        }),
      ),
  );
  it.live("does not release a replaced checkout even when the registered path is reused", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.mark;
        const receipt = (yield* readManagedProjectCheckout(f.cwd))!;
        yield* f.fs.rename(f.cwd, `${f.cwd}-original`);
        yield* f.fs.makeDirectory(`${f.cwd}/.git`, { recursive: true });
        yield* f.fs.writeFileString(`${f.cwd}/new-user-data`, "keep");
        expect((yield* assertManagedProjectOwned(receipt).pipe(Effect.result))._tag).toBe(
          "Failure",
        );
        expect(yield* f.fs.readFileString(`${f.cwd}/new-user-data`)).toBe("keep");
      }),
    ),
  );
});
