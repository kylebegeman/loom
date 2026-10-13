// fork: project-checkout-management
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Schema from "effect/Schema";
import type { RepositoryIdentity, ProjectId } from "@t3tools/contracts";
import {
  ProjectCheckoutManagementError,
  type ProjectCheckoutPreview,
  type ProjectCheckoutAdoptRequest,
  type ProjectCheckoutRetentionRequest,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as StorageCleanup from "../storageCleanup.ts";
import {
  assertManagedProjectOwned,
  markManagedProjectCheckout,
  readManagedProjectCheckout,
  restoreManagedProjectCheckout,
  setManagedProjectRetention,
} from "../workspace/ManagedProjectCheckout.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { runCheckoutProcess } from "../workspace/checkoutProcess.ts";
import { buildRepositoryIdentity } from "./RepositoryIdentityResolver.ts";

export class ProjectCheckoutManagement extends Context.Service<
  ProjectCheckoutManagement,
  {
    readonly preview: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<ProjectCheckoutPreview, ProjectCheckoutManagementError>;
    readonly adopt: (
      input: ProjectCheckoutAdoptRequest,
      authorize?: Effect.Effect<void, ProjectCheckoutManagementError>,
    ) => Effect.Effect<ProjectCheckoutPreview, ProjectCheckoutManagementError>;
    readonly setRetention: (
      input: ProjectCheckoutRetentionRequest,
      authorize?: Effect.Effect<void, ProjectCheckoutManagementError>,
    ) => Effect.Effect<ProjectCheckoutPreview, ProjectCheckoutManagementError>;
  }
>()("t3/project/ProjectCheckoutManagement") {}

const encodeFingerprint = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const isManagementError = Schema.is(ProjectCheckoutManagementError);

const redactRemoteUrl = (remoteUrl: string) => {
  try {
    const url = new URL(remoteUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return remoteUrl.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/\s]+@/i, "$1").replace(/[?#].*$/, "");
  }
};
const publicIdentity = (identity: RepositoryIdentity): RepositoryIdentity => ({
  ...identity,
  locator: { ...identity.locator, remoteUrl: redactRemoteUrl(identity.locator.remoteUrl) },
});

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const cleanup = yield* StorageCleanup.StorageCleanup;
  const runner = yield* ProcessRunner.ProcessRunner;
  const uid = yield* HostProcess.UserId;
  const crypto = yield* Crypto.Crypto;
  const token = Effect.fnUntraced(function* (fingerprint: unknown) {
    const encoded = yield* encodeFingerprint(fingerprint);
    return Hex.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode(encoded)));
  });
  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  };
  const onFileSystem = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
    );
  const readProject = Effect.fnUntraced(function* (projectId: ProjectId) {
    const row = yield* projects
      .get(projectId)
      .pipe(
        Effect.mapError(
          (cause) => new ProjectCheckoutManagementError({ projectId, reason: "io", cause }),
        ),
      );
    if (Option.isNone(row) || row.value.deletedAt !== null)
      return yield* new ProjectCheckoutManagementError({ projectId, reason: "not-found" });
    return row.value;
  });
  const inspect = Effect.fnUntraced(function* (projectId: ProjectId) {
    const row = yield* readProject(projectId);
    const cwd = path.resolve(row.workspaceRoot);
    const base: ProjectCheckoutPreview = {
      projectId,
      workspaceRoot: cwd,
      state: "blocked",
      ownershipSource: null,
      retention: "inherit",
      head: null,
      branch: null,
      repositoryIdentity: null,
      localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
      blockers: [],
      reviewToken: null,
    };
    const blocked = (reason: string, state = base): ProjectCheckoutPreview => ({
      ...state,
      state: "blocked",
      blockers: [reason],
      reviewToken: null,
    });
    // Metadata adoption must never give cleanup ownership of environment state or its parent.
    const protectedPaths: { path: string; state: boolean }[] = [];
    for (const [root, state] of [
      [config.baseDir, false],
      [config.stateDir, true],
    ] as const) {
      const lexical = path.resolve(root);
      protectedPaths.push({ path: lexical, state });
      let ancestor = lexical;
      const suffix: string[] = [];
      while (true) {
        const canonical = yield* fs.realPath(ancestor).pipe(Effect.result);
        if (canonical._tag === "Success") {
          protectedPaths.push({ path: path.join(canonical.success, ...suffix), state });
          break;
        }
        if ((yield* fs.exists(ancestor)) || path.dirname(ancestor) === ancestor)
          return blocked("Loom's environment data path could not be verified safely.");
        suffix.unshift(path.basename(ancestor));
        ancestor = path.dirname(ancestor);
      }
    }
    // Projects may live under <T3 home>/projects, but never inside userdata or above the home.
    if (
      cwd === path.parse(cwd).root ||
      protectedPaths.some(
        (root) => inside(cwd, root.path) || (root.state && inside(root.path, cwd)),
      )
    )
      return blocked(
        "This folder contains environment data or is inside Loom's environment data directory.",
      );
    const parent = yield* fs.realPath(path.dirname(cwd)).pipe(Effect.option);
    if (Option.isNone(parent)) return blocked("The project parent folder is unavailable.");
    if (parent.value !== path.dirname(cwd))
      return blocked("The project path passes through a symbolic link.");
    const receiptResult = yield* readManagedProjectCheckout(cwd).pipe(Effect.result);
    if (receiptResult._tag === "Failure")
      return blocked("The project ownership receipt is invalid or belongs to another computer.");
    const receipt = receiptResult.success;
    const known =
      receipt === null
        ? base
        : ({
            ...base,
            ownershipSource: receipt.ownershipSource,
            retention: receipt.retention,
            repositoryIdentity: publicIdentity(receipt.repositoryIdentity),
          } satisfies ProjectCheckoutPreview);
    if (
      receipt?.projectId !== null &&
      receipt?.projectId !== undefined &&
      receipt.projectId !== projectId
    )
      return blocked("This managed folder belongs to another project.", known);
    if (!(yield* fs.exists(cwd))) {
      if (receipt === null || !receipt.released || receipt.projectId === null)
        return blocked("The project folder is missing and has no managed recovery receipt.", known);
      const released = { ...known, state: "released" as const };
      return { ...released, reviewToken: yield* token({ projectId, cwd, receipt, exists: false }) };
    }
    const canonical = yield* fs.realPath(cwd);
    if (canonical !== cwd) return blocked("The project folder is a symbolic link.", known);
    if (receipt !== null) {
      const owned = yield* assertManagedProjectOwned(receipt).pipe(Effect.result);
      if (owned._tag === "Failure")
        return blocked("The project folder was replaced or its ownership changed.", known);
    }
    const root = yield* fs.stat(cwd);
    const gitPath = path.join(cwd, ".git");
    const git = yield* fs.stat(gitPath).pipe(Effect.option);
    if (
      uid === undefined ||
      root.type !== "Directory" ||
      Option.getOrNull(root.uid) !== uid ||
      !Option.isSome(root.ino) ||
      Option.isNone(git) ||
      git.value.type !== "Directory" ||
      Option.getOrNull(git.value.uid) !== uid ||
      !Option.isSome(git.value.ino) ||
      root.dev !== git.value.dev
    )
      return blocked(
        "Only a primary Git checkout owned by this computer's user can be managed. Linked worktrees and shared Git directories stay external.",
        known,
      );
    if ((yield* fs.realPath(gitPath)) !== gitPath)
      return blocked("This checkout uses an external Git directory.", known);
    const read = (args: string[]) =>
      runCheckoutProcess({
        command: "git",
        args: ["--no-optional-locks", "-C", cwd, ...args],
        timeout: "10 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 256 * 1024,
        outputMode: "truncate",
      });
    const top = yield* read([
      "rev-parse",
      "--show-toplevel",
      "--absolute-git-dir",
      "--git-common-dir",
    ]);
    const [topRoot, gitRoot, commonRoot] = top.stdout.trim().split("\n");
    if (
      top.code !== 0 ||
      top.timedOut ||
      top.stdoutInvalidUtf8 ||
      top.stdoutTruncated ||
      topRoot !== cwd ||
      gitRoot !== gitPath ||
      path.resolve(cwd, commonRoot ?? "") !== gitPath
    )
      return blocked(
        "The registered project folder must be the primary repository root with its own Git directory.",
        known,
      );
    const headResult = yield* read(["rev-parse", "--verify", "HEAD"]);
    const branchResult = yield* read(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const origin = yield* read(["remote", "get-url", "origin"]);
    const status = yield* read(["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
    const ignored = yield* read([
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ]);
    const summary = {
      trackedChanges: 0,
      untrackedFiles: 0,
      ignoredFiles: ignored.stdout.split("\0").filter(Boolean).length,
      truncated: status.stdoutTruncated || ignored.stdoutTruncated,
    };
    const entries = status.stdout.split("\0").filter(Boolean);
    for (let index = 0; index < entries.length; index++) {
      const code = entries[index]!.slice(0, 2);
      if (code === "??") summary.untrackedFiles++;
      else {
        summary.trackedChanges++;
        if (code.includes("R") || code.includes("C")) index++;
      }
    }
    const identity =
      origin.code === 0 && origin.stdout.trim() !== ""
        ? buildRepositoryIdentity({
            rootPath: cwd,
            remoteName: "origin",
            remoteUrl: redactRemoteUrl(origin.stdout.trim()),
            originUrl: redactRemoteUrl(origin.stdout.trim()),
          })
        : null;
    const state: ProjectCheckoutPreview = {
      ...known,
      state: receipt === null ? "external" : receipt.released ? "released" : "managed",
      head: headResult.code === 0 ? headResult.stdout.trim() : null,
      branch: branchResult.code === 0 ? branchResult.stdout.trim() : null,
      repositoryIdentity: identity,
      localFiles: summary,
    };
    if (
      [headResult, origin, status, ignored].some(
        (result) => result.timedOut || result.stdoutInvalidUtf8 || result.stdoutTruncated,
      ) ||
      branchResult.timedOut ||
      branchResult.stdoutInvalidUtf8 ||
      branchResult.stdoutTruncated ||
      (branchResult.code !== 0 && branchResult.code !== 1)
    )
      return blocked(
        "Git could not complete this review safely. Try again when the repository is available.",
        state,
      );
    if (identity === null)
      return blocked("A Git origin remote is required before this checkout can be managed.", state);
    if (headResult.code === 0 && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(state.head ?? ""))
      return blocked(
        "Git returned an invalid revision. Review the repository before adopting it.",
        state,
      );
    if (
      branchResult.code === 0 &&
      (state.branch === null || state.branch.length === 0 || /[\s\p{Cc}]/u.test(state.branch))
    )
      return blocked(
        "Git returned an invalid branch. Review the repository before adopting it.",
        state,
      );
    if (headResult.code !== 0)
      return blocked("Create the repository's first commit before adopting its checkout.", state);
    if (status.code !== 0 || ignored.code !== 0 || summary.truncated)
      return blocked(
        "The local file review could not be completed safely. Reduce the file list and review again.",
        state,
      );
    if (receipt !== null && identity.canonicalKey !== receipt.repositoryIdentity.canonicalKey)
      return blocked("The checkout's origin no longer matches its ownership receipt.", state);
    const blockers: string[] = [];
    if (receipt?.released)
      blockers.push(
        "The previous release stopped with the original folder intact. Choosing Keep retains that verified checkout.",
      );
    if (summary.trackedChanges + summary.untrackedFiles > 0)
      blockers.push(
        "Local changes are preserved. Cleanup keeps this checkout until they are published or removed.",
      );
    if (summary.ignoredFiles > 0)
      blockers.push(
        "Ignored files remain in this folder. Cleanup retains local data except rebuildable dependency folders.",
      );
    if (branchResult.code !== 0)
      blockers.push(
        "The detached revision is preserved in recovery. Cleanup still requires that revision to be published.",
      );
    const fingerprint = {
      projectId,
      cwd,
      checkoutInode: root.ino.value,
      gitInode: git.value.ino.value,
      device: root.dev,
      uid,
      birthtime: Option.map(root.birthtime, (date) => date.getTime()).pipe(Option.getOrNull),
      head: state.head,
      branch: state.branch,
      origin: identity,
      status: status.stdout,
      ignored: ignored.stdout,
      receipt,
    };
    return { ...state, blockers, reviewToken: yield* token(fingerprint) };
  }, onFileSystem);
  const mapError = (projectId: ProjectId) => (cause: unknown) =>
    isManagementError(cause)
      ? cause
      : new ProjectCheckoutManagementError({ projectId, reason: "io", cause });
  const preview: ProjectCheckoutManagement["Service"]["preview"] = Effect.fn(
    "ProjectCheckoutManagement.preview",
  )((input) => inspect(input.projectId).pipe(Effect.mapError(mapError(input.projectId))));
  const mutate = Effect.fnUntraced(function* (
    input: ProjectCheckoutAdoptRequest | ProjectCheckoutRetentionRequest,
    adoption: boolean,
    authorize?: Effect.Effect<void, ProjectCheckoutManagementError>,
  ) {
    const before = yield* readProject(input.projectId);
    const cwd = path.resolve(before.workspaceRoot);
    const result = yield* withWorkspaceLease(
      cwd,
      Effect.gen(function* () {
        const latest = yield* readProject(input.projectId);
        if (path.resolve(latest.workspaceRoot) !== cwd)
          return yield* new ProjectCheckoutManagementError({
            projectId: input.projectId,
            reason: "stale-review",
          });
        const review = yield* inspect(input.projectId);
        if (review.reviewToken === null || review.state === "blocked")
          return yield* new ProjectCheckoutManagementError({
            projectId: input.projectId,
            reason: "blocked",
          });
        if (review.reviewToken !== input.reviewToken)
          return yield* new ProjectCheckoutManagementError({
            projectId: input.projectId,
            reason: "stale-review",
          });
        // A queued MCP mutation rechecks the live caller after waiting and reviewing.
        if (authorize !== undefined) yield* authorize;
        const authoritative = yield* readProject(input.projectId);
        if (path.resolve(authoritative.workspaceRoot) !== cwd)
          return yield* new ProjectCheckoutManagementError({
            projectId: input.projectId,
            reason: "stale-review",
          });
        if (adoption) {
          if (
            review.state !== "external" ||
            review.repositoryIdentity === null ||
            input.retention === "inherit"
          )
            return yield* new ProjectCheckoutManagementError({
              projectId: input.projectId,
              reason: "stale-review",
            });
          yield* markManagedProjectCheckout(cwd, review.repositoryIdentity, {
            ownershipSource: "adopted",
            retention: input.retention,
            projectId: input.projectId,
          });
        } else {
          if (review.state === "external")
            return yield* new ProjectCheckoutManagementError({
              projectId: input.projectId,
              reason: "not-managed",
            });
          if (review.state === "released" && input.retention === "keep") {
            const restored = yield* restoreManagedProjectCheckout(cwd, true);
            if (!restored)
              return yield* new ProjectCheckoutManagementError({
                projectId: input.projectId,
                reason: "io",
              });
          }
          yield* setManagedProjectRetention(cwd, input.retention, input.projectId, true);
        }
        return yield* inspect(input.projectId);
      }),
    );
    // Enqueue only after releasing the checkout lock; the worker takes the same lease.
    yield* cleanup.requestSweep;
    return result;
  }, onFileSystem);
  return ProjectCheckoutManagement.of({
    preview,
    adopt: (input, authorize) =>
      mutate(input, true, authorize).pipe(Effect.mapError(mapError(input.projectId))),
    setRetention: (input, authorize) =>
      mutate(input, false, authorize).pipe(Effect.mapError(mapError(input.projectId))),
  });
});
export const layer = Layer.effect(ProjectCheckoutManagement, make);
