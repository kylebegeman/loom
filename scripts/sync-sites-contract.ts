#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { vitePlusCommand } from "./check-changed-command.ts";

const response = <S extends Schema.Constraint>(path: S) =>
  Schema.Struct({
    method: Schema.Literal("GET"),
    path,
    status: Schema.Literal(200),
    // Keep bodies unprojected so schema tests catch fields the client would discard.
    body: Schema.Unknown,
  });
const Bundle = Schema.fromJsonString(
  Schema.Struct({
    formatVersion: Schema.Literal(1),
    responses: Schema.Struct({
      "sites-list": response(Schema.Literal("/v1/integrations/sites")),
      "site-analytics": response(
        Schema.String.check(
          Schema.isPattern(/^\/v1\/integrations\/sites\/[a-z0-9][a-z0-9-]{0,63}\/analytics$/),
        ),
      ),
    }),
  }),
  { space: 2 },
);

const decodeBundle = Schema.decodeEffect(Bundle);
const encodeBundle = Schema.encodeEffect(Bundle);

export class SitesContractDriftError extends Schema.TaggedError<SitesContractDriftError>()(
  "SitesContractDriftError",
  {},
) {
  override get message(): string {
    return "Sites contract fixture is out of date. Run sites:contract:sync with --source.";
  }
}

class SitesContractFormatError extends Schema.TaggedError<SitesContractFormatError>()(
  "SitesContractFormatError",
  { exitCode: Schema.Number },
) {
  override get message(): string {
    return `Could not format the Sites contract fixture (exit ${this.exitCode}).`;
  }
}

export const syncSitesContract = Effect.fn("syncSitesContract")(function* (options: {
  readonly source: string;
  readonly check: boolean;
  readonly rootDir?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const root = options.rootDir ?? repositoryRoot;
  const destination = path.join(root, "packages/contracts/src/fork/fixtures/begamin-sites.json");
  const source = yield* fs.readFileString(path.resolve(options.source));
  const bundle = yield* decodeBundle(source);
  const contents = `${yield* encodeBundle(bundle)}\n`;
  if (options.check) {
    const current = yield* fs.readFileString(destination).pipe(
      Effect.flatMap(decodeBundle),
      Effect.flatMap(encodeBundle),
      Effect.map((json) => `${json}\n`),
    );
    if (current !== contents) {
      return yield* new SitesContractDriftError();
    }
    yield* Console.log("Sites contract fixture matches the canonical bundle.");
  } else {
    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
    yield* fs.writeFileString(destination, contents);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const [command, args] = vitePlusCommand(["fmt", destination]);
    const exitCode = yield* spawner.exitCode(
      ChildProcess.make(command, args, {
        cwd: repositoryRoot,
        stdout: "ignore",
        stderr: "inherit",
      }),
    );
    if (exitCode !== 0) return yield* new SitesContractFormatError({ exitCode });
    yield* Console.log("Synced packages/contracts/src/fork/fixtures/begamin-sites.json.");
  }
});

const command = Command.make(
  "sync-sites-contract",
  {
    source: Flag.String("source").pipe(
      Flag.withDescription("Path to the backend's canonical synthetic sites-consumer.json bundle."),
    ),
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("Fail if the checked-in fixture differs, without writing it."),
      Flag.withDefault(false),
    ),
  },
  syncSitesContract,
).pipe(Command.withDescription("Sync or check the Loom Sites consumer contract fixture."));

if (import.meta.main) {
  Command.run(command, { version: "1.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
