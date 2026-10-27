// fork: library-projects -- checkpoint operations fan out over a Library project's repositories.
import {
  VcsRepositoryDetectionError, // fork: library-projects
  VcsUnsupportedOperationError,
  CheckpointRef, // fork: library-projects
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts"; // fork: library-projects
import { parseTurnDiffFilesFromNumstat } from "./Diffs.ts";
import { threadIdFromCheckpointRef } from "./Utils.ts";

import type { CheckpointStoreError } from "./Errors.ts";
import type { VcsCheckpointOps } from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

export interface CaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
}

export interface RestoreCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly fallbackToHead?: boolean;
}

export interface DiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly fallbackFromToHead?: boolean;
  readonly ignoreWhitespace: boolean;
  readonly format?: "patch" | "numstat";
  /** Maximum bytes collected from the diff command. */
  readonly maxOutputBytes?: number;
  /** Limits the diff to these exact paths. An empty list yields an empty diff. */
  readonly filePaths?: ReadonlyArray<string>;
}

export interface ListAuthoredPathsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
}

export interface DeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
}

export class CheckpointStore extends Context.Service<
  CheckpointStore,
  {
    readonly isGitRepository: (cwd: string) => Effect.Effect<boolean, CheckpointStoreError>;

    readonly captureCheckpoint: (
      input: CaptureCheckpointInput,
    ) => Effect.Effect<void, CheckpointStoreError>;

    readonly hasCheckpointRef: (
      input: Omit<RestoreCheckpointInput, "fallbackToHead">,
    ) => Effect.Effect<boolean, CheckpointStoreError>;

    readonly restoreCheckpoint: (
      input: RestoreCheckpointInput,
    ) => Effect.Effect<boolean, CheckpointStoreError>;

    readonly diffCheckpoints: (
      input: DiffCheckpointsInput,
    ) => Effect.Effect<string, CheckpointStoreError>;

    /** Null means HEAD is unchanged or unrecorded; all changed paths then belong to the turn. */
    readonly listAuthoredPaths: (
      input: ListAuthoredPathsInput,
    ) => Effect.Effect<ReadonlySet<string> | null, CheckpointStoreError>;

    readonly deleteCheckpointRefs: (
      input: DeleteCheckpointRefsInput,
    ) => Effect.Effect<void, CheckpointStoreError>;
  }
>()("t3/checkpointing/CheckpointStore") {}

