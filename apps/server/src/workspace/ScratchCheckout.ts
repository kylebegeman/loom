// fork: mini-native-retention
// @effect-diagnostics nodeBuiltinImport:off -- Crypto.digest cannot hash multi-gigabyte bundles incrementally.
import * as NodeCrypto from "node:crypto";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { type ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { runCheckoutProcess } from "./checkoutProcess.ts";
import { withWorkspaceLease } from "./workspaceLease.ts";

export class ScratchCheckoutError extends Schema.TaggedError<ScratchCheckoutError>()(
  "ScratchCheckoutError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export interface ScratchCheckoutInput {
  readonly scratchRoot: string;
  readonly worktreePath: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  /** Primary projects share a recovery key across conversations. */
  readonly recoveryKind?: "project";
  /** Internal callers may hold the non-reentrant workspace lease already. */
  readonly workspaceLeaseHeld?: boolean;
}
const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literals(["git", "empty"]),
  projectId: Schema.String,
  threadId: Schema.String,
  worktreePath: Schema.String,
  scratchRoot: Schema.String,
  head: Schema.NullOr(Schema.String),
  refs: Schema.String,
  metadataDigest: Schema.String,
  bundleDigest: Schema.NullOr(Schema.String),
  mode: Schema.Number,
});
export type ScratchCheckoutManifest = typeof Manifest.Type;
const digest = (bytes: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("hex");

/** Archives sit beside Scratch on the same filesystem, never beneath a released checkout. */
export function scratchArchivePaths(input: ScratchCheckoutInput) {
  const root =
    input.recoveryKind === "project"
      ? `${input.scratchRoot}/.t3-project-archives`
      : `${input.scratchRoot}/../.t3-scratch-archives`;
  return { root, archive: `${root}/${digest(input.threadId)}` };
}

const isScratchCheckoutError = Schema.is(ScratchCheckoutError);
const ManifestCodec = Schema.fromJsonString(Manifest);
const encodeManifest = Schema.encodeEffect(ManifestCodec);
const decodeManifest = Schema.decodeEffect(ManifestCodec);
const fail = (message: string) => new ScratchCheckoutError({ message });
const mapFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) =>
      isScratchCheckoutError(error)
        ? error
        : new ScratchCheckoutError({
            message: "Scratch checkout recovery could not be completed safely.",
            cause: error,
          }),
    ),
  );

const canonicalRoot = Effect.fnUntraced(function* (input: ScratchCheckoutInput) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(input.scratchRoot);
  const cwd = path.resolve(input.worktreePath);
  if (path.dirname(root) === root || path.dirname(cwd) !== root)
    return yield* fail("Scratch checkout is outside its registered folder.");
  if (
    (yield* fs.realPath(root)) !==
    path.join(yield* fs.realPath(path.dirname(root)), path.basename(root))
  )
    return yield* fail("Scratch root must be canonical.");
  const rootInfo = yield* fs.stat(root);
  const uid = yield* HostProcess.UserId;
  if (uid !== undefined && Option.getOrNull(rootInfo.uid) !== uid)
    return yield* fail("Scratch root is not owned by this process.");
  const parentInfo = yield* fs.stat(path.dirname(root));
  if (
    rootInfo.dev !== parentInfo.dev ||
    !Option.isSome(rootInfo.uid) ||
    !Option.isSome(parentInfo.uid) ||
    rootInfo.uid.value !== parentInfo.uid.value
  )
    return yield* fail("Scratch root ownership or filesystem changed.");
  return {
    root: yield* fs.realPath(root),
    cwd: path.join(yield* fs.realPath(root), path.basename(cwd)),
    rootInfo,
  };
});

