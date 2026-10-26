import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ProcessRunner from "../processRunner.ts";
import { proveGitPublication, proveRepositoryPublication } from "./gitPublication.ts";

const layer = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const runner = yield* ProcessRunner.ProcessRunner;
  const parent = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
  const cwd = `${parent}/checkout`;
  const remote = `${parent}/remote.git`;
  const command = Effect.fnUntraced(function* (at: string, args: string[]) {
    const result = yield* runner.run({ command: "git", cwd: at, args });
    if (result.code !== 0) return yield* Effect.fail(result);
    return result.stdout.trim();
  });
  yield* command(parent, ["init", "--bare", "-b", "main", remote]);
  yield* command(parent, ["init", "-b", "main", cwd]);
  yield* command(cwd, ["config", "user.name", "Publication test"]);
  yield* command(cwd, ["config", "user.email", "publication@example.test"]);
  yield* command(cwd, ["commit", "--allow-empty", "-m", "Published work"]);
  yield* command(cwd, ["remote", "add", "origin", remote]);
  yield* command(cwd, ["push", "origin", "main"]);
  const head = yield* command(cwd, ["rev-parse", "HEAD"]);
  const proof = proveGitPublication((args) => command(cwd, args));
  const repositoryProof = (remoteUrls: ReadonlyArray<string> = [remote]) =>
    proveRepositoryPublication((args) => command(cwd, [...args]), remoteUrls);
  return { cwd, remote, parent, command, head, proof, repositoryProof };
});

it.layer(layer)("Git publication proof", (it) => {
  it.effect("accepts published branches and annotated tags while the remote branch advances", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(f.cwd, ["tag", "-a", "published", "-m", "Published tag"]);
      yield* f.command(f.cwd, ["push", "origin", "refs/tags/published"]);
      yield* f.command(f.cwd, ["branch", "sibling"]);
      yield* f.command(f.cwd, ["commit", "--allow-empty", "-m", "Remote advances"]);
      yield* f.command(f.cwd, ["push", "origin", "main"]);
      yield* f.command(f.cwd, ["reset", "--hard", f.head]);
      expect(yield* f.proof).toEqual({ published: true, head: f.head });
    }),
  );

  it.effect.each(["branch", "tag", "annotated-tag", "detached-head"] as const)(
    "rejects an unpublished %s despite a published main branch and stale private refs",
    (ref) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.command(f.cwd, ["switch", "-c", "local-only"]);
        yield* f.command(f.cwd, ["commit", "--allow-empty", "-m", "Unpublished work"]);
        const local = yield* f.command(f.cwd, ["rev-parse", "HEAD"]);
        yield* f.command(f.cwd, ["update-ref", "refs/t3/publication/9/heads/stale", local]);
        if (ref === "tag") yield* f.command(f.cwd, ["tag", "local-tag"]);
        if (ref === "detached-head") yield* f.command(f.cwd, ["switch", "--detach"]);
        else yield* f.command(f.cwd, ["switch", "main"]);
        if (ref !== "branch") yield* f.command(f.cwd, ["branch", "-D", "local-only"]);
        if (ref === "annotated-tag")
          yield* f.command(f.cwd, ["tag", "-a", "local-tag", "-m", "Unpublished annotation"]);
        expect(yield* f.proof).toMatchObject({ published: false });
      }),
  );

  it.effect.each(["branch", "tag"] as const)(
    "rejects a deleted remote %s after an earlier successful proof",
    (ref) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.command(f.cwd, ["switch", "-c", "sibling"]);
        yield* f.command(f.cwd, ["commit", "--allow-empty", "-m", "Published then deleted"]);
        const local = yield* f.command(f.cwd, ["rev-parse", "HEAD"]);
        if (ref === "tag") {
          yield* f.command(f.cwd, ["tag", "-a", "observed", "-m", "Observed tag"]);
          yield* f.command(f.cwd, ["push", "origin", "refs/tags/observed"]);
        } else yield* f.command(f.cwd, ["push", "origin", "sibling"]);
        yield* f.command(f.cwd, ["switch", "main"]);
        if (ref === "tag") yield* f.command(f.cwd, ["branch", "-D", "sibling"]);
        expect(yield* f.proof).toMatchObject({ published: true });
        yield* f.command(f.remote, [
          "update-ref",
          "-d",
          ref === "tag" ? "refs/tags/observed" : "refs/heads/sibling",
        ]);
        if (ref === "branch")
          expect(yield* f.command(f.cwd, ["rev-parse", "refs/remotes/origin/sibling"])).toBe(local);
        expect(yield* f.proof).toMatchObject({ published: false });
      }),
  );

  it.effect("fetches publication outside configured tracking mappings across all remotes", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(f.cwd, ["switch", "-c", "sibling"]);
      yield* f.command(f.cwd, ["commit", "--allow-empty", "-m", "Published sibling"]);
      yield* f.command(f.cwd, ["push", "origin", "sibling"]);
      yield* f.command(f.cwd, ["switch", "main"]);
      yield* f.command(f.cwd, [
        "config",
        "remote.origin.fetch",
        "+refs/heads/main:refs/remotes/origin/main",
      ]);
      yield* f.command(f.cwd, ["remote", "rename", "origin", "secondary"]);
      const primary = `${f.parent}/primary.git`;
      yield* f.command(f.parent, ["init", "--bare", "-b", "main", primary]);
      yield* f.command(f.cwd, ["remote", "add", "origin", primary]);
      yield* f.command(f.cwd, ["push", "origin", "main"]);
      expect(yield* f.proof).toEqual({ published: true, head: f.head });
    }),
  );

  it.effect("ignores and preserves hidden checkpoint refs with unpublished commits", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(f.cwd, ["switch", "--detach"]);
      yield* f.command(f.cwd, ["commit", "--allow-empty", "-m", "Hidden checkpoint"]);
      const checkpoint = yield* f.command(f.cwd, ["rev-parse", "HEAD"]);
      yield* f.command(f.cwd, ["update-ref", "refs/t3/checkpoints/test", checkpoint]);
      yield* f.command(f.cwd, ["switch", "main"]);
      expect(yield* f.proof).toEqual({ published: true, head: f.head });
      expect(yield* f.command(f.cwd, ["rev-parse", "refs/t3/checkpoints/test"])).toBe(checkpoint);
    }),
  );

  it.effect("preserves fetch state while rechecking publication before archive removal", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const fs = yield* FileSystem.FileSystem;
      const fetchHead = `${f.cwd}/.git/FETCH_HEAD`;
      yield* fs.writeFileString(fetchHead, "keep the user's fetch state\n");
      expect(yield* f.proof).toMatchObject({ published: true });
      const before = yield* fs.stat(fetchHead);
      expect(yield* f.proof).toMatchObject({ published: true });
      expect(yield* fs.readFileString(fetchHead)).toBe("keep the user's fetch state\n");
      expect((yield* fs.stat(fetchHead)).mtime).toEqual(before.mtime);
    }),
  );

  it.effect("fails a proof when any configured remote cannot be fetched", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(yield* f.proof).toMatchObject({ published: true });
      yield* f.command(f.cwd, ["remote", "add", "unreachable", `${f.parent}/missing.git`]);
      expect((yield* f.proof.pipe(Effect.exit))._tag).toBe("Failure");
    }),
  );

  it.effect("rejects missing remotes and remotes without published revisions", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(f.remote, ["update-ref", "-d", "refs/heads/main"]);
      expect(yield* f.proof).toEqual({ published: false, reason: "no published revisions" });
      yield* f.command(f.cwd, ["remote", "remove", "origin"]);
      expect(yield* f.proof).toEqual({ published: false, reason: "no publication remote" });
    }),
  );
});

