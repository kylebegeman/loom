import { EnvironmentId, IsoDateTime } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Path from "effect/Path";

class EnrollmentOperationError extends Schema.TaggedError<EnrollmentOperationError>()(
  "EnrollmentOperationError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Enrollment operation failed.";
  }
}

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
    const url = yield* Effect.try({
      try: () => new URL(enrollment.libraryUrl),
      catch: (cause) => new EnrollmentOperationError({ cause }),
    });
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

export const writeLibraryCredential = Effect.fn("LibraryEnrollment.writeCredential")(
  function* (input: { readonly file: string; readonly contents: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.dirname(input.file);
    yield* fs.makeDirectory(dir, { recursive: true, mode: 0o700 });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const temporary = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ directory: dir, prefix: ".publisher-" }),
          (name) => fs.remove(name, { recursive: true }).pipe(Effect.ignore),
        );
        const file = path.join(temporary, "publisher.json");
        yield* fs.writeFileString(file, input.contents, { mode: 0o600, flag: "wx" });
        yield* Effect.scoped(fs.open(file).pipe(Effect.flatMap((handle) => handle.sync)));
        yield* fs.rename(file, input.file);
        yield* Effect.scoped(fs.open(dir).pipe(Effect.flatMap((handle) => handle.sync)));
      }),
    );
  },
);
