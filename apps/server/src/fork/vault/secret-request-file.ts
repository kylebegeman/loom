import { SecretRequestError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as FileSystem from "effect/FileSystem";

const isSecretRequestError = Schema.is(SecretRequestError);

export const prepareSecretRequestFile = Effect.fn("Vault.prepareSecretRequestFile")(function* (
  fs: FileSystem.FileSystem,
  directory: string,
  name: string,
  bytes: Uint8Array,
) {
  const file = `${directory}/${name}`;
  const partial = `${file}.partial`;
  return yield* Effect.gen(function* () {
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
    yield* fs.chmod(directory, 0o700);
    if (yield* fs.exists(file)) {
      const current = yield* fs.readFile(file);
      if (current.length !== bytes.length || current.some((byte, i) => byte !== bytes[i])) {
        return yield* new SecretRequestError({ reason: "already_answered" });
      }
      return file;
    }
    yield* fs.remove(partial, { force: true });
    yield* fs.writeFile(partial, bytes, { flag: "wx", mode: 0o600 });
    yield* fs.rename(partial, file);
    return file;
  }).pipe(
    Effect.mapError((cause) =>
      isSecretRequestError(cause) ? cause : new SecretRequestError({ reason: "store_failed" }),
    ),
  );
});

export const removeSecretRequestFile = Effect.fn("Vault.removeSecretRequestFile")(
  (fs: FileSystem.FileSystem, file: string | undefined) =>
    file === undefined
      ? Effect.void
      : fs
          .remove(file, { force: true })
          .pipe(Effect.catch(() => Effect.logWarning("Could not remove a private request file"))),
);
