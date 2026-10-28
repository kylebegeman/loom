import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as Store from "./SkillStore.ts";
import { makeSkillFiles } from "./SkillFiles.ts";
import {
  makeSkillSources,
  normalizeSkillSourceUrl,
  parseGitSkillTree,
  SkillSourceTransport,
} from "./SkillSources.ts";

const base = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);
const config = ServerConfig.layerTest("/workspace", { prefix: "loom-skill-sources-test-" }).pipe(
  Layer.provide(base),
);
const layer = Store.layer.pipe(
  Layer.provideMerge(config),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(base),
);

it("rejects credentials, private addresses, query strings and option-like refs as source URLs", () => {
  for (const url of [
    "http://github.com/acme/skills",
    "https://user:secret@github.com/acme/skills",
    "https://127.0.0.1/source",
    "https://100.64.0.1/source",
    "https://host.ts.net/source",
    "https://github.com/acme/skills?token=x",
  ])
    expect(() => normalizeSkillSourceUrl(url)).toThrow();
  expect(normalizeSkillSourceUrl("https://github.com/acme/skills/")).toBe(
    "https://github.com/acme/skills",
  );
});

it("rejects unsafe Git paths before any filesystem writes", () => {
  const oid = "a".repeat(40);
  for (const name of [
    "../escape",
    "skills/../escape",
    "skills/.git/config",
    "skills\\escape",
    "/absolute",
  ])
    expect(() => parseGitSkillTree(`100644 blob ${oid} 3\t${name}\0`)).toThrow();
});

it.live(
  "fetches a pinned source and copies every nested file byte-for-byte without running scripts",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const files = yield* makeSkillFiles;
        const runner = yield* ProcessRunner.ProcessRunner;
        const root = yield* files.fs.makeTempDirectoryScoped();
        const repo = files.path.join(root, "source");
        yield* files.fs.makeDirectory(files.path.join(repo, "skills", "sample", "scripts"), {
          recursive: true,
        });
        const skillRoot = files.path.join(repo, "skills", "sample");
        yield* files.fs.writeFileString(
          files.path.join(skillRoot, "SKILL.md"),
          "---\nname: sample\ndescription: Use for a sample\n---\nRead the reference and use the binary asset.",
        );
        const binary = new Uint8Array([0, 255, 128, 13, 10]);
        yield* files.fs.writeFile(files.path.join(skillRoot, "asset.bin"), binary);
        yield* files.fs.writeFileString(
          files.path.join(skillRoot, "scripts", "install.sh"),
          `#!/bin/sh\ntouch '${files.path.join(root, "executed")}'\n`,
        );
        yield* files.fs.chmod(files.path.join(skillRoot, "scripts", "install.sh"), 0o755);
        yield* runner.run({ command: "git", args: ["init", repo] });
        yield* runner.run({ command: "git", args: ["add", "."], cwd: repo });
        yield* runner.run({
          command: "git",
          args: [
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "commit",
            "-m",
            "fixture",
          ],
          cwd: repo,
        });
        const sources = yield* makeSkillSources.pipe(
          Effect.provideService(SkillSourceTransport, {
            normalizeUrl: (value) => value,
            allowFile: true,
          }),
        );
        yield* sources.start({ requestId: "fetch-1", url: `file://${repo}` });
        const event = yield* sources.watch("fetch-1").pipe(Stream.runLast);
        expect(Option.getOrNull(event)?.phase, Option.getOrNull(event)?.error ?? "").toBe("ready");
        const source = Option.getOrThrow(event).source!;
        expect(source.commit).toMatch(/^[a-f0-9]{40}$/);
        expect(source.skills).toMatchObject([
          { name: "sample", files: 3, containsScripts: true, issues: [] },
        ]);
        const destination = files.path.join(root, "installed");
        yield* sources.copySkill(source, "skills/sample", destination);
        expect(
          Array.from(yield* files.fs.readFile(files.path.join(destination, "asset.bin"))),
        ).toEqual(Array.from(binary));
        expect(yield* files.fs.exists(files.path.join(destination, "scripts", "install.sh"))).toBe(
          true,
        );
        expect(yield* files.fs.exists(files.path.join(root, "executed"))).toBe(false);
        expect((yield* (yield* Store.SkillStore).read).sources[0]?.commit).toBe(source.commit);
        const cached = yield* sources.start({ requestId: "fetch-1", url: `file://${repo}` });
        expect(cached.source?.commit).toBe(source.commit);
      }),
    ).pipe(Effect.provide(layer)),
);

it.effect("cancels only the requested fetch and publishes its terminal state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const sources = yield* makeSkillSources.pipe(
        Effect.provideService(
          ProcessRunner.ProcessRunner,
          ProcessRunner.ProcessRunner.of({
            run: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
              ),
          }),
        ),
      );
      yield* sources.start({ requestId: "cancel-this", url: "https://github.com/acme/skills" });
      yield* Deferred.await(started);
      yield* sources.cancel("cancel-this");
      yield* Deferred.await(stopped);
      const event = yield* sources.watch("cancel-this").pipe(Stream.runLast);
      expect(Option.getOrNull(event)).toMatchObject({
        id: "cancel-this",
        phase: "cancelled",
        source: null,
      });
      expect(
        yield* Effect.flip(
          sources.start({ requestId: "cancel-this", url: "https://github.com/acme/other" }),
        ),
      ).toMatchObject({ reason: "conflict" });
    }),
  ).pipe(Effect.provide(layer)),
);
