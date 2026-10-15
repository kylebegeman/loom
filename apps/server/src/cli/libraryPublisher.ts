import { EnvironmentId } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import { Command, Flag, GlobalFlag } from "effect/cli";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as LibraryPublishingCredential from "../auth/LibraryPublishingCredential.ts";
import * as ServerConfig from "../config.ts";
import { authLocationFlags, DurationFromString, resolveCliAuthConfig } from "./config.ts";

/** Run on the Library server as its local operator. The token is written only to its private file. */
export const libraryPublisherCommand = Command.make("library-publisher", {
  ...authLocationFlags,
  sourceEnvironmentId: Flag.String("source-environment-id").pipe(Flag.withSchema(EnvironmentId)),
  libraryUrl: Flag.String("library-url").pipe(
    Flag.withDescription("Canonical HTTPS Library origin."),
  ),
  ttl: Flag.String("ttl").pipe(Flag.withSchema(DurationFromString), Flag.optional),
}).pipe(
  Command.withDescription(
    "Issue a source-specific Library publishing credential into the server's private secrets directory.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      return yield* Effect.gen(function* () {
        const publisher = yield* LibraryPublishingCredential.LibraryPublishingCredential;
        const issued = yield* publisher.issue({
          sourceEnvironmentId: flags.sourceEnvironmentId,
          libraryUrl: flags.libraryUrl,
          ...(Option.isSome(flags.ttl) ? { ttl: flags.ttl.value } : {}),
        });
        yield* Console.log(
          `Saved publisher credential: ${issued.credentialFile}\nSession: ${issued.sessionId}\nExpires: ${DateTime.formatIso(issued.expiresAt)}\nRevoke with: t3 auth session revoke ${issued.sessionId}`,
        );
      }).pipe(
        Effect.provide(
          LibraryPublishingCredential.layer.pipe(
            Layer.provide(EnvironmentAuth.layerRuntime),
            Layer.provide(ServerConfig.layer(config)),
            Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
          ),
        ),
      );
    }),
  ),
);