/** @public */
export const make = Effect.gen(function* () {
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;

  const resolveCheckpoints = Effect.fn("CheckpointStore.resolveCheckpoints")(function* (
    operation: string,
    cwd: string,
  ) {
    const handle = yield* vcsRegistry.resolve({ cwd });
    if (!handle.driver.checkpoints) {
      return yield* new VcsUnsupportedOperationError({
        operation,
        kind: handle.kind,
        detail: `${handle.kind} driver does not implement checkpoint operations.`,
      });
    }
    return handle.driver.checkpoints satisfies VcsCheckpointOps;
  });

  // fork: library-projects
  const workspaceStore = yield* Effect.serviceOption(LibraryWorkspaceStore.LibraryWorkspaceStore);
  const targets = Effect.fnUntraced(function* (cwd: string, checkpointRef?: CheckpointRef) {
    const repositories = Option.isSome(workspaceStore)
      ? yield* workspaceStore.value
          .repositoriesForRoot(
            cwd,
            checkpointRef === undefined ? undefined : threadIdFromCheckpointRef(checkpointRef),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new VcsRepositoryDetectionError({
                  operation: "CheckpointStore.workspace",
                  cwd,
                  detail: "The project working-copy receipt is unavailable.",
                  cause,
                }),
            ),
          )
      : null;
    return repositories ?? [{ path: cwd, relativePath: "" }];
  });
  const prefixPath = (prefix: string, file: string) => (prefix === "" ? file : `${prefix}/${file}`);
  const prefixNumstat = (numstat: string, prefix: string) => {
    if (prefix === "") return numstat;
    const records = numstat.split("\0");
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      const counts = /^(\d+|-)\t(\d+|-)\t/.exec(record);
      if (!counts) continue;
      const file = record.slice(counts[0].length);
      if (file !== "") records[index] = `${counts[0]}${prefixPath(prefix, file)}`;
      else {
        records[index + 1] = prefixPath(prefix, records[index + 1] ?? "");
        records[index + 2] = prefixPath(prefix, records[index + 2] ?? "");
        index += 2;
      }
    }
    return records.join("\0");
  };
  const isGitRepository: CheckpointStore["Service"]["isGitRepository"] = Effect.fn(
    "CheckpointStore.isGitRepository",
  )(function* (cwd) {
    const repositories = yield* targets(cwd);
    if (repositories.length === 0) return false;
    for (const repository of repositories) {
      if ((yield* vcsRegistry.detect({ cwd: repository.path, requestedKind: "git" })) === null)
        return false;
    }
    return true;
  });

  const captureCheckpoint: CheckpointStore["Service"]["captureCheckpoint"] = Effect.fn(
    "CheckpointStore.captureCheckpoint",
  )(function* (input) {
    for (const repository of yield* targets(input.cwd, input.checkpointRef)) {
      const checkpoints = yield* resolveCheckpoints(
        "CheckpointStore.captureCheckpoint",
        repository.path,
      );
      yield* checkpoints.captureCheckpoint({ ...input, cwd: repository.path });
    }
  });

  const hasCheckpointRef: CheckpointStore["Service"]["hasCheckpointRef"] = Effect.fn(
    "CheckpointStore.hasCheckpointRef",
  )(function* (input) {
    const repositories = yield* targets(input.cwd, input.checkpointRef);
    if (repositories.length === 0) return false;
    for (const repository of repositories) {
      const checkpoints = yield* resolveCheckpoints(
        "CheckpointStore.hasCheckpointRef",
        repository.path,
      );
      if (!(yield* checkpoints.hasCheckpointRef({ ...input, cwd: repository.path }))) return false;
    }
    return true;
  });

  const restoreCheckpoint: CheckpointStore["Service"]["restoreCheckpoint"] = Effect.fn(
    "CheckpointStore.restoreCheckpoint",
  )(function* (input) {
    const repositories = yield* targets(input.cwd, input.checkpointRef);
    if (repositories.length === 0) return false;
    const resolved: Array<{ readonly cwd: string; readonly checkpoints: VcsCheckpointOps }> = [];
    for (const repository of repositories) {
      const checkpoints = yield* resolveCheckpoints(
        "CheckpointStore.restoreCheckpoint",
        repository.path,
      );
      if (
        input.fallbackToHead !== true &&
        !(yield* checkpoints.hasCheckpointRef({
          cwd: repository.path,
          checkpointRef: input.checkpointRef,
        }))
      )
        return false;
      resolved.push({ cwd: repository.path, checkpoints });
    }
    if (resolved.length === 1)
      return yield* resolved[0]!.checkpoints.restoreCheckpoint({ ...input, cwd: resolved[0]!.cwd });
    // Keep all repositories recoverable if a later restore fails after earlier ones changed.
    const safetyRef = CheckpointRef.make(`refs/t3/project-library/restore/${yield* randomUuidV4}`);
    for (const repository of resolved)
      yield* repository.checkpoints.captureCheckpoint({
        cwd: repository.cwd,
        checkpointRef: safetyRef,
      });
    const restored = yield* Effect.result(
      Effect.gen(function* () {
        for (const repository of resolved) {
          if (!(yield* repository.checkpoints.restoreCheckpoint({ ...input, cwd: repository.cwd })))
            return false;
        }
        return true;
      }),
    );
    if (restored._tag === "Failure" || !restored.success) {
      const rollback = yield* Effect.forEach(resolved, (repository) =>
        Effect.result(
          repository.checkpoints.restoreCheckpoint({
            cwd: repository.cwd,
            checkpointRef: safetyRef,
          }),
        ),
      );
      if (rollback.some((result) => result._tag === "Failure" || !result.success))
        return yield* new VcsRepositoryDetectionError({
          operation: "CheckpointStore.restoreCheckpoint",
          cwd: input.cwd,
          detail:
            "Project restore failed. Recovery checkpoints were retained for the repositories.",
          cause: { restored, rollback },
        });
    }
    for (const repository of resolved)
      yield* repository.checkpoints.deleteCheckpointRefs({
        cwd: repository.cwd,
        checkpointRefs: [safetyRef],
      });
    return restored._tag === "Failure" ? yield* restored.failure : restored.success;
  });

  const diffCheckpoints: CheckpointStore["Service"]["diffCheckpoints"] = Effect.fn(
    "CheckpointStore.diffCheckpoints",
  )(function* (input) {
    const diffs: string[] = [];
    for (const repository of yield* targets(input.cwd, input.toCheckpointRef)) {
      const checkpoints = yield* resolveCheckpoints(
        "CheckpointStore.diffCheckpoints",
        repository.path,
      );
      const filePaths = input.filePaths?.flatMap((file) => {
        if (repository.relativePath === "") return [file];
        const prefix = `${repository.relativePath}/`;
        return file.startsWith(prefix) ? [file.slice(prefix.length)] : [];
      });
      const diff = yield* checkpoints.diffCheckpoints({
        ...input,
        cwd: repository.path,
        pathPrefix: repository.relativePath,
        ...(filePaths === undefined ? {} : { filePaths }),
      });
      diffs.push(input.format === "numstat" ? prefixNumstat(diff, repository.relativePath) : diff);
    }
    return diffs.join("");
  });

  const listAuthoredPaths: CheckpointStore["Service"]["listAuthoredPaths"] = Effect.fn(
    "CheckpointStore.listAuthoredPaths",
  )(function* (input) {
    const repositories = yield* targets(input.cwd, input.toCheckpointRef);
    const authored = new Set<string>();
    for (const repository of repositories) {
      const checkpoints = yield* resolveCheckpoints(
        "CheckpointStore.listAuthoredPaths",
        repository.path,
      );
      const paths = yield* checkpoints.listAuthoredPaths({ ...input, cwd: repository.path });
      if (paths === null) {
        if (repositories.length === 1) return null;
        const changed = yield* checkpoints.diffCheckpoints({
          ...input,
          cwd: repository.path,
          ignoreWhitespace: false,
          format: "numstat",
        });
        for (const file of parseTurnDiffFilesFromNumstat(changed)) {
          authored.add(prefixPath(repository.relativePath, file.path));
          if (file.previousPath !== undefined)
            authored.add(prefixPath(repository.relativePath, file.previousPath));
        }
      } else for (const file of paths) authored.add(prefixPath(repository.relativePath, file));
    }
    return authored;
  });

  const deleteCheckpointRefs: CheckpointStore["Service"]["deleteCheckpointRefs"] = Effect.fn(
    "CheckpointStore.deleteCheckpointRefs",
  )(function* (input) {
    for (const repository of yield* targets(input.cwd)) {
      const checkpoints = yield* resolveCheckpoints(
        "CheckpointStore.deleteCheckpointRefs",
        repository.path,
      );
      yield* checkpoints.deleteCheckpointRefs({ ...input, cwd: repository.path });
    }
  });

  return CheckpointStore.of({
    isGitRepository,
    captureCheckpoint,
    hasCheckpointRef,
    restoreCheckpoint,
    diffCheckpoints,
    listAuthoredPaths,
    deleteCheckpointRefs,
  });
});

export const layer = Layer.effect(CheckpointStore, make);
