import {
  SkillRegistryError,
  SkillFetchInput,
  type SkillFetchJob,
  type SkillRegistrySource,
  type SkillSourceSkill,
} from "@t3tools/contracts/fork";
import { isPublicFaviconHost } from "@t3tools/shared/hostClassification";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProcessRunner from "../../processRunner.ts";
import {
  fail,
  makeSkillFiles,
  SKILL_FILE_LIMIT,
  SKILL_TREE_BYTE_LIMIT,
  SKILL_TREE_FILE_LIMIT,
} from "./SkillFiles.ts";
import { SkillStore } from "./SkillStore.ts";
import { validateSkill } from "./validation.ts";

const isSkillError = Schema.is(SkillRegistryError);
const encodeFetch = Schema.encodeEffect(Schema.fromJsonString(SkillFetchInput));

export interface GitSkillFile {
  readonly path: string;
  readonly mode: string;
  readonly oid: string;
  readonly bytes: number;
}
export function normalizeSkillSourceUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !isPublicFaviconHost(url.hostname)
  )
    throw fail(
      "invalid",
      "Use a public HTTPS git URL without credentials, query parameters or fragments.",
    );
  return url.href.replace(/\/$/, "");
}
export const SkillSourceTransport = Context.Reference<{
  readonly normalizeUrl: (value: string) => string;
  readonly allowFile: boolean;
}>("t3/fork/skill-registry/SkillSourceTransport", {
  defaultValue: () => ({ normalizeUrl: normalizeSkillSourceUrl, allowFile: false }),
});

export function parseGitSkillTree(text: string): readonly GitSkillFile[] {
  return text
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-7]{6}) (?:blob|commit) ([a-f0-9]{40,64})\s+(\d+|-)\t([\s\S]+)$/.exec(
        line,
      );
      if (
        !match ||
        match[4]!
          .split("/")
          .some(
            (part) => part === ".." || part === "." || part.toLowerCase() === ".git" || part === "",
          ) ||
        /[\r\n\\]/.test(match[4]!)
      )
        throw fail("invalid", "The source contains an unsupported file path.");
      return {
        path: match[4]!,
        mode: match[1]!,
        oid: match[2]!,
        bytes: match[3] === "-" ? 0 : Number(match[3]),
      };
    });
}
const finished = (job: SkillFetchJob) =>
  job.phase === "ready" || job.phase === "failed" || job.phase === "cancelled";

