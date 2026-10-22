import { Argument, Command, Flag } from "effect/cli";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as RecoveryArchive from "./RecoveryArchive.ts";

const keyFile = Flag.String("key-file");
const environmentId = Flag.String("environment-id");
export const recoveryCommand = Command.make("recovery").pipe(
  Command.withDescription(
    "Encrypt and authenticate operator-supplied OpenBao snapshots locally. No server connection, backend restore or trust promotion. Keep the recovery key separately.",
  ),
  Command.withSubcommands([
    Command.make("key-create", { keyFile: Argument.String("new-key-file") }).pipe(
      Command.withDescription(
        "Create a private random recovery key at a new path. Never prints key bytes. Keep it separate from archives.",
      ),
      Command.withHandler(({ keyFile }) =>
        Effect.flatMap(RecoveryArchive.RecoveryArchive, (service) =>
          service.createKey(keyFile),
        ).pipe(
          Effect.andThen(
            Console.log("Recovery key created. Store it separately from Vault archives."),
          ),
          Effect.provide(RecoveryArchive.layer),
        ),
      ),
    ),
    Command.make("seal", {
      snapshotFile: Argument.String("snapshot-file"),
      archiveFile: Argument.String("new-archive-file"),
      keyFile,
      environmentId,
    }).pipe(
      Command.withDescription(
        "Encrypt a private, previously captured OpenBao snapshot into a new archive. Does not create or validate a backend snapshot.",
      ),
      Command.withHandler((input) =>
        Effect.flatMap(RecoveryArchive.RecoveryArchive, (service) => service.seal(input)).pipe(
          Effect.flatMap((result) => Console.log(JSON.stringify(result))),
          Effect.provide(RecoveryArchive.layer),
        ),
      ),
    ),
    Command.make("verify", {
      archiveFile: Argument.String("archive-file"),
      keyFile,
      environmentId,
    }).pipe(
      Command.withDescription(
        "Authenticate the entire archive and expected environment without writing plaintext. Backend restore acceptance is separate.",
      ),
      Command.withHandler((input) =>
        Effect.flatMap(RecoveryArchive.RecoveryArchive, (service) => service.verify(input)).pipe(
          Effect.flatMap((result) => Console.log(JSON.stringify(result))),
          Effect.provide(RecoveryArchive.layer),
        ),
      ),
    ),
    Command.make("unseal", {
      archiveFile: Argument.String("archive-file"),
      snapshotFile: Argument.String("new-snapshot-file"),
      keyFile,
      environmentId,
    }).pipe(
      Command.withDescription(
        "Recover an authenticated snapshot into a new owner-only file. Never restores a server, changes trust or overwrites an existing file.",
      ),
      Command.withHandler((input) =>
        Effect.flatMap(RecoveryArchive.RecoveryArchive, (service) => service.unseal(input)).pipe(
          Effect.flatMap((result) => Console.log(JSON.stringify(result))),
          Effect.provide(RecoveryArchive.layer),
        ),
      ),
    ),
  ]),
);