/** Mountinfo is authoritative for bind mounts, which can share their parent's device number. */
export const assertScratchUnmounted = Effect.fnUntraced(function* (cwd: string) {
  if ((yield* HostProcess.Platform) !== "linux") return;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = yield* fs.readFileString("/proc/self/mountinfo");
  for (const line of source.trim().split("\n")) {
    const fields = line.split(" ");
    if (fields.length < 10 || !fields.includes("-") || fields[4] === undefined)
      return yield* fail("Linux mount information could not be verified.");
    const mount = fields[4].replace(/\\(040|011|012|134)/g, (_, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
    if (!path.isAbsolute(mount)) return yield* fail("Linux mount information is not absolute.");
    const relative = path.relative(cwd, mount);
    if (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    )
      return yield* fail("Scratch folder contains a mounted filesystem.");
  }
});

// Normal workspace callers reuse the existing Git service. File and terminal paths can
// restore an archive without constructing the entire Git/project service graph.
const archiveGit = Effect.fnUntraced(function* (
  cwd: string,
  args: string[],
  allowNonZeroExit = false,
) {
  const existing = yield* Effect.serviceOption(GitVcsDriver.GitVcsDriver);
  if (Option.isSome(existing))
    return yield* existing.value.execute({
      operation: "ScratchCheckout",
      cwd,
      args,
      timeoutMs: 300_000,
      maxOutputBytes: 8 * 1024 * 1024,
      allowNonZeroExit,
    });
  const result = yield* runCheckoutProcess({
    command: "git",
    args: ["-C", cwd, ...args],
    timeout: "5 minutes",
    maxOutputBytes: 8 * 1024 * 1024,
    outputMode: "truncate",
  });
  if (result.code === null || (!allowNonZeroExit && result.code !== 0))
    return yield* fail("Git could not prepare the recovery archive.");
  return { ...result, exitCode: result.code };
});
const gitRead = Effect.fnUntraced(function* (cwd: string, args: string[]) {
  const result = yield* archiveGit(cwd, args);
  if (result.stdoutTruncated)
    return yield* fail("Scratch Git metadata exceeds the inspection limit.");
  return result.stdout;
});

const fileDigest = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const hash = NodeCrypto.createHash("sha256");
  yield* Stream.runForEach(fs.stream(file), (chunk) => Effect.sync(() => hash.update(chunk)));
  return hash.digest("hex");
});

/** Refuse mounted subtrees and special files before any recursive release. Symbolic links themselves are safe to unlink. */
export const scratchCheckoutOwned = Effect.fnUntraced(function* (input: ScratchCheckoutInput) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { cwd, rootInfo } = yield* canonicalRoot(input);
  yield* assertScratchUnmounted(cwd);
  const pending = [cwd];
  let count = 0;
  while (pending.length > 0) {
    const target = pending.pop()!;
    if (++count > 2_000_000)
      return yield* fail("Scratch checkout exceeds the ownership inspection limit.");
    const isLink = yield* fs.readLink(target).pipe(
      Effect.as(true),
      Effect.catchIf(
        (error) =>
          error.cause instanceof Error && "code" in error.cause && error.cause.code === "EINVAL",
        () => Effect.succeed(false),
      ),
    );
    if (isLink) continue;
    const info = yield* fs.stat(target);
    if (
      info.dev !== rootInfo.dev ||
      !Option.isSome(info.uid) ||
      info.uid.value !== Option.getOrNull(rootInfo.uid)
    )
      return yield* fail("Scratch checkout ownership or filesystem changed.");
    if (info.type === "Directory") {
      for (const name of yield* fs.readDirectory(target)) pending.push(path.join(target, name));
    } else if (info.type !== "File")
      return yield* fail("Scratch checkout contains a special file.");
  }
});

const refsAt = (cwd: string) => gitRead(cwd, ["for-each-ref", "--format=%(refname) %(objectname)"]);

/** Copy and fingerprint private Git metadata without dereferencing links or including object packs. */
const metadata = Effect.fnUntraced(function* (gitDir: string, destination?: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootInfo = yield* fs.stat(gitDir);
  const uid = yield* HostProcess.UserId;
  if (uid !== undefined && Option.getOrNull(rootInfo.uid) !== uid)
    return yield* fail("Scratch metadata is not owned by this process.");
  const hash = NodeCrypto.createHash("sha256");
  const pending = [{ source: gitDir, relative: "" }];
  let count = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const entry = pending.pop()!;
    const names = (yield* fs.readDirectory(entry.source)).toSorted();
    for (const name of names) {
      if (entry.relative === "" && name === "objects") continue;
      const source = path.join(entry.source, name);
      const relative = path.join(entry.relative, name);
      if (++count > 100_000 || (yield* fs.realPath(source)) !== source)
        return yield* fail("Scratch Git metadata contains aliases or too many entries.");
      const info = yield* fs.stat(source);
      if (
        info.dev !== rootInfo.dev ||
        Option.getOrNull(info.uid) !== Option.getOrNull(rootInfo.uid) ||
        (uid !== undefined && Option.getOrNull(info.uid) !== uid)
      )
        return yield* fail("Scratch metadata ownership or filesystem changed.");
      if (name.endsWith(".lock")) return yield* fail("Scratch Git metadata is locked.");
      hash.update(`${relative}\0${info.mode}\0`);
      if (info.type === "Directory") {
        if (destination !== undefined)
          yield* fs.makeDirectory(path.join(destination, relative), {
            recursive: true,
            mode: info.mode,
          });
        pending.push({ source, relative });
      } else if (info.type === "File") {
        bytes += Number(info.size);
        if (bytes > 64 * 1024 * 1024)
          return yield* fail("Scratch Git metadata exceeds the archive limit.");
        const contents = yield* fs.readFile(source);
        hash.update(contents);
        if (destination !== undefined) {
          const target = path.join(destination, relative);
          yield* fs.writeFile(target, contents, { mode: info.mode });
          yield* Effect.scoped(fs.open(target).pipe(Effect.flatMap((file) => file.sync)));
        }
      } else return yield* fail("Scratch Git metadata contains a special file.");
    }
  }
  return hash.digest("hex");
});

