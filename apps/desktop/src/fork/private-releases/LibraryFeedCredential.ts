import { libraryComputerDirectory } from "@t3tools/shared/fork/library-computer";
import { LOOM_RELEASES_ROUTE } from "@t3tools/shared/fork/release-mirror";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";

const MAX_CREDENTIAL_BYTES = 16 * 1024;
const HEADER_SAFE_TOKEN = /^[\x21-\x7e]{1,4096}$/u;

const PublisherCredential = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    sourceEnvironmentId: Schema.String,
    libraryUrl: Schema.String,
    accessToken: Schema.String,
    expiresAt: Schema.String,
  }),
);
const decodeCredential = Schema.decodeUnknownEffect(PublisherCredential);

/** The release feed this build checks, or `undefined` for a GitHub or mock feed. */
export function libraryReleaseFeedUrl(input: {
  readonly mockUpdates: boolean;
  readonly policyFeedUrl: string | undefined;
  readonly appUpdateYml: Option.Option<Readonly<Record<string, string>>>;
}): string | undefined {
  if (input.mockUpdates) return undefined;
  const feedUrl =
    input.policyFeedUrl ??
    Option.match(input.appUpdateYml, {
      onNone: () => undefined,
      onSome: (config) => (config.provider === "generic" ? config.url : undefined),
    });
  if (feedUrl === undefined) return undefined;
  const url = URL.parse(feedUrl);
  return url !== null &&
    url.protocol === "https:" &&
    url.pathname.replace(/\/+$/u, "").endsWith(LOOM_RELEASES_ROUTE)
    ? feedUrl
    : undefined;
}

/**
 * Reads this computer's Library credential as request headers for its Library's release feed, or
 * `null`. The file is the one the server reads: the enrolled credential, else the legacy secrets
 * copy. Read before every request, so the server's renewals apply without a restart.
 */
export const makeLibraryFeedHeaders = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const join = environment.path.join;
  return Effect.fn("desktop.updates.libraryFeedHeaders")(function* (feedUrl: string | undefined) {
    if (feedUrl === undefined) return null;
    const environmentId = (yield* fileSystem
      .readFileString(join(environment.stateDir, "environment-id"))
      .pipe(Effect.orElseSucceed(() => ""))).trim();
    if (environmentId === "") return null;
    const enrolled = join(
      libraryComputerDirectory(environment.homeDirectory, environmentId),
      "publisher.json",
    );
    const file = (yield* fileSystem.exists(enrolled).pipe(Effect.orElseSucceed(() => false)))
      ? enrolled
      : join(environment.stateDir, "secrets", "library-publisher.json");
    const now = yield* Clock.currentTimeMillis;
    return yield* Effect.gen(function* () {
      const stat = yield* fileSystem.stat(file);
      if (
        stat.type !== "File" ||
        (stat.mode & 0o077) !== 0 ||
        Number(stat.size) > MAX_CREDENTIAL_BYTES
      )
        return null;
      const credential = yield* decodeCredential(yield* fileSystem.readFileString(file));
      if (
        credential.sourceEnvironmentId !== environmentId ||
        !(Date.parse(credential.expiresAt) > now) ||
        URL.parse(credential.libraryUrl)?.origin !== new URL(feedUrl).origin ||
        !HEADER_SAFE_TOKEN.test(credential.accessToken)
      )
        return null;
      return { authorization: `Bearer ${credential.accessToken}` };
    }).pipe(
      // Neither the file's contents nor a decode failure may reach a log line.
      Effect.orElseSucceed(() => null),
    );
  });
});