it.layer(layer)("Repository publication proof", (it) => {
  it.effect.each(["stash", "reset-commit", "note", "other-ref"] as const)(
    "rejects work only a %s keeps, though every branch is published",
    (kind) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const fs = yield* FileSystem.FileSystem;
        expect(yield* f.repositoryProof()).toEqual({ published: true, head: f.head });
        if (kind === "stash") {
          yield* fs.writeFileString(`${f.cwd}/notes.md`, "unsaved\n");
          yield* f.command(f.cwd, ["stash", "--include-untracked"]);
        } else if (kind === "reset-commit") {
          yield* f.command(f.cwd, ["commit", "--allow-empty", "-m", "Dropped by a reset"]);
          yield* f.command(f.cwd, ["reset", "--hard", f.head]);
        } else if (kind === "note") yield* f.command(f.cwd, ["notes", "add", "-m", "Local note"]);
        else {
          yield* f.command(f.cwd, ["commit", "--allow-empty", "-m", "Kept under another ref"]);
          yield* f.command(f.cwd, ["update-ref", "refs/backup/work", "HEAD"]);
          yield* f.command(f.cwd, ["reset", "--hard", f.head]);
          yield* f.command(f.cwd, ["reflog", "expire", "--expire=now", "--all"]);
        }
        expect(yield* f.command(f.cwd, ["status", "--porcelain"])).toBe("");
        expect(yield* f.proof).toMatchObject({ published: true });
        expect(yield* f.repositoryProof()).toMatchObject({ published: false });
      }),
  );

  it.effect("counts only the given publication remotes, never a remote at the repository", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.command(f.cwd, ["commit", "--allow-empty", "-m", "Unpushed"]);
      yield* f.command(f.cwd, ["remote", "add", "self", "."]);
      expect(yield* f.proof).toMatchObject({ published: true });
      expect(yield* f.repositoryProof()).toMatchObject({ published: false });
      expect(yield* f.repositoryProof([])).toEqual({
        published: false,
        reason: "no publication remote",
      });
    }),
  );

  it.effect("leaves the repository's refs and objects untouched while the remote advances", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const other = `${f.parent}/other`;
      yield* f.command(f.parent, ["clone", f.remote, other]);
      yield* f.command(other, ["config", "user.name", "Publication test"]);
      yield* f.command(other, ["config", "user.email", "publication@example.test"]);
      yield* f.command(other, ["commit", "--allow-empty", "-m", "Someone else's work"]);
      yield* f.command(other, ["push", "origin", "main"]);
      const before = {
        refs: yield* f.command(f.cwd, ["for-each-ref"]),
        objects: yield* f.command(f.cwd, ["count-objects", "-v"]),
      };
      expect(yield* f.repositoryProof()).toEqual({ published: true, head: f.head });
      expect({
        refs: yield* f.command(f.cwd, ["for-each-ref"]),
        objects: yield* f.command(f.cwd, ["count-objects", "-v"]),
      }).toEqual(before);
    }),
  );
});