/** Builds and verifies a durable recovery receipt. The caller holds the workspace lease and rechecks activity before removal. */
export const archiveScratchCheckout = Effect.fn("ScratchCheckout.archive")(function* (
  input: ScratchCheckoutInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { root, cwd, rootInfo } = yield* canonicalRoot(input);
  if ((yield* fs.realPath(cwd)) !== path.join(yield* fs.realPath(root), path.basename(cwd)))
    return yield* fail("Scratch checkout must be canonical.");
  const info = yield* fs.stat(cwd);
  if (
    info.dev !== rootInfo.dev ||
    !Option.isSome(info.uid) ||
    info.uid.value !== Option.getOrNull(rootInfo.uid)
  )
    return yield* fail("Scratch checkout ownership or filesystem changed.");
  yield* scratchCheckoutOwned(input);
  const names = yield* fs.readDirectory(cwd);
  const kind = names.length === 0 ? ("empty" as const) : ("git" as const);
  if (kind === "git") {
    if (!names.includes(".git")) return yield* fail("Non-Git Scratch data is retained.");
    if ((yield* fs.stat(path.join(cwd, ".git"))).type !== "Directory")
      return yield* fail("Scratch must be an independent repository.");
    const gitDir = path.join(cwd, ".git");
    if (
      (yield* fs.realPath(gitDir)) !== gitDir ||
      (yield* gitRead(cwd, ["rev-parse", "--show-toplevel"])).trim() !== cwd
    )
      return yield* fail("Scratch repository must be canonical and independent.");
    const common = (yield* gitRead(cwd, ["rev-parse", "--git-common-dir"])).trim();
    if (
      path.resolve(cwd, common) !== gitDir ||
      (yield* fs.exists(path.join(gitDir, "objects", "info", "alternates")))
    )
      return yield* fail("Scratch repository uses shared object storage.");
    const configuredWorktree = yield* archiveGit(cwd, ["config", "--get", "core.worktree"], true);
    if (configuredWorktree.exitCode === 0)
      return yield* fail("Scratch repository has a custom worktree binding.");
    const worktrees = yield* gitRead(cwd, ["worktree", "list", "--porcelain"]);
    if ((worktrees.match(/^worktree /gm)?.length ?? 0) !== 1)
      return yield* fail("Scratch repository has linked worktrees.");
  }
  const archiveRoot = path.resolve(scratchArchivePaths({ ...input, scratchRoot: root }).root);
  yield* fs.makeDirectory(archiveRoot, { recursive: true, mode: 0o700 });
  if (
    (yield* fs.realPath(archiveRoot)) !==
    path.resolve(scratchArchivePaths({ ...input, scratchRoot: yield* fs.realPath(root) }).root)
  )
    return yield* fail("Scratch archive folder must be canonical.");
  const archiveInfo = yield* fs.stat(archiveRoot);
  if (
    archiveInfo.dev !== rootInfo.dev ||
    !Option.isSome(archiveInfo.uid) ||
    archiveInfo.uid.value !== Option.getOrNull(rootInfo.uid)
  )
    return yield* fail("Scratch archives must use the same owned filesystem.");
  yield* assertScratchUnmounted(archiveRoot);
  yield* fs.chmod(archiveRoot, 0o700);
  const stage = path.join(
    archiveRoot,
    `${digest(input.threadId)}.pending-${NodeCrypto.randomUUID()}`,
  );
  yield* fs.makeDirectory(stage, { mode: 0o700 });
  return yield* Effect.gen(function* () {
    let head: string | null = null;
    let refs = "";
    let metadataDigest = "";
    let bundleDigest: string | null = null;
    if (kind === "git") {
      head = (yield* gitRead(cwd, ["rev-parse", "HEAD"])).trim();
      refs = yield* refsAt(cwd);
      const savedMetadata = path.join(stage, "git-metadata");
      yield* fs.makeDirectory(savedMetadata, { mode: 0o700 });
      metadataDigest = yield* metadata(path.join(cwd, ".git"), savedMetadata);
      const bundle = path.join(stage, "repository.bundle");
      yield* gitRead(cwd, [
        "-c",
        "core.fsync=all",
        "bundle",
        "create",
        bundle,
        "--all",
        "--reflog",
        "HEAD",
      ]);
      yield* fs.chmod(bundle, 0o600);
      yield* Effect.scoped(fs.open(bundle).pipe(Effect.flatMap((file) => file.sync)));
      const verification = path.join(stage, "verify.git");
      yield* fs.makeDirectory(verification);
      yield* gitRead(verification, ["init", "--bare"]);
      yield* gitRead(verification, ["bundle", "verify", bundle]);
      yield* fs.remove(verification, { recursive: true });
      bundleDigest = yield* fileDigest(bundle);
      if (
        (yield* refsAt(cwd)) !== refs ||
        (yield* gitRead(cwd, ["rev-parse", "HEAD"])).trim() !== head ||
        (yield* metadata(path.join(cwd, ".git"))) !== metadataDigest
      )
        return yield* fail("Scratch repository changed while archiving.");
    }
    const receipt: ScratchCheckoutManifest = {
      version: 1,
      kind,
      projectId: input.projectId,
      threadId: input.threadId,
      scratchRoot: root,
      worktreePath: cwd,
      head,
      refs,
      metadataDigest,
      bundleDigest,
      mode: info.mode,
    };
    const manifestPath = path.join(stage, "manifest.json");
    yield* fs.writeFileString(manifestPath, yield* encodeManifest(receipt), { mode: 0o600 });
    yield* Effect.scoped(fs.open(manifestPath).pipe(Effect.flatMap((file) => file.sync)));
    yield* Effect.scoped(fs.open(stage).pipe(Effect.flatMap((file) => file.sync)));
    const destination = path.join(archiveRoot, digest(input.threadId));
    const previous = `${destination}.previous-${NodeCrypto.randomUUID()}`;
    const hadPrevious = yield* fs.exists(destination);
    if (hadPrevious) {
      const previousManifest = path.join(destination, "manifest.json");
      if (
        (yield* fs.realPath(destination)) !== destination ||
        !(yield* fs.exists(previousManifest))
      )
        return yield* fail("The existing Scratch archive is not owned by this thread.");
      const prior = yield* decodeManifest(yield* fs.readFileString(previousManifest));
      if (
        prior.threadId !== input.threadId ||
        prior.projectId !== input.projectId ||
        prior.worktreePath !== cwd ||
        prior.scratchRoot !== root
      )
        return yield* fail("The existing Scratch archive belongs to another checkout.");
    }
    if (hadPrevious) yield* fs.rename(destination, previous);
    yield* fs
      .rename(stage, destination)
      .pipe(
        Effect.onError(() =>
          hadPrevious
            ? fs
                .rename(previous, destination)
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Scratch archive rollback failed", { cause }),
                  ),
                )
            : Effect.void,
        ),
      );
    yield* Effect.scoped(fs.open(archiveRoot).pipe(Effect.flatMap((file) => file.sync)));
    if (hadPrevious) yield* fs.remove(previous, { recursive: true });
    return receipt;
  }).pipe(Effect.ensuring(fs.remove(stage, { recursive: true, force: true }).pipe(Effect.ignore)));
}, mapFailure);

