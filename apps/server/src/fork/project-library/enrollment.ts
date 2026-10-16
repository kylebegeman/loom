import { EnvironmentId, IsoDateTime } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

/** Enrollment lives beside machine configuration, never inside a source's native history database. */
export function libraryComputerDirectory(homeDirectory: string, environmentId: string) {
  return `${homeDirectory}/.config/loom/computers/computer-${encodeURIComponent(environmentId)}`;
}
const PublicEnrollment = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    sourceEnvironmentId: EnvironmentId,
    libraryEnvironmentId: EnvironmentId,
    libraryUrl: Schema.String,
    expiresAt: IsoDateTime,
  }),
);
const decode = Schema.decodeEffect(PublicEnrollment);

/** Expose the destination, never the publisher credential, to first-time Library setup. */
export const readLibraryDestination = Effect.fnUntraced(function* (input: {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly credentialPaths: readonly string[];
}) {
  const fs = yield* FileSystem.FileSystem;
  for (const file of input.credentialPaths) {
    if (!(yield* fs.exists(file))) continue;
    const stat = yield* fs.stat(file);
    if ((stat.mode & 0o077) !== 0 || Number(stat.size) > 16 * 1024) return undefined;
    const enrollment = yield* decode(yield* fs.readFileString(file));
    if (enrollment.sourceEnvironmentId !== input.sourceEnvironmentId) return undefined;
    const url = yield* Effect.try(() => new URL(enrollment.libraryUrl));
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
      return undefined;
    return { environmentId: enrollment.libraryEnvironmentId, url: url.toString() };
  }
  return undefined;
});