export const makeSkillSources = Effect.gen(function* () {
  const files = yield* makeSkillFiles;
  const store = yield* SkillStore;
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const { fs, path } = files;
  const serviceScope = yield* Scope.Scope;
  const transport = yield* SkillSourceTransport;
  const fetchLock = yield* Semaphore.make(1);
  const jobs = new Map<
    string,
    {
      fingerprint: string;
      state: SubscriptionRef.SubscriptionRef<SkillFetchJob>;
      fiber: Fiber.Fiber<void> | null;
    }
  >();
  const nullFile = platform === "win32" ? "NUL" : "/dev/null";
  const git = Effect.fn("SkillSources.git")(function* (
    args: readonly string[],
    options?: {
      readonly cwd?: string;
      readonly onStdoutChunk?: (chunk: Uint8Array) => void;
      readonly maxOutputBytes?: number;
    },
  ) {
    const result = yield* runner.run({
      command: "git",
      args: [
        "-c",
        `core.hooksPath=${nullFile}`,
        "-c",
        `protocol.file.allow=${transport.allowFile ? "always" : "never"}`,
        "-c",
        "submodule.recurse=false",
        "-c",
        "http.followRedirects=false",
        ...args,
      ],
      env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" },
      timeout: "5 minutes",
      maxOutputBytes: options?.maxOutputBytes ?? 8 * 1024 * 1024,
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options?.onStdoutChunk === undefined ? {} : { onStdoutChunk: options.onStdoutChunk }),
    });
    if (result.code !== 0)
      return yield* fail(
        "fetch-failed",
        "Git could not read this source. Check the URL, ref, network and this computer's git authentication.",
      );
    return result;
  });
  const repository = (sourceId: string) => path.join(store.root, "sources", sourceId);
  const tree = Effect.fn("SkillSources.tree")(function* (
    source: Pick<SkillRegistrySource, "id" | "commit">,
  ) {
    if (!/^[a-f0-9]{64}$/.test(source.id) || !/^[a-f0-9]{40,64}$/.test(source.commit))
      return yield* fail("invalid", "The source revision is invalid.");
    const result = yield* git(["ls-tree", "-r", "-l", "-z", source.commit], {
      cwd: repository(source.id),
    });
    if (result.stdoutInvalidUtf8)
      return yield* fail("invalid", "The source contains non-UTF-8 filenames.");
    const entries = yield* Effect.try({
      try: () => parseGitSkillTree(result.stdout),
      catch: (cause) =>
        isSkillError(cause) ? cause : fail("invalid", "The source tree could not be read."),
    });
    if (entries.length > 100000)
      return yield* fail("limit", "This repository exceeds the source scan limit.");
    return entries;
  });
  const blob = Effect.fn("SkillSources.blob")(function* (sourceId: string, entry: GitSkillFile) {
    if (entry.bytes > SKILL_TREE_BYTE_LIMIT)
      return yield* fail("limit", "A skill file exceeds 64 MiB.");
    const chunks: Uint8Array[] = [];
    yield* git(["cat-file", "blob", entry.oid], {
      cwd: repository(sourceId),
      maxOutputBytes: entry.bytes + 1,
      onStdoutChunk: (chunk) => chunks.push(chunk.slice()),
    });
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (bytes.length !== entry.bytes)
      return yield* fail("fetch-failed", "The source blob size changed while reading.");
    return bytes;
  });
  const copySkill = Effect.fn("SkillSources.copySkill")(function* (
    source: SkillRegistrySource,
    subpath: string,
    destination: string,
  ) {
    if (!source.skills.some((skill) => skill.subpath === subpath))
      return yield* fail("invalid", "Choose a skill from the fetched source catalog.");
    const selected = (yield* tree(source)).filter(
      (file) => subpath === "." || file.path.startsWith(`${subpath}/`),
    );
    if (
      selected.length === 0 ||
      selected.length > SKILL_TREE_FILE_LIMIT ||
      selected.reduce((sum, file) => sum + file.bytes, 0) > SKILL_TREE_BYTE_LIMIT
    )
      return yield* fail("limit", "The selected skill exceeds 2,000 files or 64 MiB.");
    if (selected.some((file) => file.mode !== "100644" && file.mode !== "100755"))
      return yield* fail(
        "invalid",
        "This skill contains links or submodules. Loom cannot copy it safely as a complete directory.",
      );
    if (
      selected.some(
        (file) =>
          file.path === (subpath === "." ? ".loom-skill.json" : `${subpath}/.loom-skill.json`),
      )
    )
      return yield* fail("invalid", "The source contains Loom's reserved provenance filename.");
    yield* fs.makeDirectory(destination, { recursive: true });
    yield* Effect.forEach(
      selected,
      (entry) =>
        Effect.gen(function* () {
          const relative = subpath === "." ? entry.path : entry.path.slice(subpath.length + 1);
          const target = path.join(destination, relative);
          if (!files.within(destination, target))
            return yield* fail("invalid", "The source file leaves its skill directory.");
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          yield* fs.writeFile(target, yield* blob(source.id, entry));
          yield* fs.chmod(target, entry.mode === "100755" ? 0o755 : 0o644);
        }),
      { concurrency: 4, discard: true },
    );
  });
  const fetch = Effect.fn("SkillSources.fetch")(function* (
    input: SkillFetchInput,
    state: SubscriptionRef.SubscriptionRef<SkillFetchJob>,
  ) {
    const url = yield* Effect.try({
      try: () => transport.normalizeUrl(input.url),
      catch: (cause) =>
        isSkillError(cause) ? cause : fail("invalid", "Use a valid public HTTPS git URL."),
    });
    if (input.ref !== undefined && (/^[\s-]|[\0\r\n]/.test(input.ref) || input.ref.length > 200))
      return yield* fail("invalid", "Use a branch, tag or commit as the source ref.");
    const id = yield* files.hash(`${url}\0${input.ref ?? "HEAD"}`);
    const repo = repository(id);
    yield* fs.makeDirectory(path.dirname(repo), { recursive: true });
    if (!(yield* fs.exists(repo))) {
      const staging = yield* fs.makeTempDirectory({
        directory: path.dirname(repo),
        prefix: "fetch-",
      });
      yield* git([
        "clone",
        "--bare",
        "--depth=1",
        "--filter=blob:limit=5m",
        "--no-tags",
        "--single-branch",
        "--",
        url,
        path.join(staging, "repository"),
      ]).pipe(
        Effect.andThen(fs.rename(path.join(staging, "repository"), repo)),
        Effect.ensuring(fs.remove(staging, { recursive: true }).pipe(Effect.ignore)),
      );
    }
    yield* git(["fetch", "--depth=1", "--no-tags", "origin", input.ref ?? "HEAD"], { cwd: repo });
    const commit = (yield* git(["rev-parse", "FETCH_HEAD^{commit}"], { cwd: repo })).stdout.trim();
    yield* SubscriptionRef.set(state, {
      id: input.requestId,
      phase: "scanning",
      source: null,
      error: null,
    });
    const entries = yield* tree({ id, commit });
    const skillFiles = entries.filter(
      (entry) =>
        (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md")) &&
        !entry.path.split("/").some((part) => part === "node_modules"),
    );
    if (
      skillFiles.length > 512 ||
      skillFiles.reduce((sum, file) => sum + file.bytes, 0) > SKILL_TREE_BYTE_LIMIT
    )
      return yield* fail("limit", "This source exceeds 512 skills or 64 MiB of skill metadata.");
    const skills = yield* Effect.forEach(
      skillFiles,
      (entry) =>
        Effect.gen(function* () {
          const subpath =
            entry.path === "SKILL.md" ? "." : entry.path.slice(0, -"/SKILL.md".length);
          if (
            entry.bytes > SKILL_FILE_LIMIT ||
            (entry.mode !== "100644" && entry.mode !== "100755")
          )
            return {
              subpath,
              name: path.basename(subpath),
              description: null,
              containsScripts: false,
              files: 0,
              bytes: entry.bytes,
              issues: [
                {
                  severity: "error" as const,
                  code: "unsupported",
                  message: "SKILL.md is linked or exceeds 256 KiB.",
                },
              ],
            } satisfies SkillSourceSkill;
          const text = new TextDecoder().decode(yield* blob(id, entry));
          const validation = validateSkill(text, path.basename(subpath));
          const contents = entries.filter(
            (file) => subpath === "." || file.path.startsWith(`${subpath}/`),
          );
          return {
            subpath,
            name: validation.name ?? path.basename(subpath),
            description: validation.description,
            ...(validation.compatibility === undefined
              ? {}
              : { compatibility: validation.compatibility }),
            containsScripts: contents.some(
              (file) =>
                file.mode === "100755" ||
                file.path.startsWith(subpath === "." ? "scripts/" : `${subpath}/scripts/`),
            ),
            files: contents.length,
            bytes: contents.reduce((sum, file) => sum + file.bytes, 0),
            issues: validation.issues,
          } satisfies SkillSourceSkill;
        }),
      { concurrency: 4 },
    );
    const licenseFile = entries.find(
      (entry) =>
        /^(?:LICENSE|LICENSE\.md|LICENSE\.txt)$/i.test(entry.path) &&
        entry.bytes <= SKILL_FILE_LIMIT,
    );
    const license =
      licenseFile === undefined
        ? null
        : new TextDecoder().decode(yield* blob(id, licenseFile)).slice(0, 32768);
    const source: SkillRegistrySource = {
      id,
      url,
      ref: input.ref ?? null,
      commit,
      fetchedAt: DateTime.formatIso(yield* DateTime.now),
      license,
      skills,
    };
    yield* store.update((previous) => ({
      ...previous,
      sources: [...previous.sources.filter((value) => value.id !== id), source],
    }));
    yield* SubscriptionRef.set(state, { id: input.requestId, phase: "ready", source, error: null });
  });
  const start = Effect.fn("SkillSources.start")(function* (input: SkillFetchInput) {
    const fingerprint = yield* encodeFetch(input);
    const existing = jobs.get(input.requestId);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint)
        return yield* fail("conflict", "This fetch request ID already names a different source.");
      return yield* SubscriptionRef.get(existing.state);
    }
    if (jobs.size >= 16) {
      for (const [id, job] of jobs)
        if (finished(yield* SubscriptionRef.get(job.state))) {
          jobs.delete(id);
          break;
        }
      if (jobs.size >= 16)
        return yield* fail(
          "limit",
          "Too many source fetches are active. Cancel one before starting another.",
        );
    }
    const state = yield* SubscriptionRef.make<SkillFetchJob>({
      id: input.requestId,
      phase: "cloning",
      source: null,
      error: null,
    });
    const job = { fingerprint, state, fiber: null as Fiber.Fiber<void> | null };
    jobs.set(input.requestId, job);
    job.fiber = yield* fetchLock.withPermit(fetch(input, state)).pipe(
      Effect.catch((cause) =>
        SubscriptionRef.set(state, {
          id: input.requestId,
          phase: "failed",
          source: null,
          error: isSkillError(cause) ? cause.message : "The source could not be fetched.",
        }),
      ),
      Effect.forkIn(serviceScope),
    );
    return yield* SubscriptionRef.get(state);
  });
  const watch = (requestId: string) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const job = jobs.get(requestId);
        if (job === undefined)
          return yield* fail(
            "not-found",
            "This fetch is no longer available. Fetch the source again.",
          );
        return SubscriptionRef.changes(job.state).pipe(Stream.takeUntil(finished));
      }),
    );
  const cancel = Effect.fn("SkillSources.cancel")(function* (requestId: string) {
    const job = jobs.get(requestId);
    if (job === undefined || finished(yield* SubscriptionRef.get(job.state))) return;
    if (job.fiber !== null) yield* Fiber.interrupt(job.fiber);
    yield* SubscriptionRef.set(job.state, {
      id: requestId,
      phase: "cancelled",
      source: null,
      error: null,
    });
  });
  return { start, watch, cancel, copySkill, tree, blob };
});