export const scratchArchiveMatches = Effect.fn("ScratchCheckout.matches")(function* (
  manifest: ScratchCheckoutManifest,
) {
  const fs = yield* FileSystem.FileSystem;
  if (manifest.kind === "empty")
    return (yield* fs.readDirectory(manifest.worktreePath)).length === 0;
  return (
    (yield* refsAt(manifest.worktreePath)) === manifest.refs &&
    (yield* gitRead(manifest.worktreePath, ["rev-parse", "HEAD"])).trim() === manifest.head &&
    (yield* metadata(`${manifest.worktreePath}/.git`)) === manifest.metadataDigest
  );
}, mapFailure);

/** Restores only an archive matching the registered thread and path. Never replaces a checkout that already exists. */
export const restoreScratchCheckout = Effect.fn("ScratchCheckout.restore")(function* (
  input: ScratchCheckoutInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = path.resolve(input.worktreePath);
  const restore = Effect.gen(function* () {
    if (yield* fs.exists(cwd)) return false;
    const paths = scratchArchivePaths(input);
    const archive = path.resolve(paths.archive);
    const manifestPath = path.join(archive, "manifest.json");
    if (!(yield* fs.exists(manifestPath))) return false;
    const { root, cwd: canonicalCwd, rootInfo } = yield* canonicalRoot(input);
    const canonicalArchive = path.resolve(
      scratchArchivePaths({ ...input, scratchRoot: root }).archive,
    );
    if (
      (yield* fs.realPath(archive)) !== canonicalArchive ||
      (yield* fs.stat(archive)).dev !== rootInfo.dev
    )
      return yield* fail("Scratch archive ownership or filesystem changed.");
    const manifest = yield* decodeManifest(yield* fs.readFileString(manifestPath));
    if (
      manifest.threadId !== input.threadId ||
      manifest.projectId !== input.projectId ||
      manifest.worktreePath !== canonicalCwd ||
      manifest.scratchRoot !== root
    )
      return yield* fail("Scratch recovery receipt does not match the registered thread.");
    yield* assertScratchUnmounted(archive);
    const archiveInfo = yield* fs.stat(archive);
    const archiveRootInfo = yield* fs.stat(path.dirname(archive));
    if (
      Option.getOrNull(archiveInfo.uid) !== Option.getOrNull(rootInfo.uid) ||
      Option.getOrNull(archiveRootInfo.uid) !== Option.getOrNull(rootInfo.uid)
    )
      return yield* fail("Scratch recovery archive is not owned by this host.");
    const stage = `${canonicalCwd}.t3-restore-${NodeCrypto.randomUUID()}`;
    yield* fs.makeDirectory(stage, { mode: manifest.mode });
    return yield* Effect.gen(function* () {
      if (manifest.kind === "git") {
        const bundle = path.join(archive, "repository.bundle");
        if ((yield* fileDigest(bundle)) !== manifest.bundleDigest)
          return yield* fail("Scratch recovery bundle checksum does not match.");
        yield* gitRead(stage, ["init"]);
        yield* gitRead(stage, ["bundle", "unbundle", bundle]);
        if (
          (yield* metadata(path.join(canonicalArchive, "git-metadata"))) !== manifest.metadataDigest
        )
          return yield* fail("Scratch recovery metadata checksum does not match.");
        yield* fs.copy(path.join(canonicalArchive, "git-metadata"), path.join(stage, ".git"), {
          overwrite: true,
        });
        if ((yield* metadata(path.join(stage, ".git"))) !== manifest.metadataDigest)
          return yield* fail("Scratch recovery metadata checksum does not match.");
        yield* gitRead(stage, ["reset", "--hard", manifest.head!]);
        if ((yield* refsAt(stage)) !== manifest.refs)
          return yield* fail("Scratch recovery refs do not match.");
        yield* gitRead(stage, ["fsck", "--full", "--no-reflogs"]);
      }
      const marker = `${cwd}.t3-setup-pending`;
      if (!(yield* fs.exists(marker)))
        yield* fs.writeFileString(
          marker,
          "Restored Scratch checkout must finish workspace setup.\n",
          { flag: "wx", mode: 0o600 },
        );
      if (yield* fs.exists(cwd))
        return yield* fail("Scratch checkout appeared during restoration.");
      yield* fs.rename(stage, cwd);
      return true;
    }).pipe(
      Effect.ensuring(fs.remove(stage, { recursive: true, force: true }).pipe(Effect.ignore)),
    );
  });
  return yield* input.workspaceLeaseHeld ? restore : withWorkspaceLease(cwd, restore);
}, mapFailure);
